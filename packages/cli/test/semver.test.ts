import { describe, it, expect } from 'vitest'
import { compareVersions, minimumOfRange, parseVersion } from '../src/semver'

describe('parseVersion', () => {
  it('parses a full version, with or without prerelease and build', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] })
    expect(parseVersion('1.2.3-rc.1+sha.5')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: ['rc', 1],
    })
  })

  it('rejects anything that is not a full semver', () => {
    for (const bad of ['', '1', '1.2', '1.2.x', '01.2.3', '1.2.3-', '1.2.3-01', 'v', '^1.2.3']) {
      expect(parseVersion(bad), bad).toBeNull()
    }
  })

  it('tolerates a leading v or =, as npm does for an installed version', () => {
    expect(parseVersion('v1.2.3')).toEqual(parseVersion('1.2.3'))
    expect(parseVersion('=1.2.3')).toEqual(parseVersion('1.2.3'))
  })
})

describe('compareVersions', () => {
  const lt = (a: string, b: string): void => {
    expect(compareVersions(a, b), `${a} < ${b}`).toBe(-1)
    expect(compareVersions(b, a), `${b} > ${a}`).toBe(1)
  }

  it('orders by major, minor, patch numerically (not lexically)', () => {
    lt('0.9.0', '0.10.0')
    lt('1.2.9', '1.2.10')
    lt('1.99.99', '2.0.0')
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  })

  it('ranks a prerelease BELOW its release', () => {
    lt('1.0.0-rc.1', '1.0.0')
    lt('0.21.0-beta.0', '0.21.0')
    // ...but above the previous release.
    lt('0.20.1', '0.21.0-beta.0')
  })

  it('follows the semver 2.0 prerelease precedence example exactly', () => {
    const chain = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ]
    for (let i = 0; i < chain.length - 1; i++) lt(chain[i]!, chain[i + 1]!)
  })

  it('ignores build metadata', () => {
    expect(compareVersions('1.0.0+a', '1.0.0+b')).toBe(0)
  })

  it('throws on an unparseable operand rather than guessing', () => {
    expect(() => compareVersions('1.2', '1.2.0')).toThrow(/not a valid semver/)
  })
})

describe('minimumOfRange', () => {
  const cases: [string, string | null][] = [
    ['1.2.3', '1.2.3'],
    ['=1.2.3', '1.2.3'],
    ['v1.2.3', '1.2.3'],
    ['^1.2.3', '1.2.3'],
    ['~1.2.3', '1.2.3'],
    ['>=1.2.3', '1.2.3'],
    ['^0.20.1', '0.20.1'],
    ['^1.0.0-rc.1', '1.0.0-rc.1'],
    ['^1.2', '1.2.0'],
    ['~1', '1.0.0'],
    ['1.x', '1.0.0'],
    ['1.2.*', '1.2.0'],
    ['>=1.2.3 <2.0.0', '1.2.3'],
    ['<2.0.0 >=1.2.3', '1.2.3'],
    ['>= 1.2.3', '1.2.3'],
    ['>=1.0.0 >=1.4.0', '1.4.0'],
    ['1.2.3 - 2.0.0', '1.2.3'],
    ['^2.0.0 || ^1.4.0', '1.4.0'],
    ['workspace:^1.2.3', '1.2.3'],
    ['workspace:1.2.3', '1.2.3'],
    ['npm:@llui/components@^1.2.3', '1.2.3'],
    // No determinable floor: the CLI must say so, not invent 0.0.0.
    ['*', null],
    ['', null],
    ['x', null],
    ['latest', null],
    ['next', null],
    ['workspace:*', null],
    ['workspace:^', null],
    ['>1.2.3', null],
    ['<2.0.0', null],
    ['^1.0.0 || latest', null],
    ['github:fponticelli/llui', null],
    ['file:../llui/packages/components', null],
    ['link:../components', null],
    ['https://example.com/c.tgz', null],
  ]
  for (const [range, min] of cases) {
    it(`${JSON.stringify(range)} -> ${String(min)}`, () => {
      expect(minimumOfRange(range)).toBe(min)
    })
  }
})
