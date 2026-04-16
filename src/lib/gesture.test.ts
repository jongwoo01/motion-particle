import { describe, expect, it } from 'vitest'
import type { HandSignalFrame, LandmarkPoint } from '../types'
import {
  GestureSmoother,
  classifyGesture,
  classifyGroupGesture,
  countExtendedFingers,
  computeMotionMetrics,
  smoothFingerCountHistory,
} from './gesture'

function buildHandLandmarks(config: {
  thumb?: 'open' | 'closed'
  index: 'open' | 'closed'
  middle: 'open' | 'closed'
  ring: 'open' | 'closed'
  pinky: 'open' | 'closed'
}): LandmarkPoint[] {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.6, z: 0 }))

  landmarks[0] = { x: 0.5, y: 0.82, z: 0 }
  landmarks[1] = { x: 0.46, y: 0.72, z: 0 }
  landmarks[2] = { x: 0.42, y: 0.68, z: 0 }
  landmarks[3] = { x: 0.35, y: 0.64, z: 0 }
  landmarks[4] = { x: 0.25, y: 0.61, z: 0 }

  landmarks[5] = { x: 0.38, y: 0.58, z: 0 }
  landmarks[6] = { x: 0.36, y: 0.43, z: 0 }
  landmarks[7] = { x: 0.355, y: 0.3, z: 0 }
  landmarks[8] = { x: 0.35, y: 0.2, z: 0 }

  landmarks[9] = { x: 0.48, y: 0.57, z: 0 }
  landmarks[10] = { x: 0.48, y: 0.41, z: 0 }
  landmarks[11] = { x: 0.48, y: 0.28, z: 0 }
  landmarks[12] = { x: 0.48, y: 0.17, z: 0 }

  landmarks[13] = { x: 0.58, y: 0.59, z: 0 }
  landmarks[14] = { x: 0.59, y: 0.47, z: 0 }
  landmarks[15] = { x: 0.595, y: 0.35, z: 0 }
  landmarks[16] = { x: 0.6, y: 0.24, z: 0 }

  landmarks[17] = { x: 0.68, y: 0.62, z: 0 }
  landmarks[18] = { x: 0.71, y: 0.54, z: 0 }
  landmarks[19] = { x: 0.725, y: 0.43, z: 0 }
  landmarks[20] = { x: 0.74, y: 0.32, z: 0 }

  const applyState = (
    tipIndex: number,
    pipIndex: number,
    dipIndex: number,
    mcpIndex: number,
    state: 'open' | 'closed',
  ) => {
    if (state === 'closed') {
      landmarks[pipIndex] = {
        x: landmarks[mcpIndex].x + 0.01,
        y: landmarks[mcpIndex].y + 0.04,
        z: 0,
      }
      landmarks[dipIndex] = {
        x: landmarks[mcpIndex].x + 0.06,
        y: landmarks[mcpIndex].y + 0.07,
        z: 0,
      }
      landmarks[tipIndex] = {
        x: landmarks[mcpIndex].x + 0.015,
        y: landmarks[mcpIndex].y + 0.14,
        z: 0,
      }
    }
  }

  if ((config.thumb ?? 'closed') === 'closed') {
    landmarks[1] = { x: 0.45, y: 0.74, z: 0 }
    landmarks[3] = { x: 0.41, y: 0.68, z: 0 }
    landmarks[4] = { x: 0.43, y: 0.66, z: 0 }
  }

  applyState(8, 6, 7, 5, config.index)
  applyState(12, 10, 11, 9, config.middle)
  applyState(16, 14, 15, 13, config.ring)
  applyState(20, 18, 19, 17, config.pinky)

  return landmarks
}

function mirrorLandmarks(landmarks: LandmarkPoint[]): LandmarkPoint[] {
  return landmarks.map((point) => ({
    x: 1 - point.x,
    y: point.y,
    z: point.z,
  }))
}

function buildFrame(
  config: Parameters<typeof buildHandLandmarks>[0],
  timestamp = 1000,
  handedness: HandSignalFrame['handedness'] = 'Right',
): HandSignalFrame {
  const landmarks = buildHandLandmarks(config)

  return {
    landmarks: handedness === 'Left' ? mirrorLandmarks(landmarks) : landmarks,
    handedness,
    confidence: 0.9,
    timestamp,
  }
}

describe('classifyGesture', () => {
  it('detects an open palm', () => {
    expect(
      classifyGesture(
        buildFrame({
          thumb: 'open',
          index: 'open',
          middle: 'open',
          ring: 'open',
          pinky: 'open',
        }),
      ),
    ).toBe('open_palm')
  })

  it('detects a fist', () => {
    expect(
      classifyGesture(
        buildFrame({
          index: 'closed',
          middle: 'closed',
          ring: 'closed',
          pinky: 'closed',
        }),
      ),
    ).toBe('fist')
  })

  it('detects a victory gesture', () => {
    expect(
      classifyGesture(
        buildFrame({
          index: 'open',
          middle: 'open',
          ring: 'closed',
          pinky: 'closed',
        }),
      ),
    ).toBe('victory')
  })

  it('returns none for ambiguous finger states', () => {
    expect(
      classifyGesture(
        buildFrame({
          index: 'open',
          middle: 'closed',
          ring: 'closed',
          pinky: 'closed',
        }),
      ),
    ).toBe('none')
  })

  it('detects a one-hand heart', () => {
    const frame = buildFrame({
      thumb: 'closed',
      index: 'closed',
      middle: 'closed',
      ring: 'closed',
      pinky: 'closed',
    })

    frame.landmarks[4] = { x: 0.38, y: 0.55, z: 0 }
    frame.landmarks[8] = { x: 0.4, y: 0.56, z: 0 }

    expect(classifyGesture(frame)).toBe('heart')
  })
})

describe('classifyGroupGesture', () => {
  it('detects a two-hand heart', () => {
    const left = buildFrame({
      thumb: 'open',
      index: 'open',
      middle: 'closed',
      ring: 'closed',
      pinky: 'closed',
    })
    const right = buildFrame({
      thumb: 'open',
      index: 'open',
      middle: 'closed',
      ring: 'closed',
      pinky: 'closed',
    })

    left.handedness = 'Left'
    right.handedness = 'Right'
    left.landmarks[0] = { x: 0.38, y: 0.82, z: 0 }
    right.landmarks[0] = { x: 0.62, y: 0.82, z: 0 }
    left.landmarks[5] = { x: 0.44, y: 0.58, z: 0 }
    right.landmarks[5] = { x: 0.56, y: 0.58, z: 0 }
    left.landmarks[4] = { x: 0.48, y: 0.63, z: 0 }
    right.landmarks[4] = { x: 0.52, y: 0.63, z: 0 }
    left.landmarks[8] = { x: 0.49, y: 0.48, z: 0 }
    right.landmarks[8] = { x: 0.51, y: 0.48, z: 0 }

    expect(classifyGroupGesture([left, right])).toBe('heart')
  })
})

describe('countExtendedFingers', () => {
  it('counts a fully open right hand as five', () => {
    expect(
      countExtendedFingers(
        buildFrame({
          thumb: 'open',
          index: 'open',
          middle: 'open',
          ring: 'open',
          pinky: 'open',
        }),
      ),
    ).toBe(5)
  })

  it('counts a fully open left hand as five', () => {
    expect(
      countExtendedFingers(
        buildFrame(
          {
            thumb: 'open',
            index: 'open',
            middle: 'open',
            ring: 'open',
            pinky: 'open',
          },
          1000,
          'Left',
        ),
      ),
    ).toBe(5)
  })

  it('counts a victory hand as two', () => {
    expect(
      countExtendedFingers(
        buildFrame({
          thumb: 'closed',
          index: 'open',
          middle: 'open',
          ring: 'closed',
          pinky: 'closed',
        }),
      ),
    ).toBe(2)
  })

  it('counts a standard one gesture as one even if the thumb sits slightly outward', () => {
    const frame = buildFrame({
      thumb: 'closed',
      index: 'open',
      middle: 'closed',
      ring: 'closed',
      pinky: 'closed',
    })

    frame.landmarks[1] = { x: 0.45, y: 0.74, z: 0 }
    frame.landmarks[2] = { x: 0.4, y: 0.7, z: 0 }
    frame.landmarks[3] = { x: 0.34, y: 0.65, z: 0 }
    frame.landmarks[4] = { x: 0.31, y: 0.62, z: 0 }

    expect(countExtendedFingers(frame)).toBe(1)
  })

  it('counts a standard victory gesture as two even with a side-resting thumb', () => {
    const frame = buildFrame({
      thumb: 'closed',
      index: 'open',
      middle: 'open',
      ring: 'closed',
      pinky: 'closed',
    })

    frame.landmarks[1] = { x: 0.45, y: 0.74, z: 0 }
    frame.landmarks[2] = { x: 0.39, y: 0.7, z: 0 }
    frame.landmarks[3] = { x: 0.33, y: 0.66, z: 0 }
    frame.landmarks[4] = { x: 0.28, y: 0.64, z: 0 }

    expect(countExtendedFingers(frame)).toBe(2)
  })

  it('does not overcount the thumb when only three middle fingers are extended', () => {
    expect(
      countExtendedFingers(
        buildFrame({
          thumb: 'closed',
          index: 'open',
          middle: 'open',
          ring: 'open',
          pinky: 'closed',
        }),
      ),
    ).toBe(3)
  })

  it('does not overcount a folded thumb that is laterally displaced across the palm', () => {
    const frame = buildFrame({
      thumb: 'closed',
      index: 'open',
      middle: 'open',
      ring: 'open',
      pinky: 'closed',
    })

    frame.landmarks[1] = { x: 0.46, y: 0.72, z: 0 }
    frame.landmarks[2] = { x: 0.43, y: 0.69, z: 0 }
    frame.landmarks[3] = { x: 0.49, y: 0.66, z: 0 }
    frame.landmarks[4] = { x: 0.62, y: 0.66, z: 0 }

    expect(countExtendedFingers(frame)).toBe(3)
  })
})

describe('GestureSmoother', () => {
  it('holds a gesture through brief flicker', () => {
    const smoother = new GestureSmoother(8)
    const sequence = [
      'open_palm',
      'open_palm',
      'open_palm',
      'none',
      'open_palm',
      'open_palm',
    ] as const

    const outputs = sequence.map((gesture) => smoother.update(gesture))
    expect(outputs.at(-1)).toBe('open_palm')
  })
})

describe('smoothFingerCountHistory', () => {
  it('prefers the recent dominant discrete count over the arithmetic mean', () => {
    expect(smoothFingerCountHistory([4, 4, 5, 4, 4, 4], 5)).toBe(4)
  })
})

describe('computeMotionMetrics', () => {
  it('extracts anchor, spread, openness, pinch, and motion vectors', () => {
    const previous = buildFrame(
      {
        index: 'open',
        middle: 'open',
        ring: 'open',
        pinky: 'open',
      },
      1000,
    )
    const next = buildFrame(
      {
        index: 'open',
        middle: 'open',
        ring: 'open',
        pinky: 'open',
      },
      1033,
    )

    next.landmarks = next.landmarks.map((point, index) =>
      index === 0 ? { ...point, x: point.x + 0.04 } : point,
    )

    const metrics = computeMotionMetrics(next, previous)
    expect(metrics.velocity).toBeGreaterThan(0)
    expect(metrics.openness).toBeGreaterThan(0.4)
    expect(metrics.spread).toBeGreaterThan(0.2)
    expect(metrics.pinch).toBeGreaterThanOrEqual(0)
    expect(metrics.rotation).toBeGreaterThanOrEqual(-1)
    expect(metrics.rotation).toBeLessThanOrEqual(1)
    expect(metrics.horizontal).toBeGreaterThan(0)
    expect(metrics.anchor.x).toBeGreaterThan(0)
  })
})
