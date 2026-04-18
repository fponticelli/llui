# Performance Benchmarking Guide

This document defines the complete methodology for benchmarking LLui against other frameworks. It is methodology-focused by design: specific numbers go stale within weeks as engines, compilers, and framework internals change. The methodology is durable.

---

## 1. Methodology

### Infrastructure

Use **Playwright + Chromium headless** exclusively. Do not substitute Puppeteer. Playwright and Puppeteer expose different CDP (Chrome DevTools Protocol) surfaces; Playwright's `page.evaluate`, `page.waitForFunction`, and CDP session APIs behave consistently across versions in ways that matter for low-latency timing. Puppeteer's session management introduces additional round-trips that corrupt sub-millisecond measurements.

Serve the benchmark application from a **localhost static HTTP server** built from a production bundle. Never use Vite's dev server: it injects HMR WebSocket overhead, uses unminified source, and adds module-federation request latency that has nothing to do with the framework's runtime cost. Build first (`vite build`), then serve the `dist/` directory with a plain static server (e.g., `npx serve`, `python -m http.server`, or `npx http-server`).

Apply **4× CPU throttling** via the CDP `Emulation.setCPUThrottlingRate` command. This matches the js-framework-benchmark official methodology and is essential for cross-machine comparability: a developer laptop and a CI server have radically different clock speeds, but a 4× slowdown proportionally exposes algorithmic complexity differences that are invisible on fast hardware. At native speed, a framework with O(n) reconciliation and one with O(n²) reconciliation may differ by only a few milliseconds for n=1000; at 4× throttle the difference is measurable.

```typescript
const cdpSession = await page.context().newCDPSession(page)
await cdpSession.send('Emulation.setCPUThrottlingRate', { rate: 4 })
```

Network is irrelevant after the page loads. Do not simulate network conditions.

Run all measurements in a **fresh browser context per framework**. JavaScript engines share JIT compilation state within a browser context. If you measure React, then LLui, then Solid in the same context, each framework's JIT profile is influenced by the previous framework's hot paths. Use `browser.newContext()` for each framework.

### Warmup Protocol

Warmup serves two distinct purposes that require different throttle states:

1. **JIT compilation warmup** — let V8 identify hot functions and compile them to optimized machine code. This must happen at **1× throttle** (unthrottled). When warmup runs at 4× throttle, V8's profiler sees execution times that suggest code is "not hot enough" to warrant compilation — the profiler uses execution time budgets, not call counts alone. The result is that measured runs execute interpreted or baseline-compiled code, inflating all timings.

2. **State reset** — each warmup iteration must execute the same prerequisite operations as the measured runs. If measured runs begin with a `clear` operation, warmup must also execute `clear`. Skipping prerequisites in warmup means the JIT never compiles the clear-then-create path, so the first measured run pays compilation cost.

```typescript
const N_WARMUP = 5 // iterations at 1× throttle
const N_RUNS = 10 // iterations at 4× throttle for measurement
```

Five warmup iterations is sufficient for V8 to tier up to TurboFan for hot functions. Ten measurement runs gives adequate sample size for min/stdev statistics without excessive runtime. Do not reduce N_RUNS below 10; a sample size of 5 is statistically meaningless for stable min/stdev statistics.

After all warmup iterations complete, apply 4× throttle, then begin the measurement loop.

### Timing Protocol

All timing is **browser-side** using `performance.now()`. Do not measure from Playwright's perspective — the CDP round-trip from `page.evaluate()` to the returned result adds 2–8ms of IPC overhead that has nothing to do with framework work.

The timing window closes inside a **double requestAnimationFrame** callback:

```typescript
// Inside the benchmark application, after triggering the operation:
const t0 = performance.now()
triggerOperation()
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    window.__benchDuration = performance.now() - t0
    window.__benchDone = true
  })
})
```

The double-rAF pattern is mandatory. A single rAF fires before the browser has committed the layout and paint triggered by the DOM mutations. A double-rAF guarantees the browser has processed the style recalculation and layout pass that follows the mutation. Measuring before layout completes gives times that are unrealistically fast — the browser has deferred work to the next frame.

Signal completion with `window.__benchDone = true`. Poll for it via Playwright's `waitForFunction`:

```typescript
await page.waitForFunction(() => window.__benchDone === true)
const duration = await page.evaluate(() => window.__benchDuration as number)
await page.evaluate(() => {
  window.__benchDone = false
})
```

Reset `window.__benchDone = false` after reading the result, not before. Resetting before reading creates a race condition where a subsequent operation could overwrite `__benchDuration` before you read it.

### Memory Protocol

Memory measurement uses the CDP `Performance.getMetrics` API, which reports `JSHeapUsedSize` — the number of bytes currently in use on the V8 heap after compaction.

Before measuring memory, trigger garbage collection explicitly via CDP and wait for it to complete:

```typescript
await cdpSession.send('HeapProfiler.collectGarbage')
await page.waitForTimeout(200) // allow GC to finish
const metrics = await cdpSession.send('Performance.getMetrics')
const jsHeapUsedSize = metrics.metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0
```

The 200ms wait is not arbitrary polling — GC is an asynchronous operation in V8's incremental collector. Without the wait, `Performance.getMetrics` can return a value that reflects an in-progress collection where some unreachable objects are still counted. The 200ms window is conservative; in practice V8 finishes a forced minor + major GC within 50–100ms even at 4× throttle, but the extra headroom is cheap.

**Report both total heap and per-row marginal cost.** Total `JSHeapUsedSize` with 1000 rows includes baseline framework overhead (runtime, compiled modules, application shell) that is fixed regardless of row count. The per-row marginal cost is the more actionable figure for predicting how a framework scales with data size.

To measure per-row marginal cost, use a **warm-empty baseline** protocol that eliminates module initialization noise:

```typescript
// Step 1: Warm baseline — create rows, clear, GC, measure empty heap
await triggerRun() // create 1000 rows (warms up allocation paths)
await triggerClear() // clear all rows
await cdpSession.send('HeapProfiler.collectGarbage')
await page.waitForTimeout(200)
const emptyHeap = getJSHeapUsedSize(await cdpSession.send('Performance.getMetrics'))

// Step 2: Measure with N rows
await triggerRun() // create 1000 rows again
await cdpSession.send('HeapProfiler.collectGarbage')
await page.waitForTimeout(200)
const fullHeap = getJSHeapUsedSize(await cdpSession.send('Performance.getMetrics'))

const perRowBytes = (fullHeap - emptyHeap) / 1000
```

The warm-empty baseline (create→clear→GC→measure, then create→GC→measure) ensures both measurements share the same module initialization state, JIT compilation artifacts, and V8 internal bookkeeping. The delta isolates per-row allocation cost.

Report memory as:

| Metric               | Value   | Notes                                                  |
| -------------------- | ------- | ------------------------------------------------------ |
| Total heap (1k rows) | X kB    | Absolute cost including framework baseline             |
| Empty heap (warmed)  | Y kB    | Framework baseline after create+clear cycle            |
| Per-row marginal     | Z bytes | `(total - empty) / 1000` — the scaling-relevant number |

---

## 2. What to Measure and Why

The following operations form the benchmark suite. They are derived from the js-framework-benchmark (krausest) suite with extensions specific to append-heavy patterns.

| id           | label                           | prerequisite                         | rationale                                                                                                                                                                                                   |
| ------------ | ------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run`        | Create 1k rows                  | `clear`                              | Tests `each()` full initial reconciliation. Must `clear` first — see Keyed Reuse Inflation in §5.                                                                                                           |
| `replace`    | Replace 1k rows                 | `run`                                | Tests full teardown + rebuild. A framework that is fast at create but slow at replace has an expensive clear-or-key path.                                                                                   |
| `update`     | Update every 10th row           | `run` active                         | Tests the binding update hot path. Every 10th row label changes — 100 DOM writes out of 1000 rows. This is the most representative real-world workload: changes arrive incrementally to existing state.     |
| `select`     | Select one row                  | `run` active                         | Tests targeted class toggle. A single `.selected` class changes on one row. Measures how cheaply a framework can handle a change that affects a tiny fraction of the tree.                                  |
| `swap`       | Swap rows 1 ↔ 998               | `run` active                         | Tests the reconciliation algorithm's ability to detect a transposition without rebuilding the entire list. A framework that re-renders all 1000 rows on a 2-element swap has a broken key strategy.         |
| `remove`     | Remove one row                  | `run` active                         | Tests single-item scope disposal + DOM removal. The remaining 999 rows must be untouched.                                                                                                                   |
| `runlots`    | Create 10k rows                 | `clear`                              | Tests `each()` at scale. Exposes O(n²) algorithms that are hidden at 1k.                                                                                                                                    |
| `add`        | Append 1k to 1k                 | `run` active                         | Tests incremental append: 1k existing rows, add 1k more. A framework that reconciles from scratch on every array change will be 2× slower here than on `run`.                                               |
| `clear`      | Clear all rows                  | `run` active                         | Tests bulk scope disposal + bulk DOM removal. `textContent = ''` on the container is the canonical fast path; a framework that disposes scopes one by one will be proportionally slower.                    |
| `transition` | Swap 2 rows with `onTransition` | `run` active, `onTransition` enabled | Tests the cost of transition setup — FLIP position capture, rect reads, callback scheduling — not animation duration. Measures to rAF, not to `transitionend`. Reported separately from the geometric mean. |

**Why these operations matter:** `update` is the operation that dominates real applications. Users rarely create 1000 rows — they see incremental state changes. `run` and `clear` matter because they bound the cost of mounting and unmounting components. `swap` is a canary for reconciliation algorithm quality. `select` is a canary for false-positive binding evaluation: a framework that re-evaluates all row bindings on a selection change has a dirty-tracking failure. `transition` isolates the framework's overhead for setting up coordinated animations — it measures the synchronous bookkeeping cost that the framework pays before the browser begins the animation, ensuring that FLIP-style patterns do not introduce hidden latency.

Operations not in this list — for example, toggling visibility of a subtree, updating deeply nested state — are application-specific and should be added in separate benchmark configurations, not mixed into the core suite.

### Transition Benchmark Details

The `transition` benchmark requires special treatment because it measures setup cost, not animation duration. The timing window captures the work from operation trigger to the first rAF — the point at which the browser has all the information it needs to begin the animation. Animation duration (the 300ms CSS transition, the FLIP interpolation) is explicitly excluded.

```typescript
// Transition benchmark timing:
const t0 = performance.now()
triggerSwapWithTransition()
requestAnimationFrame(() => {
  // Single rAF — capture cost of FLIP rect reads + callback scheduling
  window.__benchDuration = performance.now() - t0
  window.__benchDone = true
})
```

Note the single-rAF pattern here, unlike the double-rAF used for mutation benchmarks. The transition benchmark measures the synchronous work (position capture, `getComputedStyle` reads, callback registration) that precedes the animation. The double-rAF would include the first frame of the animation itself, which varies with CSS transition configuration and is not framework cost.

The `transition` result is reported in its own column, separate from the geometric mean. Frameworks that do not support coordinated transitions report N/A.

---

## 3. The Benchmark Application Specification

### Window Contract

The benchmark application must expose the following on `window` before any measurement begins:

```typescript
declare global {
  interface Window {
    __benchReady: boolean // set to true after mount
    __benchDone: boolean // set to true inside double-rAF after each op
    __benchDuration: number // ms, set alongside __benchDone
  }
}
```

The harness waits for `window.__benchReady === true` before issuing any operations. All mutation operations set `__benchDone` inside the double-rAF pattern described in §1. The `transition` benchmark uses a single-rAF pattern instead (see §2 Transition Benchmark Details). `__benchDuration` is the time from `performance.now()` at operation start to `performance.now()` inside the double-rAF.

### Button IDs

The harness triggers operations by clicking buttons identified by these exact `id` attributes:

- `#run` — create 1000 rows
- `#replace` — replace 1000 rows (runs `run` over existing 1000 rows)
- `#update` — update every 10th row label
- `#swap` — swap rows at index 1 and 998
- `#runlots` — create 10000 rows
- `#add` — append 1000 rows to existing rows
- `#clear` — clear all rows
- `#remove` — remove the first row (click triggers `.remove` button inside first `tr`)

For `select`, the harness clicks `.lbl` in the first `tr` directly rather than a named button.

### Table Structure

The table must use a `<tbody>` containing `<tr>` elements directly. The harness verifies row count with:

```typescript
const rowCount = await page.evaluate(() => document.querySelectorAll('tbody tr').length)
```

This is the authoritative row count. If the framework renders into a shadow DOM, virtualized container, or non-`tbody` structure, the harness cannot validate correctness. The `tbody` requirement is non-negotiable for cross-framework comparability.

Each row must have the following structure:

```html
<tr class="">
  <!-- class="selected" when selected -->
  <td class="col-md-1">{ id }</td>
  <td class="col-md-4"><a class="lbl">{ label }</a></td>
  <td class="col-md-1">
    <a class="remove"><span class="glyphicon glyphicon-remove"></span></a>
  </td>
  <td class="col-md-6"></td>
</tr>
```

The `.lbl` anchor must be clickable to select the row. The `.remove` anchor must remove the row.

### Row Data Model

```typescript
type Row = { id: number; label: string; selected: boolean }
```

**IDs must increment globally and never reset.** A module-level counter is correct:

```typescript
let nextId = 1
function createRow(): Row {
  return { id: nextId++, label: buildLabel(), selected: false }
}
```

If `nextId` resets to 1 on each `run` call, keyed frameworks reuse existing DOM nodes instead of creating new ones. See §5 (Keyed Reuse Inflation) for the precise failure mode.

**Labels** are generated from three fixed word lists — adjective, colour, noun — by picking one word from each at random and joining with spaces. The word lists must be identical across all framework implementations so that label string lengths and character distributions are comparable. Embed the word lists in a shared `SPEC.ts` constant:

```typescript
export const ADJECTIVES = [
  'pretty',
  'large',
  'big',
  'small',
  'tall',
  'short',
  'long',
  'handsome',
  'plain',
  'quaint',
  'clean',
  'elegant',
  'easy',
  'angry',
  'crazy',
  'helpful',
  'mushy',
  'odd',
  'unsightly',
  'adorable',
  'important',
  'inexpensive',
  'cheap',
  'expensive',
  'fancy',
]
export const COLOURS = [
  'red',
  'yellow',
  'blue',
  'green',
  'pink',
  'brown',
  'purple',
  'grey',
  'white',
  'black',
  'orange',
]
export const NOUNS = [
  'table',
  'chair',
  'house',
  'bbq',
  'desk',
  'car',
  'pony',
  'cookie',
  'sandwich',
  'burger',
  'pizza',
  'mouse',
  'keyboard',
]

export function buildLabel(): string {
  const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]
  return `${pick(ADJECTIVES)} ${pick(COLOURS)} ${pick(NOUNS)}`
}
```

### DOM Sanity Check

After every operation the harness must assert that the row count matches expectations:

```typescript
async function assertRowCount(page: Page, expected: number, op: string): Promise<void> {
  const actual = await page.evaluate(() => document.querySelectorAll('tbody tr').length)
  if (actual !== expected) {
    throw new Error(`[${op}] expected ${expected} rows, got ${actual}`)
  }
}
```

A benchmark run that does not verify row counts is not a benchmark — it is a timing of how fast a framework can fail silently. A framework that renders 0 rows after `run` will show an impressively fast `run` time.

---

## 4. Statistical Treatment

### Per-Run Summary

For each operation collect N_RUNS timing samples. Compute:

- **mean** — `samples.reduce((a, b) => a + b, 0) / samples.length`
- **stdev** — sample standard deviation of the measurement runs (divide by N−1, not N)
- **min** — `Math.min(...samples)`

**The minimum is the most meaningful statistic for JIT-compiled code.** In a warmed JIT environment, the minimum represents the cost of the operation when V8 is in its optimized steady state — all hot functions compiled, all inline caches primed, all feedback vectors saturated. Higher samples represent GC pauses, OS scheduler preemption, or background JIT recompilation. Reporting the mean without the min conflates these sources of variance with the framework's actual cost. Reporting only the mean gives a pessimistic picture of what the framework can achieve.

Report all three. The stdev is a quality indicator: stdev/mean > 0.15 (15% coefficient of variation) indicates the measurement environment is noisy and results should be treated with skepticism. Increase N_RUNS, close background applications, or re-run the suite.

### Skipping Unstable Early Runs

If stdev is high, check whether the first 2 measured runs are outliers. A common pattern is: runs 1–2 are 30–50% slower than runs 3–10, then the distribution stabilizes. This indicates JIT warmup is still occurring in the early measured runs — N_WARMUP was insufficient. The correct fix is to increase N_WARMUP, not to drop outliers post-hoc. However, if increasing N_WARMUP is not feasible (e.g., the operation is irreversible within the benchmark app's state machine), dropping the first 2 runs from statistics is acceptable provided it is documented explicitly.

### Cross-Operation Aggregation

Report **two** geometric means: an **unweighted** geometric mean for cross-framework comparison, and a **weighted "interactive profile"** score that reflects real-world operation frequency.

#### Unweighted Geometric Mean

The unweighted geometric mean treats all operations equally. It is the standard aggregation for cross-framework comparison because it does not embed application-specific assumptions. Exclude operations where the vanilla (baseline) mean is below 0.5ms — these are in the noise floor of `performance.now()` precision.

```typescript
function geoMean(values: number[]): number {
  const logSum = values.reduce((acc, v) => acc + Math.log(v), 0)
  return Math.exp(logSum / values.length)
}

// Unweighted: all valid operations contribute equally
const validOps = ops.filter((op) => baseline[op].mean > 0.5)
const unweightedGeoMean = geoMean(validOps.map((op) => llui[op].mean))
```

The geometric mean is the correct aggregation when comparing ratios across heterogeneous magnitudes (some operations take 5ms, others take 200ms). The arithmetic mean would be dominated by `runlots`. The geometric mean weights each operation's _relative_ contribution equally.

#### Weighted "Interactive Profile" Score

The weighted score reflects the frequency distribution of operations in a typical interactive application. The weights are:

| Operation | Weight | Rationale                                                                            |
| --------- | ------ | ------------------------------------------------------------------------------------ |
| `update`  | 40%    | Dominates real-world workloads: incremental state changes on every user interaction. |
| `select`  | 25%    | Every click, hover, or focus change triggers a targeted class/attribute toggle.      |
| `swap`    | 10%    | Drag-to-reorder, sort-by-column, and list manipulation.                              |
| `run`     | 10%    | Initial page load, route transitions that mount a new list.                          |
| `add`     | 5%     | Infinite scroll, paginated loading, adding items to a list.                          |
| `remove`  | 5%     | Deleting items, filtering, closing tabs.                                             |
| `clear`   | 5%     | Route transitions that unmount a list, reset-to-empty patterns.                      |

`runlots`, `replace`, and `transition` are excluded from the weighted score. `runlots` is a scaling diagnostic (see below). `replace` is a synthetic worst-case. `transition` is reported separately.

```typescript
const INTERACTIVE_WEIGHTS: Record<string, number> = {
  update: 0.4,
  select: 0.25,
  swap: 0.1,
  run: 0.1,
  add: 0.05,
  remove: 0.05,
  clear: 0.05,
}

function weightedGeoMean(
  results: Record<string, { mean: number }>,
  weights: Record<string, number>,
): number {
  let logSum = 0
  let weightSum = 0
  for (const [op, w] of Object.entries(weights)) {
    if (results[op] && results[op].mean > 0.5) {
      logSum += w * Math.log(results[op].mean)
      weightSum += w
    }
  }
  return Math.exp(logSum / weightSum)
}
```

The weighted geometric mean is `exp(Σ wᵢ·ln(tᵢ) / Σ wᵢ)`. It preserves the geometric mean's property of equal sensitivity to proportional changes while prioritizing operations that matter most in production.

**Report both numbers.** The unweighted mean is the apples-to-apples cross-framework comparison. The weighted mean answers "how will this framework feel to a user?" — it is the number that matters for product decisions.

### Scaling Diagnostic: 1k Headline, 10k Diagnostic

The **1k `run`** operation is the headline create benchmark. The **10k `runlots`** is a scaling diagnostic, not a primary metric. Report both, plus a **scaling factor** column:

```
scaling_factor = time_10k / time_1k
```

A scaling factor of 10.0 indicates perfect O(n) behavior. A factor significantly above 10 (e.g., 12–15) indicates superlinear complexity — O(n log n) reconciliation or O(n) DOM allocation with GC pressure at scale. A factor below 10 indicates amortized setup costs that are proportionally cheaper at larger N (unlikely but possible with pre-allocated pools).

The scaling factor is the actionable diagnostic: it reveals algorithmic complexity that is invisible at 1k rows. Report `runlots` timing in its own row, and the scaling factor as a derived column. Neither `runlots` nor the scaling factor participates in the geometric means.

---

## 5. Common Measurement Pitfalls

### 1. Keyed Reuse Inflation (Critical)

**Effect:** Create appears 10–16× faster than reality for keyed frameworks.

**Cause:** If the row ID counter resets to 1 on each `run` call, and the benchmark has run previously, a keyed reconciler sees keys 1–1000 in both the old and new list. Instead of creating 1000 new DOM nodes, it patches the labels of 1000 existing nodes. Patching a text node label costs roughly 1/15th the cost of creating a `<tr>` with 4 cells, a text node, and two anchors. The benchmark reports the patching cost, not the creation cost.

**Fix:** Never reset the ID counter. Always precede `run` with `clear`. The harness must enforce this ordering — if the application state already has rows when `run` is clicked, the harness should clear first as part of the `run` operation's prerequisite sequence.

### 2. Insufficient Warmup

**Effect:** Stdev is high; early runs are significantly slower than late runs.

**Cause:** V8 needs to observe hot functions being called repeatedly before it commits to TurboFan compilation. If N_WARMUP is too small, the first measured run is still executing baseline or Maglev-compiled code. Each subsequent run gets faster as more functions are promoted, introducing a downward trend in the sample that inflates stdev and makes the mean unrepresentative.

**Fix:** Increase N_WARMUP. Five iterations is a floor, not a target. For complex reconciliation operations (`run`, `replace`, `runlots`), consider 8–10 warmup iterations. Verify warmup is sufficient by checking that the first measured run is within 15% of the minimum.

### 3. GC Interference

**Effect:** Occasional runs are 2–5× slower than the median.

**Cause:** V8's garbage collector can trigger a major collection mid-operation if the benchmark has accumulated enough garbage from previous runs. The GC pause is counted as framework execution time.

**Fix:** Trigger GC via CDP before each measurement run, not just before the memory measurement. This ensures each run starts from a predictable heap state. The 200ms wait after `HeapProfiler.collectGarbage` is required.

```typescript
for (let i = 0; i < N_RUNS; i++) {
  await cdpSession.send('HeapProfiler.collectGarbage')
  await page.waitForTimeout(200)
  // ... setup prerequisite state ...
  // ... trigger operation ...
  await page.waitForFunction(() => window.__benchDone === true)
  samples.push(await page.evaluate(() => window.__benchDuration))
  await page.evaluate(() => {
    window.__benchDone = false
  })
}
```

### 4. CPU Throttle Applied to Warmup

**Effect:** All measured timings are inflated; the framework appears slower than it is.

**Cause:** V8's profiler estimates "hotness" using execution time. At 4× throttle, functions that run in 0.5ms take 2ms. V8's profiler thresholds for tier-up to TurboFan are time-based; at 4× throttle, the threshold requires 4× as many calls before compilation is triggered. Warmup iterations are wasted — they never cause the JIT to compile the hot path.

**Fix:** Apply 4× throttle only after all warmup iterations complete. The throttle sequence is: warmup at 1×, then `setCPUThrottlingRate(4)`, then measure.

### 5. Using `Date.now()` for Sub-Millisecond Timing

**Effect:** All timings are rounded to the nearest millisecond, hiding differences between frameworks that differ by 0.2–0.8ms on fast operations like `select` and `swap`.

**Fix:** Always use `performance.now()`. Its resolution is sub-millisecond in Chromium (typically 0.1ms in practice).

### 6. Measuring Playwright Round-Trip Latency

**Effect:** All timings include 2–8ms of CDP IPC overhead that is identical across frameworks and obscures real differences.

**Cause:** Measuring from `page.evaluate(() => triggerOp())` to the resolved promise includes the time for Playwright to send the CDP command, the JS to execute, and the result to serialize and return over the CDP socket. For operations that take 5ms, this adds 40–160% error.

**Fix:** Measure entirely browser-side. `performance.now()` in the browser, result communicated via `window.__benchDuration`, polled via `waitForFunction`. The Playwright call is only for setup and teardown, never inside the timing window.

### 7. Sharing a Browser Context Across Frameworks

**Effect:** Later frameworks in the test sequence appear faster because earlier frameworks warmed up V8's JIT for similar code patterns.

**Fix:** One browser context per framework. Each context gets a fresh V8 isolate with no inherited JIT state.

### 8. Not Verifying DOM Row Count

**Effect:** A bug in the benchmark application causes incorrect row counts; timings are meaningless.

**Fix:** Assert row count after every operation. Treat count mismatches as fatal errors, not warnings. A framework that panics and renders 0 rows has a 0ms `run` time — which would otherwise look like a record-breaking result.

### 9. Memory Without GC

**Effect:** Reported memory includes dead objects still on the heap, making all frameworks look worse than they are, and obscuring differences between frameworks that generate different amounts of garbage.

**Fix:** `HeapProfiler.collectGarbage` + 200ms wait before `Performance.getMetrics`. This is required, not optional.

### 10. System Load Variance

**Effect:** Benchmark results vary by 20–30% across runs taken minutes apart.

**Cause:** Background processes, OS page cache pressure, thermal throttling, and power management affect timing. A laptop that has been running compiles for 5 minutes will have elevated core temperatures and reduced boost clocks.

**Fix:** Close all non-essential applications before benchmarking. Run the full suite multiple times at different times of day. Report results only when multiple runs of the full suite agree within 10%.

---

## 6. How to Improve Performance

The following optimizations are ordered by expected impact for LLui specifically. Impact is estimated based on the operation profile: reconciliation-heavy operations (`run`, `replace`, `runlots`, `add`) dominate total time, and within reconciliation, `each()` is the critical path.

### 1. `each()` Reconciliation Algorithm

**Impact: Very high for `swap`, `add`, `replace`.**

The reconciliation algorithm in `each()` determines the minimum set of DOM operations required to transform the current list into the new list. A naive implementation removes all old entries and inserts all new entries — O(n) DOM operations for any change. The optimal algorithm for common cases:

- **Order-preserving insertion** (`add`): detect that new items are a suffix of the new array and perform only the suffix insertions. No existing DOM nodes are touched.
- **Targeted swap** (`swap`): for a 2-element position swap, detect the transposition and issue exactly 1 `insertBefore` call. Do not rebuild 998 untouched rows.
- **Key-based matching** (`replace`): use a `Map<key, entry>` for O(1) key lookup rather than `Array.prototype.find` which is O(n) per query, giving O(n²) overall for `replace`.

The classic longest-increasing-subsequence (LIS) algorithm finds the maximum set of items that retain their relative order, minimizing moves. For `swap` specifically — which is an important benchmark operation — a targeted 2-swap detector that fires before the full LIS pass is worth implementing: detect when exactly 2 positions swapped and handle it directly.

### 2. Dirty Bitmask Precision

**Impact: High for `select`, `update`.**

The dirty bitmask is the Phase 2 pre-filter. A bitmask of `0xFFFFFFFF` (fallback when the compiler plugin does not run or when an accessor's dependencies cannot be resolved) causes every binding to be evaluated on every update. The compiler plugin must produce tight masks at the **access path** level: a binding reading `s.row.selected` gets a different bit from one reading `s.row.label`. When `select` fires, only the `selected` path bit is dirty — all label bindings are skipped at the mask check, paying one bitwise AND each.

The compiler tracks nested paths up to depth 2 and supports destructuring and single-assignment aliases. When the compiler cannot determine an accessor's dependencies (computed access, multi-hop aliases, closure captures), it falls back to `0xFFFFFFFF` and emits a diagnostic warning identifying the exact accessor and the reason. Every false positive in the mask translates to a wasted accessor call across every row in the `update` benchmark. For components with 32+ unique access paths, paths beyond position 30 overflow to `FULL_MASK`, meaning their bindings re-evaluate on every dirty cycle. The measured overhead is ~1–4 microseconds per update at 40–80 paths — negligible for realistic message rates. The compiler warns at 32+ paths, listing the top-level fields by path count so authors can decompose into child components or slice handlers.

### 3. Per-Item Equality-Checked Updaters (`addCheckedItemUpdater`)

**Impact: High for `update` and `select` with large lists.**

When `each()` detects an item reference change, it invokes per-item updaters registered via `addCheckedItemUpdater`. Each updater includes an `Object.is` equality check before the DOM write, so derived values that did not actually change (e.g., a row's ID when only its label changed) skip the DOM mutation entirely. This replaces the earlier `eachItemStable` field on Scope — that field and its associated O(n) `eachItemStable` loop have been removed.

For `update` (every 10th row changes), only the 100 changed rows invoke their updaters, and within each row only the bindings whose derived value actually differs produce a DOM write. The remaining 900 rows are skipped at Phase 1 via the same-keys single-pass reconciliation (see §3.5), never reaching Phase 2 at all.

### 4. Per-Message-Type Handlers (`__handlers`)

**Impact: High for all single-message operations (`select`, `update`, `swap`, `remove`, `clear`).**

The compiler analyzes each `case` in the `update()` switch and generates specialized handler functions per message type. Each handler knows exactly which dirty bits fire and calls the appropriate specialized reconciler. The runtime dispatches single-message updates directly to the handler, bypassing dirty computation and the generic Phase 1/2 pipeline. Multi-message batches fall back to the generic path.

The compiler detects array operation patterns per case and selects the optimal reconciler:

| Pattern                                   | Detection                     | Reconciler                 |
| ----------------------------------------- | ----------------------------- | -------------------------- |
| `select` (no array change)                | No array mutation             | Skip all structural blocks |
| `clear` (empty array literal)             | `[]` assignment               | `reconcileClear()`         |
| `update`/`swaprows` (.slice() + mutation) | `.slice()` + index assignment | `reconcileItems()`         |
| `remove` (.filter())                      | `.filter()` call              | `reconcileRemove()`        |
| `run`/`add` (full replace/append)         | Full array replacement        | Generic `reconcile()`      |

Handlers delegate to a shared runtime function `__handleMsg` instead of duplicating the update-reconcile-Phase 2 pattern per message type. This reduced handler code from 2039 to 292 bytes.

### 4b. Specialized Reconcilers on `each()`

Three specialized reconcilers avoid work that the generic `reconcile()` performs unconditionally:

- **`reconcileItems(state)`**: Same keys, only item data changed. Skips mismatch/swap detection entirely — single-pass update of changed item refs.
- **`reconcileClear()`**: Direct bulk clear without evaluating the items accessor. No per-item disposal loop.
- **`reconcileRemove(state)`**: Parallel-walk removal for `.filter()` patterns. No Map/Set allocation — walks old and new arrays simultaneously to find the removed entry.

### 4c. `selector.__directUpdate`

Bypasses Phase 2 entirely for select-style operations. Evaluates the selector field and updates registry entries directly, avoiding the flat binding array scan.

### 4d. Scope Pooling

Disposed scopes are returned to a capped pool (max 2048). `createLifetime()` reuses pooled scopes instead of allocating new objects. Arrays on pooled scopes are reset to shared empty sentinels on disposal, avoiding per-scope array allocation on reuse.

### 5. Level 1 vs Level 2 Composition Overhead

**Impact: Zero for Level 1; small per-parent-update for Level 2.**

Level 1 composition (view functions) has zero runtime overhead beyond what the bitmask already covers. The child view function's bindings are part of the parent's flat binding array; depth-2 path tracking (`s.toolbar.menuOpen`) provides the same granularity as a separate component's bitmask. There is no `PropsWatcher`, no shallow-diff, no cross-boundary message dispatch.

Level 2 composition (`child()`) adds per-parent-update cost: the props accessor is called, the result is shallow-diffed against the previous props, and if changed, `propsMsg` is called and the result is enqueued into the child's message queue. For N Level 2 children, this is O(N × props fields) per parent update. This is cheaper than the binding scan for components with 30+ paths, but it is not free. Prefer Level 1 unless the Level 2 criteria (bitmask overflow, encapsulation, independent effect lifecycle) apply.

### 5. Array Reference Identity Fast Path

**Impact: High for `select`, `swap` at very large list sizes.**

If the accessor passed to `each()` returns the same array reference as the previous call, no reconciliation is needed — this is now an O(1) check and early return. Previously this case still ran an O(n) `eachItemStable` loop to mark each scope; that loop has been eliminated. The fast path:

```typescript
const newItems = getItems(state)
if (newItems === this.lastItems) {
  // O(1) — skip Phase 1 reconciliation entirely for this each() block
  return
}
```

This is only valid for the structural phase. Phase 2 still runs bindings that depend on paths other than the array-producing path.

### 5b. Same-Keys Single-Pass Reconciliation

**Impact: High for `update` with large lists.**

When the array reference changes but the key set is identical (common for immutable updates that replace individual items), `each()` now merges the two formerly separate O(n) passes — key matching and item-ref comparison — into a single O(n) pass. Items whose reference has not changed are skipped entirely (no updater invocation, no binding evaluation). Only items with changed references invoke their equality-checked updaters.

### 6. Avoid String Coercion in Hot Path

**Impact: Small but measurable for `update` with large lists.**

`String(value)` allocates a wrapper call frame. `'' + value` is faster coercion for non-string primitives. For values that are already strings (which is always true for pre-built labels in this benchmark), avoid any coercion at all — check type before coercing:

```typescript
// Slower
textNode.nodeValue = String(value)

// Faster for mixed types
textNode.nodeValue = typeof value === 'string' ? value : '' + value
```

For numbers specifically, text nodes accept numeric `nodeValue` directly without String conversion:

```typescript
textNode.nodeValue = value // works if value is a number
```

### 7. Batch Attribute Writes

**Impact: Small for class toggle operations.**

For toggling a single class (e.g., `selected`), `classList.toggle('selected', value)` is faster than `className = value ? 'selected' : ''` because it avoids string allocation and does not invalidate the style engine's class cache for unrelated classes. Avoid `setAttribute('class', ...)` entirely for class manipulation — it does a string parse pass.

For direct property assignment to known DOM properties (`disabled`, `checked`, `value`), use direct property assignment rather than `setAttribute`. The difference is a string key lookup vs. a direct slot write in the DOM binding layer.

### 8. Reduce Binding Object Allocation

**Impact: Small, primarily for `run` and `replace`.**

Each binding is currently a plain object. For applications that create many bindings at mount time, the allocations for `run` (1000 rows × bindings per row) are measurable. Representing bindings as typed arrays (or frozen objects with V8 object shape stability) reduces allocation overhead.

This optimization has diminishing returns once shape stability is established — V8 inlines property access on objects with stable hidden classes. Measure before implementing.

### 9. Avoid Layout Thrash

**Impact: Context-dependent; measurable when bindings mix reads and writes.**

If a binding reads a layout-affecting property (e.g., `offsetHeight`) then writes a DOM property that triggers layout, and another binding does the same interleaved, the browser is forced to recalculate layout between writes. Separate all layout reads from layout writes: collect all reads first, then issue all writes. In the benchmark app's binding pattern, this does not apply because no binding reads layout properties. In real applications it does.

### 10. O(1) Key Lookup in Entry Map

**Impact: High for `replace` on large lists if not already implemented.**

During reconciliation, looking up whether a key from the new list exists in the old list must use a `Map<key, entry>` pre-built from the old list, not `array.find()`. `Array.find` is O(n); with n=1000, building the new list requires 1000 × O(n) = O(n²) lookups. A `Map` lookup is amortized O(1), so the full reconciliation is O(n) in the key-matching phase.

### 11. Microtask Batching via `send()` / `flush()`

**Impact: High for burst-send scenarios (WebSocket, drag, rapid keystroke).**

`send()` enqueues messages and defers the update cycle to a microtask. Multiple sends within the same synchronous execution coalesce into one `processMessages` pass: one dirty mask (OR of all individual deltas), one Phase 1, one Phase 2, one set of DOM writes. This is LLui's primary batching mechanism.

For benchmark operations that trigger a single message (e.g., clicking a button that sends one `select` message), batching has no effect — there is only one message to process. For operations that trigger multiple state changes in rapid succession (e.g., replacing the entire item array which may involve both a `setItems` message and derived state updates), batching reduces DOM writes to the minimum necessary.

When benchmarking, use `flush()` to force the update cycle synchronously after the operation trigger, ensuring the timing window captures the full update cost. Do not use `await Promise.resolve()` — the microtask scheduling adds non-deterministic CDP round-trip overhead to the measurement.

```typescript
await page.evaluate(() => {
  ;(window as any).__app.send({ type: 'run' })
  ;(window as any).__app.flush()
})
```

### 12. Compiler-Generated `__update` Function

**Impact: High for all operations.**

The compiler generates a per-component `__update` function that replaces the generic Phase 1 / Phase 2 loop. Instead of iterating arrays of structural blocks and bindings, the generated function contains direct inline calls to each reconciler and each binding updater with mask checks baked in. This eliminates loop iteration overhead and enables V8 to inline individual calls.

Phase 1 mask gating is built into the generated function: each structural block (`each`, `branch`, `show`) carries a compiler-injected `__mask` (the OR of all state paths its accessor reads). The generated code skips the block when `(block.__mask & dirtyMask) === 0`, so an `each()` depending on path A is entirely skipped when only path B is dirty.

The generated function imports `__applyBinding` directly, bypassing the generic binding dispatch. Uncompiled components fall back to the generic `runUpdate` loop with identical semantics.

### 13. Skip String Conversion for Number Text Nodes

**Impact: Negligible; mentioned for completeness.**

V8 accepts numbers as `nodeValue` without conversion. `node.nodeValue = 42` works and avoids one string allocation per row ID render.

### 14. Row Factory

**Impact: High for `run`, `replace`, `add` — eliminates per-row closure allocation.**

The compiler generates a shared update function for `each()` render callbacks, replacing per-row closures with a single factory function that is called with the entry context. Instead of each row creating its own closure for item updaters via `selector.bind()`, the compiler emits a shared function that receives the entry directly.

This optimization is disabled when the render callback uses `selector.bind()`, because bound selectors cause V8 to deoptimize the shared function (megamorphic inline caches from heterogeneous receiver shapes). The compiler detects `selector.bind()` calls in the render body and falls back to per-row closures in that case.

For 1000-row creation, this eliminates 1000 closure allocations per render callback, reducing GC pressure and improving cache locality.

### 15. Strided `reconcileChanged`

**Impact: High for `update` — reduces reconciliation from O(n) to O(k) where k = n/stride.**

The compiler detects `for` loop patterns with constant stride increments (`i += STRIDE`) in `update()` case bodies and generates handlers that call `reconcileChanged(state, stride)` instead of the generic `reconcileItems`. The strided reconciler only visits entries at stride intervals, skipping entries that cannot have changed.

For the `update` benchmark (every 10th row changes, stride=10), this reduces the reconciliation scan from 1000 entries to 100 entries — a 10x reduction in loop iterations.

### 16. Generation-Guarded Selector Disposal

**Impact: High for `clear` — O(1) bulk clear with no memory leak on generic reconcile.**

Per-row `addDisposer` still exists but is guarded by a generation counter. On bulk clear (`reconcileClear`), `registerOnClear` bumps the generation and calls `registry.clear()`, making all outstanding per-row disposers no-ops (they check `generation !== myGeneration` and bail). On generic reconcile (individual row removal), disposers fire normally and compact the registry. This gives O(1) bulk clear without the memory leak that a disposer-free approach would cause on incremental removal.

### 17. `registerOnRemove` Callback

**Impact: Medium for `remove` — enables direct bucket compaction.**

`each()` notifies selectors when individual rows are removed via `reconcileRemove`. The `registerOnRemove` callback allows selectors to compact their per-entry bucket directly when a row is removed, rather than waiting for the per-scope disposer to fire. This keeps the selector registry tight without relying solely on scope disposal.

### 18. Row Factory Disabled for Selector Renders

**Impact: Neutral (avoids regression) — prevents V8 deopt in selector-heavy renders.**

The V8 deoptimization from selector function declarations inside the row factory render persists even after removing per-row disposers. Row factory remains active for non-selector renders (where it eliminates per-row closure allocation), but the compiler falls back to per-row closures when `selector.bind()` is present in the render body.

### 19. Entry-Level Updaters

**Impact: Medium for `update` — reduces indirection on item update path.**

`itemUpdaters` are moved from the scope object to the entry object directly. When `each()` detects an item reference change and needs to invoke updaters, it accesses `entry.updaters` instead of `entry.scope.itemUpdaters`. This eliminates one property lookup per item update and keeps the updater array co-located with the entry data it operates on.

### 20. Reusable Render Bag

**Impact: Medium for `run`, `replace`, `add` — reduces per-entry object allocation.**

The `each()` render callback receives a bag object `({ send, item, index })`. Instead of allocating a new bag per entry during creation, a single shared `buildBag` object is mutated with the current entry's `item` and `index` accessors before each render call. Since `view()` runs synchronously and the bag is only used during the render callback (not captured), the shared object is safe to reuse.

For 1000-row creation, this eliminates 999 object allocations (one bag is created, then reused for all subsequent entries).

---

## 7. What to Avoid in Performance Optimization

**Do not optimize before profiling.** Run the benchmark under Chrome DevTools' Performance panel (or CDP's `Profiler.start`/`Profiler.stop`) and identify the actual hot paths before writing any optimization code. The assumptions in §6 are derived from structural analysis of the algorithm — they may not hold for a specific build or V8 version. Profile first, then apply the relevant optimization from the ordered list.

**Do not optimize for synthetic benchmarks at the cost of correctness.** The benchmark app does not use transitions. A framework can skip transition scheduling during measurements and appear faster. Do not implement a "benchmark mode" that disables real runtime behavior — it produces numbers that are useless for predicting production performance.

**Do not optimize `create` at the cost of `update`.** Create (mounting 1000 rows) happens once per user session in most applications. Update happens thousands of times. Micro-optimizing the mount path by, for example, pre-allocating binding arrays at fixed sizes, can make the binding update path slower by disrupting V8's array shape tracking.

**Do not share state between benchmark runs.** Each operation must start from a documented, known DOM and application state. If the benchmark app accumulates state between operations — event listener counts, allocation counters, cached key maps — results become non-reproducible across reordering of operations.

**Do not monkey-patch DOM APIs.** Wrapping `Element.prototype.setAttribute` or `Node.prototype.appendChild` to measure call counts adds indirection to every DOM write across the entire application, including Playwright's internal DOM operations. Use MutationObserver for DOM change observation, or CDP's DOM domain for audit purposes.

---

## 8. What Looks Like an Optimization But Isn't

**Object pooling for binding tuples.** Modern V8 garbage collection of small short-lived objects is extremely fast. A `[mask, kind, key, accessor]` tuple that is allocated during mount and lives until dispose is not short-lived — it is medium-lived, and it will be promoted to old-space regardless of pooling. Object pooling adds complexity and often hurts cache locality by reusing objects with stale inline caches. Measure before implementing.

**Manual SIMD-like optimizations in JavaScript.** V8 automatically vectorizes tight loops over typed arrays. Manually unrolling the binding loop or splitting the array into chunks does not help and makes the code unmaintainable.

**Avoiding closures in hot paths.** V8 optimizes closures well. Per-item closures that capture the row `id` are inlined by TurboFan. De-closure-ing (passing data as arguments, using index lookups) rarely produces measurable improvement and makes the code harder to read and verify correct.

**Using `DocumentFragment` for single-node inserts.** `DocumentFragment` reduces layout recalculations when inserting many nodes simultaneously by batching them into a single reflow. For single-node inserts (`remove`, `select`), creating a `DocumentFragment` adds allocation overhead with no benefit. The threshold where `DocumentFragment` pays off is approximately 10+ nodes in a single insertion.

**Avoiding `querySelectorAll` for DOM sanity checks.** `querySelectorAll` is called once per measurement iteration, outside the timing window, after `__benchDone` is read. Its cost is irrelevant to the reported timing. Replacing it with a manual row counter for performance reasons is premature optimization of a non-hot path.

**Switching from `Map` to `Object` for key storage.** For integer or string keys, `Map` has essentially the same performance as a plain object in modern V8, and `Map` has cleaner semantics (no prototype collision, iterable in insertion order). Object-based key maps do not meaningfully outperform `Map` for n=1000.

---

## 9. Runtime Cost of Structural Patterns

This section documents the performance characteristics of three runtime patterns that operate outside the core benchmark suite but have measurable cost in production applications: `handleEffects` chains, nested `each` scopes, and `onTransition` batching.

### 9.1 `handleEffects` Chain Performance

The `handleEffects<Effect>().else((eff, send, signal) => { ... })` pattern is the canonical effect handler. It executes on every effect emitted by `update()`, so its per-invocation cost must be negligible relative to the DOM work it triggers.

**Target: <500ns per effect dispatch (per keystroke in a typing-heavy UI).**

**Cancel registry:** Effect cancellation uses a `Map<string, AbortController>` keyed by cancel token. `Map.get` + `Map.set` is O(1) amortized. The `AbortController` is a platform object — its allocation cost is fixed and small (~200 bytes). When `cancel(token)` fires, the registry calls `controller.abort()` and deletes the entry. When `cancel(token, inner)` fires, the registry aborts the old controller, creates a new one, stores it, and passes its `signal` to the inner effect.

```typescript
// Internal cancel registry (simplified)
const cancelRegistry = new Map<string, AbortController>()

function handleCancel(token: string, inner?: Effect): void {
  const existing = cancelRegistry.get(token)
  if (existing) existing.abort()
  if (inner) {
    const controller = new AbortController()
    cancelRegistry.set(token, controller)
    dispatchEffect(inner, controller.signal)
  } else {
    cancelRegistry.delete(token)
  }
}
```

**Switch dispatch:** The effect handler uses a `switch` statement on `eff.type`, not a dynamic dispatch table (`Map<string, handler>`). V8 compiles switch-on-string to a jump table when the case count is ≤64 and all cases are string literals. This avoids the hash + lookup + indirect call overhead of dynamic dispatch.

**Frozen function object:** The handler function returned by `handleEffects().else(...)` is a single frozen object. It is allocated once at component mount time and reused for every effect dispatch. No per-dispatch allocation occurs. V8 marks frozen objects as having a stable hidden class, enabling monomorphic inline caching on the dispatch call site.

**Measurement:** Profile `handleEffects` cost by emitting 1000 no-op effects in a tight loop and measuring with `performance.now()`. The target is <500µs total (500ns per effect). If the handler exceeds this budget, the bottleneck is in the user's effect handler body, not the dispatch mechanism.

### 9.2 Nested `each` Scope Performance

When `each()` appears inside another `each()`'s render callback, the runtime detects the nesting and registers the inner `each`'s blocks with the parent `each`'s scope rather than the flat component-level binding list. This enables tree-structured Phase 1 iteration instead of flat iteration.

**Why this matters:** A flat binding list for a component with `each` over 100 categories, each containing `each` over ~10 items, has 1000+ bindings in a single flat array. When a single item in one category changes, flat iteration evaluates all 1000 bindings' dirty masks. Tree walk evaluates the parent `each`'s 100 category scopes, identifies the one dirty category, then evaluates only that category's ~10 item bindings. This is O(100 + 10) = O(110) mask checks instead of O(1000).

**Zero overhead for flat lists:** The nesting detection is a single boolean check during `each()` initialization: "is the current scope owned by another `each`?" If not, the `each` block is registered in the flat component binding list as usual. No tree walk overhead is incurred for components that use only flat `each()` — the tree walk code path is never entered.

**Scope registration:** Each `each` scope maintains a `children: EachScope[]` array. When the runtime detects a nested `each`, it pushes the inner scope onto the parent's `children` array instead of the component's flat `bindings` array. During Phase 1 (reconciliation), the parent `each` processes its items, and for each item whose scope is dirty, it recursively processes that item's child `each` scopes.

```typescript
// Phase 1 tree walk (simplified)
function processEachScope(scope: EachScope, dirtyMask: number): void {
  if (!(scope.mask & dirtyMask)) return // prune entire subtree
  reconcileItems(scope)
  for (const child of scope.children) {
    processEachScope(child, dirtyMask) // recurse into nested each
  }
}
```

**Memory cost:** One additional `children` array per `each` scope. For flat lists, this array is empty (never allocated until the first child is registered). For nested lists, the array holds references to child scopes — no duplication of binding data.

### 9.3 `onTransition` Batching Performance

`onTransition({ entering, leaving, parent })` is the coordinated FLIP transition API. It fires before `enter`/`leave` for individual elements, enabling position capture and batch animation setup. The performance-critical constraint is minimizing forced layout passes.

**One forced layout pass per update cycle.** When multiple `onTransition` callbacks fire in the same update cycle (e.g., a sort operation that moves 50 rows), the runtime batches all callbacks:

1. **Before DOM mutations:** Capture `getBoundingClientRect()` for all elements that will move. This is one forced layout read — the browser computes layout once. All rect reads happen in a single pass: iterate all pending `onTransition` scopes, read rects for their `entering` and `leaving` elements, store in a `Map<Element, DOMRect>`.

2. **Apply DOM mutations:** Phase 1 reconciliation moves, inserts, and removes DOM nodes.

3. **After DOM mutations:** Read new positions for all moved elements (one more forced layout read). Compute deltas. Fire all `onTransition` callbacks with pre-computed position data.

```typescript
// Batched onTransition (simplified)
function batchTransitions(pending: TransitionScope[]): void {
  // Step 1: Read old positions (one layout pass)
  const oldRects = new Map<Element, DOMRect>()
  for (const scope of pending) {
    for (const el of scope.elements) {
      oldRects.set(el, el.getBoundingClientRect())
    }
  }

  // Step 2: Apply DOM mutations (reconciliation)
  applyDOMMutations()

  // Step 3: Read new positions (one layout pass)
  const newRects = new Map<Element, DOMRect>()
  for (const scope of pending) {
    for (const el of scope.elements) {
      newRects.set(el, el.getBoundingClientRect())
    }
  }

  // Step 4: Fire callbacks with computed deltas
  for (const scope of pending) {
    const entering = scope.entering.map((el) => ({
      el,
      from: oldRects.get(el),
      to: newRects.get(el),
    }))
    const leaving = scope.leaving.map((el) => ({
      el,
      from: oldRects.get(el),
      to: newRects.get(el),
    }))
    scope.onTransition({ entering, leaving, parent: scope.parent })
  }
}
```

**Cost analysis:** O(N) rect reads before mutations + O(N) rect reads after mutations + O(N) delta math, where N is the total number of transitioning elements across all `onTransition` scopes in the update cycle. `getBoundingClientRect()` costs ~1–5µs per element depending on tree depth. For a sort of 100 rows: 100 reads × 2 passes × ~3µs = ~600µs of layout read cost. The delta math (subtraction of 4 floats per element) is negligible.

**When `onTransition` is not registered:** Zero cost. The transition batching code path is gated behind a `pendingTransitions.length > 0` check before Phase 1. Components without `onTransition` callbacks never enter the batching path.

**Composition with `enter`/`leave`:** `onTransition` fires first (Steps 1–4 above). Then `enter`/`leave` fire for individual elements. This ordering ensures FLIP position capture happens before any CSS classes are applied by `enter`/`leave`. The composition is additive — `enter`/`leave` see elements that are already in their final DOM position, with `onTransition` having set up any necessary `transform` overrides for the FLIP animation.

---

## 10. Resolved Questions

**Geometric mean aggregation.** Resolved: report both unweighted geometric mean (cross-framework comparison, §4) and weighted "interactive profile" score (production-representative, §4). The weighted score uses empirical operation frequency weights: update 40%, select 25%, swap 10%, run 10%, add 5%, remove 5%, clear 5%.

**Operation weighting.** Resolved: the interactive profile weights are defined in §4. They embed a "typical interactive application" model. Applications with radically different profiles (e.g., a real-time dashboard with 90% update) can define custom weight vectors; the methodology supports any weight distribution.

**Bundle size reporting (brotli vs. gzip).** Resolved: moved to 06 Bundle Size. Bundle size methodology is not a performance benchmarking concern — it belongs with the bundle analysis document.

**Transition benchmarking.** Resolved: the `transition` operation (§2) measures setup cost to rAF, not animation duration. Single-rAF timing window captures FLIP rect reads and callback scheduling. Reported separately from geometric means. Frameworks without coordinated transitions report N/A.

**Memory: total heap vs. per-row overhead.** Resolved: report both (§1 Memory Protocol). The warm-empty baseline protocol (create→clear→GC→measure, then create→GC→measure) isolates per-row marginal cost from framework baseline. Per-row bytes is the scaling-relevant number; total heap is the absolute cost.

**`runlots` vs. `run` as primary create benchmark.** Resolved: 1k `run` is the headline metric; 10k `runlots` is a scaling diagnostic (§4). The scaling factor (`time_10k / time_1k`) reveals algorithmic complexity. Neither participates in the weighted geometric mean; `run` participates in the unweighted geometric mean.
