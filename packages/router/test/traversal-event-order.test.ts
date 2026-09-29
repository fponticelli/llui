import { beforeAll, describe, expect, it } from 'vitest'
import { component, mountApp, text } from '@llui/dom'
import { createRouter, route, type RouteLocation } from '../src/index'
import { connectRouter, type RouterEnv } from '../src/connect'
import { sessionHistory, type Task } from './support/session-history'

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
// `support/session-history.ts` models the session history precisely enough to
// deliver every legal interleaving; this file explores them and asserts the
// router's observable outcome is the same for all of them — exactly one
// dispatch per traversal it accepted, none for a traversal it blocked, and a
// restore that lands where it started — on both restore paths (`FLAVOURS`).

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

type Scenario = (choose: (ready: Task[]) => number) => unknown

/**
 * Both ways the router can undo a blocked traversal. Every sweep in this file
 * runs against each: the History API path (relative `history.go`, attributed by
 * movement) is what browsers without the Navigation API run, and must stay
 * fully covered; the Navigation API path (`traverseTo(key)`, attributed by the
 * `navigate` event's `info`) is what the rest run.
 */
const FLAVOURS = [
  { flavour: 'History API', navigation: false },
  { flavour: 'Navigation API', navigation: true },
] as const

/** The events the History API fires — what the hash-mode delivery tests order. */
const urlEvents = (observed: readonly string[]): string[] =>
  observed.filter((event) => event === 'popstate' || event === 'hashchange')

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

describe.each(FLAVOURS)(
  'hash-mode traversal events in every legal delivery order ($flavour)',
  ({ navigation }) => {
    it('the model delivers the reordered sequence the loaded browser did', () => {
      // Guard against a vacuous sweep: the interleaving that failed in Chromium
      // must be one of the schedules explored below.
      const schedules = everyInterleaving(
        (choose) => blockedRestoreScenario(choose, navigation).events,
      )
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
        const { dispatches, marker, hash, afterUnblock } = blockedRestoreScenario(
          choose,
          navigation,
        )
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
        const history = sessionHistory('#/', { navigation })
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
        const history = sessionHistory('#/', { navigation })
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
      const history = sessionHistory('#/', { navigation })
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
      const history = sessionHistory('#/', { navigation })
      const router = mountRouter(history.env, () => false)
      router.navigate('login')
      // `replace()` writes with `replaceState`, which fires nothing — so the one
      // event still to come is the navigation's own, and it now finds a URL the
      // router wrote itself.
      router.replace('other')
      history.drain(() => 0)
      expect(urlEvents(history.observed)).toEqual(['popstate', 'hashchange'])
      expect(router.dispatches).toEqual(['login'])
      expect(history.env.hash).toBe('#/other')
      router.dispose()
    })
  },
)

/**
 * The browser fixture's sequence (`test/browser/same-fragment.fixture.ts`):
 * two hash navigations, a same-fragment replace, a same-fragment back, then a
 * back onto a blocked route whose restore races that back's `hashchange`.
 */
function blockedRestoreScenario(choose: (ready: Task[]) => number, navigation: boolean) {
  const history = sessionHistory('', { navigation })
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
    events: urlEvents(history.observed),
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
  /** Whether the env has the Navigation API (see `FLAVOURS`). */
  navigation: boolean
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
  const history = sessionHistory(c.mode === 'hash' ? '#/' : '/', {
    mode: c.mode,
    navigation: c.navigation,
  })
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
  navigation: boolean,
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
              yield { mode, navigation, standing, blocked, first, later, reloaded }
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
function indistinguishable(outcome: RaceOutcome): 'same-delta' | 'maybe-lapsed' | null {
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
  const sameDelta = own.some((r) =>
    outcome.traversals.some((u) => u.by === 'user' && u.delta === r.delta && preempts(r, u.ranAt)),
  )
  if (sameDelta) return 'same-delta'
  const maybeLapsed = own.some(
    (r) =>
      r.landed !== null &&
      moves.some((m) => preempts(r, m.ranAt) && lapsesFrom(r, m.from, m.known)),
  )
  return maybeLapsed ? 'maybe-lapsed' : null
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
  /**
   * Intent violations in schedules excluded as {@link indistinguishable}, by
   * shape — what the History API path really does get wrong there. Never
   * filled with the Navigation API, which excludes nothing.
   */
  excused: Record<'same-delta' | 'maybe-lapsed', string[]>
}

function raceReport(
  laterChoices: ReadonlyArray<readonly LaterAction[]>,
  modes: ReadonlyArray<RaceCase['mode']>,
  navigation: boolean,
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
    excused: { 'same-delta': [], 'maybe-lapsed': [] },
  }
  for (const c of raceCases(laterChoices, modes, navigation)) {
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
      const shape = indistinguishable(o)
      if (shape !== null) {
        report.indistinguishable++
        // Undecidable only for an observer of the History API. With the
        // Navigation API the `navigate` event names whose traversal it is, so
        // the intent half holds for EVERY schedule.
        if (!c.navigation) {
          for (const v of raceIntentViolations(o, c)) report.excused[shape].push(explain(v))
          continue
        }
      }
      for (const v of raceIntentViolations(o, c)) report.intent.push(explain(v))
    }
  }
  return report
}

/**
 * The sweeps both flavours run: one later action in both modes; two in history
 * mode, where no `hashchange` multiplies the schedules (hash mode's extra event
 * is orthogonal to the race and is swept above and in the one-action half).
 */
function raceSweeps(navigation: boolean): RaceReport[] {
  return [
    raceReport([[], [-1], [1], [-2], [2], ['a'], ['c']], ['hash', 'history'], navigation),
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
      navigation,
    ),
  ]
}

describe('a user traversal racing a blocked traversal’s restore (History API)', () => {
  // The sweeps, shared by the assertions below: every case, every schedule.
  // Built in `beforeAll` because they are a fixture. One later action in both
  // modes; two in history mode, where no `hashchange` multiplies the schedules
  // (hash mode's extra event is orthogonal to the race and is swept above and
  // in the one-action half). Measured, unloaded: ~1.5 s and ~1 s; the whole
  // History API sweep took ~5.7 s, and the Navigation API one below ~6.9 s, at
  // load ~29 — inside the 60 s hook budget.
  const reports: RaceReport[] = []
  beforeAll(() => {
    reports.push(...raceSweeps(false))
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

  it('does get the two unattributable shapes wrong — the gap the Navigation API closes', () => {
    // The exclusion is not a formality: in some of the excluded schedules the
    // History API path ends where the user did NOT go, or dispatches a route
    // only its own traversal reached. The Navigation API sweep below runs the
    // same schedules and excludes none of them.
    for (const shape of ['same-delta', 'maybe-lapsed'] as const) {
      expect(reports.flatMap((report) => report.excused[shape]).length).toBeGreaterThan(0)
    }
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
      navigation: false,
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
      navigation: false,
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

describe('a user traversal racing a blocked traversal’s restore (Navigation API)', () => {
  // The same cases and schedules as the History API sweep above. What changes
  // is what the router can know: the `navigate` event says whose traversal is
  // landing, and `traverseTo(key)` names the entry to return to — so neither
  // exclusion the History half makes applies, and the intent half is held for
  // every schedule, the two undecidable shapes included.
  const reports: RaceReport[] = []
  beforeAll(() => {
    reports.push(...raceSweeps(true))
  })
  const total = (
    key: 'schedules' | 'indistinguishable' | 'preempted' | 'lapsed' | 'navigatedMidRestore',
  ) => reports.reduce((sum, report) => sum + report[key], 0)

  it('explores the race it claims to, including both shapes the History API cannot attribute', () => {
    for (const report of reports) {
      expect(report.preempted).toBeGreaterThan(0)
      expect(report.navigatedMidRestore).toBeGreaterThan(0)
      // Schedules that ARE the two undecidable shapes — held to the intent
      // half below instead of being excused from it.
      expect(report.indistinguishable).toBeGreaterThan(0)
    }
    expect(total('schedules')).toBeGreaterThan(0)
  })

  it('always leaves the URL and the application agreeing, nothing refused dispatched, nothing armed', () => {
    expect(reports.flatMap((report) => report.invariant).slice(0, 5)).toEqual([])
  })

  it('never treats its own traversal as a navigation — in EVERY schedule', () => {
    expect(reports.flatMap((report) => report.intent).slice(0, 5)).toEqual([])
  })

  it('same delta: a user traversal the size of the restore, queued ahead of it, is the user’s', () => {
    // On `a`, back onto the refused `home`; the user's `go(1)` runs before the
    // router's restore. The History path takes the user's landing on `a` for
    // its own, then judges its real restore — which carries the browser on to
    // `b` — as a navigation and dispatches `b`. Here the user's landing carries
    // no `info`, so it is guarded and dispatched as the user's; the restore
    // then finds the browser already on `a` and does nothing.
    const c: RaceCase = {
      mode: 'hash',
      standing: 1,
      blocked: ['home'],
      first: -1,
      later: [1],
      reloaded: false,
      navigation: true,
    }
    const outcome = raceScenario(c, userFirstThenTraversals)
    expect(outcome.traversals.map((t) => `${t.by}(${t.delta})→${t.landed}`)).toEqual([
      'user(-1)→home',
      'user(1)→a',
      'router(0)→null',
    ])
    expect(outcome.dispatches).toEqual(['a'])
    expect(outcome.showing).toBe('a')
  })

  it('maybe lapsed: a restore the app navigated away from still lands, and is the router’s', () => {
    // On `home`, `go(2)` onto the refused `b`; the user's `go(-1)` runs first
    // (`a`, accepted), then the app navigates to `c`, then the restore runs.
    // Relative to `a` the History path's `go(-2)` would have lapsed, so it was
    // forgotten — and from `c` it lands on `home`, judged as a navigation and
    // dispatched. `traverseTo(home)` lands there too, but announced as the
    // router's own, and is sent on to `c`.
    const c: RaceCase = {
      mode: 'history',
      standing: 0,
      blocked: ['b'],
      first: 2,
      later: [-1, 'c'],
      reloaded: false,
      navigation: true,
    }
    const outcome = raceScenario(
      c,
      inOrder('user presses go(-1)', 'user go(2)', 'user go(-1)', 'app navigates to c'),
    )
    expect(outcome.traversals.map((t) => `${t.by}(${t.delta})→${t.landed}`)).toEqual([
      'user(2)→b',
      'user(-1)→a',
      'router(-2)→home',
      'router(2)→c',
    ])
    expect(outcome.navigations.map((n) => n.to)).toEqual(['c'])
    expect(outcome.dispatches).toEqual(['a', 'c'])
    expect(outcome.showing).toBe('c')
  })

  it('the reported shape: a stale restore is sent on to where the user went', () => {
    const c: RaceCase = {
      mode: 'hash',
      standing: 0,
      blocked: ['a'],
      first: 1,
      later: [2],
      reloaded: false,
      navigation: true,
    }
    const outcome = raceScenario(c, userFirstThenTraversals)
    expect(outcome.traversals.map((t) => `${t.by}(${t.delta})→${t.landed}`)).toEqual([
      'user(1)→a',
      'user(2)→c',
      'router(-3)→home',
      'router(3)→c',
    ])
    expect(outcome.dispatches).toEqual(['c'])
    expect(outcome.showing).toBe('c')
  })
})

/**
 * A scripted schedule: at each choice, run the ready task named by the next
 * label if it is ready, else the first ready task (traversals before queued
 * `hashchange`s — the order `drain` lists them in).
 */
function inOrder(...labels: string[]): (ready: Task[]) => number {
  let next = 0
  return (ready) => {
    const wanted = ready.findIndex((task) => task.label === labels[next])
    if (wanted === -1) return 0
    next++
    return wanted
  }
}
