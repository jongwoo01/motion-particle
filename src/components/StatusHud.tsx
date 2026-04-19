import type {
  CameraPermissionState,
  CameraStreamState,
  GestureType,
  InteractionMode,
  TrackingState,
} from '../types'
import './StatusHud.css'

function toTrackingLabel(trackingState: TrackingState) {
  switch (trackingState) {
    case 'idle':
      return '대기'
    case 'requesting_permission':
      return '권한 요청'
    case 'ready':
      return '준비 완료'
    case 'denied':
      return '권한 차단'
    case 'interrupted':
      return '연결 끊김'
    case 'unsupported':
      return '지원 안 됨'
    case 'error':
      return '오류'
    default:
      return '알 수 없음'
  }
}

function toPermissionLabel(permissionState: CameraPermissionState) {
  switch (permissionState) {
    case 'granted':
      return '권한 허용'
    case 'prompt':
      return '권한 대기'
    case 'denied':
      return '권한 차단'
    case 'unsupported':
      return '권한 조회 미지원'
    case 'unknown':
    default:
      return '권한 미확인'
  }
}

function toStreamLabel(streamState: CameraStreamState) {
  switch (streamState) {
    case 'live':
      return '스트림 정상'
    case 'muted':
      return '스트림 일시 중단'
    case 'ended':
      return '스트림 종료'
    case 'inactive':
    default:
      return '스트림 없음'
  }
}

function toGestureLabel(gesture: GestureType) {
  switch (gesture) {
    case 'open_palm':
      return '펼친 손'
    case 'fist':
      return '주먹'
    case 'victory':
      return '브이'
    case 'heart':
      return '하트'
    case 'none':
    default:
      return '없음'
  }
}

function toFieldLabel(energy: number, swirl: number) {
  if (energy > 0.72) return '폭발'
  if (swirl > 0.56) return '와류'
  if (energy > 0.42) return '활성'
  return '부유'
}

interface StatusHudProps {
  modelReady: boolean
  trackingState: TrackingState
  permissionState: CameraPermissionState
  streamState: CameraStreamState
  isCameraActive: boolean
  handDetected: boolean
  gesture: GestureType
  rawDetectionCount: number
  videoResolution: { width: number; height: number }
  lastInferenceDurationMs: number
  sendCount: number
  resultCount: number
  debugState: string
  mode: InteractionMode
  fingerCount: number
  energy: number
  swirl: number
}

export function StatusHud(props: StatusHudProps) {
  const intensity = Math.round(props.energy * 100)

  return (
    <section className="status-hud" aria-label="실시간 상태">
      <div className="status-hud__row">
        <div className="status-hud__item">
          <span className="status-hud__label">Camera</span>
          <strong>{props.isCameraActive ? 'On' : 'Off'}</strong>
        </div>
        <div className="status-hud__item">
          <span className="status-hud__label">Hand</span>
          <strong>{props.handDetected ? 'Detected' : 'Searching'}</strong>
        </div>
        <div className="status-hud__item">
          <span className="status-hud__label">Gesture</span>
          <strong>{toGestureLabel(props.gesture)}</strong>
        </div>
        <div className="status-hud__item">
          <span className="status-hud__label">Points</span>
          <strong>{props.rawDetectionCount}</strong>
        </div>
        <div className="status-hud__item">
          <span className="status-hud__label">{props.mode === 'count' ? 'Count' : 'Field'}</span>
          <strong>{props.mode === 'count' ? props.fingerCount : toFieldLabel(props.energy, props.swirl)}</strong>
        </div>
      </div>
      <p className="status-hud__meta">
        {props.mode === 'count' ? 'Count mode' : `Flow mode · intensity ${intensity}`} · {props.modelReady ? 'Model loaded' : 'Model loading'} · {toTrackingLabel(props.trackingState)} · {toPermissionLabel(props.permissionState)} · {toStreamLabel(props.streamState)} · {props.videoResolution.width}×{props.videoResolution.height}
      </p>
    </section>
  )
}
