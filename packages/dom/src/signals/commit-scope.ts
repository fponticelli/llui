// The commit scope — the runtime's reentrancy guard as a SCOPED RESOURCE.
//
// Four code paths in the update loop can reconcile the DOM: the `send` drain, the
// frame flush, a devtools state poke, and the post-mount replay of a commit that
// was owed while `mount` was still null. Every one of them needs the same three
// things, in the same order:
//
//   1. the reentrancy guard SET before the commit — a commit can synchronously
//      re-enter `send` (removing a focused node fires `blur`), and that send must
//      ENQUEUE rather than start a nested drain mid-reconcile, which corrupts the
//      scope tree / turns an in-flight `removeBetween` into a `NotFoundError`;
//   2. the PRIOR guard state restored on the way out, never a blind `= false` — a
//      flush can be called from inside an `onEffect` that is itself running under
//      an active drain, and clearing the flag would leave that outer drain
//      believing it is not draining, so its next send starts a nested drain and
//      double-processes the queue;
//   3. the queue settled afterwards, because (1) means commit-induced messages
//      are still sitting in it.
//
// Those used to be four hand-written copies of the same `prev = draining; …
// finally { draining = prev }` block in `component.ts`, correct only by review —
// each of them a bug at some point (issue #59).
//
// Here the machinery is MODULE-PRIVATE. `drain`, the commit decision and the
// guard flags are not exported, are not on the returned object, and are not in
// `component.ts`'s lexical scope. The only way to reach them is a
// {@link CommitToken}, and the only source of a token is `withCommitScope`, whose
// `finally` restores the guard. A caller holding no token cannot commit; a caller
// that stashed one cannot use it later (`settle` refuses outside an open scope).
// The guarantee is the enclosure, exactly as in `@llui/test`'s
// `withTimerTracking` / `withCapturedConsoleErrors` / `withMountedRun` nesting:
// there is no place left to write a commit that a guard can be skipped past.
//
// What this does NOT make impossible: a host callback is still ordinary code
// running inside the scope, so `reduce`/`commit` can do anything they like. The
// token constrains WHERE a commit can happen, not what one does.
//
// This is a relocation of the guard, not a redesign of the schedule. The
// OBSERVABLE schedule — which state frames subscribers see, and when each
// message's effects are dispatched — is what the four hand-written blocks
// produced, on the normal path AND on the throw path: issue #59 puts the effect
// dispatch order (commit, then effects) explicitly out of scope, a devtools/agent
// state frame is part of that contract too, and an exception escaping a round
// still DROPS that round's collected effects rather than firing them against a
// half-reconciled DOM. So the scope modes below reproduce each path's ordering
// rather than unifying them into one, and `drain` dispatches from inside its
// `try` rather than its `finally`.
// `test/signals/issue-59-reentrant-effect-buffer.test.ts` pins the whole nested
// trace; `test/signals/scheduler-throw-path.test.ts` pins the two throw traces.
//
// The ONE difference, and it commits nothing and notifies nobody: under `raf`, a
// send that leaves state unchanged no longer schedules a frame. The pre-refactor
// `drain` scheduled one unconditionally; routing the devtools poke and the
// post-mount replay through this same loop means a round can now reach the
// scheduling branch with nothing owed, and a frame that would commit nothing is
// pure waste (see the `pendingCommit` guard in `drain`). Only a test spying
// `requestAnimationFrame` can tell.

import { LluiFrameworkError } from './framework-error.js'

/**
 * The half of the update loop that belongs to the component: the reducer, the
 * reconcile, the effect dispatch, and the liveness answer. The scheduler owns
 * WHEN these run; the host owns WHAT they do.
 *
 * `F` is the host's effect-frame token — opaque here on purpose (see
 * {@link CommitHost.beginEffects}).
 */
export interface CommitHost<M, F> {
  /**
   * Run the pure reducer for one message and apply its result. Effects are
   * COLLECTED into the open effect frame, not dispatched — the loop releases them
   * after the commit, so the historical "reconcile, then effect" order holds at
   * settle granularity. Returns whether state MOVED (a commit is owed).
   */
  reduce(msg: M): boolean
  /**
   * Reconcile the DOM and notify subscribers against the current state. Returns
   * `false` when the mount is not live yet — during `mountSignal` an `onMount`
   * callback can send, and committing to a null mount would silently swallow the
   * reconcile. The scheduler clears its pending-commit flag ONLY on a commit that
   * actually landed, so an early state change stays owed for the post-mount
   * replay; the host cannot forget to leave the flag set, because it does not own
   * the flag.
   */
  commit(): boolean
  /**
   * Open a fresh effect-collection frame and return the one it DISPLACED, which
   * the scheduler holds on its own call stack until the matching
   * {@link CommitHost.endEffects}.
   *
   * Frames must nest, and the scheduler is the only thing that knows where a
   * round begins and ends, so the stack discipline lives here rather than in the
   * host: a settle nested inside a commit (a devtools poke provoked from a
   * subscriber) would otherwise dispatch — or, if it reset the buffer, silently
   * DISCARD — the effects the outer round had collected but not yet released.
   * State advances, the DOM updates, `onEffect` never fires: the class of bug #57
   * was, and one a competing prototype for this refactor actually shipped past a
   * full green suite. Returning the displaced frame by value keeps the nesting on
   * the call stack, so it costs no allocation on the per-send path.
   */
  beginEffects(): F
  /**
   * Dispatch the open frame's effects. Called from INSIDE the round's `try`, at
   * the point the pre-refactor `drain`'s plain `for (…) runEffect(e)` statement
   * stood — see the note in `drain` on why an aborting round must not reach here.
   */
  dispatchEffects(): void
  /**
   * Close the open frame — discarding anything still in it — and make `prev`
   * current again. Called from the round's `finally`, so it runs on the throw and
   * disposed-bail paths as well as the normal one.
   */
  endEffects(prev: F): void
  /** Torn down — the drain abandons its queue and no frame is scheduled. */
  isDisposed(): boolean
}

/**
 * Capability to run the commit machinery. Valid ONLY for the dynamic extent of
 * the `withCommitScope` body it was handed to; the combinator's `finally` is what
 * releases it. Stashing one and calling it later throws.
 */
export interface CommitToken {
  /**
   * Drive the queue to quiescence: run every queued reducer, commit once (subject
   * to the batch/scheduling policy), then release that round's effects — looping
   * while the commit or an effect enqueued more.
   */
  settle(): void
}

/**
 * How a scope treats the commit it owes on entry and the batch/frame policy.
 * These are not stylistic variants: each reproduces the ordering one of the four
 * pre-refactor commit paths had, and that ordering is agent/devtools-visible.
 */
export type ScopeMode =
  /** A plain `send` / `batch` exit: reduce first, then let the policy decide —
   * inside a `batch` nothing commits, and under `raf` the commit is a scheduled
   * frame. */
  | 'scheduled'
  /** A devtools state poke or the post-mount replay: state was written OUTSIDE
   * the reducer path, so commit it BEFORE settling the queue. Committing first is
   * what makes the poked state its own observable frame — folding it into the
   * settle instead would notify subscribers only once, with the poke and whatever
   * was already queued already merged, and the agent's state-update stream would
   * lose a frame it saw before this refactor. The settle that follows still obeys
   * the batch/frame policy. */
  | 'immediate'
  /** The frame flush (`onFrame`, `handle.flush()`): `'immediate'`, and in
   * addition every commit inside the scope is synchronous — this scope IS the
   * frame, so commit-induced messages must settle into it rather than cascade
   * into another one. */
  | 'frame'

/** Commit scheduling policy for a mount (mirrors `MountSignalOptions.scheduler`). */
export type CommitMode = 'sync' | 'raf'

/**
 * The public face of the update loop's scheduling half. Every method that can
 * reach a commit opens a scope internally; none of them hands the caller one.
 */
export interface CommitScheduler<M> {
  /** Queue a message and, unless a scope is already open, settle it. */
  dispatch(msg: M): void
  /** Coalesce a burst of `dispatch`es into ONE commit at the outermost exit. */
  batch(fn: () => void): void
  /** Force any owed commit synchronously (`handle.flush()`); a no-op under `sync`,
   * where every send already committed. */
  flushNow(): void
  /** Record a state change made OUTSIDE the reducer path (a devtools poke) and
   * commit it through the normal commit path, so subscribers fire as they would
   * for a real send. */
  pokeCommit(): void
  /** Replay a commit that was owed while `mount` was still null (an `onMount`
   * send). Under `raf` the owed commit is already a scheduled frame, so this only
   * acts in `sync` mode. */
  replayPostMountCommit(): void
  /** Cancel any scheduled frame and abandon the queue (dispose). */
  shutdown(): void
  /**
   * THE extension point for a new commit path. The four methods above are its
   * only current callers; a fifth reason to commit adds itself here and gets the
   * guard, the save/restore and the settle for free, because there is no other
   * way to obtain a {@link CommitToken}. Exposed rather than kept private so that
   * "a new path cannot forget the guard" is a property of the API surface and not
   * of this file's discipline.
   *
   * The guard is set for the WHOLE extent of `body`, so a body that never calls
   * `token.settle()` leaves anything its commit enqueued sitting in the queue: no
   * reducer runs for it until the next `dispatch`, which is a lost turn rather
   * than a lost message. Call `settle()` last unless you mean that.
   */
  withCommitScope(mode: ScopeMode, body: (token: CommitToken) => void): void
}

/**
 * Build the scheduler for one mount. Allocates its token and its single body
 * closure ONCE, here — nothing on the per-send path allocates (see the
 * `settleBody` note below).
 */
export function createCommitScheduler<M, F>(
  host: CommitHost<M, F>,
  commitMode: CommitMode,
): CommitScheduler<M> {
  const queue: M[] = []
  // Guard flags. Private to this module BY CONSTRUCTION — the enclosure is the
  // whole point, so nothing below is exposed on the returned object.
  let draining = false
  let flushing = false
  let scopeDepth = 0
  // While `batchDepth > 0` reducers still run and effects still fire; only the
  // commit is deferred to the outermost `batch` exit.
  let batchDepth = 0
  // State moved since the last commit that LANDED.
  let pendingCommit = false
  // Frame-scheduled mode: at most one frame in flight; every send until it fires
  // coalesces into it.
  let frameScheduled = false
  let rafId: number | null = null

  // Reconcile + notify once, if state moved since the last landed commit.
  function commitNow(): void {
    if (!pendingCommit) return
    // Cleared only on a commit that landed — see CommitHost.commit.
    if (host.commit()) pendingCommit = false
  }

  function scheduleCommit(): void {
    if (frameScheduled || host.isDisposed()) return
    frameScheduled = true
    if (typeof requestAnimationFrame === 'function') {
      rafId = requestAnimationFrame(onFrame)
    } else {
      // Non-browser fallback (SSR / plain jsdom / headless agent): a microtask. It
      // can't be cancelled — `onFrame` no-ops once nothing is pending, so an
      // already-flushed task is harmless.
      queueMicrotask(onFrame)
    }
  }

  // Process the queue to quiescence: run all queued reducers (collecting their
  // effects), commit once, then release the effects after the DOM is live. A
  // commit or an effect may enqueue more (a blur, an effect that sends), so loop.
  //
  // Reachable only through a token — see `settle`.
  function drain(): void {
    do {
      // One effect frame per round, saved and restored exactly like the guard
      // flags: a settle NESTED inside this round's commit gets its own frame and
      // cannot release — or lose — the effects this round has collected. `prev`
      // lives in this stack frame, so nesting allocates nothing.
      const prevEffects = host.beginEffects()
      try {
        while (queue.length > 0) {
          // Disposed mid-drain (a commit-fired blur handler, or an effect above,
          // tore the mount down): stop reducing — advancing state on a dead
          // component and committing to a null mount is wrong.
          if (host.isDisposed()) {
            queue.length = 0
            return
          }
          if (host.reduce(queue.shift() as M)) pendingCommit = true
        }
        if (batchDepth === 0) {
          if (commitMode === 'sync' || flushing) commitNow()
          // `pendingCommit` gates the scheduling too: routing the devtools poke
          // and the post-mount replay through this same loop means a round can
          // reach here with nothing owed (their commit already landed on scope
          // entry), and a frame that would commit nothing is pure waste.
          else if (pendingCommit) scheduleCommit()
        }
        // INSIDE the `try`, exactly where the pre-refactor `drain`'s plain
        // dispatch statement stood, and NOT in the `finally`. An exception
        // escaping this round — a reducer that threw, a binding that threw
        // mid-commit with no error hook — must DROP the effects collected so far,
        // which was free when they were a per-round local and is a decision now
        // that they live in a frame. Firing them on the way out would run
        // `onEffect` against a HALF-RECONCILED DOM, and a `send` from such an
        // effect would enqueue under a still-set guard and then be stranded when
        // the exception unwinds past this loop. `commitToDom`'s #57 note states
        // the stranding as the contract, and both traces are pinned in
        // `test/signals/scheduler-throw-path.test.ts`. The disposed bail-out above
        // `return`s past this for the same reason (and `runEffect` refuses once
        // disposed anyway).
        host.dispatchEffects()
      } finally {
        // Close the frame however this round exited, so the outer round's frame
        // is current again — a nested settle must not leave the enclosing one
        // looking at a frame that is not its own.
        host.endEffects(prevEffects)
      }
    } while (queue.length > 0)
  }

  const token: CommitToken = {
    settle: (): void => {
      if (scopeDepth === 0) {
        // A token that outlived its scope. Capturing one is legal JavaScript, so
        // the enclosure alone cannot stop it; refusing the call is what makes the
        // capture worthless, and turns the one remaining way to commit without a
        // guard into a loud, deterministic throw instead of a scope-tree
        // corruption that surfaces as a `NotFoundError` three frames later.
        throw new LluiFrameworkError(
          '[llui] CommitToken.settle() was called outside its commit scope. A token ' +
            'is valid only for the body it was handed to; commit through the ' +
            'CommitScheduler surface instead.',
        )
      }
      drain()
    },
  }

  // The ONE body every entry point passes to `withCommitScope`. Hoisted to mount
  // scope so the per-send path allocates NOTHING: a fresh `(t) => t.settle()` per
  // dispatch would put 1000 closures on a 1k-send burst, which is exactly the
  // regression issue #59 forbids.
  const settleBody = (t: CommitToken): void => {
    t.settle()
  }

  /**
   * Open a commit scope: set the guard, commit anything already owed if the mode
   * asks for it, hand `body` the token, and restore the PRIOR flags however
   * `body` exits. Save/restore rather than clear — a nested scope (a `flush()`
   * from inside an `onEffect` under an active drain) must leave the outer drain
   * believing it is still draining.
   */
  function withCommitScope(mode: ScopeMode, body: (token: CommitToken) => void): void {
    const prevDraining = draining
    const prevFlushing = flushing
    draining = true
    if (mode === 'frame') flushing = true
    scopeDepth++
    try {
      // Commit-then-settle for the two modes whose caller wrote state outside the
      // reducer path — see ScopeMode. It happens INSIDE the scope, so the guard is
      // set and a `send` this commit provokes still lands in the queue that `body`
      // is about to settle.
      if (mode !== 'scheduled') commitNow()
      body(token)
    } finally {
      scopeDepth--
      draining = prevDraining
      flushing = prevFlushing
    }
  }

  function onFrame(): void {
    frameScheduled = false
    rafId = null
    if (host.isDisposed()) return
    withCommitScope('frame', settleBody)
  }

  function clearFrame(): void {
    if (rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafId)
    }
    rafId = null
    frameScheduled = false
  }

  return {
    dispatch: (msg: M): void => {
      queue.push(msg)
      // A scope is already open: the active drain will pick this up. This is the
      // reentrancy contract — a commit-induced send NEVER starts a nested drain.
      if (draining) return
      withCommitScope('scheduled', settleBody)
    },
    batch: (fn: () => void): void => {
      batchDepth++
      try {
        fn()
      } finally {
        batchDepth--
        // Flush even if `fn` threw: state already advanced, so the DOM must catch
        // up to stay consistent. A batch entered DURING a drain (e.g. from an
        // effect) leaves the commit to that drain's loop.
        if (batchDepth === 0 && !draining) withCommitScope('scheduled', settleBody)
      }
    },
    flushNow: (): void => {
      // sync mode: every send already committed — nothing to flush.
      if (commitMode === 'sync' || host.isDisposed()) return
      clearFrame()
      withCommitScope('frame', settleBody)
    },
    pokeCommit: (): void => {
      pendingCommit = true
      withCommitScope('immediate', settleBody)
    },
    replayPostMountCommit: (): void => {
      if (commitMode !== 'sync' || !pendingCommit) return
      withCommitScope('immediate', settleBody)
    },
    shutdown: (): void => {
      clearFrame()
      // Abandon anything still queued (dispose can be called from inside a drain,
      // e.g. an effect that unmounts): the drain checks `isDisposed` and bails,
      // but clear the queue so nothing is left half-processed.
      queue.length = 0
    },
    withCommitScope,
  }
}
