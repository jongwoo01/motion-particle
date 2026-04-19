export interface FieldBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

export interface ParticleTargetFields {
  neutral: Float32Array
  openPalm: Float32Array
  fist: Float32Array
  victory: Float32Array
  heart: Float32Array
}

export interface NumberTargetFieldSet {
  fields: Float32Array[]
  bounds: FieldBounds[]
}

export interface BadgeAnchor {
  x: number
  y: number
}

export const BADGE_CLUSTER_SIDE = 16
export const BADGE_PARTICLES_PER_CLUSTER = BADGE_CLUSTER_SIDE * BADGE_CLUSTER_SIDE
export const MAX_BADGES = 10

const ZERO_BOUNDS: FieldBounds = {
  minX: 0,
  maxX: 0,
  minY: 0,
  maxY: 0,
  minZ: 0,
  maxZ: 0,
}

function pseudoNoise(seed: number) {
  const raw = Math.sin(seed * 12.9898) * 43758.5453123
  return raw - Math.floor(raw)
}

export function getFieldBounds(field: Float32Array): FieldBounds {
  if (field.length < 3) {
    return ZERO_BOUNDS
  }

  let minX = field[0]
  let maxX = field[0]
  let minY = field[1]
  let maxY = field[1]
  let minZ = field[2]
  let maxZ = field[2]

  for (let index = 3; index < field.length; index += 3) {
    const x = field[index]
    const y = field[index + 1]
    const z = field[index + 2]

    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }

  return { minX, maxX, minY, maxY, minZ, maxZ }
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

export function createSolidCubeTargetField(count: number) {
  const positions = new Float32Array(count * 3)
  const half = 0.88
  const EDGES: Array<[[number, number, number], [number, number, number]]> = [
    [[-1, -1, -1], [1, -1, -1]], [[-1, 1, -1], [1, 1, -1]],
    [[-1, -1, 1], [1, -1, 1]], [[-1, 1, 1], [1, 1, 1]],
    [[-1, -1, -1], [-1, 1, -1]], [[1, -1, -1], [1, 1, -1]],
    [[-1, -1, 1], [-1, 1, 1]], [[1, -1, 1], [1, 1, 1]],
    [[-1, -1, -1], [-1, -1, 1]], [[1, -1, -1], [1, -1, 1]],
    [[-1, 1, -1], [-1, 1, 1]], [[1, 1, -1], [1, 1, 1]],
  ]
  const edgeCount = Math.floor(count * 0.24)
  const surfaceCount = Math.floor(count * 0.36)
  const interiorCount = Math.max(0, count - edgeCount - surfaceCount)
  const perEdge = Math.ceil(edgeCount / EDGES.length)
  const edgeJitter = 0.024

  let ei = 0
  for (let e = 0; e < EDGES.length && ei < edgeCount; e += 1) {
    const [a, b] = EDGES[e]
    for (let j = 0; j < perEdge && ei < edgeCount; j += 1, ei += 1) {
      const t = pseudoNoise(ei + 1301)
      positions[ei * 3] = (a[0] + (b[0] - a[0]) * t) * half + (pseudoNoise(ei + 2101) - 0.5) * edgeJitter
      positions[ei * 3 + 1] = (a[1] + (b[1] - a[1]) * t) * half + (pseudoNoise(ei + 2201) - 0.5) * edgeJitter
      positions[ei * 3 + 2] = (a[2] + (b[2] - a[2]) * t) * half + (pseudoNoise(ei + 2301) - 0.5) * edgeJitter
    }
  }

  const depthJitter = 0.054
  for (let fi = 0; fi < surfaceCount; fi += 1) {
    const gi = edgeCount + fi
    const p = gi * 3
    const face = fi % 6
    const u = pseudoNoise(gi + 1401) * 2 - 1
    const v = pseudoNoise(gi + 1501) * 2 - 1
    const d = (pseudoNoise(gi + 1601) - 0.5) * depthJitter
    switch (face) {
      case 0: positions[p] = u * half; positions[p + 1] = v * half; positions[p + 2] = half + d; break
      case 1: positions[p] = u * half; positions[p + 1] = v * half; positions[p + 2] = -half + d; break
      case 2: positions[p] = half + d; positions[p + 1] = v * half; positions[p + 2] = u * half; break
      case 3: positions[p] = -half + d; positions[p + 1] = v * half; positions[p + 2] = u * half; break
      case 4: positions[p] = u * half; positions[p + 1] = half + d; positions[p + 2] = v * half; break
      default: positions[p] = u * half; positions[p + 1] = -half + d; positions[p + 2] = v * half
    }
  }

  for (let ii = 0; ii < interiorCount; ii += 1) {
    const gi = edgeCount + surfaceCount + ii
    const p = gi * 3
    positions[p] = (pseudoNoise(gi + 1801) * 2 - 1) * half * 0.78
    positions[p + 1] = (pseudoNoise(gi + 1861) * 2 - 1) * half * 0.78
    positions[p + 2] = (pseudoNoise(gi + 1931) * 2 - 1) * half * 0.78
  }

  return positions
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

export function createNumberTargetFieldSet(count: number): NumberTargetFieldSet {
  const fields = Array.from({ length: 11 }, (_, value) => createNumberTargetField(count, value))
  const bounds = fields.map((field) => getFieldBounds(field))

  return { fields, bounds }
}

export function createTargetFields(count: number): ParticleTargetFields {
  const neutral = new Float32Array(count * 3)
  const openPalm = new Float32Array(count * 3)
  const fist = createSolidCubeTargetField(count)
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

export function createBadgeClusterTemplate(side = BADGE_CLUSTER_SIDE, spacing = 0.038) {
  const positions = new Float32Array(side * side * 3)
  const half = (side - 1) / 2

  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const index = y * side + x
      const offset = index * 3
      const xRatio = half === 0 ? 0 : Math.abs(x - half) / half
      const yRatio = half === 0 ? 0 : Math.abs(y - half) / half
      const edgeFactor = Math.max(xRatio, yRatio)
      const jitterStrength = spacing * (0.14 + (1 - edgeFactor) * 0.34)
      const inwardBias = spacing * 0.06

      positions[offset] =
        (x - half) * spacing +
        (pseudoNoise(index + 1601) - 0.5) * jitterStrength -
        Math.sign(x - half || 0) * inwardBias * edgeFactor
      positions[offset + 1] =
        (half - y) * spacing +
        (pseudoNoise(index + 1657) - 0.5) * jitterStrength +
        Math.sign(half - y || 0) * inwardBias * edgeFactor
      positions[offset + 2] = (pseudoNoise(index + 1709) - 0.5) * spacing * 0.28
    }
  }

  return positions
}

export function createBalancedBadgeLayout(
  count: number,
  gapX = 0.72,
  gapY = 0.82,
): BadgeAnchor[] {
  if (count < 1) {
    return []
  }

  const anchors: BadgeAnchor[] = []
  const topRowCount = count <= 5 ? count : Math.ceil(count / 2)
  const bottomRowCount = count - topRowCount
  const topY = bottomRowCount > 0 ? gapY * 0.5 : 0
  const bottomY = -gapY * 0.5

  for (let index = 0; index < topRowCount; index += 1) {
    anchors.push({
      x: (index - (topRowCount - 1) * 0.5) * gapX,
      y: topY,
    })
  }

  for (let index = 0; index < bottomRowCount; index += 1) {
    anchors.push({
      x: (index - (bottomRowCount - 1) * 0.5) * gapX,
      y: bottomY,
    })
  }

  return anchors
}
