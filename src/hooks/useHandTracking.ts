import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'
import type { HandSignalFrame, HandTrackingSnapshot } from '../types'
import {
  GestureSmoother,
  classifyGroupGesture,
  countExtendedFingers,
  computeMotionMetrics,
  smoothFingerCountHistory,
} from '../lib/gesture'

import type { Results, Hands as HandsInstance } from '@mediapipe/hands'

const INITIAL_SNAPSHOT: HandTrackingSnapshot = {
  trackingState: 'idle',
  modelReady: false,
  isCameraActive: false,
  handDetected: false,
  gesture: 'none',
  landmarks: [],
  hands: [],
  fingerCount: 0,
  rawDetectionCount: 0,
  videoResolution: { width: 0, height: 0 },
  lastInferenceDurationMs: 0,
  lastDetectionTimestamp: null,
  sendCount: 0,
  resultCount: 0,
  debugState: 'idle',
  motionMetrics: {
    anchor: { x: 0, y: 0 },
    velocity: 0,
    openness: 0,
    spread: 0,
    pinch: 0,
    rotation: 0,
    horizontal: 0,
    vertical: 0,
  },
  errorMessage: null,
}

const HANDS_CDN_ROOT =
  'https://cdn.jsdelivr.net/npm/@mediapipe/hands'

const debugLog = (phase: string, payload?: Record<string, unknown>) => {
  if (payload) {
    console.info(`[hands] ${phase}`, payload)
    return
  }
  console.info(`[hands] ${phase}`)
}

declare global {
  interface Window {
    Hands?: new (config?: { locateFile?: (file: string, prefix?: string) => string }) => HandsInstance
  }
}

async function loadHandsConstructor() {
  if (typeof window === 'undefined') {
    throw new Error('브라우저 환경에서만 손 추적을 초기화할 수 있습니다.')
  }

  if (window.Hands) {
    debugLog('script cache hit')
    return window.Hands
  }

  await new Promise<void>((resolve, reject) => {
    debugLog('script load start', { src: `${HANDS_CDN_ROOT}/hands.js` })
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-mediapipe-hands="true"]',
    )

    if (existing) {
      existing.addEventListener(
        'load',
        () => {
          debugLog('script load done (existing tag)')
          resolve()
        },
        { once: true },
      )
      existing.addEventListener(
        'error',
        () => {
          console.error('[hands] script load failed (existing tag)')
          reject(new Error('MediaPipe Hands SDK 로드에 실패했습니다.'))
        },
        { once: true },
      )
      return
    }

    const script = document.createElement('script')
    script.src = `${HANDS_CDN_ROOT}/hands.js`
    script.async = true
    script.dataset.mediapipeHands = 'true'
    script.onload = () => {
      debugLog('script load done')
      resolve()
    }
    script.onerror = () => {
      console.error('[hands] script load failed')
      reject(new Error('MediaPipe Hands SDK 로드에 실패했습니다.'))
    }
    document.head.appendChild(script)
  })

  if (!window.Hands) {
    throw new Error('MediaPipe Hands 전역 생성자를 찾지 못했습니다.')
  }

  return window.Hands
}

export function useHandTracking(videoRef: RefObject<HTMLVideoElement | null>) {
  const [snapshot, setSnapshot] = useState<HandTrackingSnapshot>(INITIAL_SNAPSHOT)

  const streamRef = useRef<MediaStream | null>(null)
  const handsRef = useRef<HandsInstance | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const lastVideoTimeRef = useRef(-1)
  const previousFrameRef = useRef<HandSignalFrame | null>(null)
  const smootherRef = useRef(new GestureSmoother(8))
  const pendingTimestampRef = useRef<number | null>(null)
  const inferenceStartedAtRef = useRef(0)
  const sendingRef = useRef(false)
  const isMountedRef = useRef(true)
  const fingerCountHistoryRef = useRef<number[]>([])
  const stableFingerCountRef = useRef(0)

  const stopLoop = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
  }, [])

  const stopCamera = useCallback(() => {
    stopLoop()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }

    previousFrameRef.current = null
    lastVideoTimeRef.current = -1
    pendingTimestampRef.current = null
    sendingRef.current = false
    smootherRef.current = new GestureSmoother(8)
    fingerCountHistoryRef.current = []
    stableFingerCountRef.current = 0

    startTransition(() => {
      setSnapshot((current) => ({
        ...current,
        isCameraActive: false,
        handDetected: false,
        gesture: 'none',
        landmarks: [],
        hands: [],
        fingerCount: 0,
        rawDetectionCount: 0,
        videoResolution: {
          width: videoRef.current?.videoWidth ?? current.videoResolution.width,
          height: videoRef.current?.videoHeight ?? current.videoResolution.height,
        },
        debugState: 'camera stopped',
        motionMetrics: INITIAL_SNAPSHOT.motionMetrics,
      }))
    })
  }, [stopLoop, videoRef])

  const handleResults = useCallback((results: Results) => {
    const video = videoRef.current
    const timestamp = pendingTimestampRef.current ?? performance.now()
    const inferenceDurationMs = performance.now() - inferenceStartedAtRef.current
    const rawDetectionCount = results.multiHandLandmarks.length
    const detectedHands = results.multiHandLandmarks.map((handLandmarks) =>
      handLandmarks.map((point) => ({
        x: point.x,
        y: point.y,
        z: point.z,
      })),
    )
    const primaryLandmarks = results.multiHandLandmarks[0]
    const primaryHandedness = results.multiHandedness[0]
    const detectedFrames: HandSignalFrame[] = results.multiHandLandmarks.map(
      (handLandmarks, handIndex) => ({
        landmarks: handLandmarks.map((point) => ({
          x: point.x,
          y: point.y,
          z: point.z,
        })),
        handedness:
          results.multiHandedness[handIndex]?.label === 'Left' ||
          results.multiHandedness[handIndex]?.label === 'Right'
            ? results.multiHandedness[handIndex].label
            : 'Unknown',
        confidence: results.multiHandedness[handIndex]?.score ?? 0.5,
        timestamp,
      }),
    )
    debugLog('results', {
      rawDetectionCount,
      handedness: results.multiHandedness,
      inferenceDurationMs: Number(inferenceDurationMs.toFixed(2)),
    })

    if (!primaryLandmarks) {
      const smoothedGesture = smootherRef.current.update('none')
      previousFrameRef.current = null
      fingerCountHistoryRef.current = []
      stableFingerCountRef.current = 0

      startTransition(() => {
        setSnapshot((current) => ({
          ...current,
          handDetected: false,
          gesture: smoothedGesture,
          landmarks: [],
          hands: [],
          fingerCount: 0,
          rawDetectionCount,
          videoResolution: {
            width: video?.videoWidth ?? current.videoResolution.width,
            height: video?.videoHeight ?? current.videoResolution.height,
          },
          lastInferenceDurationMs: inferenceDurationMs,
          lastDetectionTimestamp: timestamp,
          resultCount: current.resultCount + 1,
          debugState: 'results received: no hand',
          motionMetrics: INITIAL_SNAPSHOT.motionMetrics,
        }))
      })
      return
    }

    const frame: HandSignalFrame = {
      landmarks: primaryLandmarks.map((point) => ({
        x: point.x,
        y: point.y,
        z: point.z,
      })),
      handedness:
        primaryHandedness?.label === 'Left' || primaryHandedness?.label === 'Right'
          ? primaryHandedness.label
          : 'Unknown',
      confidence: primaryHandedness?.score ?? 0.5,
      timestamp,
    }

    const gesture = smootherRef.current.update(classifyGroupGesture(detectedFrames))
    const motionMetrics = computeMotionMetrics(frame, previousFrameRef.current)
    const nextFingerCount = detectedFrames.reduce(
      (sum, detectedFrame) => sum + countExtendedFingers(detectedFrame),
      0,
    )
    fingerCountHistoryRef.current.push(nextFingerCount)
    if (fingerCountHistoryRef.current.length > 6) {
      fingerCountHistoryRef.current.shift()
    }
    const smoothedFingerCount = smoothFingerCountHistory(
      fingerCountHistoryRef.current,
      stableFingerCountRef.current,
    )
    stableFingerCountRef.current = smoothedFingerCount
    previousFrameRef.current = frame

    startTransition(() => {
      setSnapshot((current) => ({
        ...current,
        trackingState: 'ready',
        isCameraActive: true,
        handDetected: true,
        gesture,
        landmarks: frame.landmarks,
        hands: detectedHands,
        fingerCount: smoothedFingerCount,
        rawDetectionCount,
        videoResolution: {
          width: video?.videoWidth ?? current.videoResolution.width,
          height: video?.videoHeight ?? current.videoResolution.height,
        },
        lastInferenceDurationMs: inferenceDurationMs,
        lastDetectionTimestamp: timestamp,
        resultCount: current.resultCount + 1,
        debugState: `results received: ${rawDetectionCount} hand(s)`,
        motionMetrics,
        errorMessage: null,
      }))
    })
  }, [videoRef])

  const ensureHands = useCallback(async () => {
    if (handsRef.current) {
      debugLog('initialize skipped: existing instance')
      return handsRef.current
    }

    const Hands = await loadHandsConstructor()
    debugLog('initialize start')
    const hands = new Hands({
      locateFile: (file) => `${HANDS_CDN_ROOT}/${file}`,
    })

    hands.setOptions({
      selfieMode: true,
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.35,
      minTrackingConfidence: 0.35,
    })

    hands.onResults(handleResults)
    await hands.initialize()
    handsRef.current = hands
    debugLog('initialize done')

    startTransition(() => {
      setSnapshot((current) => ({
        ...current,
        modelReady: true,
        debugState: 'hands initialized',
        errorMessage: null,
      }))
    })

    return hands
  }, [handleResults])

  const processVideoFrame = useCallback(async (timestamp: number) => {
    const video = videoRef.current
    const hands = handsRef.current

    if (!video || !hands || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return
    }

    if (video.videoWidth === 0 || video.videoHeight === 0) {
      debugLog('video frame skipped: zero resolution', {
        width: video.videoWidth,
        height: video.videoHeight,
        readyState: video.readyState,
      })
      startTransition(() => {
        setSnapshot((current) => ({
          ...current,
          videoResolution: { width: video.videoWidth, height: video.videoHeight },
          debugState: 'waiting for non-zero video resolution',
        }))
      })
      return
    }

    if (sendingRef.current || video.currentTime === lastVideoTimeRef.current) {
      return
    }

    sendingRef.current = true
    lastVideoTimeRef.current = video.currentTime
    pendingTimestampRef.current = timestamp
    inferenceStartedAtRef.current = performance.now()
    debugLog('send start', {
      currentTime: Number(video.currentTime.toFixed(3)),
      readyState: video.readyState,
      width: video.videoWidth,
      height: video.videoHeight,
    })
    startTransition(() => {
      setSnapshot((current) => ({
        ...current,
        sendCount: current.sendCount + 1,
        debugState: `send #${current.sendCount + 1} started`,
      }))
    })

    try {
      await hands.send({ image: video })
      debugLog('send resolved', {
        currentTime: Number(video.currentTime.toFixed(3)),
      })
    } finally {
      sendingRef.current = false
    }
  }, [videoRef])

  const animationTick = useCallback(async (timestamp: number) => {
    if (!isMountedRef.current) {
      return
    }

    try {
      await processVideoFrame(timestamp)
    } catch (error) {
      console.error('[hands] frame processing error', error)
      stopCamera()
      startTransition(() => {
        setSnapshot((current) => ({
          ...current,
          trackingState: 'error',
          debugState: 'frame processing error',
          errorMessage:
            error instanceof Error
              ? error.message
              : '손 추적 처리 중 알 수 없는 오류가 발생했습니다.',
        }))
      })
      return
    }

    animationFrameRef.current = requestAnimationFrame(animationTick)
  }, [processVideoFrame, stopCamera])

  const start = useCallback(async () => {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      setSnapshot((current) => ({
        ...current,
        trackingState: 'unsupported',
      }))
      return
    }

    const video = videoRef.current
    if (!video) {
      return
    }

    try {
      debugLog('camera start requested')
      startTransition(() => {
        setSnapshot((current) => ({
          ...current,
          trackingState: 'requesting_permission',
          debugState: 'requesting camera permission',
          errorMessage: null,
        }))
      })

      stopCamera()

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      })

      streamRef.current = stream
      video.srcObject = stream
      video.muted = true
      video.playsInline = true
      video.autoplay = true
      debugLog('camera stream attached')

      await new Promise<void>((resolve) => {
        if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
          resolve()
          return
        }

        const onLoadedMetadata = () => {
          video.removeEventListener('loadedmetadata', onLoadedMetadata)
          resolve()
        }

        video.addEventListener('loadedmetadata', onLoadedMetadata)
      })

      await video.play()
      debugLog('video playback started', {
        width: video.videoWidth,
        height: video.videoHeight,
        readyState: video.readyState,
      })
      await ensureHands()

      startTransition(() => {
        setSnapshot((current) => ({
          ...current,
          trackingState: 'ready',
          isCameraActive: true,
          videoResolution: {
            width: video.videoWidth,
            height: video.videoHeight,
          },
          debugState: 'camera ready, waiting for first send',
          errorMessage: null,
        }))
      })

      animationFrameRef.current = requestAnimationFrame(animationTick)
    } catch (error) {
      const name = error instanceof DOMException ? error.name : ''
      const denied = name === 'NotAllowedError' || name === 'PermissionDeniedError'
      console.error('[hands] start failed', error)

      stopCamera()
      startTransition(() => {
        setSnapshot((current) => ({
          ...current,
          modelReady: handsRef.current !== null,
          trackingState: denied ? 'denied' : 'error',
          debugState: denied ? 'camera permission denied' : 'camera start failed',
          errorMessage:
            error instanceof Error ? error.message : '카메라를 시작하지 못했습니다.',
        }))
      })
    }
  }, [animationTick, ensureHands, stopCamera, videoRef])

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
      stopCamera()
      void handsRef.current?.close()
      handsRef.current = null
    }
  }, [stopCamera])

  return {
    ...snapshot,
    start,
  }
}
