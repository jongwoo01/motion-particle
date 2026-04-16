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
    neutral: 16000,
    open_palm: 30000,
    fist: 12000,
    victory: 22000,
  },
  low: {
    neutral: 9000,
    open_palm: 14000,
    fist: 8000,
    victory: 12000,
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
        size: 0.082,
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
        size: 0.104,
        velocity: 0.54,
        spread: 0.72,
        attraction: 1.12,
        hueShift: -0.03,
        noiseStrength: 0.12,
        brightness: 0.72,
      }
    case 'victory':
      return {
        count: counts.victory,
        size: 0.086,
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
        size: 0.106,
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
        size: 0.078,
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
          count: lowPowerMode ? 12000 : 24000,
          size: 0.112,
          velocity: 0.36,
          spread: 0.88,
          attraction: 1.26,
          hueShift: 0.12,
          noiseStrength: 0.06,
          brightness: 0.82,
        }
      : createParticlePreset(input.handDetected ? input.gesture : 'none', lowPowerMode)

  const motionBoost = input.handDetected
    ? clamp(input.metrics.velocity * 0.58 + input.metrics.openness * 0.42, 0, 0.7)
    : 0

  const spreadBoost = input.handDetected
    ? clamp(input.metrics.spread * 0.52, 0, 0.58)
    : 0

  return {
    ...basePreset,
    count: Math.round(basePreset.count * (1 + motionBoost * (resolvedMode === 'count' ? 0.12 : 0.28))),
    size: basePreset.size + spreadBoost * (resolvedMode === 'count' ? 0.004 : 0.01),
    velocity: basePreset.velocity + motionBoost * (resolvedMode === 'count' ? 0.14 : 0.28),
    spread: basePreset.spread + spreadBoost * (resolvedMode === 'count' ? 0.22 : 0.82),
    noiseStrength: basePreset.noiseStrength + motionBoost * (resolvedMode === 'count' ? 0.04 : 0.16),
    brightness: basePreset.brightness + motionBoost * (resolvedMode === 'count' ? 0.08 : 0.18),
    gesture: input.handDetected ? input.gesture : 'none',
    handDetected: input.handDetected,
    anchor: input.handDetected ? input.metrics.anchor : { x: 0, y: 0 },
    mode: resolvedMode,
    countValue: resolvedCountValue,
  }
}
