import { describe, it, expect } from 'vitest'
import { propertyTest } from '../src/property-test'
import { defineTestComponent } from '../src/defineTestComponent'
import { component, div, each, li, ol, text } from '@llui/dom'

describe('propertyTest', () => {
  it('passes when all invariants hold', () => {
    const Counter = component<{ count: number }, { type: 'inc' } | { type: 'dec' }, never>({
      name: 'Counter',
      init: () => [{ count: 0 }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'inc':
            return [{ count: state.count + 1 }, []]
          case 'dec':
            return [{ count: Math.max(0, state.count - 1) }, []]
        }
      },
      view: () => [],
    })

    // Should not throw
    propertyTest(Counter, {
      invariants: [(state) => state.count >= 0, (state) => typeof state.count === 'number'],
      messageGenerators: {
        inc: () => ({ type: 'inc' as const }),
        dec: () => ({ type: 'dec' as const }),
      },
      runs: 50,
      maxSequenceLength: 20,
    })
  })

  it('throws when an invariant is violated', () => {
    const Buggy = component<{ count: number }, { type: 'dec' }, never>({
      name: 'Buggy',
      init: () => [{ count: 0 }, []],
      update: (state) => [{ count: state.count - 1 }, []], // goes negative!
      view: () => [],
    })

    expect(() =>
      propertyTest(Buggy, {
        invariants: [(state) => state.count >= 0],
        messageGenerators: {
          dec: () => ({ type: 'dec' as const }),
        },
        runs: 10,
        maxSequenceLength: 5,
      }),
    ).toThrow(/invariant/)
  })

  it('shrinks a failing sequence to a minimal reproduction', () => {
    const Buggy = component<{ count: number }, { type: 'dec' }, never>({
      name: 'Buggy',
      init: () => [{ count: 0 }, []],
      update: (state) => [{ count: state.count - 1 }, []], // negative after one dec
      view: () => [],
    })

    let message = ''
    try {
      propertyTest(Buggy, {
        invariants: [(state) => state.count >= 0],
        messageGenerators: { dec: () => ({ type: 'dec' as const }) },
        runs: 5,
        maxSequenceLength: 8,
      })
    } catch (e) {
      message = (e as Error).message
    }

    // A single `dec` (0 → -1) already violates the invariant, so the reported
    // repro must be shrunk to exactly one step — no ' → ' chaining.
    expect(message).toMatch(/invariant/)
    expect(message).toMatch(/\[dec\]/)
    expect(message).not.toContain('→')
  })

  describe('mount mode', () => {
    interface Row {
      id: string
      label: string
    }
    type ListMsg = { type: 'add' } | { type: 'remove'; id: string } | { type: 'clear' }
    interface ListState {
      rows: Row[]
      seq: number
    }
    const List = defineTestComponent<ListState, ListMsg, never>({
      name: 'List',
      init: () => [{ rows: [], seq: 0 }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'add': {
            const seq = state.seq + 1
            return [
              { ...state, seq, rows: [...state.rows, { id: String(seq), label: `r${seq}` }] },
              [],
            ]
          }
          case 'remove':
            return [{ ...state, rows: state.rows.filter((r) => r.id !== msg.id) }, []]
          case 'clear':
            return [{ ...state, rows: [] }, []]
        }
      },
      view: ({ state }) => [
        ol({}, [
          each(
            state.map((s) => s.rows),
            {
              key: (r) => r.id,
              render: (item) => [li([text(item.map((r) => r.label))])],
            },
          ),
        ]),
      ],
    })

    it('exercises mount + send + flush across a random sequence', () => {
      propertyTest(List, {
        invariants: [(state) => state.rows.length >= 0],
        messageGenerators: {
          add: () => ({ type: 'add' as const }),
          remove: (s) =>
            s.rows.length > 0
              ? { type: 'remove' as const, id: s.rows[s.rows.length - 1]!.id }
              : { type: 'add' as const },
          clear: () => ({ type: 'clear' as const }),
        },
        runs: 10,
        maxSequenceLength: 15,
        mount: {
          assertDom: (state, container) => {
            const liCount = container.querySelectorAll('ol > li').length
            return liCount === state.rows.length
          },
        },
      })
    })

    it('observes the mounted state, not a parallel shadow reduction', () => {
      // Regression: mount mode used to ALSO run def.update separately to
      // advance a shadow `state`, and checked invariants/assertDom against
      // that shadow — not the mounted component. For an impure reducer the two
      // diverge (the reducer ran twice per message), so the asserted state
      // disagreed with the DOM. Now state is read back from the handle and the
      // reducer runs exactly once per message.
      let calls = 0
      const observedTags: number[] = []
      const Impure = component<{ tag: number }, { type: 'tick' }, never>({
        name: 'Impure',
        init: () => [{ tag: 0 }, []],
        update: () => {
          calls += 1
          return [{ tag: calls }, []]
        },
        view: ({ state }) => [div([text(state.map((s) => String(s.tag)))])],
      })

      propertyTest(Impure, {
        invariants: [
          (state) => {
            observedTags.push(state.tag)
            return true
          },
        ],
        messageGenerators: { tick: () => ({ type: 'tick' as const }) },
        runs: 1,
        maxSequenceLength: 5,
        mount: {
          // DOM reflects the mounted reduction; `state` is read back from the
          // same handle, so they always agree. A shadow def.update would make
          // `calls` advance twice per message and this would mismatch.
          assertDom: (state, container) => container.textContent === String(state.tag),
        },
      })

      // tag 0 from the initial-state check, then exactly one increment per tick
      // (the reducer ran once per message, not twice).
      expect(observedTags[0]).toBe(0)
      const ticks = observedTags.slice(1)
      ticks.forEach((tag, i) => expect(tag).toBe(i + 1))
    })

    it('fails loudly when assertDom returns false (DOM/state mismatch)', () => {
      expect(() =>
        propertyTest(List, {
          invariants: [(s) => s.rows.length >= 0],
          messageGenerators: {
            add: () => ({ type: 'add' as const }),
          },
          runs: 1,
          maxSequenceLength: 3,
          mount: {
            assertDom: () => false, // always fail
          },
        }),
      ).toThrow(/assertDom returned false/)
    })
  })

  it('reports the failing message sequence', () => {
    const Buggy = component<{ count: number }, { type: 'dec' }, never>({
      name: 'Buggy',
      init: () => [{ count: 0 }, []],
      update: (state) => [{ count: state.count - 1 }, []],
      view: () => [],
    })

    try {
      propertyTest(Buggy, {
        invariants: [(state) => state.count >= 0],
        messageGenerators: {
          dec: () => ({ type: 'dec' as const }),
        },
        runs: 10,
        maxSequenceLength: 5,
      })
      expect.unreachable()
    } catch (e) {
      expect((e as Error).message).toContain('dec')
    }
  })
})
