import { component, mountApp, text } from '@llui/dom'
import { connectRouter } from '../../src/connect.js'
import { createRouter, route, type RouteLocation } from '../../src/index.js'

/**
 * A user traversal that runs BEFORE the router's own restore of a blocked one.
 *
 * `history.go()` joins one first-in-first-out traversal queue, whoever calls
 * it. The router answers a blocked `popstate` with a restoring `history.go`
 * from inside its listener, so a traversal queued before that call runs first.
 * A real user gets there with a second back/forward press while the page is
 * busy. This fixture gets there deterministically: its own `popstate` listener
 * is registered BEFORE the router's (listeners on `window` run in registration
 * order — measured in Chromium, where registering this one with `capture: true`
 * after the router's did NOT make it run first) and queues the "user's"
 * traversal there.
 */

interface RaceResult {
  /** Routes dispatched from the blocked traversal on. */
  dispatches: string[]
  /** The route the URL shows once everything has settled. */
  showing: string
  /** Every `history.go` call and every landing, in order. */
  log: string[]
}

declare global {
  interface Window {
    __runRestoreRace(userDelta: number): Promise<RaceResult>
    __restoreRaceReady: boolean
  }
}

const mode = new URLSearchParams(location.search).get('mode') === 'history' ? 'history' : 'hash'
const registry = {
  home: route('/'),
  a: route('/a'),
  b: route('/b'),
  c: route('/c'),
}
type Name = keyof typeof registry
type Location = RouteLocation<typeof registry>
const router = createRouter(registry, { mode })

function showing(): string {
  const url = mode === 'hash' ? location.hash : location.pathname
  return router.match(url)?.name ?? `unmatched ${url}`
}

const log: string[] = []
const originalGo = history.go.bind(history)
history.go = (delta?: number) => {
  log.push(`go(${delta})`)
  originalGo(delta)
}

// The "user". Registered before the router mounts, so it runs first.
let userDelta: number | null = null
addEventListener('popstate', () => {
  log.push(`landed ${showing()}`)
  if (userDelta === null) return
  const delta = userDelta
  userDelta = null
  history.go(delta)
})

const blocked = new Set<Name>()
const routing = connectRouter(router, {
  beforeEnter: (to) => (blocked.has(to.name) ? false : undefined),
})
const dispatches: string[] = []
const record = (message: unknown): void => {
  dispatches.push((message as { location: Location }).location.name)
}
const signal = new AbortController().signal

mountApp(
  document.querySelector('#app')!,
  component({
    name: 'RestoreRaceFixture',
    init: (): [null, never[]] => [null, []],
    update: (state: null): [null, never[]] => [state, []],
    view: () => [...routing.listener(record), text('ready')],
  }),
)

function frames(n: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number): void => {
      if (left === 0) resolve()
      else requestAnimationFrame(() => step(left - 1))
    }
    step(n)
  })
}

/**
 * Wait for `predicate`, then until nothing observable changes for 10 frames —
 * the same quiescence `same-fragment.fixture.ts` documents, for the same
 * reason: an assertion that something did NOT happen has no other honest wait.
 */
async function settle(label: string, predicate: () => boolean): Promise<void> {
  const snapshot = () => JSON.stringify([showing(), dispatches, log])
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > 5_000) throw new Error(`Timed out waiting for ${label}`)
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

window.__runRestoreRace = async (delta) => {
  // Build `home | a | b | c` with the app's own navigations, then stand on
  // `home` with the other three ahead.
  for (const name of ['home', 'a', 'b', 'c'] as const) {
    routing.handleEffect({ effect: routing.navigate(name), send: record, signal })
  }
  await settle('stack built', () => showing() === 'c')
  history.go(-3)
  await settle('back home', () => showing() === 'home')

  blocked.add('a')
  dispatches.length = 0
  log.length = 0
  userDelta = delta
  history.forward()
  // Precondition, exact: the blocked traversal, the user's and the router's
  // restore have all landed (three landings), and quiescence after them.
  await settle('race settled', () => log.filter((line) => line.startsWith('landed')).length >= 3)
  return { dispatches: [...dispatches], showing: showing(), log: [...log] }
}

window.__restoreRaceReady = true
