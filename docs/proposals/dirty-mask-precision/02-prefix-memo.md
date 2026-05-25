# Cross-Commit Prefix Memoization

**Status:** proposal
**Effort:** 1-2 days
**Ceiling:** ~50% reduction in prefix-walk closure calls; ~0.05ms on
jfb-ticker `narrow×100` (small absolute, but cheap to ship)
**Sequence:** mid — independent of compiler work, can land any time
after `01-compiler-precise-dirty.md`

## The cost being addressed

`computeDirtyFromPrefixes` is currently called like:

```ts
const precise = computeDirtyFromPrefixes(prefixes, oldState, newState)
```

It invokes each prefix function **twice** per commit — once on `prev`,
once on `next`:

```ts
for (let i = 0; i < prefixes.length; i++) {
  if (prefixes[i]!(prev) !== prefixes[i]!(next)) dirty |= 1 << i
}
```

For a 35-prefix component this is 70 closure calls per commit.

But: across consecutive commits, this commit's `next` is the next
commit's `prev`. The 35 closure invocations on `next` could be cached
and reused as the 35 `prev` invocations on the following commit. Cuts
total calls per commit from 70 to 35.

## The fix

Cache the most-recent `prefixes[i](next)` result on the
`ComponentInstance`:

```ts
interface ComponentInstance {
  // existing fields...
  _prefixCache?: unknown[] // cached values from last commit's `next`
  _prefixCacheGen?: number // matches a generation counter to detect staleness
}

function computeDirtyFromPrefixesMemoized(
  prefixes: ReadonlyArray<(s: unknown) => unknown>,
  prev: unknown,
  next: unknown,
  inst: ComponentInstance,
): number | [number, number] {
  const cached = inst._prefixCache // values for `prev` if cache is hot
  const fresh = new Array(prefixes.length)

  let dirty = 0
  for (let i = 0; i < prefixes.length; i++) {
    const prevVal = cached ? cached[i] : prefixes[i]!(prev)
    const nextVal = prefixes[i]!(next)
    fresh[i] = nextVal
    if (prevVal !== nextVal) dirty |= 1 << i
  }
  inst._prefixCache = fresh
  return dirty // (lo/hi pair handling omitted for brevity)
}
```

## Why this works

LLui's `processMessages` runs strictly in commit order. Between
consecutive commits, no other code calls `prefixes[i]` against the
state. The cache stays valid until the next commit's `update()` returns.

Cache invalidation triggers:

- Dev-mode state replacement via `_devReplaceState` (rare; bump cache
  gen)
- `mountApp` re-mount (new instance, new cache)
- `dispose` (cache GC'd with instance)

No other cases require invalidation. The contract is: cached values
correspond to `inst.state` at the moment of caching. Any operation
that mutates `inst.state` outside the normal commit path must bump the
generation counter.

## Measurement

For jfb-ticker (35 prefixes, ~30ns/closure call):

- Before: 70 calls × 30ns = 2100ns/commit
- After: 35 calls × 30ns = 1050ns/commit
- Savings: ~1μs/commit

For `narrow×100`: 100 commits × 1μs = 0.1ms saved. From current 1.8ms
to ~1.7ms.

For `burst-1k`: 1000 × 1μs = 1ms saved. From current 14.9ms to ~13.9ms.

Modest in absolute terms, but cheap to implement and zero risk if
invalidation is handled correctly.

## Risks

- **Stale cache producing wrong dirty mask.** Mitigated by tying the
  cache to the instance and bumping the gen on any non-commit-path
  state mutation. The runtime currently has 1 such path
  (`_devReplaceState`); audit for others when implementing.
- **Memory overhead.** One `Array<unknown>` per component instance,
  length = `prefixes.length`. For Ticker: 35 references = ~280 bytes
  per instance. Negligible.
- **Initial commit penalty.** First commit pays full 70 calls (no cache
  yet). Same as today. Subsequent commits halve the work.

## Implementation milestones

1. Add `_prefixCache` field to `ComponentInstance` (`update-loop.ts`).
2. New function `computeDirtyFromPrefixesMemoized` that reads/writes
   the cache.
3. Call from `_handleMsg` instead of `computeDirtyFromPrefixes`.
4. Wire `_devReplaceState` to invalidate (`inst._prefixCache = undefined`).
5. Re-run jfb-ticker + jfb keyed benches to confirm no regressions and
   the predicted ~5-6% drop on burst-1k.
