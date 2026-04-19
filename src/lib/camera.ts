import type { CameraPermissionState, TrackingState } from '../types'

export const CAMERA_PERMISSION_QUERY = {
  name: 'camera' as PermissionName,
}

export interface CameraStartErrorInfo {
  trackingState: TrackingState
  permissionState?: CameraPermissionState
  debugState: string
  message: string
}

export function normalizeCameraPermissionState(
  state: PermissionState | string,
): CameraPermissionState {
  switch (state) {
    case 'granted':
      return 'granted'
    case 'prompt':
      return 'prompt'
    case 'denied':
      return 'denied'
    default:
      return 'unsupported'
  }
}

export function classifyCameraStartError(error: unknown): CameraStartErrorInfo {
  const name = error instanceof DOMException ? error.name : ''

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return {
        trackingState: 'denied',
        permissionState: 'denied',
        debugState: 'camera permission denied',
        message:
          '브라우저가 이 사이트의 카메라 접근을 차단했습니다. 주소창 또는 사이트 설정에서 카메라 권한을 허용해야 다시 시작할 수 있습니다.',
      }
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return {
        trackingState: 'error',
        debugState: 'camera device not found',
        message: '사용 가능한 카메라를 찾지 못했습니다. 연결 상태와 OS 입력 장치를 확인해주세요.',
      }
    case 'NotReadableError':
    case 'TrackStartError':
      return {
        trackingState: 'error',
        debugState: 'camera device busy or unreadable',
        message:
          '카메라가 다른 앱에서 사용 중이거나 장치 접근에 실패했습니다. 다른 앱을 종료한 뒤 다시 시도해주세요.',
      }
    case 'AbortError':
      return {
        trackingState: 'error',
        debugState: 'camera start aborted',
        message: '카메라 시작이 중단되었습니다. 장치 연결 상태를 확인한 뒤 다시 시도해주세요.',
      }
    case 'OverconstrainedError':
      return {
        trackingState: 'error',
        debugState: 'camera constraints unsatisfied',
        message:
          '요청한 카메라 조건을 만족하는 장치를 찾지 못했습니다. 기본 카메라로 다시 시도하거나 다른 장치를 선택해주세요.',
      }
    case 'SecurityError':
      return {
        trackingState: 'unsupported',
        debugState: 'camera blocked by browser security policy',
        message: '현재 컨텍스트에서는 카메라 접근이 차단되었습니다. HTTPS 또는 localhost 환경에서 다시 열어주세요.',
      }
    case 'InvalidStateError':
      return {
        trackingState: 'error',
        debugState: 'document not active for camera start',
        message: '현재 문서가 비활성 상태라 카메라를 시작할 수 없습니다. 탭을 활성화한 뒤 다시 시도해주세요.',
      }
    default:
      if (error instanceof TypeError) {
        return {
          trackingState: 'unsupported',
          debugState: 'camera api unavailable in current context',
          message: '현재 브라우저 컨텍스트에서는 카메라 API를 사용할 수 없습니다.',
        }
      }

      return {
        trackingState: 'error',
        debugState: 'camera start failed',
        message: error instanceof Error ? error.message : '카메라를 시작하지 못했습니다.',
      }
  }
}
