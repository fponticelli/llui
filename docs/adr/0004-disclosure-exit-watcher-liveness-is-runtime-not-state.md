---
status: accepted
---

# Disclosure exit-watcher liveness is runtime state, never domain state

Accordion/collapsible's animated exit ("closing" retention until an
`exitCompletion` watcher settles it) must never hang if a consumer forgets
to place `parts.exitCompletion`. Getting the fail-safe mechanism right took
three attempts; this records why the first two were rejected, so nobody
re-derives them.

## Decision

Whether an `exitCompletion` part is CURRENTLY mounted is a fact about the
running view tree, not domain state — it can never correctly live in
`AccordionState`/`CollapsibleState`, however it is encoded. It lives instead
in a module-level runtime registry (`EXIT_WATCHER_COUNTS`, a `Map<string,
number>` in `packages/components/src/internal/disclosure-motion.ts`), keyed
by a scope-namespaced `opts.id` (`accordion:${id}` / `collapsible:${id}`),
mutated directly by `exitCompletion`'s own mount/cleanup — never through
`send`, never serialized, never replayed. The only new fact that travels as
a message is a plain `retain?: boolean` field on every closing-capable
message, stamped by `connect()`'s trigger handlers from that registry at
dispatch time. The reducer stays exactly as pure as before
(`animated && msg.retain === true`), and `init()` stays fully deterministic.

A raw `send({ type: 'close', value })` from app/agent code with no `retain`
closes instantly, even with `animated: true` and the part placed —
documented, fail-safe. `parts.close(value)` is the one supported helper for
an animated PROGRAMMATIC close.

## Rejected: a `setTimeout`-armed stall watchdog

The first fix retained `closing` unconditionally whenever `animated: true`
and armed a "has this been closing too long" timer as a backstop. Rejected:
it could never distinguish "genuinely stuck" from "no Web Animations
support" (jsdom has no `getAnimations`, so `completeIfUnanimated` always
reports "unknown," which reads as "still running" and fires the watchdog
falsely), and it needed a disposal/dedupe apparatus to avoid leaking timers
or re-warning.

## Rejected: an idempotent "is anything watching" boolean in state

The second fix pushed the fact into state as `exitWatched`/`exitWatchers`,
driven by `exitWatcherAttach`/`exitWatcherDetach` messages sent by the
watcher's own mount/cleanup. Rejected on three independent grounds, each
fatal alone:

1. A closure-owned mount COUNT keyed by dispatcher identity broke the
   moment two `connect()` calls used two textually-identical but
   referentially DIFFERENT inline dispatcher wrappers (`(msg) =>
send({ type: 'accordion', msg })` written separately at each call site) —
   no `WeakMap` can unify two distinct function objects.
2. The fix for that — a per-JS-realm session token baked into state — made
   `init()` NON-DETERMINISTIC (a fresh random token every call), which
   breaks `replayTrace`/`propertyTest` outright (a recorded trace's
   `expectedState` embeds one realm's token and can never match a replay's
   own) and directly violates the JSON-serializable, pure-`update()` state
   contract.
3. A SAME-REALM restored snapshot — the overwhelmingly common real case, a
   host persisting to `localStorage` and reloading in the same tab session,
   or simply re-mounting from a saved snapshot without a real page reload —
   is not "foreign" under that design at all, so a stale positive count
   baked into a restored slice reads as watched with nothing real attached:
   the exact hang the mechanism exists to prevent, reintroduced one field
   over.

The lesson generalizes: a snapshot of "is a watcher mounted" goes stale the
instant something remounts without a state change, so it can never live in
state correctly, however it is encoded.

## Consequences

- `connect()` warns once per scope-namespaced `id` (`warnMissingExitWatcherOnce`,
  module-level, throttled), synchronously, at dispatch time — no timer.
- Detaching the LAST watcher for an id settles every still-`closing` entry
  immediately, through the ordinary `exitComplete` message — there is no
  dedicated "detach" message.
- A snapshot restored from persistence, bypassing `init()`, carries NOTHING
  watcher-related. An item already `closing` in such a snapshot with no
  watcher ever mounted this session persists until the next real
  interaction on that item — a documented, accepted residual: it never
  hangs permanently, since any ordinary reducer transition on that value
  resolves it.
- See `packages/components/test/components/disclosure-exit-replay.test.ts`
  for the determinism proof, and `disclosure-exit-failsafe.test.ts` for the
  behavioral coverage (restored snapshots, inline dispatcher wrappers,
  shared-id scope separation, double placement, SSR/hydration).
