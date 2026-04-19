import { useMemo, useRef, useState } from 'react'
import './App.css'
import { HandOverlay } from './components/HandOverlay'
import { ParticleScene } from './components/ParticleScene'
import { StatusHud } from './components/StatusHud'
import { useHandTracking } from './hooks/useHandTracking'
import { resolveParticleControllerState } from './lib/particleController'
import type { InteractionMode } from './types'

function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const tracking = useHandTracking(videoRef)
  const [mode, setMode] = useState<InteractionMode>('flow')

  const controllerState = useMemo(
    () =>
      resolveParticleControllerState({
        gesture: tracking.gesture,
        handDetected: tracking.handDetected,
        metrics: tracking.motionMetrics,
        mode,
        countValue: tracking.fingerCount,
        hardwareConcurrency:
          typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency,
      }),
    [mode, tracking.fingerCount, tracking.gesture, tracking.handDetected, tracking.motionMetrics],
  )

  const overlayCopy = useMemo(() => {
    switch (tracking.trackingState) {
      case 'idle':
        return {
          eyebrow: 'Interactive Experience',
          title: '손을 들어 이 우주를 빚어보세요',
          body: '카메라가 켜지는 순간, 당신의 손이 이 공간의 유일한 물리법칙이 됩니다.',
          action: '카메라 시작',
        }
      case 'requesting_permission':
        return {
          eyebrow: '권한 요청 중',
          title: '브라우저 카메라 권한을 허용해주세요',
          body: 'Chrome 기준으로 가장 안정적으로 동작합니다. 권한이 열리면 손 추적과 3D 입자 렌더링이 바로 시작됩니다.',
          action: '권한 대기 중',
        }
      case 'denied':
        return {
          eyebrow: '권한 필요',
          title: '카메라 접근이 차단되었습니다',
          body: '브라우저는 차단 후 자동으로 다시 묻지 않을 수 있습니다. 주소창 또는 사이트 설정에서 카메라 권한을 허용한 뒤 다시 시도해주세요.',
          action: '다시 시도',
        }
      case 'interrupted':
        return {
          eyebrow: '카메라 연결 끊김',
          title: '실행 중이던 카메라 스트림이 중단되었습니다',
          body:
            tracking.errorMessage ??
            '장치 분리, 브라우저 권한 변경, 다른 앱의 점유 여부를 확인한 뒤 다시 연결해주세요.',
          action: '다시 연결',
        }
      case 'unsupported':
        return {
          eyebrow: '지원되지 않음',
          title: '이 브라우저는 필요한 미디어 API를 지원하지 않습니다',
          body: '최신 데스크톱 Chrome 또는 Chromium 계열 브라우저에서 다시 열어주세요.',
          action: '새로고침',
        }
      case 'error':
        return {
          eyebrow: '실행 오류',
          title: '손 추적 엔진을 시작하지 못했습니다',
          body:
            tracking.errorMessage ??
            '네트워크 상태 또는 브라우저 권한을 확인한 뒤 다시 시도해주세요.',
          action: '다시 시도',
        }
      case 'ready':
      default:
        return null
    }
  }, [tracking.errorMessage, tracking.trackingState])

  return (
    <main className="app-shell">
      <div className="app-backdrop" aria-hidden="true" />
      <video
        ref={videoRef}
        className="camera-capture"
        muted
        playsInline
      />

      <ParticleScene controllerState={controllerState} />
      <HandOverlay
        hands={tracking.hands}
        rawDetectionCount={tracking.rawDetectionCount}
      />

      <section className="scene-overlay">
        <header className="title-lockup">
          <p className="title-lockup__kicker">Palm Universe</p>
          <h1>
            <span>손끝에서</span>
            <span>우주가 시작됩니다</span>
          </h1>
          <p className="title-lockup__body">
            {mode === 'count'
              ? `지금 이 우주의 밀도는 ${tracking.fingerCount}입니다.`
              : '오직 당신 손으로 공간을 제어해보세요.'}
          </p>
        </header>

        <section className="info-dock">
          <StatusHud
            modelReady={tracking.modelReady}
            trackingState={tracking.trackingState}
            permissionState={tracking.permissionState}
            streamState={tracking.streamState}
            isCameraActive={tracking.isCameraActive}
            handDetected={tracking.handDetected}
            gesture={tracking.gesture}
            rawDetectionCount={tracking.rawDetectionCount}
            videoResolution={tracking.videoResolution}
            lastInferenceDurationMs={tracking.lastInferenceDurationMs}
            sendCount={tracking.sendCount}
            resultCount={tracking.resultCount}
            debugState={tracking.debugState}
            mode={mode}
            fingerCount={tracking.fingerCount}
            energy={controllerState.energy}
            swirl={controllerState.swirl}
          />

          <div className="info-dock__rail">
            <div className="mode-switch" role="tablist" aria-label="입자 모드">
              <button
                type="button"
                className={mode === 'flow' ? 'mode-switch__button is-active' : 'mode-switch__button'}
                onClick={() => setMode('flow')}
              >
                흐름
              </button>
              <button
                type="button"
                className={mode === 'count' ? 'mode-switch__button is-active' : 'mode-switch__button'}
                onClick={() => setMode('count')}
              >
                카운트
              </button>
            </div>

            <section className="gesture-legend" aria-label="제스처 안내">
              {mode === 'count' ? (
                <span><strong>현재 숫자</strong> {tracking.fingerCount}</span>
              ) : (
                <>
                  <span><strong>천천히 회전</strong> 와류</span>
                  <span><strong>빠르게 밀기</strong> 충격파</span>
                  <span><strong>펼친 손</strong> 개화</span>
                  <span><strong>손 모으기</strong> 응축</span>
                </>
              )}
            </section>
          </div>
        </section>
      </section>

      {overlayCopy ? (
        <section className="launch-panel" aria-live="polite">
          <div className="launch-panel__content">
            <p className="launch-panel__eyebrow">{overlayCopy.eyebrow}</p>
            <h2>{overlayCopy.title}</h2>
            <p>{overlayCopy.body}</p>
            <div className="launch-panel__actions">
              <button
                className="launch-button"
                type="button"
                onClick={tracking.start}
                disabled={tracking.trackingState === 'requesting_permission'}
              >
                {overlayCopy.action}
              </button>
              <p className="launch-panel__hint">
                최신 데스크톱 Chrome 권장 · 카메라 화면은 숨기고 손 인식
                포인트만 표시합니다.
              </p>
            </div>
          </div>
        </section>
      ) : null}
    </main>
  )
}

export default App
