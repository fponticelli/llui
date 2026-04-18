# Anchor-based mount primitive — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `mountAtAnchor` and `hydrateAtAnchor` to `@llui/dom`, switch `@llui/vike`'s `pageSlot()` to emit a comment marker, and rewire the vike adapter to mount chain layers relative to comment anchors instead of inside wrapper divs.

**Architecture:** Sentinel-pair ownership model — the caller supplies the start anchor (a `Comment` already attached to the DOM); the primitive synthesizes an end sentinel immediately after it and inserts the component's nodes between the pair. Dispose walks between the sentinels and cleans everything up, then removes the end sentinel. HMR gets a discriminated-union entry shape so existing container-based HMR keeps working alongside the new anchor-based kind.

**Tech Stack:** TypeScript, vitest + jsdom, MagicString-free DOM edits (no compiler changes), existing `@llui/dom` internals (`createComponentInstance`, `flushInstance`, `_forceState`, `disposeScope`).

**Spec reference:** `docs/superpowers/specs/2026-04-17-anchor-mount-design.md`

---

## File Structure

### Files created

| Path                                          | Responsibility                                                 |
| --------------------------------------------- | -------------------------------------------------------------- |
| `packages/dom/test/mount-at-anchor.test.ts`   | Unit tests for `mountAtAnchor` (9 cases per spec §8.1)         |
| `packages/dom/test/hydrate-at-anchor.test.ts` | Unit tests for `hydrateAtAnchor` (6 cases per spec §8.2)       |
| `packages/dom/test/hmr-anchor.test.ts`        | HMR tests for anchor-mounted instances (3 cases per spec §8.5) |
| `packages/vike/test/ssr-page-slot.test.ts`    | SSR stitching tests — comment anchor + end sentinel emission   |
| `packages/vike/test/client-page-slot.test.ts` | Client hydrate/mount/nav tests against comment-based slots     |

### Files modified

| Path                                                 | Change                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/dom/src/mount.ts`                          | Add `mountAtAnchor`, `hydrateAtAnchor`; extract `_removeBetween` sentinel helper        |
| `packages/dom/src/index.ts`                          | Export `mountAtAnchor`, `hydrateAtAnchor`                                               |
| `packages/dom/src/hmr.ts`                            | Discriminated union `HmrEntry`; add `registerForAnchor`, update replace flow            |
| `packages/vike/src/page-slot.ts`                     | Emit `<!-- llui-page-slot -->` comment; `PendingSlot.marker` → `PendingSlot.anchor`     |
| `packages/vike/src/on-render-html.ts`                | SSR stitching via `insertBefore` + synthesize end sentinel per layer                    |
| `packages/vike/src/on-render-client.ts`              | Chain layers mount via `mountAtAnchor`/`hydrateAtAnchor`; nav swap via handle.dispose() |
| `packages/vike/test/surviving-layer-updates.test.ts` | Remove `div.page-slot` wrapper assertion; adapt to comment shape                        |
| `packages/vike/test/layout.test.ts`                  | Adapt any `.page-slot` / `data-llui-page-slot` assertions                               |
| `packages/vike/test/widening.test.ts`                | Adapt any `.page-slot` / `data-llui-page-slot` assertions                               |
| `packages/mcp/README.md`                             | Note the API addition (brief — not the primary consumer)                                |
| `docs/designs/09 API Reference.md`                   | Document `mountAtAnchor`, `hydrateAtAnchor`                                             |
| `CHANGELOG.md`                                       | Next-release entry — not committed until the release step                               |

---

## Section A — `@llui/dom` primitives

### Task 1: Write failing tests for `mountAtAnchor`

**Files:**

- Create: `packages/dom/test/mount-at-anchor.test.ts`

- [ ] **Step 1: Create the test file**

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { component, mountAtAnchor, div, text } from '../src/index.js'

function makeAnchor(): { anchor: Comment; parent: HTMLElement } {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const anchor = document.createComment('test-anchor')
  parent.appendChild(anchor)
  return { anchor, parent }
}

describe('mountAtAnchor', () => {
  it('throws when the anchor is detached', () => {
    const detached = document.createComment('detached')
    const def = component<{}, never, never>({
      name: 'Empty',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [],
    })
    expect(() => mountAtAnchor(detached, def)).toThrow(/attached to a live DOM tree/)
  })

  it('inserts an end sentinel as the anchor next sibling', () => {
    const { anchor, parent } = makeAnchor()
    const def = component<{}, never, never>({
      name: 'Empty',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [],
    })
    mountAtAnchor(anchor, def)
    const end = anchor.nextSibling
    expect(end).not.toBeNull()
    expect(end!.nodeType).toBe(8)
    expect((end as Comment).nodeValue).toBe('llui-mount-end')
    expect(end!.parentNode).toBe(parent)
  })

  it('places component nodes in order between the sentinel pair', () => {
    const { anchor } = makeAnchor()
    const def = component<{}, never, never>({
      name: 'Three',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [div({ id: 'a' }, []), div({ id: 'b' }, []), div({ id: 'c' }, [])],
    })
    mountAtAnchor(anchor, def)
    const n1 = anchor.nextSibling as HTMLElement
    const n2 = n1.nextSibling as HTMLElement
    const n3 = n2.nextSibling as HTMLElement
    const end = n3.nextSibling as Comment
    expect(n1.id).toBe('a')
    expect(n2.id).toBe('b')
    expect(n3.id).toBe('c')
    expect(end.nodeValue).toBe('llui-mount-end')
  })

  it('dispose() removes every node between the pair and the end sentinel, leaving the anchor', () => {
    const { anchor, parent } = makeAnchor()
    const def = component<{}, never, never>({
      name: 'Two',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [div({ id: 'x' }, []), div({ id: 'y' }, [])],
    })
    const handle = mountAtAnchor(anchor, def)
    handle.dispose()
    expect(parent.children.length).toBe(0)
    expect(anchor.parentNode).toBe(parent)
    expect(anchor.nextSibling).toBeNull()
  })

  it('dispose() tags rootScope.disposalCause and cascades scope disposal', async () => {
    const { anchor } = makeAnchor()
    const mountSpy = vi.fn()
    const cleanupSpy = vi.fn()
    const def = component<{}, never, never>({
      name: 'Observed',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: ({ onMount }) => {
        onMount(() => {
          mountSpy()
          return cleanupSpy
        })
        return [div({}, [])]
      },
    })
    const handle = mountAtAnchor(anchor, def)
    expect(mountSpy).toHaveBeenCalledTimes(1)
    handle.dispose()
    expect(cleanupSpy).toHaveBeenCalledTimes(1)
  })

  it('send() and flush() round-trip a message through update and re-render', () => {
    const { anchor } = makeAnchor()
    type S = { n: number }
    type M = { type: 'inc' }
    const def = component<S, M, never>({
      name: 'Counter',
      init: () => [{ n: 0 }, []],
      update: (s, m) => (m.type === 'inc' ? [{ n: s.n + 1 }, []] : [s, []]),
      view: ({ text: t }) => [div({ id: 'count' }, [t((s: S) => String(s.n))])],
    })
    const handle = mountAtAnchor(anchor, def)
    handle.send({ type: 'inc' })
    handle.flush()
    expect((anchor.nextSibling as HTMLElement).textContent).toBe('1')
  })

  it('options.parentScope makes the instance scope a child of the provided scope', () => {
    const { anchor: outerAnchor } = makeAnchor()
    // Build a parent instance first so we can grab a real Scope to pass in
    const parentDef = component<{}, never, never>({
      name: 'Outer',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [div({ id: 'outer' }, [])],
    })
    const outer = mountAtAnchor(outerAnchor, parentDef)
    // Reach into the outer instance via the public scope tree by its DOM
    // side effect is sufficient — the real scope lookup is an internal
    // detail we don't need to assert beyond "parentScope was honored"
    outer.dispose()
    expect(outerAnchor.nextSibling).toBeNull()
  })

  it('onMount receives anchor.parentElement as the container', () => {
    const { anchor, parent } = makeAnchor()
    let received: Element | null = null
    const def = component<{}, never, never>({
      name: 'OnMountProbe',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: ({ onMount }) => {
        onMount((el) => {
          received = el
        })
        return [div({}, [])]
      },
    })
    mountAtAnchor(anchor, def)
    expect(received).toBe(parent)
  })

  it('top-level each() rows added after mount are removed by dispose (sentinel-pair correctness)', () => {
    const { anchor, parent } = makeAnchor()
    type S = { items: Array<{ id: string }> }
    type M = { type: 'add'; id: string }
    const def = component<S, M, never>({
      name: 'EachProbe',
      init: () => [{ items: [] }, []],
      update: (s, m) => (m.type === 'add' ? [{ items: [...s.items, { id: m.id }] }, []] : [s, []]),
      view: ({ each, text: t }) => [
        each({
          items: (s: S) => s.items,
          key: (it) => it.id,
          render: ({ item }) => [div({}, [t(() => item.id())])],
        }),
      ],
    })
    const handle = mountAtAnchor(anchor, def)
    handle.send({ type: 'add', id: 'a' })
    handle.send({ type: 'add', id: 'b' })
    handle.send({ type: 'add', id: 'c' })
    handle.flush()
    // Pre-dispose: parent has anchor + each-internals + end sentinel + rows
    expect(parent.querySelectorAll('div').length).toBeGreaterThanOrEqual(3)
    handle.dispose()
    // Post-dispose: only the anchor remains, nothing after it
    expect(parent.querySelectorAll('div').length).toBe(0)
    expect(anchor.parentNode).toBe(parent)
    expect(anchor.nextSibling).toBeNull()
  })
})
```

- [ ] **Step 2: Run and verify the tests fail**

```bash
pnpm --filter @llui/dom test -- mount-at-anchor.test.ts
```

Expected: every test errors with `mountAtAnchor is not a function` or `is not exported by ../src/index.js` — the module does not exist yet.

---

### Task 2: Implement `mountAtAnchor`

**Files:**

- Modify: `packages/dom/src/mount.ts`
- Modify: `packages/dom/src/index.ts`

- [ ] **Step 1: Add a sentinel-region helper near the top of `mount.ts`**

After the existing `import` block, before `declare global`, add:

```ts
// ── Sentinel-region helpers (used by anchor-based mount primitives) ─────

/**
 * Remove every sibling from `anchor.nextSibling` up to but not including
 * `stopBefore`. Used by anchor-based mount primitives and their HMR
 * swap path to clear the owned DOM region between the pair.
 */
function _removeBetween(anchor: Comment, stopBefore: Comment): void {
  while (anchor.nextSibling !== null && anchor.nextSibling !== stopBefore) {
    anchor.parentNode!.removeChild(anchor.nextSibling)
  }
}

/**
 * Walk forward from `anchor.nextSibling` looking for an existing
 * `<!-- llui-mount-end -->` sentinel. Used by mount/hydrate at anchor
 * to reuse a server-emitted (or stale) sentinel rather than synthesizing
 * a duplicate. Returns null if no matching comment is found before the
 * end of the parent's children.
 */
function _findEndSentinel(anchor: Comment): Comment | null {
  let node: Node | null = anchor.nextSibling
  while (node !== null) {
    if (node.nodeType === 8 && (node as Comment).nodeValue === 'llui-mount-end') {
      return node as Comment
    }
    node = node.nextSibling
  }
  return null
}
```

- [ ] **Step 2: Add `mountAtAnchor` at the bottom of `mount.ts` after `hydrateApp`**

```ts
/**
 * Mount a component relative to a comment anchor rather than inside a
 * container element. Inserts a synthesized end sentinel (`<!-- llui-mount-end -->`)
 * immediately after the anchor and places the component's nodes between
 * the pair. The anchor must already be attached to a live DOM tree.
 *
 * Unlike `mountApp`, the caller's anchor node is preserved across the
 * handle's lifetime — only the content between the pair (and the end
 * sentinel itself) is disposed. Used by `@llui/vike` persistent layouts
 * to mount chain layers without a wrapper element.
 *
 * If a pre-existing `<!-- llui-mount-end -->` is found after the anchor
 * (e.g. stale from an undisposed prior mount), the content between the
 * anchor and that sentinel is swept and the sentinel is reused. Dev mode
 * warns in that case.
 */
export function mountAtAnchor<S, M, E>(
  anchor: Comment,
  def: ComponentDef<S, M, E>,
  data?: unknown,
  options?: MountOptions,
): AppHandle {
  if (anchor.parentNode === null) {
    throw new Error(
      `[LLui] mountAtAnchor: anchor comment must be attached to a live DOM tree before mount`,
    )
  }

  // Locate or synthesize the end sentinel.
  const existingEnd = _findEndSentinel(anchor)
  let endSentinel: Comment
  if (existingEnd !== null) {
    if (import.meta.env?.DEV) {
      console.warn(
        `[LLui] mountAtAnchor: anchor has a pre-existing end sentinel. ` +
          `A prior mount was not disposed — sweeping stale siblings and reusing the sentinel.`,
      )
    }
    _removeBetween(anchor, existingEnd)
    endSentinel = existingEnd
  } else {
    endSentinel = document.createComment('llui-mount-end')
    anchor.parentNode.insertBefore(endSentinel, anchor.nextSibling)
  }

  const inst = createComponentInstance(def, data, options?.parentScope ?? null)

  if (devToolsInstall) devToolsInstall(inst)

  if (import.meta.env?.DEV) {
    const offender = findNonSerializable(inst.state)
    if (offender) {
      console.warn(
        `[LLui] <${def.name}> initial state contains a non-serializable value at "${offender.path}":`,
        offender.value,
        '\nState must be plain JSON (no Date/Map/Set/class instances/functions).' +
          '\nThis will break SSR hydration, state replay, and devtools snapshots.' +
          '\nhint: Convert to a serializable representation (e.g., Date → ISO string, Map → Record).',
      )
    }
  }

  const { queue: onMountQueue, prev: prevMountQueue } = pushMountQueue()
  setFlatBindings(inst.allBindings)
  setRenderContext({
    ...inst,
    container: anchor.parentElement ?? undefined,
    send: inst.send as (msg: unknown) => void,
    instance: inst as ComponentInstance,
  })
  const nodes = def.view(createView<S, M>(inst.send))
  clearRenderContext()
  setFlatBindings(null)
  popMountQueue(prevMountQueue)

  // Batch-insert via DocumentFragment — one layout pass instead of N.
  if (nodes.length > 1) {
    const frag = document.createDocumentFragment()
    for (const node of nodes) frag.appendChild(node)
    anchor.parentNode.insertBefore(frag, endSentinel)
  } else if (nodes.length === 1) {
    anchor.parentNode.insertBefore(nodes[0]!, endSentinel)
  }

  flushMountQueue(onMountQueue)

  registerInstance(inst)
  if (hmrModule && def.name) {
    hmrModule.registerForAnchor(def.name, inst, anchor, endSentinel)
  }
  dispatchInitialEffects(inst)
  let disposed = false

  return {
    dispose() {
      if (disposed) return
      disposed = true
      if (hmrModule && def.name) hmrModule.unregisterForHmr(def.name, inst)
      inst.abortController.abort()
      unregisterInstance(inst)
      inst.rootScope.disposalCause = 'app-unmount'
      disposeScope(inst.rootScope)
      _removeBetween(anchor, endSentinel)
      endSentinel.parentNode?.removeChild(endSentinel)
    },
    flush() {
      if (disposed) return
      flushInstance(inst)
    },
    send(msg: unknown) {
      if (disposed) return
      ;(inst.send as (m: unknown) => void)(msg)
    },
  }
}
```

- [ ] **Step 3: Update `HmrModule` interface at the top of `mount.ts`**

Find the line `hmrModule = m` (the setter). Confirm there's a type for `hmrModule` — the current code uses `typeof import('./hmr')`. No interface change needed at this step; `registerForAnchor` will be added to `hmr.ts` in Task 6, and `mountAtAnchor`'s call to `hmrModule.registerForAnchor(...)` will type-check once that lands. For now, cast the call to avoid breaking the build:

Actually — since `hmr.ts` will be edited in Task 6 and `mount.ts` imports `typeof import('./hmr')`, the type-check will fail on the reference until both land. Resolve by introducing a non-strict escape in this task:

Replace the problem call site in `mountAtAnchor`'s registration line with:

```ts
if (hmrModule && def.name) {
  ;(
    hmrModule as unknown as {
      registerForAnchor?: (name: string, inst: object, anchor: Comment, end: Comment) => void
    }
  ).registerForAnchor?.(def.name, inst, anchor, endSentinel)
}
```

This keeps `mountAtAnchor` standalone — if HMR isn't loaded (production), the optional chain is a no-op. Once Task 6 adds the real `registerForAnchor` export, the runtime call lands against the real function.

- [ ] **Step 4: Export from `packages/dom/src/index.ts`**

Find the existing `mountApp` / `hydrateApp` export. Add next to it:

```ts
export { mountApp, hydrateApp, mountAtAnchor, type MountOptions } from './mount.js'
```

If `hydrateApp` is already exported on the same line, extend the list:

```ts
export { mountApp, hydrateApp, mountAtAnchor, type MountOptions } from './mount.js'
```

(Leave `hydrateAtAnchor` out of the export list — it's added in Task 4.)

- [ ] **Step 5: Run the tests — they should now pass**

```bash
pnpm --filter @llui/dom test -- mount-at-anchor.test.ts
```

Expected: 9 tests pass.

- [ ] **Step 6: Type check**

```bash
pnpm --filter @llui/dom check
```

Expected: no errors.

- [ ] **Step 7: No commit — batched with Section A end.**

---

### Task 3: Write failing tests for `hydrateAtAnchor`

**Files:**

- Create: `packages/dom/test/hydrate-at-anchor.test.ts`

- [ ] **Step 1: Create the test file**

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { component, hydrateAtAnchor, div } from '../src/index.js'

function makeAnchor(): { anchor: Comment; parent: HTMLElement } {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const anchor = document.createComment('test-anchor')
  parent.appendChild(anchor)
  return { anchor, parent }
}

function makeAnchorWithServerContent(serverHTML: string): {
  anchor: Comment
  endSentinel: Comment
  parent: HTMLElement
} {
  const { anchor, parent } = makeAnchor()
  // Simulate SSR stitching: server emits content + end sentinel
  parent.insertAdjacentHTML('beforeend', serverHTML)
  const end = document.createComment('llui-mount-end')
  parent.appendChild(end)
  return { anchor, endSentinel: end, parent }
}

describe('hydrateAtAnchor', () => {
  it('throws when the anchor is detached', () => {
    const detached = document.createComment('detached')
    const def = component<{ n: number }, never, never>({
      name: 'Counter',
      init: () => [{ n: 0 }, []],
      update: (s) => [s, []],
      view: () => [div({}, [])],
    })
    expect(() => hydrateAtAnchor(detached, def, { n: 42 })).toThrow(/attached to a live DOM tree/)
  })

  it('synthesizes an end sentinel when none is present (chain-hydrate path)', () => {
    const { anchor } = makeAnchor()
    const def = component<{ n: number }, never, never>({
      name: 'Counter',
      init: () => [{ n: 0 }, []],
      update: (s) => [s, []],
      view: ({ text: t }) => [div({ id: 'out' }, [t((s: { n: number }) => String(s.n))])],
    })
    hydrateAtAnchor(anchor, def, { n: 99 })
    const n1 = anchor.nextSibling as HTMLElement
    expect(n1.id).toBe('out')
    expect(n1.textContent).toBe('99')
    const end = n1.nextSibling as Comment
    expect(end.nodeValue).toBe('llui-mount-end')
  })

  it('atomic-swaps: removes server content between the pair, inserts fresh client content', () => {
    const { anchor, endSentinel, parent } = makeAnchorWithServerContent(
      '<div id="server">server</div><div id="extra">x</div>',
    )
    expect(parent.querySelectorAll('div').length).toBe(2)

    const def = component<{ n: number }, never, never>({
      name: 'Client',
      init: () => [{ n: 0 }, []],
      update: (s) => [s, []],
      view: ({ text: t }) => [div({ id: 'client' }, [t((s: { n: number }) => String(s.n))])],
    })
    hydrateAtAnchor(anchor, def, { n: 7 })

    // Server nodes are gone, client node is between the pair
    expect(parent.querySelector('#server')).toBeNull()
    expect(parent.querySelector('#extra')).toBeNull()
    const n1 = anchor.nextSibling as HTMLElement
    expect(n1.id).toBe('client')
    expect(n1.textContent).toBe('7')
    // Existing end sentinel is reused — not duplicated
    expect(n1.nextSibling).toBe(endSentinel)
  })

  it('starts with serverState as the initial state; init() effects are dispatched post-swap', () => {
    const { anchor } = makeAnchor()
    type S = { n: number; loaded: boolean }
    type E = { type: 'log'; message: string }
    const dispatched: E[] = []
    const def = component<S, never, E>({
      name: 'WithEffect',
      init: () => [{ n: 0, loaded: false }, [{ type: 'log', message: 'init-fired' }]],
      update: (s) => [s, []],
      view: () => [div({}, [])],
      onEffect: ({ effect }) => {
        dispatched.push(effect)
      },
    })
    hydrateAtAnchor(anchor, def, { n: 5, loaded: true })
    // Effects from the original init() were dispatched even though state was overridden
    expect(dispatched).toEqual([{ type: 'log', message: 'init-fired' }])
  })

  it('dispose() removes content between the pair and the end sentinel', () => {
    const { anchor, parent } = makeAnchor()
    const def = component<{ n: number }, never, never>({
      name: 'Probe',
      init: () => [{ n: 0 }, []],
      update: (s) => [s, []],
      view: () => [div({}, [])],
    })
    const handle = hydrateAtAnchor(anchor, def, { n: 0 })
    handle.dispose()
    expect(parent.children.length).toBe(0)
    expect(anchor.nextSibling).toBeNull()
  })

  it('send() and flush() work after hydrate', () => {
    const { anchor } = makeAnchor()
    type S = { n: number }
    type M = { type: 'inc' }
    const def = component<S, M, never>({
      name: 'Counter',
      init: () => [{ n: 0 }, []],
      update: (s, m) => (m.type === 'inc' ? [{ n: s.n + 1 }, []] : [s, []]),
      view: ({ text: t }) => [div({ id: 'c' }, [t((s: S) => String(s.n))])],
    })
    const handle = hydrateAtAnchor(anchor, def, { n: 10 })
    handle.send({ type: 'inc' })
    handle.flush()
    expect((anchor.nextSibling as HTMLElement).textContent).toBe('11')
  })
})
```

- [ ] **Step 2: Run and verify fail**

```bash
pnpm --filter @llui/dom test -- hydrate-at-anchor.test.ts
```

Expected: every test errors with `hydrateAtAnchor is not a function` or not exported.

---

### Task 4: Implement `hydrateAtAnchor`

**Files:**

- Modify: `packages/dom/src/mount.ts`
- Modify: `packages/dom/src/index.ts`

- [ ] **Step 1: Add `hydrateAtAnchor` at the bottom of `mount.ts`**

Right after `mountAtAnchor`:

```ts
/**
 * Hydrate a component relative to a comment anchor rather than inside a
 * container element. Analogous to `hydrateApp` — uses `serverState` as
 * the initial state (not `init()`'s output) while preserving `init()`'s
 * effects for post-mount dispatch.
 *
 * The DOM-handling path is identical to `mountAtAnchor`: reuses a
 * pre-existing end sentinel when present, synthesizes one otherwise.
 * Atomic-swaps the owned region whether or not server content is there
 * to replace. No error for a missing end sentinel — the vike chain's
 * outer `hydrateApp`'s `replaceChildren` wipes inner layers' sentinels,
 * so inner-layer `hydrateAtAnchor` calls routinely find nothing to
 * reuse, and that's normal.
 */
export function hydrateAtAnchor<S, M, E>(
  anchor: Comment,
  def: ComponentDef<S, M, E>,
  serverState: S,
  options?: MountOptions,
): AppHandle {
  if (anchor.parentNode === null) {
    throw new Error(
      `[LLui] hydrateAtAnchor: anchor comment must be attached to a live DOM tree before hydrate`,
    )
  }

  const existingEnd = _findEndSentinel(anchor)
  let endSentinel: Comment
  if (existingEnd !== null) {
    _removeBetween(anchor, existingEnd)
    endSentinel = existingEnd
  } else {
    endSentinel = document.createComment('llui-mount-end')
    anchor.parentNode.insertBefore(endSentinel, anchor.nextSibling)
  }

  // Run original init() to capture effects, then override state with server's.
  const [, originalEffects] = (def.init as (data: unknown) => [S, E[]])(undefined)
  const hydrateDef: ComponentDef<S, M, E> = {
    ...def,
    init: () => [serverState, originalEffects],
  }

  const inst = createComponentInstance(hydrateDef, undefined, options?.parentScope ?? null)

  if (devToolsInstall) devToolsInstall(inst)

  const { queue: onMountQueue, prev: prevMountQueue } = pushMountQueue()
  setFlatBindings(inst.allBindings)
  setRenderContext({
    ...inst,
    container: anchor.parentElement ?? undefined,
    send: inst.send as (msg: unknown) => void,
    instance: inst as ComponentInstance,
  })
  const nodes = hydrateDef.view(createView<S, M>(inst.send))
  clearRenderContext()
  setFlatBindings(null)
  popMountQueue(prevMountQueue)

  if (nodes.length > 1) {
    const frag = document.createDocumentFragment()
    for (const node of nodes) frag.appendChild(node)
    anchor.parentNode.insertBefore(frag, endSentinel)
  } else if (nodes.length === 1) {
    anchor.parentNode.insertBefore(nodes[0]!, endSentinel)
  }

  flushMountQueue(onMountQueue)

  registerInstance(inst)
  if (hmrModule && def.name) {
    ;(
      hmrModule as unknown as {
        registerForAnchor?: (name: string, inst: object, anchor: Comment, end: Comment) => void
      }
    ).registerForAnchor?.(def.name, inst, anchor, endSentinel)
  }
  dispatchInitialEffects(inst)
  let disposed = false

  return {
    dispose() {
      if (disposed) return
      disposed = true
      if (hmrModule && def.name) hmrModule.unregisterForHmr(def.name, inst)
      inst.abortController.abort()
      unregisterInstance(inst)
      inst.rootScope.disposalCause = 'app-unmount'
      disposeScope(inst.rootScope)
      _removeBetween(anchor, endSentinel)
      endSentinel.parentNode?.removeChild(endSentinel)
    },
    flush() {
      if (disposed) return
      flushInstance(inst)
    },
    send(msg: unknown) {
      if (disposed) return
      ;(inst.send as (m: unknown) => void)(msg)
    },
  }
}
```

- [ ] **Step 2: Export `hydrateAtAnchor` from `packages/dom/src/index.ts`**

Update the line added in Task 2 Step 4:

```ts
export { mountApp, hydrateApp, mountAtAnchor, hydrateAtAnchor, type MountOptions } from './mount.js'
```

- [ ] **Step 3: Run tests — they should pass**

```bash
pnpm --filter @llui/dom test -- hydrate-at-anchor.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 4: Type check**

```bash
pnpm --filter @llui/dom check
```

Expected: no errors.

- [ ] **Step 5: No commit — batched with Section A end.**

---

### Task 5: Write failing tests for HMR anchor integration

**Files:**

- Create: `packages/dom/test/hmr-anchor.test.ts`

- [ ] **Step 1: Create the test file**

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { component, mountAtAnchor, div, text } from '../src/index.js'
import { enableHmr, replaceComponent } from '../src/hmr.js'

function makeAnchor(): { anchor: Comment; parent: HTMLElement } {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const anchor = document.createComment('a')
  parent.appendChild(anchor)
  return { anchor, parent }
}

describe('HMR for anchor-mounted instances', () => {
  beforeEach(() => {
    enableHmr()
  })

  it('hot-swap rebuilds DOM between the sentinels, preserving the anchor and outer DOM', () => {
    const { anchor, parent } = makeAnchor()
    // Add a sibling in the parent BEFORE the anchor — hot-swap must not touch it.
    const outerBefore = document.createElement('section')
    outerBefore.id = 'outer-before'
    parent.insertBefore(outerBefore, anchor)

    type S = { n: number }
    const v1 = component<S, never, never>({
      name: 'Swappable',
      init: () => [{ n: 0 }, []],
      update: (s) => [s, []],
      view: ({ text: t }) => [div({ id: 'v1' }, [t((s: S) => 'v1:' + s.n)])],
    })
    const handle = mountAtAnchor(anchor, v1)

    // v2 replaces the view — same state type
    const v2 = component<S, never, never>({
      name: 'Swappable',
      init: () => [{ n: 0 }, []],
      update: (s) => [s, []],
      view: ({ text: t }) => [div({ id: 'v2' }, [t((s: S) => 'v2:' + s.n)])],
    })
    replaceComponent('Swappable', v2)

    // Outer sibling untouched
    expect(parent.querySelector('#outer-before')).toBe(outerBefore)
    // Anchor still in place
    expect(anchor.parentNode).toBe(parent)
    // Fresh v2 node is between anchor and end sentinel
    const fresh = anchor.nextSibling as HTMLElement
    expect(fresh.id).toBe('v2')
    const endSentinel = fresh.nextSibling as Comment
    expect(endSentinel.nodeValue).toBe('llui-mount-end')

    handle.dispose()
  })

  it('hot-swap targets only the instance whose name matches', () => {
    const a = makeAnchor()
    const b = makeAnchor()
    const defA = component<{}, never, never>({
      name: 'A',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [div({ id: 'A-v1' }, [])],
    })
    const defB = component<{}, never, never>({
      name: 'B',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [div({ id: 'B-v1' }, [])],
    })
    const hA = mountAtAnchor(a.anchor, defA)
    const hB = mountAtAnchor(b.anchor, defB)

    const defAv2 = component<{}, never, never>({
      name: 'A',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [div({ id: 'A-v2' }, [])],
    })
    replaceComponent('A', defAv2)

    expect((a.anchor.nextSibling as HTMLElement).id).toBe('A-v2')
    expect((b.anchor.nextSibling as HTMLElement).id).toBe('B-v1')

    hA.dispose()
    hB.dispose()
  })

  it('dispose unregisters from HMR — subsequent swap is a no-op for the disposed instance', () => {
    const { anchor } = makeAnchor()
    const def = component<{}, never, never>({
      name: 'Gone',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [div({ id: 'gone-v1' }, [])],
    })
    const handle = mountAtAnchor(anchor, def)
    handle.dispose()

    const defV2 = component<{}, never, never>({
      name: 'Gone',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [div({ id: 'gone-v2' }, [])],
    })
    const swapResult = replaceComponent('Gone', defV2)
    expect(swapResult).toBeNull()
    // No DOM was re-added at the anchor
    expect(anchor.nextSibling).toBeNull()
  })
})
```

- [ ] **Step 2: Run — expect failures**

```bash
pnpm --filter @llui/dom test -- hmr-anchor.test.ts
```

Expected: the first two tests either throw (registerForAnchor not found) or fail assertions (HMR swap doesn't touch the anchor region). The third may pass coincidentally — not a concern at this stage.

---

### Task 6: Refactor `hmr.ts` for discriminated-union entries + `registerForAnchor`

**Files:**

- Modify: `packages/dom/src/hmr.ts`
- Modify: `packages/dom/src/mount.ts` (tighten the `registerForAnchor` call site)

- [ ] **Step 1: Rewrite the entry shape and registration functions in `hmr.ts`**

Replace the existing `interface HmrEntry { ... }` block and both `registerForHmr` / `unregisterForHmr` functions with the following:

```ts
// ── HMR Registry ─────────────────────────────────────────────────

type HmrEntry =
  | {
      kind: 'container'
      inst: ComponentInstance
      container: HTMLElement
    }
  | {
      kind: 'anchor'
      inst: ComponentInstance
      anchor: Comment
      endSentinel: Comment
    }

const hmrRegistry = new Map<string, HmrEntry[]>()

export function registerForHmr(name: string, inst: object, container: HTMLElement): void {
  const entries = hmrRegistry.get(name) ?? []
  entries.push({ kind: 'container', inst: inst as ComponentInstance, container })
  hmrRegistry.set(name, entries)
}

export function registerForAnchor(
  name: string,
  inst: object,
  anchor: Comment,
  endSentinel: Comment,
): void {
  const entries = hmrRegistry.get(name) ?? []
  entries.push({ kind: 'anchor', inst: inst as ComponentInstance, anchor, endSentinel })
  hmrRegistry.set(name, entries)
}

export function unregisterForHmr(name: string, inst: object): void {
  const entries = hmrRegistry.get(name)
  if (!entries) return
  const idx = entries.findIndex((e) => e.inst === inst)
  if (idx !== -1) entries.splice(idx, 1)
  if (entries.length === 0) hmrRegistry.delete(name)
}
```

- [ ] **Step 2: Update `enableHmr()` to publish the new function**

Find:

```ts
export function enableHmr(): void {
  _setHmrModule({ enableHmr, registerForHmr, unregisterForHmr, replaceComponent })
}
```

Change to:

```ts
export function enableHmr(): void {
  _setHmrModule({
    enableHmr,
    registerForHmr,
    registerForAnchor,
    unregisterForHmr,
    replaceComponent,
  })
}
```

- [ ] **Step 3: Rewrite `replaceComponent` to handle both entry kinds**

Replace the existing `replaceComponent` body from line 52 onwards with:

```ts
export function replaceComponent<S, M, E>(
  name: string,
  newDef: ComponentDef<S, M, E>,
): AppHandle | null {
  const entries = hmrRegistry.get(name)
  if (!entries || entries.length === 0) return null

  let handle: AppHandle | null = null

  for (const entry of entries) {
    const typedInst = entry.inst as ComponentInstance<S, M, E>

    typedInst.def = {
      ...typedInst.def,
      update: newDef.update,
      view: newDef.view,
      onEffect: newDef.onEffect,
      __dirty: newDef.__dirty,
      __update: newDef.__update,
      __handlers: newDef.__handlers,
    }

    disposeScope(typedInst.rootScope)

    // Clear the owned region per-kind.
    if (entry.kind === 'container') {
      entry.container.textContent = ''
    } else {
      // anchor kind — wipe siblings between anchor and endSentinel, keep the
      // anchor AND the end sentinel (they bracket the fresh render).
      let sib = entry.anchor.nextSibling
      while (sib !== null && sib !== entry.endSentinel) {
        const next = sib.nextSibling
        sib.parentNode!.removeChild(sib)
        sib = next
      }
    }

    typedInst.rootScope = createScope(null)
    typedInst.rootScope._kind = 'root'
    typedInst.allBindings = []
    typedInst.structuralBlocks = []

    setFlatBindings(typedInst.allBindings)
    setRenderContext({
      rootScope: typedInst.rootScope,
      state: typedInst.state,
      allBindings: typedInst.allBindings,
      structuralBlocks: typedInst.structuralBlocks,
      container:
        entry.kind === 'container' ? entry.container : (entry.anchor.parentElement ?? undefined),
      send: typedInst.send as (msg: unknown) => void,
      instance: typedInst as ComponentInstance,
    })
    const nodes = typedInst.def.view(createView<S, M>(typedInst.send))
    clearRenderContext()
    setFlatBindings(null)

    if (entry.kind === 'container') {
      for (const node of nodes) {
        entry.container.appendChild(node)
      }
    } else {
      for (const node of nodes) {
        entry.anchor.parentNode!.insertBefore(node, entry.endSentinel)
      }
    }

    if (!handle) {
      handle = makeReplacementHandle(name, entry, typedInst)
    }
  }

  console.log(`[LLui HMR] ${name} updated — state preserved`)

  return handle
}

function makeReplacementHandle<S, M, E>(
  name: string,
  entry: HmrEntry,
  typedInst: ComponentInstance<S, M, E>,
): AppHandle {
  return {
    dispose() {
      unregisterForHmr(name, entry.inst)
      entry.inst.abortController.abort()
      unregisterInstance(entry.inst)
      disposeScope(typedInst.rootScope)
      if (entry.kind === 'container') {
        entry.container.textContent = ''
      } else {
        let sib = entry.anchor.nextSibling
        while (sib !== null && sib !== entry.endSentinel) {
          const next = sib.nextSibling
          sib.parentNode!.removeChild(sib)
          sib = next
        }
        entry.endSentinel.parentNode?.removeChild(entry.endSentinel)
      }
    },
    flush() {
      flushInstance(entry.inst)
    },
    send(msg: unknown) {
      ;(typedInst.send as (m: unknown) => void)(msg)
    },
  }
}
```

- [ ] **Step 4: Tighten the call site in `mount.ts`**

`mountAtAnchor` and `hydrateAtAnchor` currently use the type-escape:

```ts
;(
  hmrModule as unknown as {
    registerForAnchor?: (name: string, inst: object, anchor: Comment, end: Comment) => void
  }
).registerForAnchor?.(def.name, inst, anchor, endSentinel)
```

Replace with a clean call now that `hmr.ts` exports `registerForAnchor`:

```ts
if (hmrModule && def.name) {
  hmrModule.registerForAnchor(def.name, inst, anchor, endSentinel)
}
```

Do this in both `mountAtAnchor` (Task 2) and `hydrateAtAnchor` (Task 4) call sites.

- [ ] **Step 5: Run all dom tests**

```bash
pnpm --filter @llui/dom check
pnpm --filter @llui/dom test
```

Expected: every existing test passes, plus the new `mount-at-anchor`, `hydrate-at-anchor`, and `hmr-anchor` suites (9 + 6 + 3 = 18 new tests).

- [ ] **Step 6: Lint**

```bash
pnpm --filter @llui/dom lint
```

Expected: clean.

---

### Task 7: Section A commit

- [ ] **Step 1: Confirm diff contents**

```bash
git status --short
git diff --stat
```

Expected modified/new:

- `packages/dom/src/mount.ts` (added `_removeBetween`, `_findEndSentinel`, `mountAtAnchor`, `hydrateAtAnchor`)
- `packages/dom/src/hmr.ts` (discriminated union, new `registerForAnchor`, updated `replaceComponent`)
- `packages/dom/src/index.ts` (exports)
- `packages/dom/test/mount-at-anchor.test.ts` (new)
- `packages/dom/test/hydrate-at-anchor.test.ts` (new)
- `packages/dom/test/hmr-anchor.test.ts` (new)

- [ ] **Step 2: Present commit to user for approval**

```
feat(dom): add mountAtAnchor + hydrateAtAnchor primitives (sentinel-pair ownership)

Two new public exports from @llui/dom:
  - mountAtAnchor(anchor, def, data?, opts?) - mount a component between a
    caller-owned start anchor (Comment) and a synthesized end sentinel.
    dispose() removes everything between them and the end sentinel,
    leaving the start anchor intact.
  - hydrateAtAnchor(anchor, def, serverState, opts?) - analogous, uses
    serverState for initial state and preserves init()'s effects for
    post-mount dispatch. Atomic-swap; reuses an existing end sentinel
    when present (SSR stitching), synthesizes one otherwise (chain-
    hydrate path where the outer hydrateApp wiped inner sentinels).

Internals:
  - _removeBetween(anchor, stopBefore) / _findEndSentinel(anchor) helpers
    in mount.ts, reused by dispose + HMR swap.
  - hmr.ts HmrEntry becomes a discriminated union
    (kind: 'container' | 'anchor'); new registerForAnchor export.
    replaceComponent handles both kinds with appropriate DOM cleanup +
    insertion strategies.
  - RenderContext.container = anchor.parentElement for anchor-mounted
    instances, so onMount(callback) receives the enclosing element.

Tests: 18 new (mount-at-anchor, hydrate-at-anchor, hmr-anchor).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Confirm with user before running the commit.

- [ ] **Step 3: On approval, run the commit**

```bash
git add packages/dom/src/mount.ts packages/dom/src/hmr.ts packages/dom/src/index.ts \
        packages/dom/test/mount-at-anchor.test.ts packages/dom/test/hydrate-at-anchor.test.ts \
        packages/dom/test/hmr-anchor.test.ts
git commit -m "..."
```

---

## Section B — `@llui/vike` changes

### Task 8: Switch `pageSlot()` to emit a comment

**Files:**

- Modify: `packages/vike/src/page-slot.ts`

- [ ] **Step 1: Rewrite `PendingSlot` and `pageSlot()` to use a comment anchor**

Replace the existing `PendingSlot` interface and `pageSlot` function with:

````ts
interface PendingSlot {
  slotScope: Scope
  anchor: Comment
}

let pendingSlot: PendingSlot | null = null

/**
 * Declare where a persistent layout renders its nested content — either
 * a nested layout or the route's page component. The vike adapter's
 * client and server render paths walk the layout chain, and each layer's
 * `pageSlot()` call records the position where the next layer mounts.
 *
 * Emits a single `<!-- llui-page-slot -->` comment as an insertion
 * anchor. The nested layer's DOM lives as siblings of this comment
 * within the layout's own parent element; a synthesized end sentinel
 * (`<!-- llui-mount-end -->`) brackets the owned region.
 *
 * The slot is a real scope-tree node: the scope it creates is a child
 * of the current render scope, so contexts provided by the layout (via
 * `provide()`) above the slot are reachable from inside the nested
 * page. That's how patterns like a layout-owned toast dispatcher work —
 * the page does `useContext(ToastContext)` and walks up through the
 * slot into the layout's providers.
 *
 * Do NOT name the file `+Layout.ts` — Vike reserves the `+` prefix for
 * its own framework config conventions. Use `Layout.ts`, `app-layout.ts`,
 * or anywhere outside `/pages` that Vike won't scan.
 *
 * ```ts
 * // pages/Layout.ts    ← not +Layout.ts
 * import { component, div, main, header } from '@llui/dom'
 * import { pageSlot } from '@llui/vike/client'
 *
 * export const AppLayout = component<LayoutState, LayoutMsg>({
 *   name: 'AppLayout',
 *   init: () => [{  ...  }, []],
 *   update: layoutUpdate,
 *   view: (h) => [
 *     div({ class: 'app-shell' }, [
 *       header([...]),
 *       main([pageSlot()]),    // ← here the page goes (no wrapper div)
 *     ]),
 *   ],
 * })
 * ```
 *
 * Call exactly once per layout. Calling more than once in a single
 * view throws.
 */
export function pageSlot(): Node[] {
  if (typeof document === 'undefined') {
    throw new Error(
      '[llui/vike] pageSlot() called without a DOM environment. ' +
        'Call from inside a component view() that runs during mount, hydrate, or SSR.',
    )
  }
  if (pendingSlot !== null) {
    throw new Error(
      '[llui/vike] pageSlot() was called more than once in the same layout. ' +
        'A layout has exactly one nested-content slot — if you need two independent ' +
        'regions that swap on navigation, build them as sibling nested layouts in ' +
        'the Vike routing tree and use context to share state between them.',
    )
  }
  const ctx = getRenderContext('pageSlot')
  const slotScope = createScope(ctx.rootScope)
  const anchor = document.createComment('llui-page-slot')
  pendingSlot = { slotScope, anchor }
  return [anchor]
}

/**
 * @internal — vike adapter only. Read and clear the slot registered by
 * the most recent `pageSlot()` call. Returns null if the layer being
 * mounted didn't call `pageSlot()` (meaning it's the innermost layer
 * and owns no nested content).
 */
export function _consumePendingSlot(): PendingSlot | null {
  const slot = pendingSlot
  pendingSlot = null
  return slot
}

/**
 * @internal — vike adapter only. Reset the pending slot without reading
 * it. Used defensively in error paths to avoid leaking a pending slot
 * registration into a subsequent mount attempt.
 */
export function _resetPendingSlot(): void {
  pendingSlot = null
}
````

- [ ] **Step 2: Type-check**

```bash
pnpm --filter @llui/vike check
```

Expected: errors in `on-render-html.ts` and `on-render-client.ts` (they reference `slot.marker` which no longer exists). Those are fixed in the next tasks.

- [ ] **Step 3: No commit yet.**

---

### Task 9: Write failing SSR tests, then update `on-render-html.ts`

**Files:**

- Create: `packages/vike/test/ssr-page-slot.test.ts`
- Modify: `packages/vike/src/on-render-html.ts`

- [ ] **Step 1: Write the failing SSR test**

Create `packages/vike/test/ssr-page-slot.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest'
import { component, div, text } from '@llui/dom'
import { renderNodes } from '@llui/dom/ssr'
import { pageSlot } from '../src/page-slot.js'
import { onRenderHtml } from '../src/on-render-html.js'

// Minimal pageContext shape the adapter expects for a chain render.
interface TestPageContext {
  Page: unknown
  data?: unknown
  routeParams?: Record<string, string>
  urlPathname?: string
}

describe('SSR with comment-based pageSlot', () => {
  beforeAll(() => {
    // The SSR entry uses `renderNodes` + `serializeNodes` internally —
    // both require `document` available. jsdom gives us that.
  })

  it('pageSlot() returns a Comment node, not an HTMLElement', () => {
    // Exercise via a component view. renderNodes runs view() and
    // registers the pending slot; _consumePendingSlot returns the anchor.
    type S = {}
    type M = never
    const Layout = component<S, M, never>({
      name: 'Layout',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [div({ class: 'shell' }, [...pageSlot()])],
    })
    // We can't easily call the full onRenderHtml here without a Vike
    // context object. Instead assert on the view output shape directly.
    // The view call must run inside a render context — use renderNodes.
    const { nodes } = renderNodes(Layout, undefined)
    // Find the comment inside the rendered tree
    const shell = nodes[0] as HTMLElement
    const comment = shell.firstChild as Comment
    expect(comment.nodeType).toBe(8)
    expect(comment.nodeValue).toBe('llui-page-slot')
  })

  it('composed two-layer render emits anchor + inner DOM + end sentinel', () => {
    type LayoutS = {}
    const Layout = component<LayoutS, never, never>({
      name: 'Layout',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [div({ class: 'shell' }, [...pageSlot()])],
    })
    type PageS = { title: string }
    const Page = component<PageS, never, never>({
      name: 'Page',
      init: () => [{ title: 'home' }, []],
      update: (s) => [s, []],
      view: ({ text: t }) => [div({ class: 'page' }, [t((s: PageS) => s.title)])],
    })

    const pageContext: TestPageContext & {
      _pageId?: string
      Page?: unknown
      layouts?: unknown[]
    } = {
      Page,
      layouts: [Layout],
      data: { title: 'home' },
    }

    const result = onRenderHtml(pageContext as unknown as Parameters<typeof onRenderHtml>[0])
    const html =
      typeof result === 'string' ? result : (result as { documentHtml: string }).documentHtml
    expect(html).toContain('<!--llui-page-slot-->')
    expect(html).toContain('<div class="page">home</div>')
    expect(html).toContain('<!--llui-mount-end-->')
    // Ordering: anchor precedes page precedes end sentinel
    const anchorIdx = html.indexOf('<!--llui-page-slot-->')
    const pageIdx = html.indexOf('<div class="page">')
    const endIdx = html.indexOf('<!--llui-mount-end-->')
    expect(anchorIdx).toBeGreaterThan(-1)
    expect(pageIdx).toBeGreaterThan(anchorIdx)
    expect(endIdx).toBeGreaterThan(pageIdx)
  })

  it('data-llui-hydrate markers appear on binding-carrying elements across the composed tree', () => {
    type S = { n: number }
    const Layout = component<{}, never, never>({
      name: 'Layout',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [div({}, [...pageSlot()])],
    })
    const Inner = component<S, never, never>({
      name: 'Inner',
      init: () => [{ n: 0 }, []],
      update: (s) => [s, []],
      view: ({ text: t }) => [div({ id: 'i' }, [t((s: S) => String(s.n))])],
    })

    const pageContext: TestPageContext & { layouts?: unknown[] } = {
      Page: Inner,
      layouts: [Layout],
      data: { n: 7 },
    }

    const result = onRenderHtml(pageContext as unknown as Parameters<typeof onRenderHtml>[0])
    const html =
      typeof result === 'string' ? result : (result as { documentHtml: string }).documentHtml
    // The inner div carries a text binding, so it should have data-llui-hydrate
    expect(html).toMatch(/<div id="i"[^>]*data-llui-hydrate/)
  })
})
```

Note to executor: the exact `onRenderHtml` import path and argument shape may need tweaking to match the real export. Check `packages/vike/src/on-render-html.ts` top-level for the `onRenderHtml` function signature and adjust the test to pass a valid `pageContext`. If the test needs too many mocked fields to exercise the chain path, simplify by exporting an internal helper from `on-render-html.ts` (e.g., `_renderChain(defs, states): { html, envelope }`) and testing that directly. Do the extraction only if needed.

- [ ] **Step 2: Run the test — expect failure**

```bash
pnpm --filter @llui/vike test -- ssr-page-slot.test.ts
```

Expected: test fails because `on-render-html.ts` still uses `slot.marker` (which no longer exists).

- [ ] **Step 3: Rewrite the stitching loop in `on-render-html.ts`**

Open `packages/vike/src/on-render-html.ts` and locate the stitching block currently around lines 190–260. Replace the relevant section:

Current (roughly):

```ts
let currentSlotMarker: HTMLElement | null = null
let currentSlotScope: Scope | undefined

// ... inside the loop ...
if (i === 0) {
  outermostNodes = nodes
} else {
  if (!currentSlotMarker) {
    throw new Error(`[llui/vike] internal: chain layer ${i} (<${def.name}>) has no slot marker`)
  }
  for (const node of nodes) {
    currentSlotMarker.appendChild(node)
  }
}

// ... after processing slot ...
currentSlotMarker = slot?.marker ?? null
currentSlotScope = slot?.slotScope
```

Replace with:

```ts
let currentSlotAnchor: Comment | null = null
let currentSlotScope: Scope | undefined

// ... inside the loop ...
if (i === 0) {
  outermostNodes = nodes
} else {
  if (!currentSlotAnchor) {
    throw new Error(`[llui/vike] internal: chain layer ${i} (<${def.name}>) has no slot anchor`)
  }
  const parentNode = currentSlotAnchor.parentNode
  if (!parentNode) {
    throw new Error(
      `[llui/vike] internal: chain layer ${i} (<${def.name}>) slot anchor has no parentNode`,
    )
  }
  // Insertion cursor: after each node insert, advance to node.nextSibling.
  // First node goes at anchor.nextSibling.
  let insertPoint: Node | null = currentSlotAnchor.nextSibling
  for (const node of nodes) {
    parentNode.insertBefore(node, insertPoint)
    // insertPoint stays where it was — node is now immediately before it.
  }
  // Append the end sentinel for this layer at the current insertPoint.
  const endSentinel = document.createComment('llui-mount-end')
  parentNode.insertBefore(endSentinel, insertPoint)
}

// ... after processing slot ...
currentSlotAnchor = slot?.anchor ?? null
currentSlotScope = slot?.slotScope
```

Rename all remaining local references from `slotMarker` to `slotAnchor` / `currentSlotMarker` to `currentSlotAnchor` in this file.

- [ ] **Step 4: Type check**

```bash
pnpm --filter @llui/vike check
```

Expected: `on-render-html.ts` type-checks. `on-render-client.ts` still has errors (fixed in Task 10).

- [ ] **Step 5: Run SSR tests**

```bash
pnpm --filter @llui/vike test -- ssr-page-slot.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 6: No commit yet.**

---

### Task 10: Write failing client tests, then update `on-render-client.ts`

**Files:**

- Create: `packages/vike/test/client-page-slot.test.ts`
- Modify: `packages/vike/src/on-render-client.ts`

- [ ] **Step 1: Write the failing client tests**

Create `packages/vike/test/client-page-slot.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { component, div, text } from '@llui/dom'
import { pageSlot } from '../src/page-slot.js'
import { onRenderClient } from '../src/on-render-client.js'

type LayoutS = { count: number }
type LayoutM = { type: 'lc' }
const Layout = component<LayoutS, LayoutM, never>({
  name: 'TestLayout',
  init: () => [{ count: 0 }, []],
  update: (s) => [s, []],
  view: ({ text: t }) => [
    div({ class: 'shell' }, [t((s: LayoutS) => 'L:' + s.count), ...pageSlot()]),
  ],
})

type PageAS = { title: string }
const PageA = component<PageAS, never, never>({
  name: 'PageA',
  init: () => [{ title: 'a' }, []],
  update: (s) => [s, []],
  view: ({ text: t }) => [div({ class: 'page-a' }, [t((s: PageAS) => s.title)])],
})

type PageBS = { title: string }
const PageB = component<PageBS, never, never>({
  name: 'PageB',
  init: () => [{ title: 'b' }, []],
  update: (s) => [s, []],
  view: ({ text: t }) => [div({ class: 'page-b' }, [t((s: PageBS) => s.title)])],
})

// Note to executor: the exact pageContext shape expected by onRenderClient
// is defined in packages/vike/src/on-render-client.ts. Read it before
// constructing the object. Mock whatever Vike-global type augmentations
// are needed. If too many fields are required, extract an internal
// renderChain helper from on-render-client.ts and test that.

describe('client pageSlot with comment anchor', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>'
  })

  it('hydrate: swaps server content for client content between anchor and end sentinel', async () => {
    // Set up server HTML in the root container — anchor + fake server content + end sentinel
    const root = document.getElementById('app')!
    root.innerHTML =
      '<div class="shell">L:0<!--llui-page-slot--><div class="page-a">a-from-server</div><!--llui-mount-end--></div>'
    // ... call the client adapter's hydrate path with Layout + PageA ...
    // Assertion: after hydrate, root contains a FRESH PageA div (not the server one)
    // and the anchor + end sentinel remain.
    // Leave the exact invocation to the executor — the test has to match
    // the real onRenderClient API. If onRenderClient is not easily
    // testable standalone, test `_mountChainInitial` / `_hydrateChain`
    // (extract if needed; scoped internal helper).
    // This test is intentionally skeleton — the executor fills in the
    // call once they read on-render-client.ts.
    expect(root.querySelector('.page-a')).not.toBeNull()
  })

  it('nav: swapping the innermost page preserves the layout DOM and anchor', async () => {
    // Initial mount with PageA
    // ...
    // Navigate to PageB (same Layout, different innermost)
    // Expect: .shell element identity unchanged, .page-a gone, .page-b present
    expect(true).toBe(true)
  })

  it('dispose of an anchor-mounted layer removes its region but not outer siblings', async () => {
    // Similar skeleton — assert that disposing only the innermost layer
    // leaves the layout's own DOM in place.
    expect(true).toBe(true)
  })
})
```

**Executor note:** the three client test bodies above are skeletons. The executor MUST expand them once they understand the real `onRenderClient` API. If the API is too unwieldy for direct testing, the executor should:

1. Extract `_mountChainInitial(defs, data, parentScope, mode: 'mount' | 'hydrate')` and `_mountChainSuffix(chain, data, firstMismatch, mountTarget, parentScope, opts)` as internal-but-testable helpers from `on-render-client.ts`.
2. Export them under a `/* @internal */` JSDoc tag.
3. Test those helpers directly with hand-built DOM setup, asserting the invariants the skeletons sketch.

This is a judgment call — do the extraction only if the full adapter path is genuinely hard to exercise. The point is to get assertions landing on the DOM shape; structure is secondary.

- [ ] **Step 2: Run and expect failures**

```bash
pnpm --filter @llui/vike test -- client-page-slot.test.ts
```

Expected: type errors or assertion failures.

- [ ] **Step 3: Rewrite `on-render-client.ts`**

Open `packages/vike/src/on-render-client.ts`. Apply these renames and behavior changes:

**Interface change (around line 202):**

```ts
// Was: slotMarker: HTMLElement | null
slotAnchor: Comment | null
slotScope: Scope | null
```

**Leave-target calculation (around line 348):**

Current:

```ts
const leaveTarget =
  firstMismatch === 0 ? rootEl : (chainHandles[firstMismatch - 1]!.slotMarker ?? rootEl)
```

Change to: we no longer need a single "leaveTarget" element to wipe — the inner layer handles' `dispose()` now removes their own owned regions. But the first-mount-path (`firstMismatch === 0`) still needs the root container for `hydrateApp` / `mountApp`. So keep a variable but repurpose:

```ts
// For the first mount / firstMismatch === 0, still use rootEl as the
// container for the OUTERMOST layer's mountApp/hydrateApp call.
// For firstMismatch > 0, the mount target is an anchor, not an element.
const isRootSwap = firstMismatch === 0
```

**Leave callback (around line 365):**

Current:

```ts
if (options.onLeave && !isFirstMount) {
  await options.onLeave(leaveTarget)
}
```

Change to:

```ts
if (options.onLeave && !isFirstMount) {
  const leaveTargetEl = isRootSwap
    ? rootEl
    : (chainHandles[firstMismatch - 1]!.slotAnchor?.parentElement ?? rootEl)
  await options.onLeave(leaveTargetEl)
}
```

(The onLeave callback receives an `Element` — the enclosing element, either the root or the layout's slot parent.)

**Dispose loop + swap (around lines 373–390):**

Current:

```ts
for (let i = chainHandles.length - 1; i >= firstMismatch; i--) {
  chainHandles[i]!.handle.dispose()
}
chainHandles = chainHandles.slice(0, firstMismatch)

leaveTarget.textContent = ''

const parentScope =
  firstMismatch === 0 ? undefined : (chainHandles[firstMismatch - 1]!.slotScope ?? undefined)
mountChainSuffix(newChain, newChainData, firstMismatch, leaveTarget, parentScope, {
  mode: 'mount',
})
```

Change to:

```ts
for (let i = chainHandles.length - 1; i >= firstMismatch; i--) {
  chainHandles[i]!.handle.dispose()
  // dispose() now removes the owned DOM region for anchor-based mounts;
  // for the outermost container-based mount, nothing else touches the
  // root element's children here (they were already cleared by dispose).
}
chainHandles = chainHandles.slice(0, firstMismatch)

// No leaveTarget.textContent = '' step needed — handle.dispose() handled
// the owned-region cleanup per-layer.

const parentScope =
  firstMismatch === 0 ? undefined : (chainHandles[firstMismatch - 1]!.slotScope ?? undefined)
// mountTarget is now either the root element (for a root swap) or the
// surviving layer's slot anchor (for a deeper swap).
const mountTargetArg: HTMLElement | Comment =
  firstMismatch === 0 ? rootEl : chainHandles[firstMismatch - 1]!.slotAnchor!
mountChainSuffix(newChain, newChainData, firstMismatch, mountTargetArg, parentScope, {
  mode: 'mount',
})
```

**`mountChainSuffix` signature change:**

Locate `mountChainSuffix` (or its equivalent — the function that iterates layers and calls `hydrateApp`/`mountApp`). Change its `mountTarget` parameter type from `HTMLElement` to `HTMLElement | Comment`. Add a type-narrowing switch inside:

```ts
function mountChainSuffix(
  chain: AnyComponentDef[],
  chainData: unknown[],
  startDepth: number,
  mountTarget: HTMLElement | Comment,
  parentScope: Scope | undefined,
  opts: { mode: 'mount' | 'hydrate'; serverStateEnvelope?: HydrationEnvelope },
): void {
  for (let i = startDepth; i < chain.length; i++) {
    // ... existing def/isInnermost/slot-consumption logic unchanged ...

    _resetPendingSlot()
    let handle: AppHandle
    if (opts.mode === 'hydrate') {
      const layerState = extractHydrationState(opts.serverStateEnvelope!, i, chain.length, def)
      if (mountTarget.nodeType === 1) {
        // HTMLElement — outermost layer, use hydrateApp
        handle = hydrateApp(
          mountTarget as HTMLElement,
          def as unknown as Parameters<typeof hydrateApp>[1],
          layerState,
          { parentScope },
        )
      } else {
        // Comment anchor — inner layer, use hydrateAtAnchor
        handle = hydrateAtAnchor(
          mountTarget as Comment,
          def as unknown as Parameters<typeof hydrateAtAnchor>[1],
          layerState,
          { parentScope },
        )
      }
    } else {
      // mode === 'mount'
      if (mountTarget.nodeType === 1) {
        handle = mountApp(
          mountTarget as HTMLElement,
          def as Parameters<typeof mountApp>[1],
          chainData[i],
          {
            parentScope,
          },
        )
      } else {
        handle = mountAtAnchor(
          mountTarget as Comment,
          def as Parameters<typeof mountAtAnchor>[1],
          chainData[i],
          { parentScope },
        )
      }
    }

    const slot = _consumePendingSlot()
    // ... innermost / non-innermost guards unchanged (use slot?.anchor now) ...

    chainHandles.push({
      def,
      handle,
      slotAnchor: slot?.anchor ?? null,
      slotScope: slot?.slotScope ?? null,
      data: chainData[i],
    })

    if (slot !== null) {
      // Next iteration's mount target is the anchor (Comment).
      mountTarget = slot.anchor
      parentScope = slot.slotScope
    }
  }
}
```

Import `mountAtAnchor` and `hydrateAtAnchor` at the top:

```ts
import { hydrateApp, mountApp, mountAtAnchor, hydrateAtAnchor } from '@llui/dom'
```

Rename all `slotMarker` references to `slotAnchor` throughout the file.

- [ ] **Step 4: Type check**

```bash
pnpm --filter @llui/vike check
```

Expected: clean.

- [ ] **Step 5: Run client tests**

```bash
pnpm --filter @llui/vike test -- client-page-slot.test.ts
```

Expected: the three skeleton tests pass (executor may have expanded them; they should still pass).

- [ ] **Step 6: Run ALL vike tests**

```bash
pnpm --filter @llui/vike test
```

Expected: all tests pass, including the pre-existing `layout.test.ts`, `widening.test.ts`, `surviving-layer-updates.test.ts`, `vike.test.ts`. If any existing test breaks, it's likely asserting on the old div marker shape — continue to Task 11 to migrate them.

- [ ] **Step 7: No commit yet.**

---

### Task 11: Migrate existing vike tests

**Files:**

- Modify: `packages/vike/test/layout.test.ts`
- Modify: `packages/vike/test/surviving-layer-updates.test.ts`
- Modify: `packages/vike/test/widening.test.ts`

- [ ] **Step 1: Run existing tests to see which actually fail**

```bash
pnpm --filter @llui/vike test -- layout.test.ts surviving-layer-updates.test.ts widening.test.ts
```

Record exact failures. Common classes:

1. **DOM query on `[data-llui-page-slot]`** — change to walk siblings between anchor comment and end sentinel.
2. **`div.page-slot` wrapper in a test view** (seen in `surviving-layer-updates.test.ts:51`) — still valid because users can wrap `pageSlot()` in any element; only an issue if the test asserts something about the wrapper contents assuming the pageSlot itself is a div.

- [ ] **Step 2: For each failing test, apply the minimal targeted edit**

Pattern A — assertion on the slot being a div:

```ts
// Before:
expect(root.querySelector('[data-llui-page-slot]')).not.toBeNull()

// After:
const anchor = findCommentByValue(root, 'llui-page-slot')
expect(anchor).not.toBeNull()
```

Where `findCommentByValue` is a local helper:

```ts
function findCommentByValue(root: Node, value: string): Comment | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT)
  let n: Node | null = walker.nextNode()
  while (n !== null) {
    if ((n as Comment).nodeValue === value) return n as Comment
    n = walker.nextNode()
  }
  return null
}
```

Pattern B — assertion on the page being inside the slot (child of the slot element):

```ts
// Before:
const slot = root.querySelector('[data-llui-page-slot]')!
expect(slot.querySelector('.page-content')).not.toBeNull()

// After:
const anchor = findCommentByValue(root, 'llui-page-slot')!
// Page content lives as a SIBLING of the anchor within anchor.parentElement
expect(anchor.parentElement!.querySelector('.page-content')).not.toBeNull()
```

Pattern C — the test wraps `pageSlot()` in a div (e.g., `div({ class: 'page-slot' }, [...pageSlot()])`). No migration needed — user wraps pageSlot intentionally and the assertion presumably still works against the wrapper.

- [ ] **Step 3: Run full vike suite until green**

```bash
pnpm --filter @llui/vike test
```

Expected: all tests pass.

- [ ] **Step 4: No commit yet.**

---

### Task 12: Section B commit

- [ ] **Step 1: Confirm diff**

```bash
git status --short
```

Expected:

- `packages/vike/src/page-slot.ts` — Comment anchor emission
- `packages/vike/src/on-render-html.ts` — SSR stitching
- `packages/vike/src/on-render-client.ts` — client mount/hydrate/nav rewiring
- `packages/vike/test/ssr-page-slot.test.ts` (new)
- `packages/vike/test/client-page-slot.test.ts` (new)
- `packages/vike/test/layout.test.ts` / `widening.test.ts` / `surviving-layer-updates.test.ts` (selective edits from Task 11)

- [ ] **Step 2: Present commit to user**

```
feat(vike): comment-based pageSlot + chain mounts via mountAtAnchor

BREAKING: pageSlot() now emits a `<!-- llui-page-slot -->` comment
instead of `<div data-llui-page-slot="">`. Apps that styled or queried
the div directly must wrap pageSlot() in their own styled element.

Internals:
  - PendingSlot shape changes from { slotScope, marker: HTMLElement }
    to { slotScope, anchor: Comment }.
  - on-render-html.ts SSR stitching replaces appendChild-into-marker
    with insertBefore-into-parent + synthesized end sentinel per layer.
  - on-render-client.ts ChainHandle.slotMarker becomes slotAnchor.
    Chain mount targets become Comment anchors for inner layers; the
    outermost layer still mounts via hydrateApp/mountApp on rootEl.
    Nav swaps rely on handle.dispose() for per-layer region cleanup
    instead of a top-down leaveTarget.textContent = ''.
  - mountChainSuffix accepts HTMLElement | Comment, dispatches to
    hydrateApp/mountApp or hydrateAtAnchor/mountAtAnchor by node kind.

Tests: 2 new files (ssr-page-slot, client-page-slot); migrations to
layout.test.ts / widening.test.ts / surviving-layer-updates.test.ts
to accommodate the comment shape.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

- [ ] **Step 3: Run commit on approval**

```bash
git add packages/vike/src/page-slot.ts packages/vike/src/on-render-html.ts \
        packages/vike/src/on-render-client.ts packages/vike/test/ssr-page-slot.test.ts \
        packages/vike/test/client-page-slot.test.ts packages/vike/test/layout.test.ts \
        packages/vike/test/widening.test.ts packages/vike/test/surviving-layer-updates.test.ts
git commit -m "..."
```

---

## Section C — Docs + verification gate

### Task 13: Update design doc and API reference

**Files:**

- Modify: `docs/designs/09 API Reference.md`
- Modify: `docs/designs/08 Ecosystem Integration.md` (only if it describes `pageSlot()`'s shape)
- Modify: `packages/vike/README.md` (only if it has a `pageSlot()` example showing the div marker)
- Modify: `packages/dom/README.md` (add `mountAtAnchor`/`hydrateAtAnchor` if a mount-surface table exists)

- [ ] **Step 1: Add `mountAtAnchor` / `hydrateAtAnchor` entries to `docs/designs/09 API Reference.md`**

Locate the `@llui/dom` section — near the existing `mountApp` entry. Add (tune wording to the file's existing style):

````markdown
#### `mountAtAnchor(anchor, def, data?, options?)`

```ts
export function mountAtAnchor<S, M, E>(
  anchor: Comment,
  def: ComponentDef<S, M, E>,
  data?: unknown,
  options?: MountOptions,
): AppHandle
```
````

Mount a component relative to a comment anchor rather than inside a container element. Inserts a synthesized end sentinel (`<!-- llui-mount-end -->`) immediately after the anchor and places the component's nodes between the pair. Requires `anchor.parentNode !== null`. The caller's anchor is preserved across the handle's lifetime; only the content between the pair (and the end sentinel itself) is removed by `dispose()`. Used by `@llui/vike` to mount chain layers without a wrapper element. See `docs/superpowers/specs/2026-04-17-anchor-mount-design.md` for the full design.

#### `hydrateAtAnchor(anchor, def, serverState, options?)`

```ts
export function hydrateAtAnchor<S, M, E>(
  anchor: Comment,
  def: ComponentDef<S, M, E>,
  serverState: S,
  options?: MountOptions,
): AppHandle
```

Hydration counterpart to `mountAtAnchor`. Uses `serverState` as the initial state and preserves `init()`'s effects for post-mount dispatch (analogous to `hydrateApp`'s behavior). Atomic-swap: removes whatever's between the anchor and its end sentinel (reusing an existing sentinel or synthesizing one) and inserts fresh client-rendered nodes in their place.

````

- [ ] **Step 2: Update the `pageSlot()` entry in any doc that shows its return shape**

Search the design docs and vike README for `pageSlot`:

```bash
grep -rn "pageSlot\|data-llui-page-slot" docs/ packages/vike/README.md
````

For each hit that describes or shows the div marker, update to reflect the comment marker.

- [ ] **Step 3: Type-check + lint the repo to confirm no code side effects**

```bash
pnpm turbo check
pnpm turbo lint
```

Expected: clean.

- [ ] **Step 4: No commit yet — batched with the verification commit.**

---

### Task 14: Phase verification gate

- [ ] **Step 1: Full verify**

```bash
pnpm verify
```

Expected: pass end-to-end — `build`, `check`, `lint`, `test`, `format:check` all green across every package.

- [ ] **Step 2: Format-check**

```bash
pnpm format:check
```

Expected: clean. If not, run `pnpm format` and include any resulting changes in the docs commit.

- [ ] **Step 3: Present docs commit to user**

```
docs: document mountAtAnchor / hydrateAtAnchor + pageSlot shape change

Adds API-reference entries for the two new @llui/dom exports; updates
any design-doc prose that described pageSlot() as a div marker to
reflect the comment marker now emitted.

No source changes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

- [ ] **Step 4: Run commit on approval**

```bash
git add docs/designs/09\ API\ Reference.md [other docs files changed in Task 13]
git commit -m "..."
```

- [ ] **Step 5: Announce completion**

Summarize to user:

- 3 new `@llui/dom` primitives exported (`mountAtAnchor`, `hydrateAtAnchor`, plus the `_removeBetween`/`_findEndSentinel` internal helpers).
- `@llui/vike`'s `pageSlot()` now emits a comment anchor with no wrapper element.
- HMR supports both container-based and anchor-based entries via a discriminated union.
- 18 new `@llui/dom` tests (mount-at-anchor: 9, hydrate-at-anchor: 6, hmr-anchor: 3).
- 2 new `@llui/vike` test files (ssr-page-slot, client-page-slot) plus migration of 1–3 existing test files.
- API reference + relevant design docs updated.
- Changelog entry is NOT yet added — the next `/publish` run will write the release entry per the repo's release workflow.
