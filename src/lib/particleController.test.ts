import { describe, expect, it } from 'vitest'
import { createParticlePreset, resolveParticleControllerState } from './particleController'

describe('particle presets', () => {
  it('assigns a larger spread and count to the open palm preset', () => {
    const neutral = createParticlePreset('none', false)
    const openPalm = createParticlePreset('open_palm', false)

    expect(openPalm.count).toBeGreaterThan(neutral.count)
    expect(openPalm.spread).toBeGreaterThan(neutral.spread)
  })

  it('assigns higher attraction to the fist preset', () => {
    const fist = createParticlePreset('fist', false)
    const neutral = createParticlePreset('none', false)

    expect(fist.attraction).toBeGreaterThan(neutral.attraction)
    expect(fist.count).toBeLessThan(neutral.count)
  })

  it('maps gesture and motion metrics into a renderer state', () => {
    const controller = resolveParticleControllerState({
      gesture: 'victory',
      handDetected: true,
      hardwareConcurrency: 12,
      metrics: {
        anchor: { x: 0.32, y: -0.22 },
        velocity: 0.6,
        openness: 0.7,
        spread: 0.8,
      },
    })

    expect(controller.gesture).toBe('victory')
    expect(controller.anchor.x).toBeCloseTo(0.32)
    expect(controller.count).toBeGreaterThan(20000)
    expect(controller.noiseStrength).toBeGreaterThan(0.3)
  })

  it('creates a tighter renderer state in count mode', () => {
    const controller = resolveParticleControllerState({
      gesture: 'none',
      handDetected: true,
      mode: 'count',
      countValue: 7,
      hardwareConcurrency: 12,
      metrics: {
        anchor: { x: 0.1, y: -0.12 },
        velocity: 0.4,
        openness: 0.9,
        spread: 0.8,
      },
    })

    expect(controller.mode).toBe('count')
    expect(controller.countValue).toBe(7)
    expect(controller.attraction).toBeGreaterThan(1)
    expect(controller.noiseStrength).toBeLessThan(0.2)
  })
})
