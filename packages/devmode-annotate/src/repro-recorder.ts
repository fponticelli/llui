// Repro recorder. Captures clicks / inputs / keydowns / route changes
// between `start()` and `stop()`. The buffer is bounded to MAX_EVENTS
// so a recording that runs for a long time can't blow up the note.
//
// We deliberately skip password inputs and any element with
// `data-llui-private` on it or an ancestor — opt-out for sensitive
// regions of the app. Input values are truncated to TRUNC_INPUT chars.

import type { ReproEvent } from './note-types.js'

const MAX_EVENTS = 200
const TRUNC_INPUT = 80

function buildSelector(el: Element): string {
  const parts: string[] = []
  let cur: Element | null = el
  for (let depth = 0; cur && depth < 4; depth++, cur = cur.parentElement) {
    if (cur.id) {
      parts.unshift(`#${cur.id}`)
      break
    }
    const tag = cur.tagName.toLowerCase()
    const classes = Array.from(cur.classList).filter((c) => !c.startsWith('llui-'))
    if (classes.length > 0) parts.unshift(`${tag}.${classes[0]}`)
    else parts.unshift(tag)
  }
  return parts.join(' > ')
}

function isPrivate(el: Element | null): boolean {
  let cur: Element | null = el
  while (cur) {
    if (cur instanceof HTMLInputElement && cur.type === 'password') return true
    if (cur.hasAttribute('data-llui-private')) return true
    cur = cur.parentElement
  }
  return false
}

function isHud(el: Element | null): boolean {
  return !!el?.closest('#llui-devmode-annotate-root')
}

export interface ReproRecorderHandle {
  start: () => void
  stop: () => void
  /** Returns + clears the captured events. Use on submit. */
  flush: () => ReproEvent[]
  isRecording: () => boolean
}

export function createReproRecorder(): ReproRecorderHandle {
  let events: ReproEvent[] = []
  let startedAt = 0
  let recording = false

  const push = (e: ReproEvent): void => {
    if (events.length >= MAX_EVENTS) events.shift() // ring-buffer behaviour
    events.push(e)
  }
  const t = (): number => Date.now() - startedAt

  const onClick = (e: MouseEvent): void => {
    const target = e.target as Element | null
    if (!target || isHud(target) || isPrivate(target)) return
    push({ type: 'click', t: t(), selector: buildSelector(target) })
  }
  const onInput = (e: Event): void => {
    const target = e.target as
      | (HTMLInputElement & { value: string })
      | (HTMLTextAreaElement & { value: string })
      | null
    if (!target || isHud(target) || isPrivate(target)) return
    const value = (target.value ?? '').slice(0, TRUNC_INPUT)
    push({ type: 'input', t: t(), selector: buildSelector(target), value })
  }
  const onKey = (e: KeyboardEvent): void => {
    // Only meaningful keys — alphanumeric / Enter / Escape / arrows /
    // common modifiers. Skip everything else to keep the trace
    // readable.
    const tracked =
      e.key.length === 1 ||
      e.key === 'Enter' ||
      e.key === 'Escape' ||
      e.key === 'Tab' ||
      e.key.startsWith('Arrow')
    if (!tracked) return
    if (isHud(e.target as Element | null)) return
    const mods = [e.metaKey && '⌘', e.ctrlKey && '⌃', e.shiftKey && '⇧', e.altKey && '⌥']
      .filter(Boolean)
      .join('')
    push({ type: 'keydown', t: t(), key: e.key, ...(mods ? { mods } : {}) })
  }
  const onPopState = (): void => {
    if (typeof location === 'undefined') return
    push({ type: 'route', t: t(), pathname: location.pathname })
  }

  return {
    start() {
      if (recording) return
      recording = true
      events = []
      startedAt = Date.now()
      document.addEventListener('click', onClick, true)
      document.addEventListener('input', onInput, true)
      document.addEventListener('keydown', onKey, true)
      window.addEventListener('popstate', onPopState)
    },
    stop() {
      if (!recording) return
      recording = false
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('input', onInput, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('popstate', onPopState)
    },
    flush() {
      const out = events
      events = []
      return out
    },
    isRecording() {
      return recording
    },
  }
}

export interface ReplayOptions {
  /** Wall-clock factor — 1 = real time, 0 = instant, 0.5 = double speed.
   *  The original timestamps in `ReproEvent.t` are relative to the
   *  recording start. Default 1 (replay at original pace). */
  speed?: number
  /** Cap on the gap between events. The recorder may capture a long
   *  pause where the user was thinking; on replay we usually don't
   *  want to wait that long. Default 2000ms — anything longer is
   *  clamped. */
  maxStepMs?: number
  /** Bail out if a click target's selector no longer resolves. When
   *  false (default), the event is logged + skipped and replay
   *  continues with later events. */
  abortOnMissing?: boolean
}

export interface ReplayResult {
  /** How many events were successfully dispatched. */
  applied: number
  /** Events whose target selector couldn't be resolved + reason. */
  skipped: Array<{ event: ReproEvent; reason: string }>
}

/**
 * Replay a captured `ReproEvent[]` against the live DOM. Resolves the
 * selectors at dispatch time (so the page can have changed since the
 * recording) and synthesizes the corresponding DOM event. Returns
 * counts so the caller can surface success/skip rates.
 *
 * - `click` → `dispatchEvent(new MouseEvent('click', { bubbles, cancelable }))`
 *    on the resolved element.
 * - `input` → set `.value` then dispatch `Event('input')` + `Event('change')`
 *    on input/textarea. Other elements ignored.
 * - `keydown` → `dispatchEvent(new KeyboardEvent('keydown', { key, ... }))`
 *    on the active element (or document if none).
 * - `route` → `history.pushState(null, '', pathname)` then dispatch
 *    `popstate` so apps that listen for it (most routers) react.
 */
export async function replayReproEvents(
  events: ReproEvent[],
  options: ReplayOptions = {},
): Promise<ReplayResult> {
  const speed = options.speed ?? 1
  const maxStepMs = options.maxStepMs ?? 2000
  const abortOnMissing = options.abortOnMissing === true

  const result: ReplayResult = { applied: 0, skipped: [] }
  let lastT = 0
  for (const event of events) {
    const gap = Math.min(Math.max(0, event.t - lastT), maxStepMs)
    if (gap > 0 && speed > 0) {
      await new Promise((r) => setTimeout(r, gap / speed))
    }
    lastT = event.t

    try {
      await dispatchOne(event)
      result.applied++
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      result.skipped.push({ event, reason })
      if (abortOnMissing) break
    }
  }
  return result
}

async function dispatchOne(event: ReproEvent): Promise<void> {
  switch (event.type) {
    case 'click': {
      const el = document.querySelector(event.selector)
      if (!el) throw new Error(`selector did not match: ${event.selector}`)
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      return
    }
    case 'input': {
      const el = document.querySelector(event.selector) as
        | HTMLInputElement
        | HTMLTextAreaElement
        | HTMLSelectElement
        | null
      if (!el) throw new Error(`selector did not match: ${event.selector}`)
      if ('value' in el) {
        el.value = event.value
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        return
      }
      throw new Error(`target ${event.selector} is not a form field`)
    }
    case 'keydown': {
      const target = (document.activeElement as Element | null) ?? document.body
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: event.key,
          bubbles: true,
          cancelable: true,
          ...(event.mods?.includes('⌘') ? { metaKey: true } : {}),
          ...(event.mods?.includes('⌃') ? { ctrlKey: true } : {}),
          ...(event.mods?.includes('⇧') ? { shiftKey: true } : {}),
          ...(event.mods?.includes('⌥') ? { altKey: true } : {}),
        }),
      )
      return
    }
    case 'route': {
      if (typeof history === 'undefined') return
      history.pushState(null, '', event.pathname)
      window.dispatchEvent(new PopStateEvent('popstate'))
      return
    }
  }
}
