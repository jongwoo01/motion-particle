import { describe, expect, it } from 'vitest'
import {
  createBalancedBadgeLayout,
  createSolidCubeTargetField,
  getFieldBounds,
} from './particleTargets'

describe('particle targets', () => {
  it('creates a deterministic solid cube target field', () => {
    const first = createSolidCubeTargetField(128)
    const second = createSolidCubeTargetField(128)

    expect(Array.from(first)).toEqual(Array.from(second))
  })

  it('fills the cube interior instead of sampling faces only', () => {
    const field = createSolidCubeTargetField(2048)
    const bounds = getFieldBounds(field)
    const extentX = bounds.maxX - bounds.minX
    const extentY = bounds.maxY - bounds.minY
    const extentZ = bounds.maxZ - bounds.minZ
    const averageExtent = (extentX + extentY + extentZ) / 3
    let interiorCount = 0

    for (let index = 0; index < field.length; index += 3) {
      if (
        Math.abs(field[index]) < 0.32 &&
        Math.abs(field[index + 1]) < 0.32 &&
        Math.abs(field[index + 2]) < 0.32
      ) {
        interiorCount += 1
      }
    }

    expect(Math.abs(extentX - averageExtent)).toBeLessThan(0.08)
    expect(Math.abs(extentY - averageExtent)).toBeLessThan(0.08)
    expect(Math.abs(extentZ - averageExtent)).toBeLessThan(0.08)
    expect(interiorCount).toBeGreaterThan(40)
  })

  it('creates a balanced badge layout for 0 to 10 badges', () => {
    for (let count = 0; count <= 10; count += 1) {
      expect(createBalancedBadgeLayout(count)).toHaveLength(count)
    }

    const five = createBalancedBadgeLayout(5)
    expect(new Set(five.map((anchor) => anchor.y))).toHaveProperty('size', 1)

    const seven = createBalancedBadgeLayout(7)
    const topRow = seven.filter((anchor) => anchor.y > 0)
    const bottomRow = seven.filter((anchor) => anchor.y < 0)

    expect(topRow).toHaveLength(4)
    expect(bottomRow).toHaveLength(3)
    expect(topRow.reduce((sum, anchor) => sum + anchor.x, 0)).toBeCloseTo(0)
    expect(bottomRow.reduce((sum, anchor) => sum + anchor.x, 0)).toBeCloseTo(0)

    const ten = createBalancedBadgeLayout(10)
    expect(ten.filter((anchor) => anchor.y > 0)).toHaveLength(5)
    expect(ten.filter((anchor) => anchor.y < 0)).toHaveLength(5)
  })
})
