import { component, mountApp, text } from '@llui/dom'
import { browserRouterEnv, connectRouter } from '../../src/connect.js'
import { createRouter, route, type RouteLocation } from '../../src/index.js'

/**
 * The shapes the History API path cannot undo or attribute, driven in real
 * Chromium — once through the Navigation API (`?nav=on`, what Chromium runs by
 * default) and once with it forced off (`?nav=off`, what a browser without it
 * runs). `?mode=` picks hash or history routing.
 *
 * Every scenario starts from a clean stack the fixture builds with the app's own
 * navigations, then does what the scenario names and waits until nothing
 * observable changes (see `settle`).
 *
 * The "user" acts through two `popstate` listeners, one registered BEFORE the
 * router mounts and one AFTER (listeners on `window` run in registration order).
 * The early one runs ahead of the router's handling of a landing, which is how a
 * user traversal is queued AHEAD of the router's restore — deterministically, as
 * in `restore-race.fixture.ts`; the late one runs after it, which is how the app
 * navigates between the router's handling of a landing and its queued restore.
 */

interface ScenarioResult {
  /** Routes dispatched from the scenario's action on. */
  dispatches: string[]
  /** The route the application shows: its last dispatch, or where it stood. */
  app: string
  /** The route the URL shows once everything has settled. */
  showing: string
  /** Every traversal the page asked for and every landing, in order. */
  log: string[]
  /** `navigation.entries()` as routes, bottom first, and the current index. */
  entries: string[]
  index: number
}

type Scenario =
  | 'foreign-push'
  | 'typed-fragment-across'
  | 'typed-fragment-onto'
  | 'same-delta'
  | 'maybe-lapsed'

declare global {
  interface Window {
    __runScenario(scenario: Scenario, minLandings: number): Promise<ScenarioResult>
    __navigationApiReady: boolean
    /** Whether the router under test was handed the Navigation API. */
    __routerUsesNavigation: boolean
  }
}

const params = new URLSearchParams(location.search)
const mode = params.get('mode') === 'history' ? 'history' : 'hash'
const env = browserRouterEnv({ navigation: params.get('nav') !== 'off' })
const registry = {
  home: route('/'),
  a: route('/a'),
  b: route('/b'),
  c: route('/c'),
}
type Name = keyof typeof registry
type Location = RouteLocation<typeof registry>
const router = createRouter(registry, { mode })

function routeOf(url: string): string {
  const parsed = new URL(url)
  const address = mode === 'hash' ? parsed.hash : parsed.pathname
  return router.match(address)?.name ?? `unmatched ${address}`
}

function showing(): string {
  return routeOf(location.href)
}

const log: string[] = []
const originalGo = history.go.bind(history)
history.go = (delta?: number) => {
  log.push(`go(${delta})`)
  originalGo(delta)
}
const originalTraverseTo = navigation.traverseTo.bind(navigation)
navigation.traverseTo = (key, options) => {
  const entry = navigation.entries().find((candidate) => candidate.key === key)
  log.push(`traverseTo(${entry?.url == null ? 'missing' : routeOf(entry.url)})`)
  return originalTraverseTo(key, options)
}

/** One-shot user actions keyed by the route a landing shows. */
const early = new Map<string, () => void>()
const late = new Map<string, () => void>()
const runPlanned = (plan: Map<string, () => void>): void => {
  const here = showing()
  const action = plan.get(here)
  if (action === undefined) return
  plan.delete(here)
  action()
}

// The early "user": registered before the router mounts, so it runs first.
addEventListener('popstate', () => {
  log.push(`landed ${showing()}`)
  runPlanned(early)
})

const blocked = new Set<Name>()
const routing = connectRouter(router, {
  env,
  beforeEnter: (to) => (blocked.has(to.name) ? false : undefined),
})
window.__routerUsesNavigation = env.navigation !== undefined
const dispatches: string[] = []
// What the application shows before any dispatch: the route it loaded on, as an
// app's `init` would read it.
let app = showing()
const record = (message: unknown): void => {
  const name =
    (message as { type: string }).type === 'navigate'
      ? (message as { location: Location }).location.name
      : `unmatched ${(message as { url: string }).url}`
  dispatches.push(name)
  app = name
}
const signal = new AbortController().signal

mountApp(
  document.querySelector('#app')!,
  component({
    name: 'NavigationApiFixture',
    init: (): [null, never[]] => [null, []],
    update: (state: null): [null, never[]] => [state, []],
    view: () => [...routing.listener(record), text('ready')],
  }),
)

// The late "user": registered after the router's listener, so it runs after the
// router has handled the landing.
addEventListener('popstate', () => runPlanned(late))

function navigate(name: Name): void {
  routing.handleEffect({ effect: routing.navigate(name), send: record, signal })
}

function frames(n: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number): void => {
      if (left === 0) resolve()
      else requestAnimationFrame(() => step(left - 1))
    }
    step(n)
  })
}

const landings = (): number => log.filter((line) => line.startsWith('landed')).length

/**
 * Wait for `predicate`, then until nothing observable changes for 10 frames —
 * the quiescence `same-fragment.fixture.ts` documents, for the same reason: an
 * assertion that something did NOT happen has no other honest wait.
 */
async function settle(label: string, predicate: () => boolean): Promise<void> {
  const snapshot = () => JSON.stringify([location.href, dispatches, log])
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > 5_000) {
      throw new Error(`Timed out waiting for ${label}: ${snapshot()}`)
    }
    await frames(1)
  }
  let last = snapshot()
  for (let quiet = 0; quiet < 10; ) {
    await frames(1)
    const now = snapshot()
    quiet = now === last ? quiet + 1 : 0
    last = now
    if (performance.now() - started > 5_000) throw new Error(`Timed out settling ${label}`)
  }
}

/** Build `home | a | b | c` with the app's own navigations and stand on `standing`. */
async function stack(standing: Name): Promise<void> {
  for (const name of ['home', 'a', 'b', 'c'] as const) navigate(name)
  await settle('stack built', () => showing() === 'c')
  const back = ['home', 'a', 'b', 'c'].indexOf(standing) - 3
  if (back !== 0) {
    history.go(back)
    await settle(`back on ${standing}`, () => showing() === standing)
  }
}

/** The stack every hand-edit scenario starts from: `home | a | b(typed) | c`. */
async function typedStack(): Promise<void> {
  navigate('home')
  navigate('a')
  await settle('a', () => showing() === 'a')
  // A fragment typed into the address bar: a new entry the router never wrote.
  // The router sees it through its listener and, the guard accepting it,
  // dispatches `b` — but it cannot stamp a position on it.
  location.hash = '#/b'
  await settle('typed b', () => app === 'b')
  navigate('c')
  await settle('c', () => showing() === 'c')
}

const scenarios: Record<Scenario, () => Promise<void>> = {
  // `home | /tracker (foreign) | a`, then a blocked `go(-2)` onto `home`.
  'foreign-push': async () => {
    navigate('home')
    await settle('home', () => showing() === 'home')
    // Analytics, a widget, another framework: an entry the router never sees.
    history.pushState({ foreign: true }, '', mode === 'hash' ? '#/tracker' : '/tracker')
    navigate('a')
    await settle('a', () => showing() === 'a')
    blocked.add('home')
    reset()
    history.go(-2)
  },
  // A blocked `go(-2)` from `c` onto `a`, ACROSS the typed entry.
  'typed-fragment-across': async () => {
    await typedStack()
    blocked.add('a')
    reset()
    history.go(-2)
  },
  // A blocked back from `c` ONTO the typed entry.
  'typed-fragment-onto': async () => {
    await typedStack()
    blocked.add('b')
    reset()
    history.back()
  },
  // On `a`, a blocked back onto `home`; the user presses forward — the same
  // size as the router's own restore — before the restore is queued.
  'same-delta': async () => {
    await stack('a')
    blocked.add('home')
    early.set('home', () => history.go(1))
    reset()
    history.back()
  },
  // On `home`, a blocked `go(2)` onto `b`; the user's back is queued ahead of
  // the restore and lands on `a`, from where the restore (`go(-2)` on the
  // History path) would point outside the stack — and then the app navigates to
  // `c`, from where it would not.
  'maybe-lapsed': async () => {
    await stack('home')
    blocked.add('b')
    early.set('b', () => history.go(-1))
    late.set('a', () => navigate('c'))
    reset()
    history.go(2)
  },
}

function reset(): void {
  dispatches.length = 0
  log.length = 0
}

window.__runScenario = async (scenario, minLandings) => {
  await scenarios[scenario]()
  await settle(`${scenario} settled`, () => landings() >= minLandings)
  return {
    dispatches: [...dispatches],
    app,
    showing: showing(),
    log: [...log],
    entries: navigation
      .entries()
      .map((entry) => (entry.url === null ? 'no url' : routeOf(entry.url))),
    index: navigation.currentEntry?.index ?? -1,
  }
}

window.__navigationApiReady = true
