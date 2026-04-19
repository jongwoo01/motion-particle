import type {
  GestureType,
  InteractionMode,
  MotionMetrics,
  ParticleControllerState,
  ParticlePreset,
} from '../types'

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const PRESET_COUNTS = {
  high: {
    neutral: 22000,
    open_palm: 42000,
    fist: 18000,
    victory: 30000,
  },
  low: {
    neutral: 12000,
    open_palm: 22000,
    fist: 10000,
    victory: 16000,
  },
}

export function createParticlePreset(
  gesture: GestureType,
  lowPowerMode: boolean,
): ParticlePreset {
  const counts = lowPowerMode ? PRESET_COUNTS.low : PRESET_COUNTS.high

  switch (gesture) {
    case 'open_palm':
      return {
        count: counts.open_palm,
        size: 0.07,
        velocity: 0.82,
        spread: 1.78,
        attraction: 0.22,
        hueShift: 0.04,
        noiseStrength: 0.52,
        brightness: 0.98,
      }
    case 'fist':
      return {
        count: counts.fist,
        size: 0.076,
        velocity: 0.36,
        spread: 0.68,
        attraction: 0.88,
        hueShift: -0.04,
        noiseStrength: 0.08,
        brightness: 0.70,
      }
    case 'victory':
      return {
        count: counts.victory,
        size: 0.072,
        velocity: 0.94,
        spread: 1.22,
        attraction: 0.56,
        hueShift: 0.38,
        noiseStrength: 0.38,
        brightness: 0.88,
      }
    case 'heart':
      return {
        count: counts.victory,
        size: 0.086,
        velocity: 0.46,
        spread: 0.84,
        attraction: 1.08,
        hueShift: -0.08,
        noiseStrength: 0.1,
        brightness: 0.86,
      }
    case 'none':
    default:
      return {
        count: counts.neutral,
        size: 0.064,
        velocity: 0.52,
        spread: 0.94,
        attraction: 0.46,
        hueShift: 0.14,
        noiseStrength: 0.18,
        brightness: 0.66,
      }
  }
}

export function resolveParticleControllerState(input: {
  gesture: GestureType
  handDetected: boolean
  metrics: MotionMetrics
  hardwareConcurrency?: number
  mode?: InteractionMode
  countValue?: number
}): ParticleControllerState {
  const lowPowerMode = (input.hardwareConcurrency ?? 4) <= 6
  const resolvedMode = input.mode ?? 'flow'
  const resolvedCountValue = clamp(Math.round(input.countValue ?? 0), 0, 10)
  const basePreset =
    resolvedMode === 'count'
      ? {
          count: lowPowerMode ? 16000 : 30000,
          size: 0.086,
          velocity: 0.28,
          spread: 0.84,
          attraction: 1.34,
          hueShift: 0.12,
          noiseStrength: 0.02,
          brightness: 0.78,
        }
      : createParticlePreset(input.handDetected ? input.gesture : 'none', lowPowerMode)

  const motionBoost = input.handDetected
    ? clamp(
        input.metrics.velocity * 0.28 +
          input.metrics.openness * 0.18 +
          input.metrics.spread * 0.14,
        0,
        0.42,
      )
    : 0

  const spreadBoost = input.handDetected
    ? clamp(input.metrics.spread * 0.34 + input.metrics.openness * 0.08, 0, 0.34)
    : 0
  const drift = input.handDetected
    ? {
        x: clamp(input.metrics.horizontal * 0.74, -1, 1),
        y: clamp(input.metrics.vertical * 0.74, -1, 1),
      }
    : { x: 0, y: 0 }
  const energy = input.handDetected
    ? clamp(
        input.metrics.velocity * 0.42 +
          input.metrics.openness * 0.18 +
          input.metrics.spread * 0.12 +
          input.metrics.pinch * 0.16 +
          Math.abs(input.metrics.rotation) * 0.12,
        0,
        1,
      )
    : 0
  const swirl = input.handDetected
    ? clamp(
        Math.abs(input.metrics.rotation) * 0.6 +
          Math.abs(drift.x) * 0.14 +
          (input.gesture === 'victory' ? 0.24 : 0) +
          (input.gesture === 'heart' ? 0.12 : 0),
        0,
        1,
      )
    : 0
  const bloom = input.handDetected
    ? clamp(
        input.metrics.openness * 0.4 +
          input.metrics.spread * 0.34 +
          (input.gesture === 'open_palm' ? 0.28 : 0),
        0,
        1,
      )
    : 0
  const compression = input.handDetected
    ? clamp(
        (1 - input.metrics.openness) * 0.26 +
          input.metrics.pinch * 0.46 +
          (input.gesture === 'fist' ? 0.36 : 0),
        0,
        1,
      )
    : 0
  const eventPulse = input.handDetected
    ? clamp(
        input.metrics.velocity * 0.48 +
          Math.abs(drift.x) * 0.12 +
          Math.abs(drift.y) * 0.12 +
          input.metrics.pinch * 0.18 +
          Math.abs(input.metrics.rotation) * 0.1,
        0,
        1,
      )
    : 0
  const rigidity = !input.handDetected
    ? resolvedMode === 'count'
      ? 0.78
      : 0.22
    : resolvedMode === 'count'
      ? 0.86
      : clamp(
          0.22 +
            (input.gesture === 'fist' ? 0.82 : 0) +
            (input.gesture === 'heart' ? 0.38 : 0) +
            (input.gesture === 'victory' ? 0.12 : 0) +
            input.metrics.pinch * 0.12 +
            (1 - input.metrics.openness) * 0.18,
          0.2,
          1,
        )

  return {
    ...basePreset,
    count: Math.round(basePreset.count * (1 + motionBoost * (resolvedMode === 'count' ? 0.1 : 0.18))),
    size: basePreset.size + spreadBoost * (resolvedMode === 'count' ? 0.003 : 0.01),
    velocity: basePreset.velocity + motionBoost * (resolvedMode === 'count' ? 0.08 : 0.18),
    spread: basePreset.spread + spreadBoost * (resolvedMode === 'count' ? 0.16 : 0.44),
    noiseStrength: basePreset.noiseStrength + motionBoost * (resolvedMode === 'count' ? 0.02 : 0.09),
    brightness: basePreset.brightness + motionBoost * (resolvedMode === 'count' ? 0.05 : 0.12),
    gesture: input.handDetected ? input.gesture : 'none',
    handDetected: input.handDetected,
    anchor: input.handDetected ? input.metrics.anchor : { x: 0, y: 0 },
    mode: resolvedMode,
    countValue: resolvedCountValue,
    badgeCount: resolvedMode === 'count' ? resolvedCountValue : 0,
    rigidity,
    energy,
    swirl: resolvedMode === 'count' ? 0 : swirl,
    bloom: resolvedMode === 'count' ? 0 : bloom,
    compression: resolvedMode === 'count' ? 0 : compression,
    drift: resolvedMode === 'count' ? { x: 0, y: 0 } : drift,
    pinch: resolvedMode === 'count' ? 0 : input.metrics.pinch,
    eventPulse: resolvedMode === 'count' ? 0 : eventPulse,
  }
}
