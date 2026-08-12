import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { el, signalText } from '../../src/signals/dom'
import type { LluiDebugAPI } from '../../src/signals/devtools'

// Issue #59, the highest-value case in the batch: a settle NESTED inside a commit
// must not steal the effects the OUTER settle has collected but not yet
// dispatched.
//
// The shape: a `send` reduces (collecting effect A), then commits. The commit
// notifies subscribers, and a subscriber does what devtools/the agent bridge do —
// dispatches a message AND pokes state (`__lluiDebug.restoreState`). The poke
// opens a nested commit scope which reduces the queued message (collecting effect
// B) and commits. If that nested round dispatches from a SHARED effect buffer, it
// either fires A at the wrong moment or — the shape a competing prototype
// actually shipped — resets the buffer and DROPS A entirely: state advanced, the
// DOM updated, `onEffect` never ran, no error anywhere. That is exactly the class
// of bug #57 was, and it survived all 477 tests plus a dedicated scheduler suite.
//
// So the assertion is the WHOLE trace, not "A eventually fired": the ordering is
// the contract. Effects are dispatched by the round that collected them, after
// that round's commit ("commit, then effects" — explicitly out of scope for #59
// to change), which puts A after the nested scope has closed.

interface S {
  n: number
}
type M = { type: 'start' } | { type: 'from-subscriber' }
type Eff = { type: 'A' } | { type: 'B' }

function debugApi(): LluiDebugAPI {
  const debug = (globalThis as { __lluiDebug?: LluiDebugAPI }).__lluiDebug
  if (debug === undefined) {
    throw new Error('devtools are not installed — is import.meta.env.DEV off under vitest?')
  }
  return debug
}

describe('#59 a nested settle must not steal the outer round’s effects', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    // The debug API is a global, last-install-wins registration; leave none behind.
    delete (globalThis as { __lluiDebug?: LluiDebugAPI }).__lluiDebug
  })

  it('dispatches every collected effect, in commit-then-effects order', () => {
    const log: string[] = []
    const container = document.createElement('div')
    document.body.appendChild(container)

    const h = mountSignalComponent<S, M, Eff>(container, {
      name: 'ReentrantEffectBuffer',
      init: () => ({ n: 0 }),
      update: (s, m) =>
        m.type === 'start'
          ? [{ n: 1 }, [{ type: 'A' } as Eff]]
          : [{ n: s.n + 10 }, [{ type: 'B' } as Eff]],
      view: () => [el('p', {}, [signalText((s) => String((s as S).n), ['n'])])],
      onEffect: (e) => {
        log.push(`effect:${e.type}`)
      },
    })

    h.subscribe((s) => {
      log.push(`sub:${s.n}`)
      // Only the FIRST notification re-enters; the notifications this block
      // provokes must not recurse.
      if (s.n !== 1) return
      // A commit-time dispatch (the `blur`-handler shape). It has to queue behind
      // the in-flight commit — nothing is logged for it here.
      h.send({ type: 'from-subscriber' })
      log.push('poke-start')
      // A devtools/agent state poke from inside the commit: opens a NESTED commit
      // scope, which commits the poked state and then settles the queued message.
      debugApi().restoreState({ n: 99 })
      log.push('poke-end')
    })

    h.send({ type: 'start' })

    expect(log).toEqual([
      'sub:1', //        the outer commit notifies with the reduced state
      'poke-start',
      'sub:99', //       the poke's own commit — an agent-visible state frame that
      //                 must NOT be swallowed by folding the poke into a re-reduce
      'sub:109', //      the queued message, settled inside the nested scope
      'effect:B', //     …and ITS effect, after ITS commit
      'poke-end',
      'effect:A', //     the outer round's effect, released by the outer round
    ])
    h.dispose()
  })
})
