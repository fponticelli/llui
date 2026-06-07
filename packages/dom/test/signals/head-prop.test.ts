import { describe, it, expect, afterEach } from 'vitest'
import { domHeadSink, type HeadController, type HeadTarget } from '../../src/signals/head'

// Invariant: after ANY sequence of register/set/release across keys, the live
// <head>/<html> reflects exactly the most-recently-registered LIVE writer per key
// (last-writer-wins), and a key with no live writers leaves no managed trace.
// A reference model (stack of values per key) is the oracle.

// Deterministic LCG so failures reproduce (no Math.random / Date in the harness).
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000
}

interface Live {
  ctl: HeadController
  value: string
}

const KEYS: { key: string; target: HeadTarget; read: () => string | null }[] = [
  {
    key: 'title',
    target: { kind: 'title' },
    read: () => document.head.querySelector('title')?.textContent ?? null,
  },
  {
    key: 'meta:name=description',
    target: { kind: 'element', tag: 'meta' },
    read: () =>
      document.head.querySelector('meta[name="description"]')?.getAttribute('content') ?? null,
  },
  {
    key: 'html:lang',
    target: { kind: 'attr', on: 'html', name: 'lang' },
    read: () => document.documentElement.getAttribute('lang'),
  },
]

afterEach(() => {
  for (const el of Array.from(document.head.querySelectorAll('[data-llui-head]'))) el.remove()
  document.documentElement.removeAttribute('lang')
})

describe('head sink — last-writer-wins invariant', () => {
  it('matches the reference model across random register/set/release sequences', () => {
    const sink = domHeadSink(document)
    const model = new Map<string, Live[]>(KEYS.map((k) => [k.key, []]))
    const rnd = lcg(12345)
    let counter = 0

    const setValue = (k: (typeof KEYS)[number], live: Live, v: string): void => {
      live.value = v
      if (k.target.kind === 'title') live.ctl.set({}, v)
      else if (k.target.kind === 'element') live.ctl.set({ name: 'description', content: v })
      else live.ctl.set({ lang: v })
    }

    for (let step = 0; step < 400; step++) {
      const k = KEYS[Math.floor(rnd() * KEYS.length)]!
      const stack = model.get(k.key)!
      const roll = rnd()
      if (roll < 0.45) {
        // register + initial set
        const ctl = sink.register(k.key, k.target)
        const live: Live = { ctl, value: '' }
        stack.push(live)
        setValue(k, live, `v${counter++}`)
      } else if (roll < 0.75 && stack.length) {
        // set on a random existing live writer
        const live = stack[Math.floor(rnd() * stack.length)]!
        setValue(k, live, `v${counter++}`)
      } else if (stack.length) {
        // release a random live writer
        const i = Math.floor(rnd() * stack.length)
        stack[i]!.ctl.release()
        stack.splice(i, 1)
      }

      // Oracle check for every key after each op.
      for (const kk of KEYS) {
        const s = model.get(kk.key)!
        const expected = s.length ? s[s.length - 1]!.value : null
        expect(kk.read()).toBe(expected)
      }
    }

    // Drain everything; head must return fully clean.
    for (const [, stack] of model) for (const live of stack) live.ctl.release()
    expect(document.head.querySelectorAll('[data-llui-head]').length).toBe(0)
    expect(document.documentElement.hasAttribute('lang')).toBe(false)
  })
})
