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
    expect(fist.noiseStrength).toBeLessThan(neutral.noiseStrength)
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
        pinch: 0.15,
        rotation: 0.52,
        horizontal: 0.28,
        vertical: -0.18,
        depth: 0.12,
      },
    })

    expect(controller.gesture).toBe('victory')
    expect(controller.anchor.x).toBeCloseTo(0.32)
    expect(controller.count).toBeGreaterThan(20000)
    expect(controller.noiseStrength).toBeGreaterThan(0.3)
    expect(controller.swirl).toBeGreaterThan(0.4)
    expect(controller.energy).toBeGreaterThan(0.4)
    expect(controller.rigidity).toBeLessThan(0.5)
    expect(controller.travel).toBeGreaterThan(0)
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
        pinch: 0.12,
        rotation: 0.24,
        horizontal: 0.16,
        vertical: 0.09,
        depth: 0.4,
      },
    })

    expect(controller.mode).toBe('count')
    expect(controller.countValue).toBe(7)
    expect(controller.badgeCount).toBe(7)
    expect(controller.attraction).toBeGreaterThan(1)
    expect(controller.noiseStrength).toBeLessThan(0.08)
    expect(controller.swirl).toBe(0)
    expect(controller.eventPulse).toBe(0)
    expect(controller.rigidity).toBeGreaterThan(0.8)
    expect(controller.travel).toBe(0)
  })

  it('keeps countdown mode identical to count mode within the 0-5 range', () => {
    const countController = resolveParticleControllerState({
      gesture: 'none',
      handDetected: true,
      mode: 'count',
      countValue: 5,
      hardwareConcurrency: 12,
      metrics: {
        anchor: { x: 0.1, y: -0.12 },
        velocity: 0.4,
        openness: 0.9,
        spread: 0.8,
        pinch: 0.12,
        rotation: 0.24,
        horizontal: 0.16,
        vertical: 0.09,
        depth: 0.4,
      },
    })
    const countdownController = resolveParticleControllerState({
      gesture: 'none',
      handDetected: true,
      mode: 'countdown',
      countValue: 5,
      hardwareConcurrency: 12,
      metrics: {
        anchor: { x: 0.1, y: -0.12 },
        velocity: 0.4,
        openness: 0.9,
        spread: 0.8,
        pinch: 0.12,
        rotation: 0.24,
        horizontal: 0.16,
        vertical: 0.09,
        depth: 0.4,
      },
    })

    expect(countdownController.mode).toBe('countdown')
    expect(countdownController.countValue).toBe(5)
    expect(countdownController.badgeCount).toBe(5)
    expect(countdownController.attraction).toBeGreaterThan(1)
    expect(countdownController.noiseStrength).toBeLessThan(0.08)
    expect(countdownController.swirl).toBe(0)
    expect(countdownController.eventPulse).toBe(0)
    expect(countdownController.rigidity).toBeGreaterThan(0.8)
    expect(countdownController.travel).toBe(0)
    expect({
      ...countdownController,
      mode: 'count',
      countdownBurst: false,
    }).toEqual(countController)
  })

  it('caps countdown mode to 5 even if more fingers are detected', () => {
    const controller = resolveParticleControllerState({
      gesture: 'open_palm',
      handDetected: true,
      mode: 'countdown',
      countValue: 9,
      hardwareConcurrency: 12,
      metrics: {
        anchor: { x: 0.1, y: -0.12 },
        velocity: 0.4,
        openness: 0.9,
        spread: 0.8,
        pinch: 0.12,
        rotation: 0.24,
        horizontal: 0.16,
        vertical: 0.09,
        depth: 0.4,
      },
    })

    expect(controller.mode).toBe('countdown')
    expect(controller.countValue).toBe(5)
    expect(controller.badgeCount).toBe(5)
    expect(controller.countdownBurst).toBe(false)
  })

  it('switches countdown mode into burst state for two-hand open detection', () => {
    const controller = resolveParticleControllerState({
      gesture: 'open_palm',
      handDetected: true,
      mode: 'countdown',
      countValue: 10,
      countdownBurst: true,
      hardwareConcurrency: 12,
      metrics: {
        anchor: { x: 0.1, y: -0.12 },
        velocity: 0.72,
        openness: 1,
        spread: 0.96,
        pinch: 0,
        rotation: 0.18,
        horizontal: 0.1,
        vertical: -0.08,
        depth: 0.36,
      },
    })

    expect(controller.mode).toBe('countdown')
    expect(controller.countValue).toBe(5)
    expect(controller.badgeCount).toBe(0)
    expect(controller.countdownBurst).toBe(true)
    expect(controller.bloom).toBe(1)
    expect(controller.eventPulse).toBe(1)
    expect(controller.energy).toBe(1)
  })

  it('locks fist flow closer to a stable cube than a drifting cloud', () => {
    const controller = resolveParticleControllerState({
      gesture: 'fist',
      handDetected: true,
      hardwareConcurrency: 12,
      metrics: {
        anchor: { x: 0.08, y: -0.04 },
        velocity: 0.7,
        openness: 0.52,
        spread: 0.48,
        pinch: 0.24,
        rotation: 0.36,
        horizontal: 0.22,
        vertical: -0.12,
        depth: 0.8,
      },
    })

    expect(controller.gesture).toBe('fist')
    expect(controller.spread).toBeLessThan(0.7)
    expect(controller.bloom).toBe(0)
    expect(controller.swirl).toBeLessThanOrEqual(0.02)
    expect(controller.eventPulse).toBeLessThan(0.15)
    expect(controller.compression).toBeGreaterThanOrEqual(0.78)
    expect(controller.travel).toBeLessThan(0.05)
  })

  it('amplifies forward travel when an open palm moves toward the camera', () => {
    const controller = resolveParticleControllerState({
      gesture: 'open_palm',
      handDetected: true,
      hardwareConcurrency: 12,
      metrics: {
        anchor: { x: 0.02, y: -0.03 },
        velocity: 0.52,
        openness: 0.94,
        spread: 0.88,
        pinch: 0.02,
        rotation: 0.08,
        horizontal: 0.04,
        vertical: -0.06,
        depth: 0.82,
      },
    })

    expect(controller.gesture).toBe('open_palm')
    expect(controller.travel).toBeGreaterThan(0.8)
  })
})
