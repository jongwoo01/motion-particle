import type { GestureType, HandSignalFrame, LandmarkPoint, MotionMetrics } from '../types'

const WRIST = 0
const THUMB_CMC = 1
const THUMB_MCP = 2
const THUMB_IP = 3
const THUMB_TIP = 4

const INDEX_MCP = 5
const INDEX_PIP = 6
const INDEX_DIP = 7
const INDEX_TIP = 8

const MIDDLE_MCP = 9
const MIDDLE_PIP = 10
const MIDDLE_DIP = 11
const MIDDLE_TIP = 12

const RING_MCP = 13
const RING_PIP = 14
const RING_DIP = 15
const RING_TIP = 16

const PINKY_MCP = 17
const PINKY_PIP = 18
const PINKY_DIP = 19
const PINKY_TIP = 20

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const distance = (a: LandmarkPoint, b: LandmarkPoint) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

const subtract = (a: LandmarkPoint, b: LandmarkPoint) => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
})

const dot = (
  a: ReturnType<typeof subtract>,
  b: ReturnType<typeof subtract>,
) => a.x * b.x + a.y * b.y + a.z * b.z

const length = (vector: ReturnType<typeof subtract>) =>
  Math.hypot(vector.x, vector.y, vector.z)

const normalize = (vector: ReturnType<typeof subtract>) => {
  const vectorLength = length(vector)
  if (vectorLength < 1e-6) {
    return { x: 0, y: 0, z: 0 }
  }

  return {
    x: vector.x / vectorLength,
    y: vector.y / vectorLength,
    z: vector.z / vectorLength,
  }
}

const angleAt = (a: LandmarkPoint, b: LandmarkPoint, c: LandmarkPoint) => {
  const ba = subtract(a, b)
  const bc = subtract(c, b)
  const denominator = Math.max(length(ba) * length(bc), 1e-6)
  const cosine = clamp(dot(ba, bc) / denominator, -1, 1)
  return Math.acos(cosine)
}

const normalizeScore = (value: number, min: number, max: number) =>
  clamp((value - min) / (max - min), 0, 1)

type FingerState = {
  score: number
  extended: boolean
}

type FingerStates = {
  thumb: FingerState
  index: FingerState
  middle: FingerState
  ring: FingerState
  pinky: FingerState
}

type ThumbMetrics = {
  score: number
  outwardScore: number
  palmDistanceScore: number
  reachScore: number
}

function getPalmMetrics(landmarks: LandmarkPoint[]) {
  const wrist = landmarks[WRIST]
  const indexMcp = landmarks[INDEX_MCP]
  const middleMcp = landmarks[MIDDLE_MCP]
  const pinkyMcp = landmarks[PINKY_MCP]
  const palmCenter = {
    x: (wrist.x + indexMcp.x + middleMcp.x + pinkyMcp.x) / 4,
    y: (wrist.y + indexMcp.y + middleMcp.y + pinkyMcp.y) / 4,
    z: (wrist.z + indexMcp.z + middleMcp.z + pinkyMcp.z) / 4,
  }
  const palmWidth = Math.max(distance(indexMcp, pinkyMcp), 1e-4)
  const palmHeight = Math.max(distance(wrist, middleMcp), 1e-4)
  const lateralAxis = normalize(subtract(indexMcp, pinkyMcp))

  return {
    palmCenter,
    palmWidth,
    palmHeight,
    lateralAxis,
  }
}

function getFingerExtendedScore(
  landmarks: LandmarkPoint[],
  mcp: number,
  pip: number,
  dip: number,
  tip: number,
) {
  const { palmCenter, palmWidth, palmHeight } = getPalmMetrics(landmarks)
  const pipAngle = angleAt(landmarks[mcp], landmarks[pip], landmarks[dip])
  const dipAngle = angleAt(landmarks[pip], landmarks[dip], landmarks[tip])
  const straightness =
    normalizeScore(pipAngle, 1.45, 2.95) * 0.55 +
    normalizeScore(dipAngle, 1.7, 3.05) * 0.45

  const reachGain = distance(landmarks[tip], palmCenter) - distance(landmarks[pip], palmCenter)
  const reachScore = normalizeScore(reachGain, palmWidth * 0.08, palmWidth * 0.42)

  const fingertipLift = distance(landmarks[tip], landmarks[mcp]) - distance(landmarks[pip], landmarks[mcp])
  const liftScore = normalizeScore(fingertipLift, palmHeight * 0.08, palmHeight * 0.48)

  return clamp(straightness * 0.45 + reachScore * 0.3 + liftScore * 0.25, 0, 1)
}

function getThumbMetrics(frame: Pick<HandSignalFrame, 'landmarks' | 'handedness'>): ThumbMetrics {
  const { landmarks } = frame
  const { palmCenter, palmWidth, lateralAxis } = getPalmMetrics(landmarks)
  const thumbTip = landmarks[THUMB_TIP]
  const thumbIp = landmarks[THUMB_IP]
  const thumbMcp = landmarks[THUMB_MCP]
  const thumbCmc = landmarks[THUMB_CMC]

  const mcpAngle = angleAt(thumbCmc, thumbMcp, thumbIp)
  const ipAngle = angleAt(thumbMcp, thumbIp, thumbTip)
  const straightScore =
    normalizeScore(mcpAngle, 1.15, 2.65) * 0.4 +
    normalizeScore(ipAngle, 1.55, 3.0) * 0.6

  const palmDistanceGain = distance(thumbTip, palmCenter) - distance(thumbMcp, palmCenter)
  const palmDistanceScore = normalizeScore(
    palmDistanceGain,
    palmWidth * 0.08,
    palmWidth * 0.48,
  )

  // Signed lateral motion is the key discriminator for the thumb:
  // an extended thumb moves outward from the palm along the finger row,
  // while a folded thumb may still look laterally displaced if we only use abs().
  const outwardGain = dot(subtract(thumbTip, thumbMcp), lateralAxis)
  const outwardScore = normalizeScore(
    outwardGain,
    palmWidth * 0.04,
    palmWidth * 0.34,
  )

  const palmSideProjection = dot(subtract(thumbTip, palmCenter), lateralAxis)
  const palmSideScore = normalizeScore(
    palmSideProjection,
    palmWidth * 0.14,
    palmWidth * 0.42,
  )

  const reachGain = distance(thumbTip, thumbMcp) - distance(thumbIp, thumbMcp)
  const reachScore = normalizeScore(
    reachGain,
    palmWidth * 0.08,
    palmWidth * 0.34,
  )

  return {
    score: clamp(
      straightScore * 0.22 +
        palmDistanceScore * 0.16 +
        outwardScore * 0.2 +
        palmSideScore * 0.1 +
        reachScore * 0.32,
      0,
      1,
    ),
    outwardScore,
    palmDistanceScore,
    reachScore,
  }
}

function getFingerStates(frame: Pick<HandSignalFrame, 'landmarks' | 'handedness'>): FingerStates {
  const { landmarks } = frame

  const thumbMetrics = getThumbMetrics(frame)
  const indexScore = getFingerExtendedScore(landmarks, INDEX_MCP, INDEX_PIP, INDEX_DIP, INDEX_TIP)
  const middleScore = getFingerExtendedScore(
    landmarks,
    MIDDLE_MCP,
    MIDDLE_PIP,
    MIDDLE_DIP,
    MIDDLE_TIP,
  )
  const ringScore = getFingerExtendedScore(landmarks, RING_MCP, RING_PIP, RING_DIP, RING_TIP)
  const pinkyScore = getFingerExtendedScore(
    landmarks,
    PINKY_MCP,
    PINKY_PIP,
    PINKY_DIP,
    PINKY_TIP,
  )

  return {
    thumb: {
      score: thumbMetrics.score,
      extended: thumbMetrics.score > 0.52,
    },
    index: {
      score: indexScore,
      extended: indexScore > 0.58,
    },
    middle: {
      score: middleScore,
      extended: middleScore > 0.58,
    },
    ring: {
      score: ringScore,
      extended: ringScore > 0.56,
    },
    pinky: {
      score: pinkyScore,
      extended: pinkyScore > 0.54,
    },
  }
}

export function classifyGesture(frame: Pick<HandSignalFrame, 'landmarks' | 'handedness'>): GestureType {
  if (frame.landmarks.length < 21) {
    return 'none'
  }

  const { landmarks } = frame
  const fingerStates = getFingerStates(frame)
  const extendedCount = Object.values(fingerStates).filter((finger) => finger.extended).length
  const { palmWidth, palmCenter } = getPalmMetrics(landmarks)
  const thumbIndexDistance = distance(landmarks[THUMB_TIP], landmarks[INDEX_TIP])
  const topPairY = (landmarks[THUMB_TIP].y + landmarks[INDEX_TIP].y) / 2
  const otherFingersCurled =
    !fingerStates.middle.extended && !fingerStates.ring.extended && !fingerStates.pinky.extended
  const thumbIndexLifted = topPairY < landmarks[INDEX_MCP].y + palmWidth * 0.08
  const thumbIndexReach =
    distance(landmarks[THUMB_TIP], palmCenter) + distance(landmarks[INDEX_TIP], palmCenter)

  if (
    thumbIndexDistance < palmWidth * 0.4 &&
    thumbIndexLifted &&
    otherFingersCurled &&
    thumbIndexReach > palmWidth * 0.64
  ) {
    return 'heart'
  }

  if (
    fingerStates.index.extended &&
    fingerStates.middle.extended &&
    !fingerStates.ring.extended &&
    !fingerStates.pinky.extended &&
    distance(landmarks[INDEX_TIP], landmarks[MIDDLE_TIP]) > palmWidth * 0.16
  ) {
    return 'victory'
  }

  const nonThumbAverage =
    (fingerStates.index.score +
      fingerStates.middle.score +
      fingerStates.ring.score +
      fingerStates.pinky.score) /
    4

  if (extendedCount >= 4 && nonThumbAverage > 0.66) {
    return 'open_palm'
  }

  if (extendedCount <= 1 && nonThumbAverage < 0.38 && fingerStates.thumb.score < 0.56) {
    return 'fist'
  }

  return 'none'
}

export function classifyGroupGesture(frames: HandSignalFrame[]): GestureType {
  if (frames.length < 1) {
    return 'none'
  }

  if (frames.length >= 2) {
    const [first, second] = frames
    const firstPalmWidth = distance(first.landmarks[INDEX_MCP], first.landmarks[PINKY_MCP])
    const secondPalmWidth = distance(second.landmarks[INDEX_MCP], second.landmarks[PINKY_MCP])
    const scale = (firstPalmWidth + secondPalmWidth) / 2
    const thumbsClose =
      distance(first.landmarks[THUMB_TIP], second.landmarks[THUMB_TIP]) < scale * 0.72
    const indicesClose =
      distance(first.landmarks[INDEX_TIP], second.landmarks[INDEX_TIP]) < scale * 0.68
    const thumbBelowIndex =
      (first.landmarks[THUMB_TIP].y + second.landmarks[THUMB_TIP].y) / 2 >
      (first.landmarks[INDEX_TIP].y + second.landmarks[INDEX_TIP].y) / 2
    const handsSeparated =
      Math.abs(
        ((first.landmarks[WRIST].x + first.landmarks[INDEX_MCP].x) / 2) -
          ((second.landmarks[WRIST].x + second.landmarks[INDEX_MCP].x) / 2),
      ) >
      scale * 0.55

    if (thumbsClose && indicesClose && thumbBelowIndex && handsSeparated) {
      return 'heart'
    }
  }

  return classifyGesture(frames[0])
}

export function countExtendedFingers(frame: Pick<HandSignalFrame, 'landmarks' | 'handedness'>) {
  if (frame.landmarks.length < 21) {
    return 0
  }

  const fingerStates = getFingerStates(frame)
  const thumbMetrics = getThumbMetrics(frame)
  const thumbCounted =
    thumbMetrics.score > 0.72 &&
    thumbMetrics.reachScore > 0.58 &&
    thumbMetrics.outwardScore > 0.45 &&
    thumbMetrics.palmDistanceScore > 0.18

  const extendedCount =
    Number(thumbCounted) +
    Number(fingerStates.index.extended) +
    Number(fingerStates.middle.extended) +
    Number(fingerStates.ring.extended) +
    Number(fingerStates.pinky.extended)
  return clamp(extendedCount, 0, 5)
}

export function smoothFingerCountHistory(history: number[], previousCount: number) {
  if (history.length === 0) {
    return previousCount
  }

  const weightedScores = new Map<number, number>()
  history.forEach((value, index) => {
    const weight = index + 1
    weightedScores.set(value, (weightedScores.get(value) ?? 0) + weight)
  })

  let bestValue = history.at(-1) ?? previousCount
  let bestScore = -1
  const previousScore = weightedScores.get(previousCount) ?? 0

  for (const [value, score] of weightedScores.entries()) {
    if (score > bestScore || (score === bestScore && value === history.at(-1))) {
      bestValue = value
      bestScore = score
    }
  }

  if (previousScore >= bestScore * 0.86) {
    return previousCount
  }

  return clamp(bestValue, 0, 10)
}

export class GestureSmoother {
  private readonly windowSize: number
  private readonly history: GestureType[] = []
  private stableGesture: GestureType = 'none'

  constructor(windowSize = 8) {
    this.windowSize = windowSize
  }

  update(nextGesture: GestureType): GestureType {
    this.history.push(nextGesture)
    if (this.history.length > this.windowSize) {
      this.history.shift()
    }

    const scores = new Map<GestureType, number>()
    const totalWeight = this.history.reduce((sum, gesture, index) => {
      const weight = index + 1
      scores.set(gesture, (scores.get(gesture) ?? 0) + weight)
      return sum + weight
    }, 0)

    let bestGesture: GestureType = 'none'
    let bestScore = -1

    for (const [gesture, score] of scores.entries()) {
      if (score > bestScore) {
        bestGesture = gesture
        bestScore = score
      }
    }

    const dominance = totalWeight === 0 ? 0 : bestScore / totalWeight
    if (dominance < 0.42 && this.stableGesture !== 'none') {
      return this.stableGesture
    }

    this.stableGesture = bestGesture
    return bestGesture
  }
}

export function computeMotionMetrics(
  frame: HandSignalFrame | null,
  previousFrame: HandSignalFrame | null,
): MotionMetrics {
  if (!frame || frame.landmarks.length < 21) {
    return {
      anchor: { x: 0, y: 0 },
      velocity: 0,
      openness: 0,
      spread: 0,
      pinch: 0,
      rotation: 0,
      horizontal: 0,
      vertical: 0,
    }
  }

  const wrist = frame.landmarks[WRIST]
  const indexBase = frame.landmarks[INDEX_MCP]
  const pinkyBase = frame.landmarks[PINKY_MCP]
  const anchor = {
    x: (wrist.x + indexBase.x + pinkyBase.x) / 3,
    y: (wrist.y + indexBase.y + pinkyBase.y) / 3,
  }

  const fingertipDistances = [
    distance(wrist, frame.landmarks[INDEX_TIP]),
    distance(wrist, frame.landmarks[MIDDLE_TIP]),
    distance(wrist, frame.landmarks[RING_TIP]),
    distance(wrist, frame.landmarks[PINKY_TIP]),
  ]
  const openness = clamp(
    (fingertipDistances.reduce((sum, value) => sum + value, 0) /
      fingertipDistances.length -
      0.18) /
      0.28,
    0,
    1,
  )

  const spread = clamp(
    (distance(frame.landmarks[INDEX_TIP], frame.landmarks[PINKY_TIP]) - 0.08) /
      0.38,
    0,
    1,
  )
  const pinch = clamp(
    1 - (distance(frame.landmarks[THUMB_TIP], frame.landmarks[INDEX_TIP]) - 0.025) / 0.24,
    0,
    1,
  )
  const lateralAxis = normalize(subtract(frame.landmarks[INDEX_MCP], frame.landmarks[PINKY_MCP]))

  if (!previousFrame) {
    return {
      anchor: {
        x: (anchor.x - 0.5) * 2,
        y: (0.5 - anchor.y) * 2,
      },
      velocity: 0,
      openness,
      spread,
      pinch,
      rotation: 0,
      horizontal: 0,
      vertical: 0,
    }
  }

  const previousWrist = previousFrame.landmarks[WRIST]
  const previousIndexBase = previousFrame.landmarks[INDEX_MCP]
  const previousPinkyBase = previousFrame.landmarks[PINKY_MCP]
  const previousAnchor = {
    x: (previousWrist.x + previousIndexBase.x + previousPinkyBase.x) / 3,
    y: (previousWrist.y + previousIndexBase.y + previousPinkyBase.y) / 3,
  }

  const deltaTime = Math.max(frame.timestamp - previousFrame.timestamp, 16)
  const previousLateralAxis = normalize(
    subtract(previousFrame.landmarks[INDEX_MCP], previousFrame.landmarks[PINKY_MCP]),
  )
  const velocity = clamp(
    (Math.hypot(anchor.x - previousAnchor.x, anchor.y - previousAnchor.y) /
      deltaTime) *
      26,
    0,
    1,
  )
  const horizontal = clamp(((anchor.x - previousAnchor.x) / deltaTime) * 58, -1, 1)
  const vertical = clamp(((previousAnchor.y - anchor.y) / deltaTime) * 58, -1, 1)
  const rotation = clamp(
    previousLateralAxis.x * lateralAxis.y - previousLateralAxis.y * lateralAxis.x,
    -1,
    1,
  )

  return {
    anchor: {
      x: (anchor.x - 0.5) * 2,
      y: (0.5 - anchor.y) * 2,
    },
    velocity,
    openness,
    spread,
    pinch,
    rotation,
    horizontal,
    vertical,
  }
}
