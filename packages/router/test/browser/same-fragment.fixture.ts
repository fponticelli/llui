import { component, mountApp, text } from '@llui/dom'
import { browserRouterEnv, connectRouter } from '../../src/connect.js'
import { createRouter, route, type RouteLocation } from '../../src/index.js'

interface TraversalResult {
  sameFragment: {
    events: string[]
    marker: unknown
    dispatches: string[]
  }
  blockedRestore: {
    events: string[]
    marker: unknown
    hash: string
    dispatches: string[]
  }
}

declare global {
  interface Window {
    __runSameFragmentTraversal(stallMs?: number): Promise<TraversalResult>
    __sameFragmentReady: boolean
  }
}

const registry = {
  home: route('/'),
  login: route('/login'),
  other: route('/other'),
}
type Location = RouteLocation<typeof registry>
const router = createRouter(registry)

let blockHome = false
// `?nav=off` forces the History API path; by default Chromium's Navigation API
// undoes the blocked back (`traverseTo` instead of `history.go`).
const env = browserRouterEnv({
  navigation: new URLSearchParams(location.search).get('nav') !== 'off',
})
const routing = connectRouter(router, {
  env,
  beforeEnter: (to) => (blockHome && to.name === 'home' ? false : undefined),
})
const dispatches: string[] = []
const record = (message: unknown): void => {
  dispatches.push((message as { location: Location }).location.name)
}
const signal = new AbortController().signal

mountApp(
  document.querySelector('#app')!,
  component({
    name: 'SameFragmentTraversalFixture',
    init: (): [null, never[]] => [null, []],
    update: (state: null): [null, never[]] => [state, []],
    view: () => [...routing.listener(record), text('ready')],
  }),
)

function navigate(name: 'home' | 'login' | 'other'): void {
  routing.handleEffect({ effect: routing.navigate(name), send: record, signal })
}

function replace(name: 'home' | 'login' | 'other'): void {
  routing.handleEffect({ effect: routing.replace(name), send: record, signal })
}

function marker(): unknown {
  return (history.state as Record<string, unknown> | null)?.['marker']
}

function mark(value: string): void {
  history.replaceState({ ...(history.state as object), marker: value }, '')
}

function waitFor(label: string, predicate: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = performance.now()
    const check = () => {
      if (predicate()) {
        resolve()
      } else if (performance.now() - started > 5_000) {
        reject(
          new Error(
            `Timed out waiting for ${label}: hash=${location.hash}, marker=${String(marker())}`,
          ),
        )
      } else {
        requestAnimationFrame(check)
      }
    }
    check()
  })
}

/**
 * Wait until everything the assertion is about has STOPPED changing, then
 * return it.
 *
 * The sampling this replaces waited on a PROXY — "two popstate events have
 * fired" — and then took one animation frame of slack before reading. But
 * `dispatches` is appended by the router's own `send`, which is on a different
 * schedule from the DOM events, so the proxy being satisfied does not mean the
 * dispatching has finished. One frame is enough on a quiet machine and was not
 * enough on a loaded CI runner, which is how #230 reddened `main` with
 * `dispatches: ["login", "login"]` against an expected `[]` while `events`,
 * `marker` and `hash` all matched.
 *
 * THAT DIAGNOSIS WAS INCOMPLETE. The two `login`s were REAL dispatches, not
 * late ones: `send` runs synchronously inside the router's listener, which is
 * registered before this file's recorders, so a dispatch lands before the event
 * that caused it is even recorded. Under load the browser applied the restore
 * before delivering the blocked step's `hashchange`
 * (`popstate, popstate, hashchange, hashchange`), and the router of the time
 * dispatched the restored route once per late `hashchange`. The router now
 * judges a `hashchange` by the URL it finds (`settledHash` in `connect.ts`);
 * the `stallMs` argument below forces that order on every run, and
 * `test/traversal-event-order.test.ts` sweeps every legal order in a model.
 * Quiescence stays as the honest wait for a claim of the form "never".
 *
 * The shape of that assertion is what makes it fragile: `dispatches: []` claims
 * something will NEVER happen, so a moment chosen by an unrelated signal can
 * always be too early. Quiescence is the honest wait — the snapshot has to hold
 * still across several consecutive frames before it is read.
 *
 * This does not weaken the test: a dispatch that really happens still lands in
 * the snapshot and still fails the assertion. Waiting only removes the case
 * where a real one had not arrived yet.
 *
 * BUT THE WINDOW IS BOUNDED, AND THE BOUND IS EXACTLY `quietFrames - 1`. This
 * is quiescence, not proof: a straggler arriving more than that many frames
 * after the last observable change is still missed, because by then the
 * snapshot has already held still long enough to be read. Measured, by
 * injecting #230's own symptom (two spurious `login` dispatches) at a
 * controlled delay and running both samplings:
 *
 *   delay (frames)   0   1   2   3   4   6   9   12
 *   old (1 rAF)      x   x   -   -   -   -   -   -
 *   quietFrames 3    x   x   x   x   -   -   -   -
 *   quietFrames 10   x   x   x   x   x   x   x   -
 *
 *   (x = caught, - = missed)
 *
 * So the old sampling was blind from TWO frames out, which is the whole of
 * #230. Ten was chosen because it costs nothing measurable — the test runs in
 * ~500 ms either way — and nine frames is a wide margin over the one that
 * actually failed. Do not read the table as a guarantee; read it as the range
 * that has been exercised.
 *
 * The quiet period is counted in FRAMES rather than milliseconds on purpose.
 * A loaded machine — the condition under which #230 reported — has longer
 * frames, so a frame count buys proportionally more wall-clock exactly when
 * more is needed. A fixed millisecond budget would tighten under load, which is
 * the wrong direction.
 *
 * A caller must still wait for its own PRECONDITION first. Quiescence alone
 * would be satisfied by a snapshot that has not started changing yet — the
 * frames immediately after `history.back()`, before the first popstate.
 */
async function settled<T>(label: string, snapshot: () => T, quietFrames = 10): Promise<T> {
  const started = performance.now()
  let last = JSON.stringify(snapshot())
  let quiet = 0
  for (;;) {
    await new Promise(requestAnimationFrame)
    const now = JSON.stringify(snapshot())
    if (now === last) {
      quiet += 1
      if (quiet >= quietFrames) return snapshot()
    } else {
      quiet = 0
      last = now
    }
    if (performance.now() - started > 5_000) {
      throw new Error(`Timed out waiting for ${label} to settle. Last snapshot: ${last}`)
    }
  }
}

/**
 * `stallMs` > 0 busy-waits that long after the blocked traversal's `popstate`
 * to force the restore to be applied before that traversal's `hashchange` is
 * delivered (see below). `0` leaves the order to the browser.
 */
window.__runSameFragmentTraversal = async (stallMs = 0) => {
  const events: string[] = []
  addEventListener('popstate', () => events.push('popstate'))
  addEventListener('hashchange', () => events.push('hashchange'))

  navigate('login')
  await waitFor('first hash navigation', () => events.includes('hashchange'))
  mark('entry-1')

  events.length = 0
  navigate('other')
  await waitFor('second hash navigation', () => events.includes('hashchange'))
  mark('entry-2')
  replace('login')

  events.length = 0
  dispatches.length = 0
  history.back()
  await waitFor('same-fragment back', () => marker() === 'entry-1')
  const sameFragment = await settled('same-fragment landing', () => ({
    events: [...events],
    marker: marker(),
    dispatches: [...dispatches],
  }))

  blockHome = true
  events.length = 0
  dispatches.length = 0
  if (stallMs > 0) {
    // Hold the main thread right after the BLOCKED traversal's `popstate` —
    // registered after the router's own listener, so the router has already
    // issued its restoring traversal (`history.go(1)`, or `traverseTo` with
    // the Navigation API). The blocked step's `hashchange`
    // is queued as a DOM-manipulation task; the restore arrives as a
    // traversal task. With both waiting when the thread frees up, Chromium
    // runs the traversal first and delivers
    // `popstate, popstate, hashchange, hashchange` — the order a loaded
    // machine produced by accident, and the one that made the router dispatch
    // the restored route once per late `hashchange`.
    const stall = () => {
      removeEventListener('popstate', stall)
      const until = performance.now() + stallMs
      while (performance.now() < until) {
        // Busy: a timer would yield the thread, which is the opposite of the point.
      }
    }
    addEventListener('popstate', stall)
  }
  history.back()
  // The precondition, exact rather than a proxy: both steps change the
  // fragment, so each fires one `popstate` and one `hashchange` — in whichever
  // order the event loop picks. Counting only popstates (the earlier proxy)
  // let the snapshot be taken before either `hashchange` had been delivered
  // when they arrive last. Only once all four are in is quiescence meaningful.
  await waitFor(
    'blocked traversal and restore',
    () =>
      events.filter((event) => event === 'popstate').length === 2 &&
      events.filter((event) => event === 'hashchange').length === 2,
  )
  const blockedRestore = await settled('blocked restore', () => ({
    events: [...events],
    marker: marker(),
    hash: location.hash,
    dispatches: [...dispatches],
  }))

  return { sameFragment, blockedRestore }
}

window.__sameFragmentReady = true
