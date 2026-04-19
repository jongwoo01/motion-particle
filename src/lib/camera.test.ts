import { describe, expect, it } from 'vitest'
import { classifyCameraStartError, normalizeCameraPermissionState } from './camera'

describe('normalizeCameraPermissionState', () => {
  it('maps standard permission states', () => {
    expect(normalizeCameraPermissionState('granted')).toBe('granted')
    expect(normalizeCameraPermissionState('prompt')).toBe('prompt')
    expect(normalizeCameraPermissionState('denied')).toBe('denied')
  })

  it('falls back to unsupported for unknown values', () => {
    expect(normalizeCameraPermissionState('unknown-state')).toBe('unsupported')
  })
})

describe('classifyCameraStartError', () => {
  it('treats permission denial as a denied state', () => {
    const result = classifyCameraStartError(new DOMException('blocked', 'NotAllowedError'))

    expect(result.trackingState).toBe('denied')
    expect(result.permissionState).toBe('denied')
    expect(result.message).toContain('카메라 접근')
  })

  it('treats missing devices as a recoverable error', () => {
    const result = classifyCameraStartError(new DOMException('missing', 'NotFoundError'))

    expect(result.trackingState).toBe('error')
    expect(result.debugState).toBe('camera device not found')
  })

  it('maps security errors to unsupported guidance', () => {
    const result = classifyCameraStartError(new DOMException('secure', 'SecurityError'))

    expect(result.trackingState).toBe('unsupported')
    expect(result.message).toContain('HTTPS')
  })
})
