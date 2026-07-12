import { describe, expect, it } from 'vitest'
import {
  clampOffset,
  computeModalAnchor,
  deriveSavedPosition,
  deriveKind,
  fmtTokens,
  isReady,
  isTerminal,
  isWorking,
  parseSavedPosition,
  statusLabel,
} from '../src/hud-core.js'

describe('position math', () => {
  it('clampOffset keeps the button within margins', () => {
    expect(clampOffset(-50, 1000)).toBe(16) // floored at margin
    expect(clampOffset(500, 1000)).toBe(500) // unchanged mid-range
    expect(clampOffset(99999, 1000)).toBe(1000 - 44 - 16) // capped at far edge
  })

  it('deriveSavedPosition anchors to the nearest corner', () => {
    // button near bottom-right of a 1000×800 viewport
    const rect = { left: 900, top: 700, right: 944, bottom: 744, width: 44, height: 44 }
    expect(deriveSavedPosition(rect, 1000, 800)).toEqual({
      anchorX: 'right',
      offsetX: 1000 - 944,
      anchorY: 'bottom',
      offsetY: 800 - 744,
    })
    // button near top-left
    const tl = { left: 20, top: 16, right: 64, bottom: 60, width: 44, height: 44 }
    expect(deriveSavedPosition(tl, 1000, 800)).toEqual({
      anchorX: 'left',
      offsetX: 20,
      anchorY: 'top',
      offsetY: 16,
    })
  })

  it('parseSavedPosition validates shape', () => {
    expect(parseSavedPosition(null)).toBe(null)
    expect(parseSavedPosition('not json')).toBe(null)
    expect(parseSavedPosition(JSON.stringify({ anchorX: 'middle' }))).toBe(null)
    const ok = { anchorX: 'left', offsetX: 10, anchorY: 'top', offsetY: 20 }
    expect(parseSavedPosition(JSON.stringify(ok))).toEqual(ok)
  })
})

describe('computeModalAnchor', () => {
  it('prefers right + above the button', () => {
    expect(computeModalAnchor({ top: 600, right: 900 }, 360, 320)).toEqual({
      horizontal: 'right',
      vertical: 'bottom',
    })
  })
  it('flips to left when the button hugs the left edge', () => {
    expect(computeModalAnchor({ top: 600, right: 40 }, 360, 320).horizontal).toBe('left')
  })
  it('flips below when the button hugs the top edge', () => {
    expect(computeModalAnchor({ top: 10, right: 900 }, 360, 320).vertical).toBe('top')
  })
})

describe('status helpers', () => {
  it('buckets statuses', () => {
    expect(isWorking('claimed')).toBe(true)
    expect(isWorking('in-progress')).toBe(true)
    expect(isReady('proposed')).toBe(true)
    expect(isTerminal('applied')).toBe(true)
    expect(isTerminal('failed')).toBe(true)
    expect(isTerminal('proposed')).toBe(false)
  })
  it('statusLabel renders each state', () => {
    expect(statusLabel('claimed')).toContain('working')
    expect(statusLabel('proposed', 'fixed the bug')).toBe('✓ proposed: fixed the bug')
    expect(statusLabel('applied')).toContain('applied')
    expect(statusLabel('failed', 'boom')).toBe('❌ failed: boom')
    expect(statusLabel('weird')).toBe('→ weird')
  })
  it('fmtTokens abbreviates large counts', () => {
    expect(fmtTokens(1247)).toBe((1247).toLocaleString())
    expect(fmtTokens(14000)).toBe('14k')
  })
})

describe('deriveKind', () => {
  it('prefers element, then rect, then text', () => {
    expect(deriveKind({ selector: 'x', bbox: {} }, null)).toBe('element')
    expect(deriveKind(null, { x: 0, y: 0, w: 1, h: 1 })).toBe('rect')
    expect(deriveKind(null, null)).toBe('text')
  })
})
