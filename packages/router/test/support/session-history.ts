import type { RouterEnv, RouterNavigateEvent, RouterNavigation } from '../../src/connect'

// An in-memory session history, precise enough to deliver every event order the
// HTML spec permits — shared by the model sweeps (`traversal-event-order.test.ts`)
// and the Navigation API cases (`navigation-api.test.ts`).
//
// Applying a same-document history step fires `popstate` SYNCHRONOUSLY and,
// only when the fragment changed, QUEUES a task (DOM manipulation task source)
// to fire `hashchange`. A traversal is applied by a task on ANOTHER source (the
// session history traversal queue, ONE first-in-first-out queue shared by
// `history.go()`, `navigation.traverseTo()` and the browser's own back/forward
// UI). The event loop may pick either source first; `drain(choose)` lets the
// caller pick, so a sweep can explore every order.
//
// With `navigation: true` the env also carries a faithful fake of the slice of
// the Navigation API the router uses (jsdom has none):
//
// - every entry has a KEY; a push (pushState, a fragment navigation) mints a new
//   one, a replace keeps the entry's key, and a key is never reused;
// - `navigate` fires SYNCHRONOUSLY before every same-document navigation this
//   model performs — `pushState` ('push'), `replaceState` ('replace'), a
//   fragment navigation ('push') and every traversal that is about to move the
//   browser ('traverse', with `destination.key` and the initiator's `info`);
//   then the step is applied (a traversal's `popstate`, queued `hashchange`);
// - `traverseTo(key, info)` is resolved when CALLED against the entry list (a
//   key no entry has, or the current entry's, does nothing — the spec's early
//   `InvalidStateError` / already-there results), de-duplicated against a
//   still-queued `traverseTo` for the same key (the spec's "upcoming traverse
//   API method trackers"), and resolved AGAIN when the queue runs it: an entry
//   removed in between (a push from below truncated it) lapses with no event,
//   and one the browser is already on fires nothing.
//
// A traversal can also be CANCELLED by another `navigate` listener
// (`cancelNextTraversal`): its `navigate` event fires and then nothing moves and
// nothing else fires — what `preventDefault()` does to a cancelable traversal.
// The router never cancels one itself.
//
// Not modelled, because the router depends on none of it: interception, and
// `currententrychange`.

export interface Entry {
  path: string
  hash: string
  state: unknown
  key: string
}

/**
 * `dom`: the DOM manipulation task source; `traverse`: the session history
 * traversal queue, which is ONE FIFO shared by `history.go()`,
 * `navigation.traverseTo()` and the browser's own back/forward UI; `user`: a
 * user action that has not happened yet (choosing it runs it — a user traversal
 * then joins `traverse`).
 */
export interface Task {
  source: 'dom' | 'traverse' | 'user'
  label: string
  run: () => void
}

/** Every traversal, in the order the queue ran it. */
export interface Landing {
  by: 'router' | 'user'
  /**
   * The distance it moved. A `history.go` that lapsed reports the distance it
   * asked for; a `traverseTo` that lapsed or found nothing to do reports `0`.
   */
  delta: number
  /** The URL it landed on, `null` when it lapsed, was cancelled or did nothing. */
  url: string | null
  /** The position it landed on, or `null`. */
  to: number | null
  /** When it joined the traversal queue, and when the queue ran it. */
  queuedAt: number
  ranAt: number
  /** The stack it ran against: the position it left, and the entry count. */
  from: number
  size: number
}

export interface SessionHistoryOptions {
  /** Which part of the URL the router addresses; `history` never fires `hashchange`. */
  mode?: 'hash' | 'history'
  /** Give the env a Navigation API (see the header). */
  navigation?: boolean
}

export type SessionHistory = ReturnType<typeof sessionHistory>

export function sessionHistory(initialUrl: string, options: SessionHistoryOptions = {}) {
  const mode = options.mode ?? 'hash'
  let nextKey = 0
  const mintKey = (): string => `key-${nextKey++}`
  const entries: Entry[] = [
    mode === 'hash'
      ? { path: '/', hash: initialUrl, state: null, key: mintKey() }
      : { path: initialUrl, hash: '', state: null, key: mintKey() },
  ]
  let index = 0
  const queues: Record<Task['source'], Task[]> = { dom: [], traverse: [], user: [] }
  const landings: Landing[] = []
  let clock = 0
  /** The URL the router addresses in this mode, for the entry showing. */
  const urlAt = (): string => (mode === 'hash' ? entries[index]!.hash : entries[index]!.path)

  // Listeners are CALLED the way a DOM listener is, with what the event
  // carries — a `hashchange` its `newURL` fragment. The router's contract takes
  // nothing and must not depend on it; delivering it anyway keeps this model
  // faithful to an adapter that registers the handler as the DOM listener.
  const listeners: Array<{
    event: 'popstate' | 'hashchange'
    handler: (newHash?: string) => void
  }> = []
  const navigateListeners: Array<(event: RouterNavigateEvent) => void> = []
  const observed: string[] = []

  const fire = (event: 'popstate' | 'hashchange', newHash?: string): void => {
    observed.push(event)
    for (const entry of [...listeners]) {
      if (entry.event === event) entry.handler(newHash)
    }
  }

  const fireNavigate = (event: RouterNavigateEvent): void => {
    if (!options.navigation) return
    observed.push(`navigate:${event.navigationType}`)
    for (const handler of [...navigateListeners]) handler(event)
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

  /** Move to `target` as a traversal: announce, move, apply. */
  let cancelNext = false
  /** Move to `target` as a traversal; `false` when a listener cancelled it. */
  const traverseTo = (target: number, info: unknown): boolean => {
    fireNavigate({ navigationType: 'traverse', destinationKey: entries[target]!.key, info })
    if (cancelNext) {
      cancelNext = false
      return false
    }
    const oldHash = entries[index]!.hash
    index = target
    applyStep(oldHash)
    return true
  }

  /** What every landing records about the moment the queue ran it. */
  const ran = (by: Landing['by'], queuedAt: number, delta: number) => ({
    by,
    delta,
    queuedAt,
    ranAt: clock++,
    from: index,
    size: entries.length,
  })

  /** A `history.go(delta)` — relative, resolved when the queue runs it. */
  const relativeTraversal = (by: 'router' | 'user', delta: number): Task => {
    const queuedAt = clock++
    return {
      source: 'traverse',
      label: `${by} go(${delta})`,
      run: () => {
        const run = ran(by, queuedAt, delta)
        const target = index + delta
        // Out of range: the spec aborts the traversal and fires NOTHING.
        if (target < 0 || target >= entries.length) {
          landings.push({ ...run, url: null, to: null })
          return
        }
        const moved = traverseTo(target, undefined)
        landings.push({ ...run, url: moved ? urlAt() : null, to: moved ? index : null })
      },
    }
  }

  /** Keys with a `traverseTo` still queued: the spec's upcoming-traverse trackers. */
  const upcoming = new Set<string>()

  /** A `navigation.traverseTo(key)` — absolute, re-resolved when the queue runs it. */
  const keyedTraversal = (key: string, info: unknown): Task => {
    const queuedAt = clock++
    upcoming.add(key)
    return {
      source: 'traverse',
      label: `router traverseTo(${key})`,
      run: () => {
        upcoming.delete(key)
        const target = entries.findIndex((entry) => entry.key === key)
        // Removed since it was called (a push from below truncated it): the
        // traversal is aborted and fires nothing. Already there: nothing moves.
        if (target === -1 || target === index) {
          landings.push({ ...ran('router', queuedAt, 0), url: null, to: null })
          return
        }
        const run = ran('router', queuedAt, target - index)
        const moved = traverseTo(target, info)
        landings.push({ ...run, url: moved ? urlAt() : null, to: moved ? index : null })
      },
    }
  }

  const applyUrl = (url: string, current: Entry): Pick<Entry, 'path' | 'hash'> =>
    url.startsWith('#')
      ? { path: current.path, hash: url }
      : { path: url.split('#')[0]!, hash: url.includes('#') ? url.slice(url.indexOf('#')) : '' }

  const navigation: RouterNavigation = {
    get currentKey() {
      return entries[index]!.key
    },
    traverseTo(key, info) {
      // Resolved at CALL time first: an unknown key is an immediate
      // `InvalidStateError`, the current entry's an immediate success — neither
      // queues anything.
      const target = entries.findIndex((entry) => entry.key === key)
      if (target === -1 || target === index) return
      if (upcoming.has(key)) return
      queues.traverse.push(keyedTraversal(key, info))
    },
    onNavigate(handler) {
      navigateListeners.push(handler)
      return () => {
        navigateListeners.splice(navigateListeners.indexOf(handler), 1)
      }
    },
  }

  /** Create an entry above the current one, truncating everything above it. */
  const push = (entry: Omit<Entry, 'key'>): void => {
    entries.splice(index + 1)
    entries.push({ ...entry, key: mintKey() })
    index++
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
      fireNavigate({ navigationType: 'push', destinationKey: null, info: undefined })
      push({ path: current.path, hash: next, state: null })
      applyStep(current.hash)
    },
    pushState(state, url) {
      const current = entries[index]!
      fireNavigate({ navigationType: 'push', destinationKey: null, info: undefined })
      push({ ...applyUrl(url, current), state })
    },
    replaceState(state, url) {
      const current = entries[index]!
      fireNavigate({ navigationType: 'replace', destinationKey: null, info: undefined })
      entries[index] = {
        ...(url === undefined ? current : applyUrl(url, current)),
        state,
        key: current.key,
      }
    },
    back() {
      this.go(-1)
    },
    forward() {
      this.go(1)
    },
    go(delta) {
      queues.traverse.push(relativeTraversal('router', delta))
    },
    scrollTo() {},
    onUrlChange(event, handler) {
      const entry = { event, handler }
      listeners.push(entry)
      return () => {
        listeners.splice(listeners.indexOf(entry), 1)
      }
    },
    ...(options.navigation ? { navigation } : {}),
  }

  return {
    env,
    observed,
    landings,
    /** The entry showing: its position in the stack and its URL. */
    at: () => ({ index, url: urlAt(), size: entries.length }),
    /** Every entry's URL, bottom first. */
    urls: () => entries.map((entry) => (mode === 'hash' ? entry.hash : entry.path)),
    /** How many listeners are subscribed, of each kind — for leak checks. */
    subscriptions: () => ({ url: listeners.length, navigate: navigateListeners.length }),
    /** A tick of the clock `landings` are stamped with, for ordering other actions. */
    now: () => clock++,
    marker: () => (entries[index]!.state as Record<string, unknown> | null)?.['marker'],
    mark(value: string) {
      const current = entries[index]!
      entries[index] = { ...current, state: { ...(current.state as object), marker: value } }
    },
    /**
     * A `history.pushState` the router never sees — analytics, an embedded
     * widget, another framework. It fires no `popstate`; with the Navigation API
     * it fires a `navigate` ('push') like any push.
     */
    foreignPush(url: string, state: unknown = { foreign: true }): void {
      env.pushState(state, url)
    },
    /**
     * A fragment the user TYPES into the address bar: a new entry carrying no
     * state, announced like any fragment navigation. Hash mode only.
     */
    typeFragment(fragment: string): void {
      env.setHash(fragment)
    },
    /**
     * Another `navigate` listener will `preventDefault()` the next traversal
     * that is about to move the browser, whoever issued it.
     */
    cancelNextTraversal(): void {
      cancelNext = true
    },
    /** A user traversal (back button, long-press menu) that is queued NOW. */
    userGo(delta: number): void {
      queues.traverse.push(relativeTraversal('user', delta))
    },
    /**
     * A user traversal that is still to come: the scheduler decides when it
     * joins the traversal queue, so it is explored before, between and after
     * every traversal the router issues.
     */
    userGoLater(delta: number): void {
      this.later(`user presses go(${delta})`, () =>
        queues.traverse.push(relativeTraversal('user', delta)),
      )
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
        if (!this.step(choose)) return
      }
    },
    /** Run ONE queued task (`choose` picks the source); `false` when none is queued. */
    step(choose: (ready: Task[]) => number = () => 0): boolean {
      const ready = [queues.traverse[0], queues.dom[0], queues.user[0]].filter(
        (t): t is Task => t !== undefined,
      )
      if (ready.length === 0) return false
      const task = ready[ready.length === 1 ? 0 : choose(ready)]!
      queues[task.source].shift()
      task.run()
      return true
    },
  }
}
