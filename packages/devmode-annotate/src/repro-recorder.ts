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
