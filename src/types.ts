export type TrackingState =
  | 'idle'
  | 'requesting_permission'
  | 'ready'
  | 'denied'
  | 'interrupted'
  | 'unsupported'
  | 'error'

export type CameraPermissionState =
  | 'unknown'
  | 'prompt'
  | 'granted'
  | 'denied'
  | 'unsupported'

export type CameraStreamState = 'inactive' | 'live' | 'muted' | 'ended'

export type GestureType = 'open_palm' | 'fist' | 'victory' | 'heart' | 'none'
export type InteractionMode = 'flow' | 'count'

export interface LandmarkPoint {
  x: number
  y: number
  z: number
}


export type FlowFocusFinger = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky'

export interface FlowFocusState {
  x: number
  y: number
  intensity: number
  confidence: number
  radius: number
  shimmer: number
  finger: FlowFocusFinger
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
  pinch: number
  rotation: number
  horizontal: number
  vertical: number
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
  badgeCount: number
  rigidity: number
  energy: number
  swirl: number
  bloom: number
  compression: number
  drift: { x: number; y: number }
  pinch: number
  eventPulse: number
}

export interface HandTrackingSnapshot {
  trackingState: TrackingState
  permissionState: CameraPermissionState
  streamState: CameraStreamState
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
