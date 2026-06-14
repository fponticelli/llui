import { describe, it, expect, afterEach } from 'vitest'
import { createReproRecorder, replayReproEvents } from '../src/repro-recorder.js'
import type { ReproEvent } from '../src/note-types.js'

function inputEvent(events: ReproEvent[]): Extract<ReproEvent, { type: 'input' }> {
  const ev = events.find((e) => e.type === 'input')
  if (!ev || ev.type !== 'input') throw new Error('no input event captured')
  return ev
}

describe('repro recorder privacy (allow-list value capture)', () => {
  let cleanup: (() => void) | undefined
  afterEach(() => {
    cleanup?.()
    cleanup = undefined
    document.body.innerHTML = ''
  })

  function type(el: HTMLInputElement, value: string): void {
    el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  it('does NOT capture a value from an unmarked field (records redacted)', () => {
    const input = document.createElement('input')
    document.body.append(input)
    const rec = createReproRecorder()
    cleanup = () => rec.stop()
    rec.start()
    type(input, 'sk-secret-token-value')
    const ev = inputEvent(rec.flush())
    expect(ev.redacted).toBe(true)
    expect(ev.value).toBeUndefined()
  })

  it('captures a value only when the field opts in with data-llui-capture-value', () => {
    const input = document.createElement('input')
    input.setAttribute('data-llui-capture-value', '')
    document.body.append(input)
    const rec = createReproRecorder()
    cleanup = () => rec.stop()
    rec.start()
    type(input, 'visible-query')
    const ev = inputEvent(rec.flush())
    expect(ev.value).toBe('visible-query')
    expect(ev.redacted).toBeUndefined()
  })

  it('never records a value for a password field even if marked capturable', () => {
    const input = document.createElement('input')
    input.type = 'password'
    input.setAttribute('data-llui-capture-value', '')
    document.body.append(input)
    const rec = createReproRecorder()
    cleanup = () => rec.stop()
    rec.start()
    type(input, 'hunter2')
    // isPrivate() short-circuits before any input event is pushed.
    expect(rec.flush().some((e) => e.type === 'input')).toBe(false)
  })

  it('does not keylog plain typed characters (only nav keys / modified shortcuts)', () => {
    const input = document.createElement('input')
    document.body.append(input)
    const rec = createReproRecorder()
    cleanup = () => rec.stop()
    rec.start()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    const keys = rec.flush().filter((e) => e.type === 'keydown')
    expect(keys.map((k) => (k.type === 'keydown' ? k.key : ''))).toEqual(['k', 'Enter'])
  })
})

describe('repro replay safety gate (DA3)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    history.replaceState(null, '', '/')
  })

  it('refuses replay when the page is on a different path than recorded', async () => {
    history.replaceState(null, '', '/checkout')
    const btn = document.createElement('button')
    btn.id = 'pay'
    document.body.append(btn)
    let clicked = false
    btn.addEventListener('click', () => (clicked = true))
    const res = await replayReproEvents([
      { type: 'route', t: 0, pathname: '/settings' },
      { type: 'click', t: 10, selector: '#pay' },
    ])
    expect(res.refused).toMatch(/path mismatch/)
    expect(res.applied).toBe(0)
    expect(clicked).toBe(false)
  })

  it('refuses replay when the confirmation gate declines', async () => {
    const btn = document.createElement('button')
    btn.id = 'go'
    document.body.append(btn)
    let clicked = false
    btn.addEventListener('click', () => (clicked = true))
    const res = await replayReproEvents([{ type: 'click', t: 0, selector: '#go' }], {
      confirm: () => false,
    })
    expect(res.refused).toMatch(/not confirmed/)
    expect(clicked).toBe(false)
  })

  it('skips synthesized targets outside the app root', async () => {
    const app = document.createElement('div')
    app.id = 'app'
    const outside = document.createElement('button')
    outside.id = 'danger'
    document.body.append(app, outside)
    let clicked = false
    outside.addEventListener('click', () => (clicked = true))
    const res = await replayReproEvents([{ type: 'click', t: 0, selector: '#danger' }], {
      appRoot: '#app',
      expectedPath: null,
    })
    expect(clicked).toBe(false)
    expect(res.skipped.some((s) => /outside app root/.test(s.reason))).toBe(true)
  })

  it('applies events on the matching path with confirmation', async () => {
    const btn = document.createElement('button')
    btn.id = 'ok'
    document.body.append(btn)
    let clicked = false
    btn.addEventListener('click', () => (clicked = true))
    const res = await replayReproEvents(
      [
        { type: 'route', t: 0, pathname: '/' },
        { type: 'click', t: 5, selector: '#ok' },
      ],
      { confirm: () => true, speed: 0 },
    )
    expect(res.refused).toBeUndefined()
    expect(clicked).toBe(true)
    expect(res.applied).toBe(2)
  })
})
