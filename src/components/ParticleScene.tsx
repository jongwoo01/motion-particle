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
import type { ParticleControllerState } from '../types'

interface ParticleSceneProps {
  controllerState: ParticleControllerState
}

type DynamicsState = ParticleControllerState

const MAX_PARTICLES = 32000
const MIN_PARTICLES = 6000

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

  void main() {
    vec2 centered = gl_PointCoord - vec2(0.5);
    float circleDistance = length(centered);
    float squareDistance = max(abs(centered.x), abs(centered.y));
    float shapeDistance = mix(circleDistance, squareDistance, 0.36);

    float body = smoothstep(0.53, 0.16, shapeDistance);
    float core = smoothstep(0.22, 0.0, shapeDistance);
    float edge = smoothstep(0.58, 0.34, shapeDistance) - smoothstep(0.34, 0.2, shapeDistance);

    vec3 denseColor = mix(vColor, vec3(0.96, 0.97, 1.0), 0.16 + vScale * 0.08);
    vec3 coreColor = mix(denseColor, vec3(1.0), 0.28);
    vec3 finalColor = denseColor * body * 0.98 + coreColor * core * 0.56 + denseColor * edge * 0.14;
    float alpha = body * 0.84 + core * 0.22;

    if (alpha < 0.01) discard;
    gl_FragColor = vec4(finalColor, alpha);
  }
`

function hslToColor(h: number, s: number, l: number) {
  const color = new Color()
  color.setHSL(h, s, l)
  return color
}

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
    scales[index] = 0.72 + pseudoNoise((index + 3) * 91.137) * 1.4
  }

  return scales
}

function createHeartTarget(index: number) {
  const t = pseudoNoise(index + 701) * Math.PI * 2
  const fill = Math.pow(pseudoNoise(index + 743), 0.72)
  const depthJitter = (pseudoNoise(index + 787) - 0.5) * 0.22
  const x = 16 * Math.pow(Math.sin(t), 3)
  const y =
    13 * Math.cos(t) -
    5 * Math.cos(2 * t) -
    2 * Math.cos(3 * t) -
    Math.cos(4 * t)

  return {
    x: (x / 18) * fill * 0.96,
    y: (y / 17) * fill * 0.92 + 0.08,
    z: depthJitter * (0.18 + (1 - fill) * 0.22),
  }
}

function createCubeTarget(index: number) {
  const face = Math.floor(pseudoNoise(index + 991) * 6)
  const edgeA = pseudoNoise(index + 1031) * 2 - 1
  const edgeB = pseudoNoise(index + 1061) * 2 - 1
  const size = 1.08
  const softInset = (pseudoNoise(index + 1097) - 0.5) * 0.08

  switch (face) {
    case 0:
      return { x: size, y: edgeA * size, z: edgeB * size + softInset }
    case 1:
      return { x: -size, y: edgeA * size, z: edgeB * size + softInset }
    case 2:
      return { x: edgeA * size, y: size, z: edgeB * size + softInset }
    case 3:
      return { x: edgeA * size, y: -size, z: edgeB * size + softInset }
    case 4:
      return { x: edgeA * size, y: edgeB * size, z: size + softInset }
    default:
      return { x: edgeA * size, y: edgeB * size, z: -size + softInset }
  }
}

function createNumberTargetField(count: number, value: number) {
  const positions = new Float32Array(count * 3)

  if (typeof document === 'undefined') {
    return positions
  }

  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 320
  const context = canvas.getContext('2d')

  if (!context) {
    return positions
  }

  const text = String(value)
  const fontSize = value === 10 ? 182 : 228
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#ffffff'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.font = `900 ${fontSize}px Pretendard, Inter, sans-serif`
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 8)

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
  const candidates: Array<{ x: number; y: number }> = []
  const widthScale = value === 10 ? 4.6 : 3.4

  for (let y = 0; y < canvas.height; y += 2) {
    for (let x = 0; x < canvas.width; x += 2) {
      const alpha = imageData.data[(y * canvas.width + x) * 4 + 3]
      if (alpha < 48) continue

      candidates.push({
        x: ((x / canvas.width) - 0.5) * widthScale,
        y: (0.5 - y / canvas.height) * 4.2,
      })
    }
  }

  if (candidates.length < 1) {
    return positions
  }

  for (let index = 0; index < count; index += 1) {
    const offset = index * 3
    const sample = candidates[
      Math.floor(pseudoNoise((value + 1) * 193 + index * 1.137) * candidates.length)
    ]
    const fillJitter = Math.pow(pseudoNoise(index + value * 71), 1.4)
    positions[offset] = sample.x + (pseudoNoise(index + value * 17) - 0.5) * 0.08 * fillJitter
    positions[offset + 1] =
      sample.y + (pseudoNoise(index + value * 29) - 0.5) * 0.08 * fillJitter
    positions[offset + 2] = (pseudoNoise(index + value * 47) - 0.5) * 0.16 * fillJitter
  }

  return positions
}

function createNumberTargetFields(count: number) {
  return Array.from({ length: 11 }, (_, value) => createNumberTargetField(count, value))
}

function createTargetFields(count: number) {
  const neutral = new Float32Array(count * 3)
  const openPalm = new Float32Array(count * 3)
  const fist = new Float32Array(count * 3)
  const victory = new Float32Array(count * 3)
  const heart = new Float32Array(count * 3)

  for (let index = 0; index < count; index += 1) {
    const offset = index * 3
    const theta = pseudoNoise(index + 101) * Math.PI * 2
    const phi = Math.acos(pseudoNoise(index + 203) * 2 - 1)
    const cluster = pseudoNoise(index + 307)
    const ring = pseudoNoise(index + 409)
    const progress = index / count

    const neutralRadius =
      cluster < 0.82
        ? 0.3 + Math.pow(pseudoNoise(index + 509), 1.55) * 1.25
        : 1.28 + ring * 1.05
    neutral[offset] = Math.sin(phi) * Math.cos(theta) * neutralRadius * 1.02
    neutral[offset + 1] = Math.cos(phi) * neutralRadius * 0.56
    neutral[offset + 2] = Math.sin(phi) * Math.sin(theta) * neutralRadius * 0.88

    const openRadius =
      cluster < 0.68
        ? 0.9 + Math.pow(pseudoNoise(index + 601), 1.28) * 1.95
        : 1.8 + ring * 1.75
    openPalm[offset] = Math.sin(phi) * Math.cos(theta) * openRadius * 1.08
    openPalm[offset + 1] = Math.cos(phi) * openRadius * 0.72
    openPalm[offset + 2] = Math.sin(phi) * Math.sin(theta) * openRadius * 0.96

    const cube = createCubeTarget(index)
    fist[offset] = cube.x
    fist[offset + 1] = cube.y
    fist[offset + 2] = cube.z

    const branchSide = index % 2 === 0 ? -1 : 1
    const branchSpread = Math.pow(pseudoNoise(index + 809), 1.55) * 1.12 + 0.26
    const branchLift = (pseudoNoise(index + 907) - 0.5) * 0.92
    victory[offset] = branchSide * (0.82 + branchSpread) + Math.cos(theta) * 0.18
    victory[offset + 1] = branchLift + Math.sin(phi) * 0.24
    victory[offset + 2] = (progress - 0.5) * 2.42 + Math.sin(theta) * 0.18

    const heartPoint = createHeartTarget(index)
    heart[offset] = heartPoint.x
    heart[offset + 1] = heartPoint.y
    heart[offset + 2] = heartPoint.z
  }

  return { neutral, openPalm, fist, victory, heart }
}

function createColorState() {
  return {
    hueBase: 0.58,
    hueRange: 0.08,
    saturation: 0.68,
    lightness: 0.42,
  }
}

function ParticleField({ controllerState }: ParticleSceneProps) {
  const seeds = useMemo(() => createSeedBuffer(MAX_PARTICLES), [])
  const scales = useMemo(() => createScaleBuffer(MAX_PARTICLES), [])
  const targetFields = useMemo(() => createTargetFields(MAX_PARTICLES), [])
  const numberFields = useMemo(() => createNumberTargetFields(MAX_PARTICLES), [])
  const positions = useMemo(() => Float32Array.from(targetFields.neutral), [targetFields])
  const colors = useMemo(() => new Float32Array(MAX_PARTICLES * 3), [])

  const pointsRef = useRef<Points>(null)
  const materialRef = useRef<ShaderMaterial>(null)
  const currentStateRef = useRef<DynamicsState>({ ...controllerState })
  const gestureMixRef = useRef({
    openPalm: 0,
    fist: 0,
    victory: 0,
    heart: 0,
  })
  const countModeMixRef = useRef(0)
  const velocitiesRef = useRef(new Float32Array(MAX_PARTICLES * 3))
  const viewport = useThree((state) => state.viewport)
  const size = useThree((state) => state.size)

  const uniforms = useMemo(
    () => ({
      uPointSize: { value: 20 },
      uPulse: { value: 0 },
    }),
    [],
  )

  useEffect(() => {
    currentStateRef.current = {
      ...currentStateRef.current,
      ...controllerState,
      anchor: { ...controllerState.anchor },
    }
  }, [controllerState])

  useFrame((state, delta) => {
    const points = pointsRef.current
    const material = materialRef.current
    if (!points || !material) return

    const geometry = points.geometry
    const positionAttr = geometry.getAttribute('position') as BufferAttribute
    const colorAttr = geometry.getAttribute('color') as BufferAttribute
    const positionArray = positionAttr.array as Float32Array
    const colorArray = colorAttr.array as Float32Array
    const velocities = velocitiesRef.current

    const current = currentStateRef.current
    current.count = MathUtils.lerp(current.count, controllerState.count, 0.05)
    current.size = MathUtils.lerp(current.size, controllerState.size, 0.06)
    current.velocity = MathUtils.lerp(current.velocity, controllerState.velocity, 0.05)
    current.spread = MathUtils.lerp(current.spread, controllerState.spread, 0.05)
    current.attraction = MathUtils.lerp(current.attraction, controllerState.attraction, 0.05)
    current.hueShift = MathUtils.lerp(current.hueShift, controllerState.hueShift, 0.05)
    current.noiseStrength = MathUtils.lerp(current.noiseStrength, controllerState.noiseStrength, 0.05)
    current.brightness = MathUtils.lerp(current.brightness, controllerState.brightness, 0.05)
    current.anchor.x = MathUtils.lerp(current.anchor.x, controllerState.anchor.x, 0.08)
    current.anchor.y = MathUtils.lerp(current.anchor.y, controllerState.anchor.y, 0.08)
    current.gesture = controllerState.gesture
    current.handDetected = controllerState.handDetected

    const drawCount = Math.min(MAX_PARTICLES, Math.max(MIN_PARTICLES, Math.round(current.count)))
    const time = state.clock.elapsedTime
    const mixes = gestureMixRef.current
    const targetOpen = controllerState.gesture === 'open_palm' ? 1 : 0
    const targetFist = controllerState.gesture === 'fist' ? 1 : 0
    const targetVictory = controllerState.gesture === 'victory' ? 1 : 0
    const targetHeart = controllerState.gesture === 'heart' ? 1 : 0
    countModeMixRef.current = MathUtils.damp(
      countModeMixRef.current,
      controllerState.mode === 'count' ? 1 : 0,
      4.4,
      delta,
    )
    const countModeMix = countModeMixRef.current
    const countField = numberFields[controllerState.countValue] ?? numberFields[0]

    mixes.openPalm = MathUtils.damp(mixes.openPalm, targetOpen, 3.9, delta)
    mixes.fist = MathUtils.damp(mixes.fist, targetFist, 4.2, delta)
    mixes.victory = MathUtils.damp(mixes.victory, targetVictory, 4.1, delta)
    mixes.heart = MathUtils.damp(mixes.heart, targetHeart, 4.4, delta)

    const neutralMix = Math.max(
      0,
      1 - Math.max(mixes.openPalm, mixes.fist, mixes.victory, mixes.heart),
    )
    const colorSettings = createColorState()
    colorSettings.hueBase =
      neutralMix * 0.58 +
      mixes.openPalm * 0.53 +
      mixes.fist * 0.08 +
      mixes.victory * 0.76 +
      mixes.heart * 0.96
    colorSettings.hueRange =
      neutralMix * 0.08 +
      mixes.openPalm * 0.1 +
      mixes.fist * 0.05 +
      mixes.victory * 0.12 +
      mixes.heart * 0.04
    colorSettings.saturation =
      neutralMix * 0.68 +
      mixes.openPalm * 0.8 +
      mixes.fist * 0.86 +
      mixes.victory * 0.8 +
      mixes.heart * 0.72
    colorSettings.lightness =
      neutralMix * 0.42 +
      mixes.openPalm * 0.54 +
      mixes.fist * 0.48 +
      mixes.victory * 0.54 +
      mixes.heart * 0.64
    colorSettings.hueBase = MathUtils.lerp(colorSettings.hueBase, 0.08, countModeMix * 0.72)
    colorSettings.hueRange = MathUtils.lerp(colorSettings.hueRange, 0.03, countModeMix)
    colorSettings.saturation = MathUtils.lerp(colorSettings.saturation, 0.18, countModeMix)
    colorSettings.lightness = MathUtils.lerp(colorSettings.lightness, 0.78, countModeMix * 0.86)

    const handStrength = current.handDetected ? 1 : 0.25
    const anchorX =
      current.anchor.x *
      handStrength *
      (1.5 + mixes.victory * 0.7 + mixes.openPalm * 0.2) *
      (1 - countModeMix * 0.52)
    const anchorY =
      current.anchor.y *
      handStrength *
      (1.2 + mixes.openPalm * 0.35) *
      (1 - countModeMix * 0.52)
    const springStrength =
      0.042 + current.attraction * 0.03 + mixes.fist * 0.014 + countModeMix * 0.034
    const damping = MathUtils.clamp(
      0.928 - current.velocity * 0.038 + mixes.fist * 0.03 + countModeMix * 0.022,
      0.88,
      0.982,
    )
    const turbulence =
      (current.noiseStrength * 0.0046 + current.velocity * 0.0042) * (1 - countModeMix * 0.78)

    for (let index = 0; index < drawCount; index += 1) {
      const p = index * 3
      const seed = index * 4
      const phase = seeds[seed + 3]
      const theta = seeds[seed + 1]
      const scale = scales[index]

      const breathe = 1 + Math.sin(time * 0.42 + phase) * (0.01 + mixes.openPalm * 0.014)
      const wobbleX = Math.sin(time * 0.7 + phase) * turbulence
      const wobbleY = Math.cos(time * 0.62 + theta) * turbulence * 0.68
      const wobbleZ = Math.sin(time * 0.78 + theta + phase) * turbulence

      const targetX =
        (targetFields.neutral[p] * neutralMix +
          targetFields.openPalm[p] * mixes.openPalm +
          targetFields.fist[p] * mixes.fist +
          targetFields.victory[p] * mixes.victory +
          targetFields.heart[p] * mixes.heart) *
          current.spread *
          breathe +
        anchorX

      const targetY =
        (targetFields.neutral[p + 1] * neutralMix +
          targetFields.openPalm[p + 1] * mixes.openPalm +
          targetFields.fist[p + 1] * mixes.fist +
          targetFields.victory[p + 1] * mixes.victory +
          targetFields.heart[p + 1] * mixes.heart) *
          current.spread *
          breathe +
        anchorY

      const targetZ =
        (targetFields.neutral[p + 2] * neutralMix +
          targetFields.openPalm[p + 2] * mixes.openPalm +
          targetFields.fist[p + 2] * mixes.fist +
          targetFields.victory[p + 2] * mixes.victory +
          targetFields.heart[p + 2] * mixes.heart) *
          current.spread *
          breathe
      const countTargetX = countField[p] * current.spread * 0.84 + anchorX * 0.32
      const countTargetY = countField[p + 1] * current.spread * 0.84 + anchorY * 0.32
      const countTargetZ = countField[p + 2] * current.spread * 0.84
      const resolvedTargetX = MathUtils.lerp(targetX, countTargetX, countModeMix)
      const resolvedTargetY = MathUtils.lerp(targetY, countTargetY, countModeMix)
      const resolvedTargetZ = MathUtils.lerp(targetZ, countTargetZ, countModeMix)

      velocities[p] += (resolvedTargetX - positionArray[p]) * springStrength + wobbleX
      velocities[p + 1] += (resolvedTargetY - positionArray[p + 1]) * springStrength + wobbleY
      velocities[p + 2] += (resolvedTargetZ - positionArray[p + 2]) * springStrength + wobbleZ

      const swirl =
        (neutralMix * 0.004 + mixes.openPalm * 0.009 + mixes.victory * 0.013) *
        current.velocity *
        (1 - countModeMix * 0.82)
      velocities[p] += -positionArray[p + 2] * swirl
      velocities[p + 2] += positionArray[p] * swirl

      velocities[p] *= damping
      velocities[p + 1] *= damping
      velocities[p + 2] *= damping

      positionArray[p] += velocities[p]
      positionArray[p + 1] += velocities[p + 1]
      positionArray[p + 2] += velocities[p + 2]

      const hue =
        (colorSettings.hueBase +
          current.hueShift +
          Math.sin(phase + time * 0.18) * 0.012 +
          (index / drawCount) * colorSettings.hueRange) %
        1

      const lightness =
        colorSettings.lightness +
        current.brightness * 0.16 +
        Math.sin(phase + time * 0.9) * 0.03 +
        scale * 0.012

      const color = hslToColor(
        hue,
        colorSettings.saturation,
        MathUtils.clamp(lightness, 0.26, 0.86),
      )

      colorArray[p] = color.r
      colorArray[p + 1] = color.g
      colorArray[p + 2] = color.b
    }

    geometry.setDrawRange(0, drawCount)
    positionAttr.needsUpdate = true
    colorAttr.needsUpdate = true

    material.uniforms.uPointSize.value = Math.max(
      12,
      viewport.height * size.height * current.size * 0.026,
    )
    material.uniforms.uPulse.value = MathUtils.damp(
      material.uniforms.uPulse.value as number,
      current.velocity + current.brightness * 0.18 + mixes.fist * 0.24,
      4.2,
      delta,
    )
  })

  return (
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
  )
}

function SceneEffects() {
  return (
    <EffectComposer multisampling={0}>
      <Bloom
        intensity={0.9}
        luminanceThreshold={0.24}
        luminanceSmoothing={0.28}
        mipmapBlur
      />
      <Noise opacity={0.012} blendFunction={BlendFunction.SCREEN} />
      <Vignette eskil={false} offset={0.18} darkness={0.72} />
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
