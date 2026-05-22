// Mount-and-mutate regression for the each() reconciler under
// randomized array mutations. Matches the dungeonlogs issue #3 shape:
// outer `show.when` gates an inner `each` over a per-item array, the
// array grows/shrinks/swaps as messages fire, and per-row text
// accessors read from `item.current()`.
//
// The disposer-throw fix in `lifetime.ts` + the dev-panic
// infrastructure in `update-loop.ts` together make this kind of
// reconcile race observable instead of silent. This test exercises
// the actual mount/update/dispose pipeline under random sequences
// to catch the entire class of bug.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { component, mountApp, ol, li, ul, show, each } from '../src/index'

interface Entry {
  id: string
  label: string
  generation: number
}

interface State {
  visible: boolean
  entries: Entry[]
  seq: number
}

type Msg =
  | { type: 'show' }
  | { type: 'hide' }
  | { type: 'add' }
  | { type: 'remove'; id: string }
  | { type: 'swap'; aId: string; bId: string }
  | { type: 'touch'; id: string } // bumps `generation` — exercises in-place update
  | { type: 'replace'; id: string } // remove + immediately re-add with same id (key reuse)
  | { type: 'clear' }

function update(state: State, msg: Msg): [State, never[]] {
  switch (msg.type) {
    case 'show':
      return [{ ...state, visible: true }, []]
    case 'hide':
      return [{ ...state, visible: false }, []]
    case 'add': {
      const seq = state.seq + 1
      return [
        {
          ...state,
          seq,
          entries: [...state.entries, { id: String(seq), label: `e${seq}`, generation: 0 }],
        },
        [],
      ]
    }
    case 'remove':
      return [{ ...state, entries: state.entries.filter((e) => e.id !== msg.id) }, []]
    case 'swap': {
      const ai = state.entries.findIndex((e) => e.id === msg.aId)
      const bi = state.entries.findIndex((e) => e.id === msg.bId)
      if (ai === -1 || bi === -1 || ai === bi) return [state, []]
      const next = [...state.entries]
      ;[next[ai], next[bi]] = [next[bi]!, next[ai]!]
      return [{ ...state, entries: next }, []]
    }
    case 'touch':
      return [
        {
          ...state,
          entries: state.entries.map((e) =>
            e.id === msg.id ? { ...e, generation: e.generation + 1 } : e,
          ),
        },
        [],
      ]
    case 'replace': {
      const target = state.entries.find((e) => e.id === msg.id)
      if (!target) return [state, []]
      // Same-tick remove + re-add: the array reference changes but the
      // id key persists. each() should reconcile this as a NO-OP keep
      // (or remove+add) without dropping bindings.
      return [
        {
          ...state,
          entries: [
            ...state.entries.filter((e) => e.id !== msg.id),
            { ...target, generation: target.generation + 100 },
          ],
        },
        [],
      ]
    }
    case 'clear':
      return [{ ...state, entries: [] }, []]
  }
}

const App = component<State, Msg, never>({
  name: 'EachFuzzApp',
  init: () => [{ visible: false, entries: [], seq: 0 }, []],
  update,
  view: ({ text: txt }) => [
    ul([
      ...show<State>({
        when: (s) => s.visible,
        render: () => [
          ol(
            {},
            // Inner each over the growing/shrinking array. Each row
            // reads `item.current()` and accesses a nested field —
            // the dungeonlogs-issue-3 shape.
            each<State, Entry, Msg>({
              items: (s) => s.entries,
              key: (e) => e.id,
              render: ({ item }) => [
                li([
                  txt(() => {
                    const e = item.current()
                    return `${e.label}#${e.generation}`
                  }),
                ]),
              ],
            }),
          ),
        ],
      }),
    ]),
  ],
  __compilerVersion: '__test__',
  __prefixes: [(s) => s.visible, (s) => s.entries, (s) => s.seq],
})

function entryLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('ol > li')).map(
    (el) => (el as HTMLElement).textContent ?? '',
  )
}

describe('each() under randomized growth/shrink/swap (issue #3 class)', () => {
  let errSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    errSpy.mockRestore()
  })

  it('grows from 0 → 1 → 2 inside a freshly-mounted show without crashing', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, App)
    handle.send({ type: 'show' })
    handle.send({ type: 'add' })
    handle.flush()
    expect(entryLabels(container)).toEqual(['e1#0'])
    handle.send({ type: 'add' })
    handle.flush()
    expect(entryLabels(container)).toEqual(['e1#0', 'e2#0'])
    expect(errSpy).not.toHaveBeenCalled()
  })

  it('toggles show while entries exist (gate-on/gate-off cycles)', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, App)
    handle.send({ type: 'add' })
    handle.send({ type: 'add' })
    handle.send({ type: 'show' })
    handle.flush()
    expect(entryLabels(container).length).toBe(2)
    handle.send({ type: 'hide' })
    handle.flush()
    expect(entryLabels(container).length).toBe(0)
    handle.send({ type: 'show' })
    handle.flush()
    expect(entryLabels(container).length).toBe(2)
    expect(errSpy).not.toHaveBeenCalled()
  })

  it('fuzz: 80 random mutations × 12 seeds, every step has DOM matching state', () => {
    // Seed-driven RNG for reproducible failures.
    function mulberry32(seed: number): () => number {
      let a = seed >>> 0
      return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
    }

    for (let seed = 1; seed <= 12; seed++) {
      const rand = mulberry32(seed)
      const container = document.createElement('div')
      const handle = mountApp(container, App)
      handle.send({ type: 'show' })
      handle.flush()

      const trace: Msg[] = []
      // Maintain a parallel state model so we can compare DOM ↔ state
      // after each commit. The component's update() is the source of
      // truth; we just track entries.length here.
      let state = handle.getState() as State

      for (let step = 0; step < 80; step++) {
        const ids = state.entries.map((e) => e.id)
        let msg: Msg
        const pick = rand()
        if (pick < 0.3 || ids.length === 0) {
          msg = { type: 'add' }
        } else if (pick < 0.45) {
          msg = { type: 'remove', id: ids[Math.floor(rand() * ids.length)]! }
        } else if (pick < 0.6 && ids.length >= 2) {
          const a = ids[Math.floor(rand() * ids.length)]!
          let b = ids[Math.floor(rand() * ids.length)]!
          if (a === b) b = ids[(ids.indexOf(a) + 1) % ids.length]!
          msg = { type: 'swap', aId: a, bId: b }
        } else if (pick < 0.75) {
          msg = { type: 'touch', id: ids[Math.floor(rand() * ids.length)]! }
        } else if (pick < 0.85) {
          msg = { type: 'replace', id: ids[Math.floor(rand() * ids.length)]! }
        } else if (pick < 0.92) {
          msg = state.visible ? { type: 'hide' } : { type: 'show' }
        } else {
          msg = { type: 'clear' }
        }
        trace.push(msg)
        handle.send(msg)
        handle.flush()
        state = handle.getState() as State

        // Assertion: when visible, DOM li count + labels match state.
        // When hidden, no <li> nodes inside the <ol>.
        const labels = entryLabels(container)
        if (state.visible) {
          const expected = state.entries.map((e) => `${e.label}#${e.generation}`)
          if (labels.join('|') !== expected.join('|')) {
            throw new Error(
              `seed=${seed} step=${step} DOM/state mismatch after ${JSON.stringify(msg)}:\n` +
                `  DOM:    ${JSON.stringify(labels)}\n` +
                `  State:  ${JSON.stringify(expected)}\n` +
                `  Trace:  ${trace.map((t) => t.type).join(' → ')}`,
            )
          }
        } else {
          if (labels.length !== 0) {
            throw new Error(
              `seed=${seed} step=${step} expected hidden but DOM has rows: ${JSON.stringify(labels)}`,
            )
          }
        }
      }
      expect(errSpy).not.toHaveBeenCalled()
    }
  })
})
