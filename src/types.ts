export type TrackingState =
  | 'idle'
  | 'requesting_permission'
  | 'ready'
  | 'denied'
  | 'unsupported'
  | 'error'

export type GestureType = 'open_palm' | 'fist' | 'victory' | 'heart' | 'none'
export type InteractionMode = 'flow' | 'count'

export interface LandmarkPoint {
  x: number
  y: number
  z: number
}

export interface HandSignalFrame {
  landmarks: LandmarkPoint[]
  handedness: 'Left' | 'Right' | 'Unknown'
  confidence: number
  timestamp: number
}

export interface MotionMetrics {
  anchor: { x: number; y: number }
  velocity: number
  openness: number
  spread: number
}

export interface ParticlePreset {
  count: number
  size: number
  velocity: number
  spread: number
  attraction: number
  hueShift: number
  noiseStrength: number
  brightness: number
}

export interface ParticleControllerState extends ParticlePreset {
  gesture: GestureType
  handDetected: boolean
  anchor: { x: number; y: number }
  mode: InteractionMode
  countValue: number
}

export interface HandTrackingSnapshot {
  trackingState: TrackingState
  modelReady: boolean
  isCameraActive: boolean
  handDetected: boolean
  gesture: GestureType
  landmarks: LandmarkPoint[]
  hands: LandmarkPoint[][]
  fingerCount: number
  rawDetectionCount: number
  videoResolution: { width: number; height: number }
  lastInferenceDurationMs: number
  lastDetectionTimestamp: number | null
  sendCount: number
  resultCount: number
  debugState: string
  motionMetrics: MotionMetrics
  errorMessage: string | null
}
