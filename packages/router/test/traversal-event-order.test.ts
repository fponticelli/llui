import { beforeAll, describe, expect, it } from 'vitest'
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
  a: route('/a'),
  b: route('/b'),
  c: route('/c'),
}
type Registry = typeof registry
type Location = RouteLocation<Registry>
type RouteName = keyof Registry & string

interface Entry {
  path: string
  hash: string
  state: unknown
}

/**
 * `dom`: the DOM manipulation task source; `traverse`: the session history
 * traversal queue, which is ONE FIFO shared by `history.go()` and the
 * browser's own back/forward UI; `user`: a user traversal that has not reached
 * that queue yet (choosing it appends it to `traverse`).
 */
interface Task {
  source: 'dom' | 'traverse' | 'user'
  label: string
  run: () => void
}

/**
 * A session history with the task sources that matter here. Fragment
 * navigations and traversals are applied as the spec applies them: `popstate`
 * inside the step application, `hashchange` queued behind it. What is left to
 * choose — which source's head runs next, and WHEN a pending user traversal
 * joins the traversal queue relative to the router's own `history.go` — is the
 * `choose` callback's.
 *
 * `hash` mode addresses the fragment; `history` mode addresses the path and
 * never fires `hashchange` (its fragment never changes).
 */
function sessionHistory(initialHash: string, mode: 'hash' | 'history' = 'hash') {
  const entries: Entry[] = [
    mode === 'hash'
      ? { path: '/', hash: initialHash, state: null }
      : { path: initialHash, hash: '', state: null },
  ]
  let index = 0
  const queues: Record<Task['source'], Task[]> = { dom: [], traverse: [], user: [] }
  /**
   * Every traversal, in the order the queue ran it: who asked, by how much,
   * and where it landed — `null` when it was out of range and did nothing.
   */
  const landings: Array<{
    by: 'router' | 'user'
    delta: number
    url: string | null
    /** The position it landed on, or `null`. */
    to: number | null
    /** When it joined the traversal queue, and when the queue ran it. */
    queuedAt: number
    ranAt: number
    /** The stack it ran against: the position it left, and the entry count. */
    from: number
    size: number
  }> = []
  let clock = 0
  /** The URL the router addresses in this mode, for the entry showing. */
  const urlAt = (): string => (mode === 'hash' ? entries[index]!.hash : entries[index]!.path)
  const traversal = (by: 'router' | 'user', delta: number): Task => {
    const queuedAt = clock++
    return {
      source: 'traverse',
      label: `${by} go(${delta})`,
      run: () => {
        const ran = { by, delta, queuedAt, ranAt: clock++, from: index, size: entries.length }
        const target = index + delta
        // Out of range: the spec aborts the traversal and fires NOTHING.
        if (target < 0 || target >= entries.length) {
          landings.push({ ...ran, url: null, to: null })
          return
        }
        const oldHash = entries[index]!.hash
        index = target
        landings.push({ ...ran, url: urlAt(), to: index })
        applyStep(oldHash)
      },
    }
  }
  const applyUrl = (url: string, current: Entry): Pick<Entry, 'path' | 'hash'> =>
    url.startsWith('#')
      ? { path: current.path, hash: url }
      : { path: url.split('#')[0]!, hash: url.includes('#') ? url.slice(url.indexOf('#')) : '' }
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
      return entries[index]!.path
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
      const current = entries[index]!
      entries.splice(index + 1)
      entries.push({ path: current.path, hash: next, state: null })
      index++
      applyStep(current.hash)
    },
    pushState(state, url) {
      const current = entries[index]!
      entries.splice(index + 1)
      entries.push({ ...applyUrl(url, current), state })
      index++
    },
    replaceState(state, url) {
      const current = entries[index]!
      entries[index] = { ...(url === undefined ? current : applyUrl(url, current)), state }
    },
    back() {
      this.go(-1)
    },
    forward() {
      this.go(1)
    },
    go(delta) {
      queues.traverse.push(traversal('router', delta))
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
    landings,
    /** The entry showing: its position in the stack and its URL. */
    at: () => ({ index, url: urlAt(), size: entries.length }),
    /** A tick of the clock `landings` are stamped with, for ordering other actions. */
    now: () => clock++,
    marker: () => (entries[index]!.state as Record<string, unknown> | null)?.['marker'],
    mark(value: string) {
      const current = entries[index]!
      entries[index] = { ...current, state: { ...(current.state as object), marker: value } }
    },
    /** A user traversal (back button, long-press menu) that is queued NOW. */
    userGo(delta: number): void {
      queues.traverse.push(traversal('user', delta))
    },
    /**
     * A user traversal that is still to come: the scheduler decides when it
     * joins the traversal queue, so it is explored before, between and after
     * every traversal the router issues.
     */
    userGoLater(delta: number): void {
      this.later(`user presses go(${delta})`, () => queues.traverse.push(traversal('user', delta)))
    },
    /**
     * Anything else the user does that the scheduler should place at every
     * point — a click that runs the app's own navigation, say. It runs as a task
     * of its own, synchronously, like the event handler it stands for.
     */
    later(label: string, run: () => void): void {
      queues.user.push({ source: 'user', label, run })
    },
    /** Run queued tasks until none remain, letting `choose` pick the source. */
    drain(choose: (ready: Task[]) => number): void {
      for (let steps = 0; ; steps++) {
        // A router that keeps traversing on its own never settles; fail loudly
        // rather than hang the sweep.
        if (steps > 200) throw new Error('session history did not settle in 200 tasks')
        const ready = [queues.traverse[0], queues.dom[0], queues.user[0]].filter(
          (t): t is Task => t !== undefined,
        )
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

function mountRouter(
  env: RouterEnv,
  isBlocked: (to: Location) => boolean,
  mode: 'hash' | 'history' = 'hash',
) {
  const routing = connectRouter(createRouter(registry, { mode }), {
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

// ── A user traversal racing the router's own restore ─────────────────────────
//
// A guard-blocked traversal is undone with `history.go(delta)`, which is
// ASYNCHRONOUS and joins the same first-in-first-out traversal queue as the
// browser's own back/forward buttons. So the user can traverse again before the
// restore runs — or after it, or between it and a correction of it — and the
// app can navigate in the middle. The router cannot see who queued what; it
// sees only `popstate`s, in order, each on a stamped entry.
//
// Semantics, and what each test below holds the router to:
//
// - ALWAYS (every schedule): at quiescence the application shows the route the
//   URL shows; nothing the guard refused is dispatched; and nothing the race
//   armed outlives it — the next ordinary traversal dispatches exactly the
//   route it lands on.
// - WHERE ATTRIBUTION IS DECIDABLE: the router's own traversals are not
//   navigations. The outcome is the one the USER's actions alone decide — the
//   last route a user traversal or app navigation reached that the guard
//   accepted — and no route is dispatched that only a router traversal reached.
//   The one undecidable shape is excluded, and only from this half (see
//   `indistinguishable`).
//
// This is stricter than the mature routers: React Router's data router and
// TanStack Router both answer a blocked POP with `history.go(-delta)` and then
// swallow the NEXT popstate unconditionally (`unblockBlockerHistoryUpdate`,
// `ignoreNextPop`), whichever traversal produced it — so a user traversal that
// lands first is swallowed while the app keeps showing the old route, and the
// restore that lands after it is processed as a navigation.

/** The stack every race case starts from: one entry per route, all stamped. */
const STACK: readonly RouteName[] = ['home', 'a', 'b', 'c']

/** The route a URL in the model addresses, in either mode. */
function routeOf(url: string): RouteName {
  const path = url.startsWith('#') ? url.slice(1) : url
  const name = STACK.find((candidate) => (candidate === 'home' ? '/' : `/${candidate}`) === path)
  if (name === undefined) throw new Error(`no route in the race stack for ${url}`)
  return name
}

/** A later user action: a traversal by a delta, or the app navigating to a route. */
type LaterAction = number | RouteName

interface RaceCase {
  mode: 'hash' | 'history'
  /** The accepted entry the user starts on. */
  standing: number
  /** Routes the guard refuses once the race starts. */
  blocked: readonly RouteName[]
  /** The user's first traversal — queued at once, onto a refused route. */
  first: number
  /** Further actions, each placed at every possible point by the scheduler. */
  later: readonly LaterAction[]
  /**
   * Whether the page RELOADED on the starting entry before the race: the router
   * that races is a fresh one that adopted the stamps it found, and knows of no
   * entry above the one it loaded on until it sees one.
   */
  reloaded: boolean
}

interface Traversal {
  by: 'router' | 'user'
  delta: number
  /** The route it landed on, or `null` when it lapsed (out of range). */
  landed: RouteName | null
  queuedAt: number
  ranAt: number
  /** The position it left, and how many entries the stack had then. */
  from: number
  size: number
  /** The highest position the router knew to exist when it ran. */
  known: number
}

/** An app navigation: where it went, when, and the stack it pushed onto. */
interface Navigation {
  to: RouteName
  ranAt: number
  from: number
  size: number
  /** Whether it pushed an entry (the guard may refuse it). */
  pushed: boolean
  known: number
}

interface RaceOutcome {
  /** Route the application is showing (its last dispatch). */
  app: RouteName
  /** Route of the entry the browser is showing. */
  showing: RouteName
  dispatches: string[]
  /** Every traversal the queue ran, in order. */
  traversals: Traversal[]
  /** Every app navigation, and when it ran on the same clock. */
  navigations: Navigation[]
  /** A later, unguarded traversal: what it dispatched and where it landed. */
  after: { dispatches: string[]; showing: RouteName }
}

function raceScenario(c: RaceCase, choose: (ready: Task[]) => number): RaceOutcome {
  const history = sessionHistory(c.mode === 'hash' ? '#/' : '/', c.mode)
  const blocked = new Set<string>()
  const isBlocked = (to: Location) => blocked.has(to.name)
  let router = mountRouter(history.env, isBlocked, c.mode)
  for (const name of STACK.slice(1)) {
    router.navigate(name)
    history.drain(() => 0)
  }
  // Walk down to the standing entry with ordinary, unguarded traversals.
  for (let i = STACK.length - 1; i > c.standing; i--) {
    history.userGo(-1)
    history.drain(() => 0)
  }
  const before = router.dispatches.at(-1) as RouteName
  if (before !== STACK[c.standing]) throw new Error(`setup: standing on ${before}`)
  if (c.reloaded) {
    // A new router on the same session history, as after a reload.
    router.dispose()
    router = mountRouter(history.env, isBlocked, c.mode)
  }

  for (const name of c.blocked) blocked.add(name)
  router.dispatches.length = 0
  history.landings.length = 0
  const navigations: Array<Omit<Navigation, 'known'>> = []
  history.userGo(c.first)
  for (const action of c.later) {
    if (typeof action === 'number') history.userGoLater(action)
    else
      history.later(`app navigates to ${action}`, () => {
        const { index: from, size } = history.at()
        const ranAt = history.now()
        router.navigate(action)
        navigations.push({ to: action, ranAt, from, size, pushed: history.at().index !== from })
      })
  }
  history.drain(choose)
  const dispatches = [...router.dispatches]
  const app = (dispatches.at(-1) ?? before) as RouteName
  const showing = routeOf(history.at().url)

  // What the router knew of the stack's top at each move: everything it
  // created before a reload, then only what it has seen land or pushed since.
  let known = c.reloaded ? c.standing : STACK.length - 1
  const moves = [
    ...history.landings.map((t) => ({ kind: 'traversal' as const, at: t.ranAt, t })),
    ...navigations.map((n) => ({ kind: 'navigation' as const, at: n.ranAt, n })),
  ].sort((x, y) => x.at - y.at)
  const traversals: Traversal[] = []
  const navigated: Navigation[] = []
  for (const move of moves) {
    if (move.kind === 'traversal') {
      const { url, to, ...rest } = move.t
      traversals.push({ ...rest, known, landed: url === null ? null : routeOf(url) })
      if (to !== null) known = Math.max(known, to)
    } else {
      navigated.push({ ...move.n, known })
      if (move.n.pushed) known = move.n.from + 1
    }
  }

  // Nothing the race armed may outlive it: with the guard lifted, one ordinary
  // traversal dispatches exactly the route it lands on, once.
  blocked.clear()
  router.dispatches.length = 0
  history.userGo(history.at().index > 0 ? -1 : 1)
  history.drain(() => 0)
  const after = { dispatches: [...router.dispatches], showing: routeOf(history.at().url) }
  router.dispose()
  return { app, showing, dispatches, traversals, navigations: navigated, after }
}

/**
 * Every race case over the four-entry stack, in both modes: every starting
 * entry, every non-empty set of refused routes, and every first traversal onto
 * a refused route, each followed by every sequence in `laterChoices`.
 */
function* raceCases(
  laterChoices: ReadonlyArray<readonly LaterAction[]>,
  modes: ReadonlyArray<RaceCase['mode']>,
): Generator<RaceCase> {
  for (const mode of modes) {
    for (let standing = 0; standing < STACK.length; standing++) {
      const others = STACK.filter((_, i) => i !== standing)
      for (let mask = 1; mask < 1 << others.length; mask++) {
        const blocked = others.filter((_, i) => mask & (1 << i))
        for (const first of [-2, -1, 1, 2]) {
          const target = STACK[standing + first]
          if (target === undefined || !blocked.includes(target)) continue
          for (const later of laterChoices) {
            for (const reloaded of [false, true])
              yield { mode, standing, blocked, first, later, reloaded }
          }
        }
      }
    }
  }
}

/** The invariants EVERY schedule must satisfy, attributable or not. */
function raceInvariantViolations(outcome: RaceOutcome, c: RaceCase): string[] {
  const violations: string[] = []
  if (outcome.app !== outcome.showing) {
    violations.push(`the app shows ${outcome.app} while the URL shows ${outcome.showing}`)
  }
  const refused = outcome.dispatches.filter((name) => c.blocked.includes(name as RouteName))
  if (refused.length > 0) violations.push(`dispatched refused route(s) ${refused.join(',')}`)
  if (outcome.after.dispatches.join() !== outcome.after.showing) {
    violations.push(
      `a later traversal to ${outcome.after.showing} dispatched [${outcome.after.dispatches.join(',')}]`,
    )
  }
  return violations
}

/**
 * The router's own traversals are not navigations: the outcome must be the one
 * the user's actions alone decide. Held only where the router can tell whose
 * traversal a landing was (see {@link indistinguishable}).
 */
function raceIntentViolations(outcome: RaceOutcome, c: RaceCase): string[] {
  const accepted = [
    ...outcome.traversals
      .filter((t) => t.by === 'user' && t.landed !== null && !c.blocked.includes(t.landed))
      .map((t) => ({ route: t.landed!, at: t.ranAt })),
    ...outcome.navigations
      .filter((n) => !c.blocked.includes(n.to))
      .map((n) => ({ route: n.to, at: n.ranAt })),
  ].sort((x, y) => x.at - y.at)
  const reached = accepted.map((a) => a.route)
  const intended = reached.at(-1) ?? STACK[c.standing]!
  const violations: string[] = []
  if (outcome.showing !== intended) {
    violations.push(
      `ends on ${outcome.showing}; the user's last accepted action reached ${intended}`,
    )
  }
  const unrequested = outcome.dispatches.filter((name) => !reached.includes(name as RouteName))
  if (unrequested.length > 0) {
    violations.push(
      `dispatched ${unrequested.join(',')}, reached only by the router's own traversal`,
    )
  }
  return violations
}

/**
 * Whether the schedule contains one of the two shapes no observer of the
 * History API can attribute. Both need a user action to run while a router
 * traversal is queued — issued, not yet run:
 *
 * - SAME DELTA: the user traversal moved by the router's delta. It lands exactly
 *   where the router's would have, and the router's then lands exactly where a
 *   user traversal of that delta would have: identical events onto identical
 *   entries to the schedule in which the two ran the other way round.
 * - MAYBE LAPSED: the action moved the browser off an entry from which, as far
 *   as the router knew the stack (a reloaded router knows only what it has
 *   seen), its traversal would have lapsed, and it did not — it landed later,
 *   from wherever the action left the browser. Had it lapsed, the same later
 *   landing would have been a user traversal's. The router forgets such a
 *   traversal rather than keep a suppression with no expiry (see
 *   `ownTraversals` in `connect.ts`), so its landing is judged as a browser
 *   navigation — the same answer it gives in the other history.
 */
function indistinguishable(outcome: RaceOutcome): boolean {
  const own = outcome.traversals.filter((t) => t.by === 'router')
  const preempts = (r: Traversal, at: number) => r.queuedAt < at && at < r.ranAt
  // Judged by what the ROUTER knew of the stack, which after a reload can be
  // less than the stack has: a restore that looks to it as if it might lapse is
  // forgotten even when it would in fact have landed.
  const lapsesFrom = (r: Traversal, from: number, known: number) =>
    from + r.delta < 0 || from + r.delta > known
  const moves = [
    ...outcome.traversals.filter((t) => t.by === 'user' && t.landed !== null),
    ...outcome.navigations,
  ]
  return own.some(
    (r) =>
      outcome.traversals.some(
        (u) => u.by === 'user' && u.delta === r.delta && preempts(r, u.ranAt),
      ) ||
      (r.landed !== null &&
        moves.some((m) => preempts(r, m.ranAt) && lapsesFrom(r, m.from, m.known))),
  )
}

interface RaceReport {
  cases: number
  schedules: number
  /** Schedules excluded from the intent half as indistinguishable. */
  indistinguishable: number
  /** Schedules in which a user action ran while a router traversal was queued. */
  preempted: number
  /** Schedules in which a router traversal lapsed (targeted a missing entry). */
  lapsed: number
  /** Schedules in which the app navigated while a router traversal was queued. */
  navigatedMidRestore: number
  invariant: string[]
  intent: string[]
}

function raceReport(
  laterChoices: ReadonlyArray<readonly LaterAction[]>,
  modes: ReadonlyArray<RaceCase['mode']> = ['hash', 'history'],
): RaceReport {
  const report: RaceReport = {
    cases: 0,
    schedules: 0,
    indistinguishable: 0,
    preempted: 0,
    lapsed: 0,
    navigatedMidRestore: 0,
    invariant: [],
    intent: [],
  }
  for (const c of raceCases(laterChoices, modes)) {
    report.cases++
    for (const { schedule, outcome } of everyInterleaving((choose) => raceScenario(c, choose))) {
      report.schedules++
      const o = outcome as RaceOutcome
      const own = o.traversals.filter((t) => t.by === 'router')
      const inFlight = (at: number) => own.some((r) => r.queuedAt < at && at < r.ranAt)
      if (o.traversals.some((t) => t.by === 'user' && inFlight(t.ranAt))) report.preempted++
      if (own.some((r) => r.landed === null)) report.lapsed++
      if (o.navigations.some((n) => inFlight(n.ranAt))) report.navigatedMidRestore++
      const explain = (v: string) =>
        `${v} — ${JSON.stringify(c)} — ${schedule.join(' ; ')} — ` +
        o.traversals.map((t) => `${t.by}(${t.delta})→${t.landed ?? 'lapsed'}`).join(' ')
      for (const v of raceInvariantViolations(o, c)) report.invariant.push(explain(v))
      if (indistinguishable(o)) {
        report.indistinguishable++
        continue
      }
      for (const v of raceIntentViolations(o, c)) report.intent.push(explain(v))
    }
  }
  return report
}

describe('a user traversal racing a blocked traversal’s restore', () => {
  // The sweeps, shared by the assertions below: every case, every schedule.
  // Built in `beforeAll` because they are a fixture. One later action in both
  // modes; two in history mode, where no `hashchange` multiplies the schedules
  // (hash mode's extra event is orthogonal to the race and is swept above and
  // in the one-action half). Measured, unloaded: ~1.5 s and ~1 s.
  const reports: RaceReport[] = []
  beforeAll(() => {
    reports.push(raceReport([[], [-1], [1], [-2], [2], ['a'], ['c']]))
    reports.push(
      raceReport(
        [
          [-1, 1],
          [1, -1],
          [-1, -1],
          [1, 1],
          [-1, 'c'],
          ['a', 1],
        ],
        ['history'],
      ),
    )
  })
  const total = (
    key: 'schedules' | 'indistinguishable' | 'preempted' | 'lapsed' | 'navigatedMidRestore',
  ) => reports.reduce((sum, report) => sum + report[key], 0)

  it('explores the race it claims to: preemption, lapsed restores and mid-restore navigation', () => {
    // Non-vacuity. Each of these is a shape the router has to get right, and a
    // sweep that never produced one would pass the assertions below for free.
    for (const report of reports) {
      expect(report.preempted).toBeGreaterThan(0)
      expect(report.lapsed).toBeGreaterThan(0)
      expect(report.navigatedMidRestore).toBeGreaterThan(0)
    }
    // Most schedules are attributable, and those are what the intent half checks.
    expect(total('indistinguishable')).toBeLessThan(total('schedules') / 2)
  })

  it('always leaves the URL and the application agreeing, nothing refused dispatched, nothing armed', () => {
    expect(reports.flatMap((report) => report.invariant).slice(0, 5)).toEqual([])
  })

  it('never treats its own traversal as a navigation wherever the landing is attributable', () => {
    expect(reports.flatMap((report) => report.intent).slice(0, 5)).toEqual([])
  })

  it('does not dispatch where a stale restore lands after the user moved on (the reported shape)', () => {
    // home → `a` is refused and the router queues `go(-1)` to undo it; the user
    // takes `go(2)` before that runs and lands on `c`, which the guard accepts.
    // The stale restore then moves the browser to `b`. Before, the router had
    // already forgotten its restore, so it dispatched `b` — a route nobody
    // asked for — and left the user there.
    const c: RaceCase = {
      mode: 'hash',
      standing: 0,
      blocked: ['a'],
      first: 1,
      later: [2],
      reloaded: false,
    }
    const outcome = raceScenario(c, userFirstThenTraversals)
    expect(outcome.traversals.map((t) => `${t.by}(${t.delta})→${t.landed}`)).toEqual([
      'user(1)→a',
      'user(2)→c',
      'router(-1)→b',
      'router(1)→c',
    ])
    expect(outcome.dispatches).toEqual(['c'])
    expect(outcome.showing).toBe('c')
  })

  it('a second refused landing waits for the restore already queued instead of compounding it', () => {
    // home → `a` is refused and the router queues `go(-1)`; the user's `go(1)`
    // runs first and lands on `b`, refused too. The queued restore will land
    // from `b` — on `a` — so a second restore issued now would be measured from
    // a position the first is about to move: it would lapse or overshoot. The
    // router waits for the first and corrects from where it lands. The end state
    // is the same either way (the sweep above holds both to it); what this pins
    // is that the router issues no traversal its own queue will invalidate.
    const c: RaceCase = {
      mode: 'hash',
      standing: 0,
      blocked: ['a', 'b'],
      first: 1,
      later: [1],
      reloaded: false,
    }
    const outcome = raceScenario(c, userFirstThenTraversals)
    expect(outcome.traversals.map((t) => `${t.by}(${t.delta})→${t.landed}`)).toEqual([
      'user(1)→a',
      'user(1)→b',
      'router(-1)→a',
      'router(-1)→home',
    ])
    expect(outcome.dispatches).toEqual([])
    expect(outcome.showing).toBe('home')
  })
})

/**
 * A fixed schedule: a pending user action joins the queue as soon as it can —
 * so it runs AHEAD of the router's restore — and traversals run before queued
 * `hashchange`s.
 */
function userFirstThenTraversals(ready: Task[]): number {
  const user = ready.findIndex((t) => t.source === 'user')
  if (user >= 0) return user
  return Math.max(
    0,
    ready.findIndex((t) => t.source === 'traverse'),
  )
}
