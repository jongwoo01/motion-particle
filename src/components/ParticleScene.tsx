import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, Noise, Vignette } from '@react-three/postprocessing'
import { useEffect, useMemo, useRef } from 'react'
import {
  BufferAttribute,
  Color,
  DynamicDrawUsage,
  MathUtils,
  NormalBlending,
  ShaderMaterial,
  type Points,
} from 'three'
import { BlendFunction } from 'postprocessing'
import {
  BADGE_PARTICLES_PER_CLUSTER,
  MAX_BADGES,
  createBadgeClusterTemplate,
  createBalancedBadgeLayout,
  createCountdownBurstTargetField,
  createNumberTargetFieldSet,
  createTargetFields,
} from '../lib/particleTargets'
import type { ParticleControllerState } from '../types'

interface ParticleSceneProps {
  controllerState: ParticleControllerState
}

type DynamicsState = ParticleControllerState

type TrailNode = {
  x: number
  y: number
  strength: number
}

const MAX_PARTICLES = 42000
const MIN_PARTICLES = 9000
const TRAIL_NODES = 6
const BADGE_POINT_COUNT = BADGE_PARTICLES_PER_CLUSTER * MAX_BADGES
const BADGE_LAYOUT_GAP_X = 0.72
const BADGE_LAYOUT_GAP_Y = 0.82
const BADGE_GROUP_GAP = 0.96

const particleVertexShader = `
  attribute float aScale;
  varying vec3 vColor;
  varying float vScale;

  uniform float uPointSize;
  uniform float uPulse;

  void main() {
    vColor = color;
    vScale = aScale;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float depthScale = 1.0 / max(0.45, -mvPosition.z);
    float pulse = 0.88 + uPulse * 0.24;

    gl_PointSize = uPointSize * aScale * depthScale * pulse;
    gl_Position = projectionMatrix * mvPosition;
  }
`

const particleFragmentShader = `
  varying vec3 vColor;
  varying float vScale;

  uniform float uSquareMix;

  void main() {
    vec2 centered = gl_PointCoord - vec2(0.5);
    float circleDistance = length(centered);
    float squareDistance = max(abs(centered.x), abs(centered.y));
    float shapeDistance = mix(circleDistance, squareDistance, uSquareMix);

    float halo = smoothstep(0.7, 0.18, shapeDistance);
    float body = smoothstep(0.54, 0.14, shapeDistance);
    float core = smoothstep(0.18, 0.0, shapeDistance);
    float edge = smoothstep(0.62, 0.32, shapeDistance) - smoothstep(0.34, 0.14, shapeDistance);

    vec3 haloColor = mix(vColor, vec3(0.9, 0.95, 1.0), 0.18 + vScale * 0.1);
    vec3 bodyColor = mix(haloColor, vec3(1.0), 0.16 + vScale * 0.04);
    vec3 coreColor = mix(bodyColor, vec3(1.0), 0.62);
    vec3 finalColor =
      haloColor * halo * 0.24 +
      bodyColor * body * 0.94 +
      coreColor * core * 0.74 +
      haloColor * edge * 0.16;
    float alpha = halo * 0.12 + body * 0.78 + core * 0.18;

    if (alpha < 0.01) discard;
    gl_FragColor = vec4(finalColor, alpha);
  }
`

const badgeVertexShader = `
  attribute float aScale;
  varying vec3 vColor;

  uniform float uPointSize;

  void main() {
    vColor = color;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float depthScale = 1.0 / max(0.55, -mvPosition.z);

    gl_PointSize = uPointSize * aScale * depthScale;
    gl_Position = projectionMatrix * mvPosition;
  }
`

const badgeFragmentShader = `
  varying vec3 vColor;

  uniform float uOpacity;

  void main() {
    vec2 centered = gl_PointCoord - vec2(0.5);
    float squareDistance = max(abs(centered.x), abs(centered.y));
    float body = smoothstep(0.58, 0.18, squareDistance);
    float haze = smoothstep(0.76, 0.34, squareDistance) * 0.18;
    float alpha = (body * 0.84 + haze) * uOpacity;
    vec3 finalColor = mix(vColor, vec3(0.99, 0.99, 1.0), body * 0.16);

    if (alpha < 0.01) discard;
    gl_FragColor = vec4(finalColor, alpha);
  }
`

function pseudoNoise(seed: number) {
  const raw = Math.sin(seed * 12.9898) * 43758.5453123
  return raw - Math.floor(raw)
}

function createSeedBuffer(count: number) {
  const values = new Float32Array(count * 4)

  for (let index = 0; index < count; index += 1) {
    const offset = index * 4
    values[offset] = pseudoNoise(index + 1) * 2 - 1
    values[offset + 1] = pseudoNoise(index + 11) * Math.PI * 2
    values[offset + 2] = pseudoNoise(index + 29) * 2 - 1
    values[offset + 3] = pseudoNoise(index + 53) * Math.PI * 2
  }

  return values
}

function createScaleBuffer(count: number) {
  const scales = new Float32Array(count)

  for (let index = 0; index < count; index += 1) {
    const seed = pseudoNoise((index + 3) * 91.137)

    if (seed < 0.72) {
      scales[index] = 0.54 + Math.pow(seed / 0.72, 1.85) * 0.82
      continue
    }

    if (seed < 0.94) {
      scales[index] = 1.18 + Math.pow((seed - 0.72) / 0.22, 1.1) * 1.02
      continue
    }

    scales[index] = 2.24 + Math.pow((seed - 0.94) / 0.06, 0.72) * 1.64
  }

  return scales
}

function createBadgeScaleBuffer(count: number) {
  const scales = new Float32Array(count)

  for (let index = 0; index < count; index += 1) {
    scales[index] = 0.68 + pseudoNoise(index + 1703) * 0.24
  }

  return scales
}

function createColorState() {
  return {
    hueBase: 0.58,
    hueRange: 0.08,
    saturation: 0.68,
    lightness: 0.42,
  }
}

function rotateFistTarget(x: number, y: number, z: number, spinY: number, tiltX: number) {
  const cosY = Math.cos(spinY)
  const sinY = Math.sin(spinY)
  const rotatedX = x * cosY - z * sinY
  const rotatedZ = x * sinY + z * cosY
  const cosX = Math.cos(tiltX)
  const sinX = Math.sin(tiltX)

  return {
    x: rotatedX,
    y: y * cosX - rotatedZ * sinX,
    z: y * sinX + rotatedZ * cosX,
  }
}

function ParticleField({ controllerState }: ParticleSceneProps) {
  const seeds = useMemo(() => createSeedBuffer(MAX_PARTICLES), [])
  const scales = useMemo(() => createScaleBuffer(MAX_PARTICLES), [])
  const badgeScales = useMemo(() => createBadgeScaleBuffer(BADGE_POINT_COUNT), [])
  const targetFields = useMemo(() => createTargetFields(MAX_PARTICLES), [])
  const numberTargets = useMemo(() => createNumberTargetFieldSet(MAX_PARTICLES), [])
  const countdownBurstField = useMemo(() => createCountdownBurstTargetField(MAX_PARTICLES), [])
  const badgeTemplate = useMemo(() => createBadgeClusterTemplate(), [])
  const badgeLayouts = useMemo(
    () =>
      Array.from({ length: MAX_BADGES + 1 }, (_, count) =>
        createBalancedBadgeLayout(count, BADGE_LAYOUT_GAP_X, BADGE_LAYOUT_GAP_Y),
      ),
    [],
  )
  const positions = useMemo(() => Float32Array.from(targetFields.neutral), [targetFields])
  const colors = useMemo(() => new Float32Array(MAX_PARTICLES * 3), [])
  const badgePositions = useMemo(() => new Float32Array(BADGE_POINT_COUNT * 3), [])
  const badgeColors = useMemo(() => new Float32Array(BADGE_POINT_COUNT * 3), [])
  const mainColor = useMemo(() => new Color(), [])
  const badgeColor = useMemo(() => new Color(), [])
  const pointsRef = useRef<Points>(null)
  const materialRef = useRef<ShaderMaterial>(null)
  const badgePointsRef = useRef<Points>(null)
  const badgeMaterialRef = useRef<ShaderMaterial>(null)
  const currentStateRef = useRef<DynamicsState>({
    ...controllerState,
    anchor: { ...controllerState.anchor },
    drift: { ...controllerState.drift },
  })
  const gestureMixRef = useRef({
    openPalm: 0,
    fist: 0,
    victory: 0,
    heart: 0,
  })
  const countModeMixRef = useRef(0)
  const countdownModeMixRef = useRef(0)
  const velocitiesRef = useRef(new Float32Array(MAX_PARTICLES * 3))
  const badgeVelocitiesRef = useRef(new Float32Array(BADGE_POINT_COUNT * 3))
  const gestureEventRef = useRef(0)
  const shockwaveRef = useRef(0)
  const countdownBurstMixRef = useRef(controllerState.countdownBurst ? 1 : 0)
  const badgeRevealRef = useRef(0)
  const previousGestureRef = useRef(controllerState.gesture)
  const previousEventPulseRef = useRef(0)
  const previousTravelRef = useRef(controllerState.travel)
  const travelBurstRef = useRef(0)
  const previousCountBadgeCountRef = useRef(controllerState.mode === 'count' ? controllerState.badgeCount : 0)
  const previousCountdownBadgeCountRef = useRef(
    controllerState.mode === 'countdown' ? controllerState.badgeCount : 0,
  )
  const fistChargeRef = useRef(0)
  const trailRef = useRef<TrailNode[]>(
    Array.from({ length: TRAIL_NODES }, () => ({ x: 0, y: 0, strength: 0 })),
  )
  const viewport = useThree((state) => state.viewport)
  const size = useThree((state) => state.size)

  const uniforms = useMemo(
    () => ({
      uPointSize: { value: 20 },
      uPulse: { value: 0 },
      uSquareMix: { value: 0.36 },
    }),
    [],
  )
  const badgeUniforms = useMemo(
    () => ({
      uPointSize: { value: 12 },
      uOpacity: { value: 0 },
    }),
    [],
  )

  useEffect(() => {
    currentStateRef.current = {
      ...currentStateRef.current,
      ...controllerState,
      anchor: { ...controllerState.anchor },
      drift: { ...controllerState.drift },
    }
  }, [controllerState])

  useFrame((state, delta) => {
    const points = pointsRef.current
    const material = materialRef.current
    const badgePoints = badgePointsRef.current
    const badgeMaterial = badgeMaterialRef.current

    if (!points || !material || !badgePoints || !badgeMaterial) {
      return
    }

    const geometry = points.geometry
    const badgeGeometry = badgePoints.geometry
    const positionAttr = geometry.getAttribute('position') as BufferAttribute
    const colorAttr = geometry.getAttribute('color') as BufferAttribute
    const badgePositionAttr = badgeGeometry.getAttribute('position') as BufferAttribute
    const badgeColorAttr = badgeGeometry.getAttribute('color') as BufferAttribute
    const positionArray = positionAttr.array as Float32Array
    const colorArray = colorAttr.array as Float32Array
    const badgePositionArray = badgePositionAttr.array as Float32Array
    const badgeColorArray = badgeColorAttr.array as Float32Array
    const velocities = velocitiesRef.current
    const badgeVelocities = badgeVelocitiesRef.current
    const fistInputActive =
      controllerState.mode === 'flow' &&
      controllerState.handDetected &&
      controllerState.gesture === 'fist'
    const countInputActive = controllerState.mode === 'count'
    const countdownInputActive = controllerState.mode === 'countdown'
    const numberInputActive = countInputActive || countdownInputActive

    const current = currentStateRef.current
    current.count = MathUtils.lerp(
      current.count,
      controllerState.count,
      numberInputActive ? 0.2 : fistInputActive ? 0.16 : 0.05,
    )
    current.size = MathUtils.lerp(
      current.size,
      controllerState.size,
      numberInputActive ? 0.16 : fistInputActive ? 0.16 : 0.06,
    )
    current.velocity = MathUtils.lerp(
      current.velocity,
      controllerState.velocity,
      numberInputActive ? 0.18 : fistInputActive ? 0.18 : 0.05,
    )
    current.spread = MathUtils.lerp(
      current.spread,
      controllerState.spread,
      numberInputActive ? 0.22 : fistInputActive ? 0.22 : 0.05,
    )
    current.attraction = MathUtils.lerp(
      current.attraction,
      controllerState.attraction,
      numberInputActive ? 0.2 : fistInputActive ? 0.22 : 0.06,
    )
    current.hueShift = MathUtils.lerp(current.hueShift, controllerState.hueShift, numberInputActive ? 0.12 : 0.05)
    current.noiseStrength = MathUtils.lerp(
      current.noiseStrength,
      controllerState.noiseStrength,
      numberInputActive ? 0.16 : fistInputActive ? 0.2 : 0.05,
    )
    current.brightness = MathUtils.lerp(
      current.brightness,
      controllerState.brightness,
      numberInputActive ? 0.16 : fistInputActive ? 0.16 : 0.05,
    )
    current.rigidity = MathUtils.lerp(
      current.rigidity,
      controllerState.rigidity,
      numberInputActive ? 0.22 : fistInputActive ? 0.24 : 0.08,
    )
    current.energy = MathUtils.lerp(current.energy, controllerState.energy, numberInputActive ? 0.18 : fistInputActive ? 0.2 : 0.12)
    current.swirl = MathUtils.lerp(current.swirl, controllerState.swirl, numberInputActive ? 0.18 : fistInputActive ? 0.22 : 0.08)
    current.bloom = MathUtils.lerp(current.bloom, controllerState.bloom, numberInputActive ? 0.18 : fistInputActive ? 0.22 : 0.08)
    current.compression = MathUtils.lerp(
      current.compression,
      controllerState.compression,
      numberInputActive ? 0.18 : fistInputActive ? 0.24 : 0.08,
    )
    current.pinch = MathUtils.lerp(current.pinch, controllerState.pinch, numberInputActive ? 0.18 : fistInputActive ? 0.16 : 0.08)
    current.eventPulse = MathUtils.lerp(
      current.eventPulse,
      controllerState.eventPulse,
      numberInputActive ? 0.18 : fistInputActive ? 0.24 : 0.12,
    )
    current.travel = MathUtils.lerp(current.travel, controllerState.travel, numberInputActive ? 0.22 : fistInputActive ? 0.08 : 0.16)
    current.anchor.x = MathUtils.lerp(current.anchor.x, controllerState.anchor.x, numberInputActive ? 0.12 : fistInputActive ? 0.12 : 0.05)
    current.anchor.y = MathUtils.lerp(current.anchor.y, controllerState.anchor.y, numberInputActive ? 0.12 : fistInputActive ? 0.12 : 0.05)
    current.drift.x = MathUtils.lerp(current.drift.x, controllerState.drift.x, numberInputActive ? 0.12 : fistInputActive ? 0.14 : 0.05)
    current.drift.y = MathUtils.lerp(current.drift.y, controllerState.drift.y, numberInputActive ? 0.12 : fistInputActive ? 0.14 : 0.05)
    current.gesture = controllerState.gesture
    current.handDetected = controllerState.handDetected
    current.mode = controllerState.mode
    current.countValue = controllerState.countValue
    current.badgeCount = controllerState.badgeCount

    const drawCount = Math.min(MAX_PARTICLES, Math.max(MIN_PARTICLES, Math.round(current.count)))
    const time = state.clock.elapsedTime
    const mixes = gestureMixRef.current
    const targetOpen = controllerState.gesture === 'open_palm' ? 1 : 0
    const targetFist = controllerState.gesture === 'fist' ? 1 : 0
    const targetVictory = controllerState.gesture === 'victory' ? 1 : 0
    const targetHeart = controllerState.gesture === 'heart' ? 1 : 0
    const countModeActive = countInputActive
    const countdownModeActive = countdownInputActive
    countdownBurstMixRef.current = MathUtils.damp(
      countdownBurstMixRef.current,
      controllerState.countdownBurst ? 1 : 0,
      controllerState.countdownBurst ? 6.8 : 5.4,
      delta,
    )
    const countdownBurstMix = countdownBurstMixRef.current
    countModeMixRef.current = MathUtils.damp(
      countModeMixRef.current,
      countModeActive ? 1 : 0,
      countModeActive ? 8.8 : 4.4,
      delta,
    )
    countdownModeMixRef.current = MathUtils.damp(
      countdownModeMixRef.current,
      countdownModeActive ? 1 : 0,
      countdownModeActive ? 8.8 : 4.4,
      delta,
    )
    const countModeMix = countModeMixRef.current
    const countdownModeMix = countdownModeMixRef.current
    const countdownNumberMix = countdownModeMix * (1 - countdownBurstMix)
    const numberModeMix = MathUtils.clamp(countModeMix + countdownNumberMix, 0, 1)
    const countField = numberTargets.fields[controllerState.countValue] ?? numberTargets.fields[0]
    const countBounds = numberTargets.bounds[controllerState.countValue] ?? numberTargets.bounds[0]
    const countdownField = numberTargets.fields[controllerState.countValue] ?? numberTargets.fields[0]
    const countdownBounds = numberTargets.bounds[controllerState.countValue] ?? numberTargets.bounds[0]
    const flowModeMix = 1 - numberModeMix
    const badgeCount = countModeActive
      ? controllerState.badgeCount
      : countdownModeActive
        ? controllerState.countdownBurst ? 0 : controllerState.badgeCount
        : 0

    if (countModeActive && badgeCount !== previousCountBadgeCountRef.current) {
      badgeRevealRef.current = 0
    }

    if (countdownModeActive && badgeCount !== previousCountdownBadgeCountRef.current) {
      badgeRevealRef.current = 0
    }

    previousCountBadgeCountRef.current = countModeActive ? badgeCount : 0
    previousCountdownBadgeCountRef.current = countdownModeActive ? badgeCount : 0
    badgeRevealRef.current = MathUtils.damp(
      badgeRevealRef.current,
      countModeActive
        ? badgeCount > 0 ? 1 : 0
        : countdownModeActive
          ? controllerState.countdownBurst ? 0 : badgeCount > 0 ? 1 : 0
          : 0,
      countModeActive ? 12 : countdownModeActive ? 12 : 4.2,
      delta,
    )
    const badgeReveal = badgeRevealRef.current

    const gestureChanged =
      controllerState.mode === 'flow' &&
      current.handDetected &&
      controllerState.gesture !== previousGestureRef.current &&
      controllerState.gesture !== 'none'
    const pulseSpike =
      controllerState.mode === 'flow' &&
      !fistInputActive &&
      controllerState.eventPulse > 0.62 &&
      previousEventPulseRef.current <= 0.62

    // Fist charge builds up while holding, releases on open_palm
    if (controllerState.gesture === 'fist' && controllerState.handDetected && controllerState.mode === 'flow') {
      fistChargeRef.current = Math.min(1, fistChargeRef.current + delta * 0.65)
    } else {
      fistChargeRef.current = Math.max(0, fistChargeRef.current - delta * 1.6)
    }

    if (gestureChanged || pulseSpike) {
      gestureEventRef.current = 1
      const isFistRelease =
        gestureChanged &&
        controllerState.gesture === 'open_palm' &&
        previousGestureRef.current === 'fist'
      shockwaveRef.current = isFistRelease ? 1 + fistChargeRef.current * 0.6 : 1
    }

    previousGestureRef.current = controllerState.gesture
    previousEventPulseRef.current = controllerState.eventPulse
    gestureEventRef.current = MathUtils.damp(gestureEventRef.current, 0, fistInputActive ? 8.5 : 2.8, delta)
    shockwaveRef.current = Math.max(0, shockwaveRef.current - delta * (fistInputActive ? 4.8 : 1.3))
    const travelDelta = controllerState.travel - previousTravelRef.current
    previousTravelRef.current = controllerState.travel
    travelBurstRef.current = Math.max(
      Math.max(0, travelBurstRef.current - delta * 2.6),
      Math.abs(travelDelta) * 1.85,
    )

    mixes.openPalm = MathUtils.damp(mixes.openPalm, targetOpen, 2.8, delta)
    mixes.fist = MathUtils.damp(mixes.fist, targetFist, fistInputActive ? 11.5 : 3.1, delta)
    mixes.victory = MathUtils.damp(mixes.victory, targetVictory, 2.9, delta)
    mixes.heart = MathUtils.damp(mixes.heart, targetHeart, 3, delta)

    const neutralMix = Math.max(
      0,
      1 - Math.max(mixes.openPalm, mixes.fist, mixes.victory, mixes.heart),
    )
    const fistModeMix = mixes.fist * flowModeMix
    const fistLock = fistInputActive
      ? MathUtils.clamp(mixes.fist * 1.15 + current.rigidity * 0.35, 0, 1)
      : 0
    const countRigidityMix = current.rigidity * countModeMix
    const countdownRigidityMix = current.rigidity * countdownModeMix
    const numberRigidityMix = countRigidityMix + countdownRigidityMix
    const gestureDominance = Math.max(
      neutralMix,
      mixes.openPalm,
      mixes.fist,
      mixes.victory,
      mixes.heart,
    )
    const signatureOrbit =
      neutralMix * 0.18 +
      mixes.openPalm * 0.08 +
      mixes.fist * 0.02 +
      mixes.victory * 0.72 +
      mixes.heart * 0.06
    const signatureBloom =
      neutralMix * 0.16 +
      mixes.openPalm * 1 +
      mixes.fist * 0.04 +
      mixes.victory * 0.18 +
      mixes.heart * 0.44
    const signatureCompression =
      neutralMix * 0.16 +
      mixes.openPalm * 0.04 +
      mixes.fist * 1 +
      mixes.victory * 0.04 +
      mixes.heart * 0.38
    const signatureVortex =
      neutralMix * 0.14 +
      mixes.openPalm * 0.08 +
      mixes.fist * 0.02 +
      mixes.victory * 1 +
      mixes.heart * 0.12
    const signatureDrift =
      neutralMix * 0.22 +
      mixes.openPalm * 0.36 +
      mixes.fist * 0.08 +
      mixes.victory * 0.52 +
      mixes.heart * 0.12
    const signatureShock =
      neutralMix * 0.18 +
      mixes.openPalm * 0.22 +
      mixes.fist * 0.04 +
      mixes.victory * 0.48 +
      mixes.heart * 0.06
    const signatureTrail =
      neutralMix * 0.2 +
      mixes.openPalm * 0.28 +
      mixes.fist * 0.02 +
      mixes.victory * 0.42 +
      mixes.heart * 0.08
    const signatureTurbulence =
      neutralMix * 0.22 +
      mixes.openPalm * 0.28 +
      mixes.fist * 0.04 +
      mixes.victory * 0.2 +
      mixes.heart * 0.1
    const gestureStability = MathUtils.clamp(
      0.48 + gestureDominance * 0.22 + current.rigidity * 0.18,
      0.5,
      0.92,
    )
    const stabilityFactor = MathUtils.clamp(
      gestureStability * (0.82 + current.rigidity * 0.14),
      0.5,
      0.96,
    )
    const lockedNeutralMix = neutralMix * (1 - fistLock)
    const colorSettings = createColorState()
    colorSettings.hueBase =
      lockedNeutralMix * 0.58 +
      mixes.openPalm * 0.53 +
      mixes.fist * 0.08 +
      mixes.victory * 0.76 +
      mixes.heart * 0.96
    colorSettings.hueRange =
      lockedNeutralMix * 0.08 +
      mixes.openPalm * 0.1 +
      mixes.fist * 0.05 +
      mixes.victory * 0.12 +
      mixes.heart * 0.04
    colorSettings.saturation =
      lockedNeutralMix * 0.68 +
      mixes.openPalm * 0.8 +
      mixes.fist * 0.86 +
      mixes.victory * 0.8 +
      mixes.heart * 0.72
    colorSettings.lightness =
      lockedNeutralMix * 0.42 +
      mixes.openPalm * 0.54 +
      mixes.fist * 0.48 +
      mixes.victory * 0.54 +
      mixes.heart * 0.64
    colorSettings.hueBase +=
      current.swirl * 0.05 * signatureVortex +
      current.drift.x * 0.012 * signatureDrift -
      current.compression * 0.02 * signatureCompression
    colorSettings.hueRange += current.energy * 0.05 + current.swirl * 0.025 * signatureVortex
    colorSettings.saturation = MathUtils.clamp(
      colorSettings.saturation + current.energy * 0.1 + current.pinch * 0.06,
      0.36,
      0.96,
    )
    colorSettings.lightness = MathUtils.clamp(
      colorSettings.lightness + current.energy * 0.07 + gestureEventRef.current * 0.06,
      0.24,
      0.82,
    )
    colorSettings.hueBase = MathUtils.lerp(colorSettings.hueBase, 0.1, fistModeMix * 0.78)
    colorSettings.hueRange = MathUtils.lerp(colorSettings.hueRange, 0.014, fistModeMix * 0.92)
    colorSettings.saturation = MathUtils.lerp(colorSettings.saturation, 0.18, fistModeMix * 0.86)
    colorSettings.lightness = MathUtils.lerp(colorSettings.lightness, 0.6, fistModeMix * 0.82)
    // Fast motion cools hue toward blue
    colorSettings.hueBase = MathUtils.lerp(
      colorSettings.hueBase,
      0.62,
      current.velocity * 0.22 * flowModeMix * (1 - fistModeMix),
    )
    colorSettings.hueBase = MathUtils.lerp(colorSettings.hueBase, 0.08, countModeMix * 0.72)
    colorSettings.hueBase = MathUtils.lerp(colorSettings.hueBase, 0.08, countdownModeMix * 0.72)
    colorSettings.hueBase = MathUtils.lerp(colorSettings.hueBase, 0.96, countdownBurstMix * 0.42)
    colorSettings.hueRange = MathUtils.lerp(colorSettings.hueRange, 0.02, countModeMix)
    colorSettings.hueRange = MathUtils.lerp(colorSettings.hueRange, 0.02, countdownModeMix)
    colorSettings.hueRange = MathUtils.lerp(colorSettings.hueRange, 0.24, countdownBurstMix)
    colorSettings.saturation = MathUtils.lerp(colorSettings.saturation, 0.14, countModeMix)
    colorSettings.saturation = MathUtils.lerp(colorSettings.saturation, 0.14, countdownModeMix)
    colorSettings.saturation = MathUtils.lerp(colorSettings.saturation, 0.88, countdownBurstMix)
    colorSettings.lightness = MathUtils.lerp(colorSettings.lightness, 0.78, countModeMix * 0.86)
    colorSettings.lightness = MathUtils.lerp(colorSettings.lightness, 0.78, countdownModeMix * 0.86)
    colorSettings.lightness = MathUtils.lerp(colorSettings.lightness, 0.7, countdownBurstMix * 0.9)

    const handStrength = current.handDetected ? 1 : 0.25
    const stableAnchor = {
      x: Math.abs(current.anchor.x) < 0.016 ? 0 : current.anchor.x,
      y: Math.abs(current.anchor.y) < 0.016 ? 0 : current.anchor.y,
    }
    const stableDrift = {
      x: Math.abs(current.drift.x) < 0.03 ? 0 : current.drift.x,
      y: Math.abs(current.drift.y) < 0.03 ? 0 : current.drift.y,
    }
    const stableTravel = Math.abs(current.travel) < 0.04 ? 0 : current.travel
    const anchorFollow =
      (neutralMix * 0.52 +
        mixes.openPalm * 0.44 +
        mixes.fist * 0.62 +
        mixes.victory * 0.58 +
        mixes.heart * 0.28) *
      (1 - numberModeMix * 0.5)
    const anchorX =
      stableAnchor.x *
      handStrength *
      (1.18 + mixes.victory * 0.2 + mixes.openPalm * 0.1) *
      anchorFollow
    const anchorY =
      stableAnchor.y *
      handStrength *
      (1.02 + mixes.openPalm * 0.12) *
      anchorFollow
    const forwardTravel =
      stableTravel *
      mixes.openPalm *
      flowModeMix *
      handStrength *
      (0.92 + current.velocity * 0.26 + current.energy * 0.18) *
      (1 - fistLock)
    const travelBurst = travelBurstRef.current * mixes.openPalm * flowModeMix * (1 - fistLock)
    const travelScale = 1 + Math.abs(forwardTravel) * 0.18 + travelBurst * 0.08
    const springStrength =
      0.042 +
      current.attraction * 0.031 +
      mixes.fist * 0.014 +
      countModeMix * 0.024 +
      countdownModeMix * 0.024 +
      (numberInputActive ? 0.055 : 0) +
      current.rigidity * 0.018 +
      gestureStability * 0.012 +
      fistLock * 0.08
    const velocityDamping = MathUtils.clamp(
      0.074 +
        current.rigidity * 0.058 +
        countModeMix * 0.038 +
        countdownModeMix * 0.038 +
        (numberInputActive ? 0.075 : 0) +
        fistModeMix * 0.042 -
        current.energy * 0.01 +
        fistLock * 0.06,
      0.06,
      0.34,
    )
    const turbulence =
      (current.noiseStrength * 0.0038 + current.velocity * 0.0026) *
      (1 - numberModeMix * 0.94) *
      (1 - current.rigidity * 0.72) *
      signatureTurbulence *
      (1 - fistLock * 0.96)
    const flowEnergy = current.energy * flowModeMix
    const vortexStrength =
      (0.002 + current.swirl * 0.017 + gestureEventRef.current * 0.01) *
      flowModeMix *
      signatureVortex *
      (1 - fistModeMix * 0.9) *
      (1 - current.rigidity * 0.35) *
      (1 - fistLock * 0.96)
    const bloomStrength =
      (current.bloom * 0.018 + mixes.openPalm * 0.008) *
      flowModeMix *
      signatureBloom *
      (1 - fistModeMix * 0.9) *
      (1 - fistLock)
    const compressionStrength =
      (current.compression * 0.012 + current.pinch * 0.008) *
      flowModeMix *
      signatureCompression *
      (1 - fistModeMix * 0.84) *
      (0.8 + fistLock * 0.35)
    const driftStrength =
      (0.0022 + flowEnergy * 0.0038) *
      flowModeMix *
      signatureDrift *
      (1 - fistModeMix * 0.88) *
      stabilityFactor *
      (1 - fistLock * 0.95)
    const shockRadius = 0.28 + (1 - shockwaveRef.current) * 2.8
    const shockStrength =
      shockwaveRef.current *
      (0.02 + current.eventPulse * 0.01) *
      flowModeMix *
      signatureShock *
      (1 - fistModeMix * 0.92) *
      stabilityFactor *
      (1 - fistLock)

    const trail = trailRef.current
    trail[0].x = MathUtils.damp(trail[0].x, anchorX, 10, delta)
    trail[0].y = MathUtils.damp(trail[0].y, anchorY, 10, delta)
    trail[0].strength = MathUtils.damp(
      trail[0].strength,
      current.handDetected && controllerState.mode === 'flow'
        ? (0.14 +
            flowEnergy * 0.36 +
            current.eventPulse * 0.18 +
            Math.abs(forwardTravel) * 0.22 +
            travelBurst * 0.3) *
          signatureTrail *
          (1 - fistModeMix * 0.92) *
          stabilityFactor *
          (1 - fistLock)
        : 0,
      fistInputActive ? 10.5 : 5.8,
      delta,
    )
    for (let index = 1; index < trail.length; index += 1) {
      trail[index].x = MathUtils.damp(
        trail[index].x,
        trail[index - 1].x,
        7.4 - index * 0.5,
        delta,
      )
      trail[index].y = MathUtils.damp(
        trail[index].y,
        trail[index - 1].y,
        7.4 - index * 0.5,
        delta,
      )
      trail[index].strength = MathUtils.damp(
        trail[index].strength,
        trail[index - 1].strength * (0.82 - index * 0.06),
        4.8 - index * 0.28,
        delta,
      )
    }

    const gravityPull = mixes.fist * 0.026 * flowModeMix * (1 - numberModeMix)
    const ambientFlowStrength =
      !current.handDetected && controllerState.mode === 'flow' ? 0.0038 * (1 - numberModeMix) : 0
    const fistSpinY = time * 0.28 * fistModeMix
    const fistTiltX = Math.sin(time * 0.26) * 0.16 * fistModeMix
    for (let index = 0; index < drawCount; index += 1) {
      const p = index * 3
      const seed = index * 4
      const phase = seeds[seed + 3]
      const theta = seeds[seed + 1]
      const scale = scales[index]
      const rotatedFistTarget = rotateFistTarget(
        targetFields.fist[p],
        targetFields.fist[p + 1],
        targetFields.fist[p + 2],
        fistSpinY,
        fistTiltX,
      )

      const breathe =
        1 +
        Math.sin(time * 0.42 + phase) *
          (0.004 + mixes.openPalm * 0.012 + mixes.heart * 0.005)
      const wobbleX = Math.sin(time * 0.7 + phase) * turbulence
      const wobbleY = Math.cos(time * 0.62 + theta) * turbulence * 0.68
      const wobbleZ = Math.sin(time * 0.78 + theta + phase) * turbulence

      const targetX =
        (targetFields.neutral[p] * lockedNeutralMix +
          targetFields.openPalm[p] * mixes.openPalm +
          rotatedFistTarget.x * mixes.fist +
          targetFields.victory[p] * mixes.victory +
          targetFields.heart[p] * mixes.heart) *
          current.spread *
          breathe *
          travelScale +
        anchorX

      const targetY =
        (targetFields.neutral[p + 1] * lockedNeutralMix +
          targetFields.openPalm[p + 1] * mixes.openPalm +
          rotatedFistTarget.y * mixes.fist +
          targetFields.victory[p + 1] * mixes.victory +
          targetFields.heart[p + 1] * mixes.heart) *
          current.spread *
          breathe *
          travelScale +
        anchorY

      const targetZ =
        (targetFields.neutral[p + 2] * lockedNeutralMix +
          targetFields.openPalm[p + 2] * mixes.openPalm +
          rotatedFistTarget.z * mixes.fist +
          targetFields.victory[p + 2] * mixes.victory +
          targetFields.heart[p + 2] * mixes.heart) *
          current.spread *
          breathe +
        forwardTravel * 1.9
      const countTargetX = countField[p] * current.spread * 0.84 + anchorX * 0.32
      const countTargetY = countField[p + 1] * current.spread * 0.84 + anchorY * 0.32
      const countTargetZ = countField[p + 2] * current.spread * 0.84
      const countdownTargetX = countdownField[p] * current.spread * 0.84 + anchorX * 0.32
      const countdownTargetY = countdownField[p + 1] * current.spread * 0.84 + anchorY * 0.32
      const countdownTargetZ = countdownField[p + 2] * current.spread * 0.84
      const countResolvedTargetX = MathUtils.lerp(targetX, countTargetX, countModeMix)
      const countResolvedTargetY = MathUtils.lerp(targetY, countTargetY, countModeMix)
      const countResolvedTargetZ = MathUtils.lerp(targetZ, countTargetZ, countModeMix)
      const countdownResolvedTargetX = MathUtils.lerp(countResolvedTargetX, countdownTargetX, countdownNumberMix)
      const countdownResolvedTargetY = MathUtils.lerp(countResolvedTargetY, countdownTargetY, countdownNumberMix)
      const countdownResolvedTargetZ = MathUtils.lerp(countResolvedTargetZ, countdownTargetZ, countdownNumberMix)
      const burstTargetX = countdownBurstField[p] * current.spread
      const burstTargetY = countdownBurstField[p + 1] * current.spread * 0.94
      const burstTargetZ = countdownBurstField[p + 2] * current.spread
      const resolvedTargetX = MathUtils.lerp(countdownResolvedTargetX, burstTargetX, countdownBurstMix)
      const resolvedTargetY = MathUtils.lerp(countdownResolvedTargetY, burstTargetY, countdownBurstMix)
      const resolvedTargetZ = MathUtils.lerp(countdownResolvedTargetZ, burstTargetZ, countdownBurstMix)

      velocities[p] += (resolvedTargetX - positionArray[p]) * springStrength + wobbleX
      velocities[p + 1] += (resolvedTargetY - positionArray[p + 1]) * springStrength + wobbleY
      velocities[p + 2] += (resolvedTargetZ - positionArray[p + 2]) * springStrength + wobbleZ

      const orbitalSpin =
        (neutralMix * 0.004 + mixes.openPalm * 0.009 + mixes.victory * 0.013) *
        current.velocity *
        flowModeMix *
        signatureOrbit *
        (1 - fistModeMix * 0.94)
      velocities[p] += -positionArray[p + 2] * orbitalSpin
      velocities[p + 2] += positionArray[p] * orbitalSpin

      const deltaX = positionArray[p] - anchorX
      const deltaY = positionArray[p + 1] - anchorY
      const radialDistance = Math.max(0.001, Math.hypot(deltaX, deltaY))
      const radialInfluence =
        1 / (1 + radialDistance * radialDistance * (3.6 + current.compression * 4.6))
      const radialX = deltaX / radialDistance
      const radialY = deltaY / radialDistance
      const countdownBurstOutward =
        countdownBurstMix *
        (0.01 + current.energy * 0.012 + current.eventPulse * 0.014) *
        (0.6 + (1 - radialInfluence) * 0.9)
      const burstTangential =
        countdownBurstMix *
        (0.0024 + current.swirl * 0.0048) *
        (0.36 + radialInfluence * 0.64)
      const burstLift =
        countdownBurstMix *
        (0.0018 + current.bloom * 0.0056) *
        (0.42 + (1 - radialInfluence) * 0.72)
      const burstTwinkle = Math.pow(
        Math.max(0, Math.sin(time * 9.4 + phase * 3.6 + theta * 1.8)),
        6,
      ) * countdownBurstMix

      velocities[p] += radialX * bloomStrength * radialInfluence
      velocities[p + 1] += radialY * bloomStrength * radialInfluence
      velocities[p] -= radialX * compressionStrength * radialInfluence
      velocities[p + 1] -= radialY * compressionStrength * radialInfluence

      velocities[p] += -radialY * vortexStrength * radialInfluence
      velocities[p + 1] += radialX * vortexStrength * radialInfluence
      velocities[p] += stableDrift.x * driftStrength * (0.7 + radialInfluence * 1.2)
      velocities[p + 1] += stableDrift.y * driftStrength * (0.7 + radialInfluence * 1.2)
      velocities[p + 2] += (current.swirl * 0.0018 + current.energy * 0.0022) * radialInfluence
      velocities[p] += radialX * countdownBurstOutward
      velocities[p + 1] += radialY * countdownBurstOutward
      velocities[p + 2] += countdownBurstOutward * 0.9
      velocities[p] += -radialY * burstTangential
      velocities[p + 1] += radialX * burstTangential
      velocities[p + 1] += burstLift
      velocities[p + 2] += burstTwinkle * 0.016
      const travelDirection = Math.sign(forwardTravel || travelDelta || 0)
      const tunnelStrength =
        (Math.abs(forwardTravel) * 0.03 + travelBurst * 0.018) *
        (0.45 + (1 - radialInfluence) * 0.9)
      if (travelDirection !== 0 && tunnelStrength > 0.0001) {
        velocities[p] += radialX * tunnelStrength * travelDirection
        velocities[p + 1] += radialY * tunnelStrength * travelDirection
        velocities[p + 2] += travelDirection * (Math.abs(forwardTravel) * 0.06 + travelBurst * 0.03)
      }

      if (shockStrength > 0.0001) {
        const ringDelta = radialDistance - shockRadius
        const ring = Math.exp(-(ringDelta * ringDelta) * 11)
        velocities[p] += radialX * shockStrength * ring
        velocities[p + 1] += radialY * shockStrength * ring
      }

      for (let trailIndex = 0; trailIndex < trail.length; trailIndex += 1) {
        const node = trail[trailIndex]
        if (node.strength < 0.02) continue

        const trailDx = positionArray[p] - node.x
        const trailDy = positionArray[p + 1] - node.y
        const trailDistanceSq = trailDx * trailDx + trailDy * trailDy + 0.01
        const wake =
          (node.strength * 0.006 * flowModeMix) / (1 + trailDistanceSq * (10 + trailIndex * 3))
        velocities[p] += -trailDy * wake * (0.8 + current.swirl * 0.6)
        velocities[p + 1] += trailDx * wake * (0.8 + current.bloom * 0.6)
        velocities[p + 2] += wake * (0.2 - trailIndex * 0.03)
      }

      // Gravity well: particles rush toward hand when fist
      if (gravityPull > 0.001) {
        velocities[p] += (anchorX - positionArray[p]) * gravityPull
        velocities[p + 1] += (anchorY - positionArray[p + 1]) * gravityPull
      }

      // Ambient flow field: organic undulation when no hand
      if (ambientFlowStrength > 0) {
        const nx = positionArray[p] * 0.68
        const ny = positionArray[p + 1] * 0.62
        const flowX = Math.sin(nx * 1.3 + time * 0.12) * Math.cos(ny * 0.8 + time * 0.09)
        const flowY = Math.cos(nx * 0.7 + time * 0.15) * Math.sin(ny * 1.1 + time * 0.11)
        velocities[p] += flowX * ambientFlowStrength
        velocities[p + 1] += flowY * ambientFlowStrength
      }

      velocities[p] *= 1 - velocityDamping
      velocities[p + 1] *= 1 - velocityDamping
      velocities[p + 2] *= 1 - velocityDamping

      positionArray[p] += velocities[p]
      positionArray[p + 1] += velocities[p + 1]
      positionArray[p + 2] += velocities[p + 2]

      const hue =
        (colorSettings.hueBase +
          current.hueShift +
          Math.sin(phase + time * (0.18 + current.energy * 0.08)) *
            ((0.007 + current.swirl * 0.01 * signatureVortex) * (1 - current.rigidity * 0.78) +
              numberRigidityMix * 0.003) +
          radialInfluence * current.bloom * 0.02 * signatureBloom +
          (index / drawCount) * colorSettings.hueRange) %
        1
      const burstBand = Math.floor(pseudoNoise(index + 4201) * 5)
      const burstHueBase =
        burstBand === 0
          ? 0.11
          : burstBand === 1
            ? 0.08
            : burstBand === 2
              ? 0.14
              : burstBand === 3
                ? 0.58
                : 0.12
      const burstHue =
        (burstHueBase +
          Math.sin(time * (0.6 + burstBand * 0.08) + phase * 2.4) * 0.028 +
          radialInfluence * 0.04) % 1
      const resolvedHue = MathUtils.lerp(hue, burstHue, countdownBurstMix * 0.82)

      const lightness =
        colorSettings.lightness +
        current.brightness * 0.14 +
        Math.sin(phase + time * (0.9 + current.energy * 0.6)) *
          ((0.018 + gestureEventRef.current * 0.012) * (1 - current.rigidity * 0.76) +
            numberRigidityMix * 0.01) +
        shockwaveRef.current * radialInfluence * 0.06 +
        scale * 0.012
      const burstLightness =
        lightness +
        burstTwinkle * 0.22 +
        countdownBurstMix * 0.06 +
        (1 - radialInfluence) * countdownBurstMix * 0.08
      const resolvedSaturation = MathUtils.lerp(
        colorSettings.saturation,
        0.52,
        countdownBurstMix * (0.56 + burstTwinkle * 0.18),
      )

      mainColor.setHSL(
        resolvedHue,
        resolvedSaturation,
        MathUtils.clamp(burstLightness, 0.26, 0.96),
      )
      colorArray[p] = mainColor.r
      colorArray[p + 1] = mainColor.g
      colorArray[p + 2] = mainColor.b
    }

    geometry.setDrawRange(0, drawCount)
    positionAttr.needsUpdate = true
    colorAttr.needsUpdate = true

    const mainPointScalar =
      0.0235 +
      flowModeMix * 0.0032 -
      countModeMix * 0.0018 -
      countdownModeMix * 0.0018 -
      countdownBurstMix * 0.0024 -
      fistModeMix * 0.0012
    material.uniforms.uPointSize.value = Math.max(
      9,
      viewport.height * size.height * current.size * mainPointScalar,
    )
    material.uniforms.uPulse.value = MathUtils.damp(
      material.uniforms.uPulse.value as number,
      fistInputActive
        ? 0.12 + current.velocity * 0.1 + mixes.fist * 0.03
        : controllerState.countdownBurst
          ? 0.42 +
            current.brightness * 0.1 +
            current.energy * 0.16 +
            current.eventPulse * 0.12 +
            countdownBurstMix * 0.12
        : current.velocity * 0.42 +
          current.brightness * 0.12 +
          current.energy * 0.2 +
          Math.abs(forwardTravel) * 0.34 +
          travelBurst * 0.26 +
          gestureEventRef.current * 0.18 +
          mixes.fist * 0.08,
      fistInputActive ? 8.6 : 4.2,
      delta,
    )
    material.uniforms.uSquareMix.value = MathUtils.damp(
      material.uniforms.uSquareMix.value as number,
      MathUtils.clamp(0.16 + fistModeMix * 0.92 + countModeMix * 0.08 + countdownModeMix * 0.08 - countdownBurstMix * 0.12, 0.04, 1),
      fistInputActive ? 10.5 : 6.6,
      delta,
    )

    const badgeDrawCount = badgeCount * BADGE_PARTICLES_PER_CLUSTER
    const badgeLayout = badgeLayouts[badgeCount] ?? []
    const countFieldScale = current.spread * 0.84
    const countdownFieldScale = current.spread * 0.84
    const countAnchorX = anchorX * 0.32
    const countdownAnchorX = anchorX * 0.32
    const countAnchorY = anchorY * 0.32
    const countdownAnchorY = anchorY * 0.32
    const countBadgeBaseY = countBounds.maxY * countFieldScale + BADGE_GROUP_GAP + countAnchorY
    const countdownBadgeBaseY =
      countdownBounds.maxY * countdownFieldScale + BADGE_GROUP_GAP + countdownAnchorY
    const badgeBaseY = countModeActive
      ? countBadgeBaseY
      : countdownModeActive
        ? countdownBadgeBaseY
        : countBadgeBaseY
    const badgeSpring =
      0.086 +
      countModeMix * 0.028 +
      countdownModeMix * 0.028 +
      (numberInputActive ? 0.07 : 0) +
      current.rigidity * 0.02
    const badgeVelocityDamping = MathUtils.clamp(
      0.11 +
        current.rigidity * 0.03 +
        countModeMix * 0.02 +
        countdownModeMix * 0.02 +
        (numberInputActive ? 0.07 : 0),
      0.1,
      0.28,
    )

    for (let badgeIndex = 0; badgeIndex < badgeCount; badgeIndex += 1) {
      const anchor = badgeLayout[badgeIndex]
      if (!anchor) continue

      for (let localIndex = 0; localIndex < BADGE_PARTICLES_PER_CLUSTER; localIndex += 1) {
        const globalIndex = badgeIndex * BADGE_PARTICLES_PER_CLUSTER + localIndex
        const p = globalIndex * 3
        const templateOffset = localIndex * 3
        const gatherScatter = numberInputActive
          ? (1 - badgeReveal) * (0.12 + badgeIndex * 0.008)
          : (1 - badgeReveal) * (0.34 + badgeIndex * 0.015)
        const idleFloat = numberInputActive
          ? 0.0018 + (1 - badgeReveal) * 0.006
          : 0.006 + (1 - badgeReveal) * 0.014
        const floatX =
          Math.sin(time * (0.88 + pseudoNoise(globalIndex + 1901) * 0.54) + globalIndex * 0.11) *
          idleFloat
        const floatY =
          Math.cos(time * (0.78 + pseudoNoise(globalIndex + 1951) * 0.6) + globalIndex * 0.13) *
          idleFloat
        const floatZ =
          Math.sin(time * (0.64 + pseudoNoise(globalIndex + 2017) * 0.44) + globalIndex * 0.09) *
          idleFloat *
          0.8
        const gatherX = (pseudoNoise(globalIndex + 2053) - 0.5) * gatherScatter
        const gatherY = (pseudoNoise(globalIndex + 2111) - 0.5) * gatherScatter
        const gatherZ = (pseudoNoise(globalIndex + 2161) - 0.5) * gatherScatter * 0.32

        const badgeAnchorX = countModeActive
          ? countAnchorX
          : countdownModeActive
            ? countdownAnchorX
            : countAnchorX
        const targetX = badgeTemplate[templateOffset] + anchor.x + badgeAnchorX + gatherX + floatX
        const targetY =
          badgeTemplate[templateOffset + 1] + anchor.y + badgeBaseY + gatherY + floatY
        const targetZ = badgeTemplate[templateOffset + 2] + gatherZ + floatZ

        badgeVelocities[p] += (targetX - badgePositionArray[p]) * badgeSpring
        badgeVelocities[p + 1] += (targetY - badgePositionArray[p + 1]) * badgeSpring
        badgeVelocities[p + 2] += (targetZ - badgePositionArray[p + 2]) * badgeSpring

        badgeVelocities[p] *= 1 - badgeVelocityDamping
        badgeVelocities[p + 1] *= 1 - badgeVelocityDamping
        badgeVelocities[p + 2] *= 1 - badgeVelocityDamping

        badgePositionArray[p] += badgeVelocities[p]
        badgePositionArray[p + 1] += badgeVelocities[p + 1]
        badgePositionArray[p + 2] += badgeVelocities[p + 2]

        const edgeWeight =
          (Math.abs(badgeTemplate[templateOffset]) + Math.abs(badgeTemplate[templateOffset + 1])) /
          0.6
        badgeColor.setHSL(
          0.1,
          0.08,
          MathUtils.clamp(
            0.78 -
              edgeWeight * 0.06 -
              badgeIndex * 0.01 +
              Math.sin(time * 0.9 + globalIndex * 0.07) * 0.015,
            0.62,
            0.82,
          ),
        )

        badgeColorArray[p] = badgeColor.r
        badgeColorArray[p + 1] = badgeColor.g
        badgeColorArray[p + 2] = badgeColor.b
      }
    }

    badgeGeometry.setDrawRange(0, badgeDrawCount)
    badgePositionAttr.needsUpdate = badgeDrawCount > 0
    badgeColorAttr.needsUpdate = badgeDrawCount > 0
    badgeMaterial.uniforms.uPointSize.value = Math.max(
      7,
      viewport.height * size.height * 0.0086,
    )
    badgeMaterial.uniforms.uOpacity.value = MathUtils.damp(
      badgeMaterial.uniforms.uOpacity.value as number,
      countModeActive ? (badgeCount > 0 ? 0.94 : 0) : countdownModeActive ? (badgeCount > 0 ? 0.94 : 0) : 0,
      numberInputActive ? 8.4 : 5.2,
      delta,
    )

  })

  return (
    <>
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[positions, 3]}
            usage={DynamicDrawUsage}
          />
          <bufferAttribute
            attach="attributes-color"
            args={[colors, 3]}
            usage={DynamicDrawUsage}
          />
          <bufferAttribute
            attach="attributes-aScale"
            args={[scales, 1]}
            usage={DynamicDrawUsage}
          />
        </bufferGeometry>
        <shaderMaterial
          ref={materialRef}
          uniforms={uniforms}
          vertexShader={particleVertexShader}
          fragmentShader={particleFragmentShader}
          transparent
          depthWrite={false}
          blending={NormalBlending}
          vertexColors
        />
      </points>
      <points ref={badgePointsRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[badgePositions, 3]}
            usage={DynamicDrawUsage}
          />
          <bufferAttribute
            attach="attributes-color"
            args={[badgeColors, 3]}
            usage={DynamicDrawUsage}
          />
          <bufferAttribute
            attach="attributes-aScale"
            args={[badgeScales, 1]}
            usage={DynamicDrawUsage}
          />
        </bufferGeometry>
        <shaderMaterial
          ref={badgeMaterialRef}
          uniforms={badgeUniforms}
          vertexShader={badgeVertexShader}
          fragmentShader={badgeFragmentShader}
          transparent
          depthWrite={false}
          blending={NormalBlending}
          vertexColors
        />
      </points>
    </>
  )
}

function SceneEffects() {
  return (
    <EffectComposer multisampling={0}>
      <Bloom
        intensity={1.02}
        luminanceThreshold={0.14}
        luminanceSmoothing={0.3}
        mipmapBlur
      />
      <Noise opacity={0.006} blendFunction={BlendFunction.SCREEN} />
      <Vignette eskil={false} offset={0.16} darkness={0.68} />
    </EffectComposer>
  )
}

export function ParticleScene({ controllerState }: ParticleSceneProps) {
  return (
    <div className="particle-scene" aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0, 7.5], fov: 50 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, powerPreference: 'high-performance', alpha: true }}
      >
        <color attach="background" args={['#030710']} />
        <fog attach="fog" args={['#030710', 6.2, 15.8]} />
        <ambientLight intensity={0.35} />
        <pointLight position={[4, 6, 3]} intensity={14} color="#8fd3ff" />
        <pointLight position={[-4, -3, 4]} intensity={10} color="#8effde" />
        <pointLight position={[0, 0, 6]} intensity={7} color="#ffd2ff" />
        <ParticleField controllerState={controllerState} />
        <SceneEffects />
      </Canvas>
    </div>
  )
}
