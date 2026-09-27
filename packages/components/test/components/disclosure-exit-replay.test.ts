import { describe, expect, it } from 'vitest'
import { replayTrace } from '@llui/test'
import * as accordion from '../../src/components/accordion'
import * as collapsible from '../../src/components/collapsible'

interface Trace<S, M, E> {
  lluiTrace: 1
  component: string
  generatedBy: string
  timestamp: string
  entries: Array<{ msg: M; expectedState: S; expectedEffects: E[] }>
}

/**
 * #264 review-264j: the design REJECTED in review-264i baked a per-JS-realm
 * random session token into `AccordionState`/`CollapsibleState`
 * (`exitWatchers.session`), which made `init()` non-deterministic — a
 * recorded trace's `expectedState` embeds ONE realm's token and can never
 * match a fresh replay's own, so `replayTrace` diverges at step 0 on every
 * single trace, unconditionally. The FINAL design removes every
 * watcher-related field from state and every attach/detach message from
 * `Msg` entirely: the only new fact travelling through a message is a
 * plain `retain?: boolean`, recorded like any other field. `init()` is
 * therefore fully deterministic again, and replaying a trace recorded in
 * ONE module instance against a definition built in a DIFFERENT one (this
 * test's own import, standing in for a genuinely separate realm — the
 * registry these components read is a Map/Set keyed by `id`, which
 * `update()`/`init()` never touch) reproduces byte-identically.
 */
describe('accordion/collapsible replayTrace determinism (#264 review-264j)', () => {
  it('accordion: a trace recorded with retain stamped replays with NO divergence', () => {
    const initState = accordion.init({ items: ['a'], value: ['a'], animated: true })
    const def = {
      name: 'accordion',
      init: (): [accordion.AccordionState, never[]] => [initState, []],
      update: accordion.update,
      view: () => [],
    }

    const trace: Trace<accordion.AccordionState, accordion.AccordionMsg, never> = {
      lluiTrace: 1,
      component: 'accordion',
      generatedBy: 'disclosure-exit-replay.test.ts',
      timestamp: '',
      entries: [],
    }

    // Record the trace by actually driving the reducer once, capturing each
    // step's real output — the trace format itself doesn't matter here, only
    // that it is a plain JSON-shaped object with no random field anywhere.
    let state = initState
    const record = (msg: accordion.AccordionMsg): void => {
      state = accordion.update(state, msg)[0]
      trace.entries.push({ msg, expectedState: state, expectedEffects: [] })
    }
    record({ type: 'close', value: 'a', retain: true })
    record({ type: 'exitComplete', value: 'a', generation: 1 })
    record({ type: 'open', value: 'a', retain: false })

    // The recorded trace is plain JSON — round-trip it to prove nothing in
    // it depends on object identity or a live closure either.
    const jsonRoundTripped: typeof trace = JSON.parse(JSON.stringify(trace))

    expect(() => replayTrace(def, jsonRoundTripped)).not.toThrow()
  })

  it('collapsible: a trace recorded with retain stamped replays with NO divergence', () => {
    const initState = collapsible.init({ open: true, animated: true })
    const def = {
      name: 'collapsible',
      init: (): [collapsible.CollapsibleState, never[]] => [initState, []],
      update: collapsible.update,
      view: () => [],
    }

    const trace: Trace<collapsible.CollapsibleState, collapsible.CollapsibleMsg, never> = {
      lluiTrace: 1,
      component: 'collapsible',
      generatedBy: 'disclosure-exit-replay.test.ts',
      timestamp: '',
      entries: [],
    }
    let state = initState
    const record = (msg: collapsible.CollapsibleMsg): void => {
      state = collapsible.update(state, msg)[0]
      trace.entries.push({ msg, expectedState: state, expectedEffects: [] })
    }
    record({ type: 'close', retain: true })
    record({ type: 'exitComplete', generation: 1 })
    record({ type: 'open', retain: false })

    const jsonRoundTripped: typeof trace = JSON.parse(JSON.stringify(trace))
    expect(() => replayTrace(def, jsonRoundTripped)).not.toThrow()
  })

  it('init() itself is deterministic across repeated calls — no trace can diverge at step 0', () => {
    expect(accordion.init({ items: ['a'], value: ['a'], animated: true })).toEqual(
      accordion.init({ items: ['a'], value: ['a'], animated: true }),
    )
    expect(collapsible.init({ open: true, animated: true })).toEqual(
      collapsible.init({ open: true, animated: true }),
    )
  })
})
