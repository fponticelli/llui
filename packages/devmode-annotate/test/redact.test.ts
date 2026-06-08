import { describe, expect, it } from 'vitest'
import {
  redactRepro,
  redactScreenshot,
  redactState,
  resolveCaptureDefaults,
} from '../src/redact.js'
import type { NoteBody, ReproEvent } from '../src/note-types.js'

describe('resolveCaptureDefaults (prod-safe defaults)', () => {
  it('defaults debug + repro ON under the dev server', () => {
    expect(resolveCaptureDefaults(true, {})).toEqual({ debug: true, repro: true })
  })
  it('defaults debug + repro OFF in production', () => {
    expect(resolveCaptureDefaults(false, {})).toEqual({ debug: false, repro: false })
  })
  it('honors explicit per-channel opt-in/out over the default', () => {
    expect(resolveCaptureDefaults(false, { captureDebug: true })).toEqual({
      debug: true,
      repro: false,
    })
    expect(resolveCaptureDefaults(true, { repro: false })).toEqual({ debug: true, repro: false })
  })
})

describe('redactState', () => {
  const body: NoteBody = { stateSnapshot: { App: { secret: 1 } }, messageLog: [] }
  it('passes through unchanged with no hook', () => {
    expect(redactState(body)).toBe(body)
  })
  it('applies the hook (e.g. drop the snapshot)', () => {
    const out = redactState(body, (b) => ({ ...b, stateSnapshot: undefined }))
    expect(out.stateSnapshot).toBeUndefined()
    expect(out.messageLog).toEqual([])
  })
})

describe('redactRepro', () => {
  const events: ReproEvent[] = [
    { type: 'click', t: 0, selector: '#a' },
    { type: 'input', t: 1, selector: '#pw', value: 'hunter2' },
  ]
  it('passes through with no hook', () => {
    expect(redactRepro(events)).toBe(events)
  })
  it('masks input values via the hook', () => {
    const out = redactRepro(events, (evs) =>
      evs.map((e) => (e.type === 'input' ? { ...e, value: '***' } : e)),
    )
    expect(out[1]).toMatchObject({ type: 'input', value: '***' })
  })
  it('can drop the whole trace', () => {
    expect(redactRepro(events, () => [])).toEqual([])
  })
})

describe('redactScreenshot', () => {
  it('passes through with no hook', () => {
    expect(redactScreenshot('AAAA')).toBe('AAAA')
  })
  it('can transform the image', () => {
    expect(redactScreenshot('AAAA', (b64) => `${b64}-masked`)).toBe('AAAA-masked')
  })
  it('returns null to drop the screenshot', () => {
    expect(redactScreenshot('AAAA', () => null)).toBeNull()
  })
})
