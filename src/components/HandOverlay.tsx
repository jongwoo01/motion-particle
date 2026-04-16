import type { LandmarkPoint } from '../types'
import './HandOverlay.css'

const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
]

interface HandOverlayProps {
  hands: LandmarkPoint[][]
  rawDetectionCount: number
}

const FINGERTIP_INDICES = new Set([4, 8, 12, 16, 20])

export function HandOverlay({ hands, rawDetectionCount }: HandOverlayProps) {
  if (rawDetectionCount < 1 || hands.length < 1) {
    return null
  }

  const visibleHands = hands.filter((hand) => hand.length >= 21)

  if (visibleHands.length < 1) {
    return null
  }

  return (
    <svg
      className="hand-overlay"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-label="손 추적 포인트"
    >
      {visibleHands.map((landmarks, handIndex) => (
        <g
          key={`hand-${handIndex}`}
          className="hand-overlay__hand"
          data-hand-index={handIndex}
        >
          <g className="hand-overlay__connections hand-overlay__connections--core">
            {HAND_CONNECTIONS.map(([start, end]) => {
              const from = landmarks[start]
              const to = landmarks[end]

              return (
                <line
                  key={`${handIndex}-${start}-${end}`}
                  x1={from.x * 100}
                  y1={from.y * 100}
                  x2={to.x * 100}
                  y2={to.y * 100}
                />
              )
            })}
          </g>
          <g className="hand-overlay__points">
            {landmarks.map((point, index) => (
              <circle
                key={`${handIndex}-${index}`}
                className={
                  FINGERTIP_INDICES.has(index)
                    ? 'hand-overlay__point hand-overlay__point--tip'
                    : 'hand-overlay__point'
                }
                cx={point.x * 100}
                cy={point.y * 100}
                r={index === 0 ? 0.82 : FINGERTIP_INDICES.has(index) ? 0.74 : 0.48}
              />
            ))}
          </g>
        </g>
      ))}
    </svg>
  )
}
