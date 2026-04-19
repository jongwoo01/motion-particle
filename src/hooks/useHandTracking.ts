import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'
import type {
  CameraPermissionState,
  CameraStreamState,
  HandSignalFrame,
  HandTrackingSnapshot,
  TrackingState,
} from '../types'
import {
  GestureSmoother,
  classifyGroupGesture,
  countExtendedFingers,
  computeMotionMetrics,
  smoothFingerCountHistory,
} from '../lib/gesture'
import {
  CAMERA_PERMISSION_QUERY,
  classifyCameraStartError,
  normalizeCameraPermissionState,
} from '../lib/camera'

import type { Results, Hands as HandsInstance } from '@mediapipe/hands'

const INITIAL_SNAPSHOT: HandTrackingSnapshot = {
  trackingState: 'idle',
  permissionState: 'unknown',
  streamState: 'inactive',
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
  const smootherRef = useRef(new GestureSmoother(6))
  const pendingTimestampRef = useRef<number | null>(null)
  const inferenceStartedAtRef = useRef(0)
  const sendingRef = useRef(false)
  const isMountedRef = useRef(true)
  const fingerCountHistoryRef = useRef<number[]>([])
  const stableFingerCountRef = useRef(0)
  const permissionStatusRef = useRef<PermissionStatus | null>(null)
  const permissionCleanupRef = useRef<(() => void) | null>(null)
  const streamCleanupRef = useRef<(() => void) | null>(null)

  const stopLoop = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
  }, [])

  const clearPermissionSubscription = useCallback(() => {
    permissionCleanupRef.current?.()
    permissionCleanupRef.current = null
    permissionStatusRef.current = null
  }, [])

  const clearStreamSubscription = useCallback(() => {
    streamCleanupRef.current?.()
    streamCleanupRef.current = null
  }, [])

  const stopCamera = useCallback(() => {
    stopLoop()
    clearStreamSubscription()
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
        streamState: 'inactive',
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
  }, [clearStreamSubscription, stopLoop, videoRef])

  const setTerminalCameraState = useCallback((
    trackingState: TrackingState,
    debugState: string,
    errorMessage: string,
    streamState: CameraStreamState = 'ended',
    permissionState?: CameraPermissionState,
  ) => {
    stopCamera()
    startTransition(() => {
      setSnapshot((current) => ({
        ...current,
        modelReady: handsRef.current !== null,
        trackingState,
        permissionState: permissionState ?? current.permissionState,
        streamState,
        debugState,
        errorMessage,
      }))
    })
  }, [stopCamera])

  const syncPermissionState = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
      startTransition(() => {
        setSnapshot((current) => ({
          ...current,
          permissionState: 'unsupported',
        }))
      })
      return 'unsupported' as CameraPermissionState
    }

    clearPermissionSubscription()

    try {
      const permissionStatus = await navigator.permissions.query(CAMERA_PERMISSION_QUERY)
      permissionStatusRef.current = permissionStatus

      const applyPermissionState = () => {
        const nextPermissionState = normalizeCameraPermissionState(permissionStatus.state)
        debugLog('permission state updated', { state: nextPermissionState })

        if (!isMountedRef.current) {
          return
        }

        if (nextPermissionState === 'denied' && streamRef.current) {
          setTerminalCameraState(
            'denied',
            'camera permission revoked while active',
            '카메라 권한이 실행 중에 차단되었습니다. 주소창 또는 사이트 설정에서 다시 허용한 뒤 시도해주세요.',
            'ended',
            'denied',
          )
          return
        }

        startTransition(() => {
          setSnapshot((current) => ({
            ...current,
            permissionState: nextPermissionState,
            ...(current.trackingState === 'denied' && nextPermissionState !== 'denied'
              ? {
                  trackingState: 'idle' as TrackingState,
                  debugState: 'camera permission changed, ready to retry',
                  errorMessage: null,
                }
              : {}),
          }))
        })
      }

      const supportsPermissionEventTarget =
        typeof permissionStatus.addEventListener === 'function' &&
        typeof permissionStatus.removeEventListener === 'function'

      if (supportsPermissionEventTarget) {
        permissionStatus.addEventListener('change', applyPermissionState)
      } else {
        permissionStatus.onchange = applyPermissionState
      }
      permissionCleanupRef.current = () => {
        if (supportsPermissionEventTarget) {
          permissionStatus.removeEventListener('change', applyPermissionState)
        } else {
          permissionStatus.onchange = null
        }
      }

      applyPermissionState()
      return normalizeCameraPermissionState(permissionStatus.state)
    } catch (error) {
      debugLog('permission query unavailable', {
        error: error instanceof Error ? error.message : String(error),
      })
      startTransition(() => {
        setSnapshot((current) => ({
          ...current,
          permissionState: 'unsupported',
        }))
      })
      return 'unsupported' as CameraPermissionState
    }
  }, [clearPermissionSubscription, setTerminalCameraState])

  const bindStreamLifecycle = useCallback((stream: MediaStream) => {
    clearStreamSubscription()

    const videoTrack = stream.getVideoTracks()[0]
    if (!videoTrack) {
      return
    }

    const handleEnded = () => {
      if (!isMountedRef.current) {
        return
      }

      setTerminalCameraState(
        'interrupted',
        'camera track ended',
        '카메라 스트림이 종료되었습니다. 장치 연결과 브라우저 권한 상태를 확인한 뒤 다시 시도해주세요.',
      )
    }

    const handleMute = () => {
      if (!isMountedRef.current) {
        return
      }

      debugLog('camera track muted')
      startTransition(() => {
        setSnapshot((current) => ({
          ...current,
          isCameraActive: false,
          handDetected: false,
          streamState: 'muted',
          debugState: 'camera stream muted',
        }))
      })
    }

    const handleUnmute = () => {
      if (!isMountedRef.current) {
        return
      }

      debugLog('camera track unmuted')
      startTransition(() => {
        setSnapshot((current) => ({
          ...current,
          isCameraActive: true,
          trackingState: 'ready',
          streamState: 'live',
          debugState: 'camera stream resumed',
          errorMessage: null,
        }))
      })
    }

    const handleDeviceChange = () => {
      if (!isMountedRef.current) {
        return
      }

      const currentTrack = stream.getVideoTracks()[0]
      debugLog('media devices changed', {
        streamActive: stream.active,
        readyState: currentTrack?.readyState ?? 'missing',
      })

      if (!stream.active || !currentTrack || currentTrack.readyState === 'ended') {
        setTerminalCameraState(
          'interrupted',
          'camera device change interrupted active stream',
          '카메라 장치가 변경되면서 현재 스트림이 중단되었습니다. 다시 연결해주세요.',
        )
        return
      }

      startTransition(() => {
        setSnapshot((current) => ({
          ...current,
          debugState: 'media devices changed',
        }))
      })
    }

    videoTrack.addEventListener('ended', handleEnded)
    videoTrack.addEventListener('mute', handleMute)
    videoTrack.addEventListener('unmute', handleUnmute)
    navigator.mediaDevices?.addEventListener?.('devicechange', handleDeviceChange)

    streamCleanupRef.current = () => {
      videoTrack.removeEventListener('ended', handleEnded)
      videoTrack.removeEventListener('mute', handleMute)
      videoTrack.removeEventListener('unmute', handleUnmute)
      navigator.mediaDevices?.removeEventListener?.('devicechange', handleDeviceChange)
    }
  }, [clearStreamSubscription, setTerminalCameraState])

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
        streamState: 'live',
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
    const stream = streamRef.current
    const videoTrack = stream?.getVideoTracks()[0]

    if (stream && (!stream.active || !videoTrack || videoTrack.readyState === 'ended')) {
      setTerminalCameraState(
        'interrupted',
        'camera stream became inactive during processing',
        '카메라 스트림이 더 이상 활성 상태가 아닙니다. 장치 연결과 권한 상태를 확인한 뒤 다시 시도해주세요.',
      )
      return false
    }

    if (!video || !hands || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return true
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
      return true
    }

    if (sendingRef.current || video.currentTime === lastVideoTimeRef.current) {
      return true
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
    return true
  }, [setTerminalCameraState, videoRef])

  const animationTick = useCallback(async (timestamp: number) => {
    if (!isMountedRef.current) {
      return
    }

    try {
      const shouldContinue = await processVideoFrame(timestamp)
      if (!shouldContinue || !isMountedRef.current) {
        return
      }
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
      stopCamera()

      const permissionState = await syncPermissionState()
      if (permissionState === 'denied') {
        startTransition(() => {
          setSnapshot((current) => ({
            ...current,
            trackingState: 'denied',
            permissionState: 'denied',
            debugState: 'camera permission denied before request',
            errorMessage:
              '브라우저가 이 사이트의 카메라 권한을 다시 묻지 않을 수 있습니다. 주소창 또는 사이트 설정에서 허용한 뒤 다시 시도해주세요.',
          }))
        })
        return
      }

      startTransition(() => {
        setSnapshot((current) => ({
          ...current,
          trackingState: 'requesting_permission',
          debugState: 'requesting camera permission',
          errorMessage: null,
        }))
      })

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      })

      streamRef.current = stream
      bindStreamLifecycle(stream)
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
          permissionState: 'granted',
          streamState: 'live',
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
      const cameraError = classifyCameraStartError(error)
      console.error('[hands] start failed', error)

      stopCamera()
      startTransition(() => {
        setSnapshot((current) => ({
          ...current,
          modelReady: handsRef.current !== null,
          trackingState: cameraError.trackingState,
          permissionState: cameraError.permissionState ?? current.permissionState,
          debugState: cameraError.debugState,
          errorMessage: cameraError.message,
        }))
      })
    }
  }, [animationTick, bindStreamLifecycle, ensureHands, stopCamera, syncPermissionState, videoRef])

  useEffect(() => {
    isMountedRef.current = true
    void syncPermissionState()

    return () => {
      isMountedRef.current = false
      clearPermissionSubscription()
      stopCamera()
      void handsRef.current?.close()
      handsRef.current = null
    }
  }, [clearPermissionSubscription, stopCamera, syncPermissionState])

  return {
    ...snapshot,
    start,
  }
}
