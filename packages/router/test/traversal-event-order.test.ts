import { describe, expect, it } from 'vitest'
import { component, mountApp, text } from '@llui/dom'
import { createRouter, route, type RouteLocation } from '../src/index'
import { connectRouter, type RouterEnv } from '../src/connect'

// A hash-mode traversal fires TWO events, and they are not delivered together.
//
// Per the HTML spec's "update document for history step application", applying
// a same-document history step fires `popstate` SYNCHRONOUSLY and, only when the
// fragment changed, QUEUES a task (DOM manipulation task source) to fire
// `hashchange`. A `history.go()` issued from inside that `popstate` — which is
// exactly what a guard-blocked traversal's restore does — is applied by ANOTHER
// task, on the navigation-and-traversal task source. The event loop may pick
// either source first, so both of these are legal deliveries of one blocked
// back-navigation and its restore:
//
//   popstate(blocked), hashchange(blocked), popstate(restore), hashchange(restore)
//   popstate(blocked), popstate(restore), hashchange(blocked), hashchange(restore)
//
// The second is what a loaded Chromium delivered in the `same-fragment` browser
// test, and the router dispatched the route it had just restored TWICE — once
// per late `hashchange` — because it read each one against the live location
// instead of recognising that the location had already been reconciled.
//
// This file models the session history precisely enough to deliver every legal
// interleaving and asserts the router's observable outcome is the same for all
// of them: exactly one dispatch per traversal it accepted, none for a traversal
// it blocked, and a restore that lands where it started.

const registry = {
  home: route('/'),
  login: route('/login'),
  other: route('/other'),
}
type Registry = typeof registry
type Location = RouteLocation<Registry>
type RouteName = keyof Registry & string

interface Entry {
  hash: string
  state: unknown
}

/** `dom`: the DOM manipulation task source; `traverse`: navigation and traversal. */
interface Task {
  source: 'dom' | 'traverse'
  label: string
  run: () => void
}

/**
 * A session history with the two task sources that matter here. Fragment
 * navigations and traversals are applied as the spec applies them: `popstate`
 * inside the step application, `hashchange` queued behind it. What is left to
 * choose — which source's head runs next — is the `choose` callback's.
 */
function sessionHistory(initialHash: string) {
  const entries: Entry[] = [{ hash: initialHash, state: null }]
  let index = 0
  const queues: Record<Task['source'], Task[]> = { dom: [], traverse: [] }
  // Listeners are CALLED the way a DOM listener is, with what the event
  // carries — a `hashchange` its `newURL` fragment. The router's contract takes
  // nothing and must not depend on it; delivering it anyway keeps this model
  // faithful to an adapter that registers the handler as the DOM listener, and
  // to the earlier contract under which the router read it.
  const listeners: Array<{
    event: 'popstate' | 'hashchange'
    handler: (newHash?: string) => void
  }> = []
  const observed: string[] = []

  const fire = (event: 'popstate' | 'hashchange', newHash?: string): void => {
    observed.push(event)
    for (const entry of [...listeners]) {
      if (entry.event === event) entry.handler(newHash)
    }
  }

  /** The step-application half common to a fragment navigation and a traversal. */
  const applyStep = (oldHash: string): void => {
    const landed = entries[index]!.hash
    fire('popstate')
    if (landed !== oldHash) {
      queues.dom.push({
        source: 'dom',
        label: `hashchange ${landed}`,
        run: () => fire('hashchange', landed),
      })
    }
  }

  const env: RouterEnv = {
    get hash() {
      return entries[index]!.hash
    },
    get pathname() {
      return '/'
    },
    get search() {
      return ''
    },
    get historyState() {
      return entries[index]!.state
    },
    get historyLength() {
      return entries.length
    },
    setHash(next) {
      const oldHash = entries[index]!.hash
      entries.splice(index + 1)
      entries.push({ hash: next, state: null })
      index++
      applyStep(oldHash)
    },
    pushState(state, url) {
      entries.splice(index + 1)
      entries.push({ hash: url.startsWith('#') ? url : entries[index]!.hash, state })
      index++
    },
    replaceState(state, url) {
      const current = entries[index]!
      entries[index] = {
        hash: url !== undefined && url.startsWith('#') ? url : current.hash,
        state,
      }
    },
    back() {
      this.go(-1)
    },
    forward() {
      this.go(1)
    },
    go(delta) {
      queues.traverse.push({
        source: 'traverse',
        label: `go(${delta})`,
        run: () => {
          const target = index + delta
          if (target < 0 || target >= entries.length) return
          const oldHash = entries[index]!.hash
          index = target
          applyStep(oldHash)
        },
      })
    },
    scrollTo() {},
    onUrlChange(event, handler) {
      const entry = { event, handler }
      listeners.push(entry)
      return () => {
        listeners.splice(listeners.indexOf(entry), 1)
      }
    },
  }

  return {
    env,
    observed,
    marker: () => (entries[index]!.state as Record<string, unknown> | null)?.['marker'],
    mark(value: string) {
      const current = entries[index]!
      entries[index] = { ...current, state: { ...(current.state as object), marker: value } }
    },
    /** Run queued tasks until none remain, letting `choose` pick the source. */
    drain(choose: (ready: Task[]) => number): void {
      for (;;) {
        const ready = [queues.traverse[0], queues.dom[0]].filter((t): t is Task => t !== undefined)
        if (ready.length === 0) return
        const task = ready[ready.length === 1 ? 0 : choose(ready)]!
        queues[task.source].shift()
        task.run()
      }
    },
  }
}

type Scenario = (choose: (ready: Task[]) => number) => unknown

/**
 * Every schedule the two task sources permit, each run from scratch — router
 * state is not cloneable, so exploring a branch means replaying the prefix.
 * Returns the outcome per schedule, keyed by the labels it ran.
 */
function everyInterleaving(scenario: Scenario): Array<{ schedule: string[]; outcome: unknown }> {
  const results: Array<{ schedule: string[]; outcome: unknown }> = []
  const pending: number[][] = [[]]
  while (pending.length > 0) {
    const prefix = pending.pop()!
    const taken: number[] = []
    const schedule: string[] = []
    const outcome = scenario((ready) => {
      const at = taken.length
      const pick = at < prefix.length ? prefix[at]! : 0
      // A decision past the replayed prefix is a NEW branch point: queue its
      // alternatives, each replaying everything taken so far.
      if (at >= prefix.length) {
        for (let alt = 1; alt < ready.length; alt++) pending.push([...taken, alt])
      }
      taken.push(pick)
      schedule.push(ready[pick]!.label)
      return pick
    })
    results.push({ schedule, outcome })
  }
  return results
}

function mountRouter(env: RouterEnv, isBlocked: (to: Location) => boolean) {
  const routing = connectRouter(createRouter(registry), {
    env,
    beforeEnter: (to) => (isBlocked(to) ? false : undefined),
  })
  const dispatches: string[] = []
  const record = (message: unknown): void => {
    dispatches.push((message as { location: Location }).location.name)
  }
  const handle = mountApp(
    document.createElement('div'),
    component({
      name: 'TraversalEventOrder',
      init: (): [null, never[]] => [null, []],
      update: (state: null): [null, never[]] => [state, []],
      view: () => [...routing.listener(record), text('')],
    }),
  )
  const signal = new AbortController().signal
  return {
    dispatches,
    navigate(name: RouteName) {
      routing.handleEffect({ effect: routing.navigate(name), send: record, signal })
    },
    replace(name: RouteName) {
      routing.handleEffect({ effect: routing.replace(name), send: record, signal })
    },
    dispose: () => handle.dispose(),
  }
}

describe('hash-mode traversal events in every legal delivery order', () => {
  it('the model delivers the reordered sequence the loaded browser did', () => {
    // Guard against a vacuous sweep: the interleaving that failed in Chromium
    // must be one of the schedules explored below.
    const schedules = everyInterleaving((choose) => blockedRestoreScenario(choose).events)
    expect(schedules.map((s) => s.outcome)).toContainEqual([
      'popstate',
      'popstate',
      'hashchange',
      'hashchange',
    ])
    expect(schedules.map((s) => s.outcome)).toContainEqual([
      'popstate',
      'hashchange',
      'popstate',
      'hashchange',
    ])
  })

  it('a guard-blocked traversal dispatches nothing and restores, in every order (#163 browser flake)', () => {
    const results = everyInterleaving((choose) => {
      const { dispatches, marker, hash, afterUnblock } = blockedRestoreScenario(choose)
      return { dispatches, marker, hash, afterUnblock }
    })
    expect(results.length).toBeGreaterThan(1)
    for (const { schedule, outcome } of results) {
      expect({ schedule, outcome }).toEqual({
        schedule,
        outcome: {
          dispatches: [],
          marker: 'entry-1',
          hash: '#/login',
          // Nothing the blocked traversal armed outlives it: the next genuine
          // traversal dispatches exactly once.
          afterUnblock: ['home'],
        },
      })
    }
  })

  it('two queued traversals dispatch once each, in every order', () => {
    const results = everyInterleaving((choose) => {
      const history = sessionHistory('#/')
      const router = mountRouter(history.env, () => false)
      router.navigate('login')
      history.drain(choose)
      router.navigate('other')
      history.drain(choose)
      router.dispatches.length = 0
      history.env.back()
      history.env.back()
      history.drain(choose)
      const outcome = { dispatches: [...router.dispatches], hash: history.env.hash }
      router.dispose()
      return outcome
    })
    expect(results.length).toBeGreaterThan(1)
    for (const { schedule, outcome } of results) {
      expect({ schedule, outcome }).toEqual({
        schedule,
        outcome: { dispatches: ['login', 'home'], hash: '#/' },
      })
    }
  })

  it('a back taken before a navigation’s own hashchange ran dispatches once, in every order', () => {
    const results = everyInterleaving((choose) => {
      const history = sessionHistory('#/')
      const router = mountRouter(history.env, () => false)
      router.navigate('login')
      // The navigation's `hashchange` is still queued when the user goes back.
      history.env.back()
      history.drain(choose)
      const outcome = { dispatches: [...router.dispatches], hash: history.env.hash }
      router.dispose()
      return outcome
    })
    expect(results.length).toBeGreaterThan(1)
    for (const { schedule, outcome } of results) {
      expect({ schedule, outcome }).toEqual({
        schedule,
        // `login` from the navigate effect itself, `home` from the traversal.
        outcome: { dispatches: ['login', 'home'], hash: '#/' },
      })
    }
  })

  it('a redundant hashchange still retires its echo, so a later same-fragment traversal is seen', () => {
    const history = sessionHistory('#/')
    const router = mountRouter(history.env, () => false)
    router.navigate('login')
    // By the time its `hashchange` runs, the URL is already reconciled — but
    // the echo the write armed must still be retired by it, or it stays armed.
    history.drain(() => 0)
    // A second entry showing the same fragment, created behind the router's
    // back (a foreign `pushState`), then a traversal back onto the first.
    history.env.pushState({ foreign: true }, '#/login')
    router.dispatches.length = 0
    history.env.back()
    history.drain(() => 0)
    expect(history.env.hash).toBe('#/login')
    // A same-fragment traversal is a real step (#163); a leftover echo armed
    // for `#/login` would swallow it.
    expect(router.dispatches).toEqual(['login'])
    router.dispose()
  })

  it('a URL-only replace is not read as a navigation by a hashchange from before it', () => {
    const history = sessionHistory('#/')
    const router = mountRouter(history.env, () => false)
    router.navigate('login')
    // `replace()` writes with `replaceState`, which fires nothing — so the one
    // event still to come is the navigation's own, and it now finds a URL the
    // router wrote itself.
    router.replace('other')
    history.drain(() => 0)
    expect(history.observed).toEqual(['popstate', 'hashchange'])
    expect(router.dispatches).toEqual(['login'])
    expect(history.env.hash).toBe('#/other')
    router.dispose()
  })
})

/**
 * The browser fixture's sequence (`test/browser/same-fragment.fixture.ts`):
 * two hash navigations, a same-fragment replace, a same-fragment back, then a
 * back onto a blocked route whose restore races that back's `hashchange`.
 */
function blockedRestoreScenario(choose: (ready: Task[]) => number) {
  const history = sessionHistory('')
  let blockHome = false
  const router = mountRouter(history.env, (to) => blockHome && to.name === 'home')

  router.navigate('login')
  history.drain(choose)
  history.mark('entry-1')
  router.navigate('other')
  history.drain(choose)
  history.mark('entry-2')
  router.replace('login')

  history.env.back()
  history.drain(choose)
  expect(router.dispatches).toEqual(['login', 'other', 'login'])
  expect(history.marker()).toBe('entry-1')

  blockHome = true
  history.observed.length = 0
  router.dispatches.length = 0
  history.env.back()
  history.drain(choose)
  const outcome = {
    events: [...history.observed],
    dispatches: [...router.dispatches],
    marker: history.marker(),
    hash: history.env.hash,
  }

  blockHome = false
  router.dispatches.length = 0
  history.env.back()
  history.drain(choose)
  const afterUnblock = [...router.dispatches]
  router.dispose()
  return { ...outcome, afterUnblock }
}
