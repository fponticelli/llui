# `DomEnv` threading — remove `globalThis` mutation from SSR

**Date:** 2026-04-18
**Status:** Design approved in outline; pending implementation plan
**Scope:** Thread the DOM implementation through `@llui/dom`'s render pipeline as an injected context instead of mutating `globalThis`. Replace `initSsrDom()` with per-call `DomEnv` injection. Add sub-entries `@llui/dom/ssr/jsdom` and `@llui/dom/ssr/linkedom` that ship pre-built envs. Breaking change to the SSR entry contract; client-side `mountApp`/`hydrateApp` API unchanged.

---

## 1. Motivation

`@llui/dom`'s current SSR story has three defects that compound. The immediate one that prompted this spec — bundle bloat on Cloudflare Workers — is a symptom.

### 1.1 Global mutation defeats bundlers

`initSsrDom()` (in `packages/dom/src/ssr-dom.ts`) calls `await import('jsdom')`, constructs a `JSDOM` instance, and mutates `globalThis` with the window's DOM classes. The render primitives then reach for `document.createElement`, `new Comment(...)`, etc. at module scope.

Rollup walks the module graph statically. `import('jsdom')` in source creates a lazy chunk; Workers' bundler (workerd/esbuild) has no code-splitting runtime, so it inlines that chunk into the main bundle. Result: **~9 MiB of jsdom ships to a Worker that never executes the line**. The user's workaround today — pre-install a different DOM implementation (linkedom) on `globalThis` before any `@llui/dom` code runs — works at runtime but doesn't help the bundle.

No amount of cleverness at the `initSsrDom` level (factory argument, `(0, eval)`, vite plugin rewrite) addresses the deeper issue: as long as the render primitives reach into `globalThis`, LLui is coupled to whatever the caller stuffs there, and the bundler has to guess.

### 1.2 Singleton process DOM is wrong under concurrency

`globalThis` is per-process. Two `renderToString` calls sharing a process can't use different DOM implementations, can't isolate test state, and leak each other's mutations. Concrete consequences:

- A CI run that tests two SSR frameworks in one Node process can't use linkedom for one and jsdom for the other.
- A Worker deployment that multiplexes several LLui apps per isolate has to hope they all want the same DOM.
- Dev-time hot restart of `vite build --ssr` while the previous process is still warming the module cache hits stale globals.

The bug isn't abstract. Two of the workarounds in dicerun2's Worker deployment (reset `document` between requests, skip `initSsrDom` entirely on second entry) exist solely to paper over the singleton.

### 1.3 `globalThis` mutation is forbidden in strict isolates

Cloudflare Workers' strict isolate mode and some edge runtimes (Deno with `--no-permit-sys`, SvelteKit's adapter-cloudflare in some configurations) refuse `globalThis[key] = ...` assignments to native-like identifiers at runtime. The current `initSsrDom` crashes under those conditions.

### 1.4 The fix aligns with modern rendering frameworks

React Server Components, Astro, Qwik, and SolidStart all thread their "server DOM" (or equivalent) through a context object passed to each render call, never a process-level global. The model is:

- Render entry point accepts a DOM/runtime binding alongside state.
- Each primitive's render context carries the binding down to the leaves.
- Test/CI/Worker runtimes inject whatever DOM they have; nothing is implied.

LLui's render primitives already accept a `RenderContext` object (`packages/dom/src/render-context.ts` — carries `rootLifetime`, `state`, `allBindings`, `structuralBlocks`). Adding a `dom` field and threading it through is a natural extension of a pattern the codebase already embraces.

---

## 2. High-level architecture

### 2.1 The `DomEnv` interface

A small record of DOM constructors and factory methods — exactly the surface `@llui/dom`'s internals need. Not a full Window, not a `globalThis` shape. The renderer depends on this interface, not on `document`:

```ts
export interface DomEnv {
  // Factories — construction points for new nodes.
  createElement(tag: string): Element
  createElementNS(ns: string, tag: string): Element // SVG, MathML
  createTextNode(text: string): Text
  createComment(text: string): Comment
  createDocumentFragment(): DocumentFragment

  // Node constructors exposed for `instanceof` checks + rare direct uses.
  readonly Element: typeof Element
  readonly Node: typeof Node
  readonly Text: typeof Text
  readonly Comment: typeof Comment
  readonly DocumentFragment: typeof DocumentFragment
  readonly HTMLElement: typeof HTMLElement
  readonly HTMLTemplateElement: typeof HTMLTemplateElement
  readonly ShadowRoot: typeof ShadowRoot

  // Event constructor for dispatch-from-runtime paths (e.g. devtools).
  readonly MouseEvent: typeof MouseEvent

  // Inner-text parser for `unsafeHtml` — jsdom/linkedom both expose
  // either `DOMParser` or the same parseFromString shape through the
  // window's innerHTML property. Adapter responsibility.
  parseHtmlFragment(html: string): DocumentFragment

  /**
   * @internal When true, the env wraps the browser `globalThis`
   * (client-side default). Enables fast paths that elide per-call
   * env lookups — DOM operations go straight to `document.*`.
   */
  readonly isBrowser?: boolean
}
```

Every DOM touch inside `@llui/dom` goes through this interface. The interface names match the exact methods/classes the runtime currently calls — grep against `/^\s*document\.\w+/` and the node-type `instanceof` sites produces this list exhaustively.

### 2.2 Injection path

`DomEnv` flows through the same render-context plumbing the runtime already uses:

```
mountApp(container, def, data?)
    │
    ▼
  creates inst.dom = browserEnv()   // default: wraps window globals
    │
    ▼
  sets RenderContext.dom = inst.dom
    │
    ▼
  each primitive (branch, scope, each, show, text, …) reads ctx.dom
    │
    ▼
  DOM construction calls go through ctx.dom.createElement(...) etc.
```

On the SSR side:

```
renderToString(def, initialState, env)  // env is REQUIRED in SSR builds
    │
    ▼
  inst.dom = env
  RenderContext.dom = env
    │
    ▼
  same render path; DOM construction uses env.createElement(...)
```

No `globalThis` touches anywhere in the render path. `mountApp`'s default env wraps the browser's window — that's the only place the browser globals are referenced.

### 2.3 Sub-entry responsibilities

| Entry | Exports | Imports DOM impl |
|---|---|---|
| `@llui/dom` | `mountApp`, `hydrateApp`, `mountAtAnchor`, `hydrateAtAnchor`, all primitives | No — defaults to `browserEnv()` which reads from `globalThis` lazily at mount time |
| `@llui/dom/ssr` | `renderToString`, `renderNodes`, `serializeNodes`, `DomEnv` type, `browserEnv()` helper | No |
| `@llui/dom/ssr/jsdom` | `jsdomEnv(): Promise<DomEnv>` | Yes — lazy `await import('jsdom')` |
| `@llui/dom/ssr/linkedom` | `linkedomEnv(): Promise<DomEnv>` | Yes — lazy `await import('linkedom')` |

A Worker build that imports only `@llui/dom/ssr/linkedom` has zero reachable references to jsdom. Rollup walks the graph and finds linkedom only. Bundle shrinks from 9+ MiB to whatever linkedom's footprint is (~200 KiB).

### 2.4 `initSsrDom` deprecation

The existing `initSsrDom()` export from `@llui/dom/ssr` becomes a deprecated shim that imports `jsdomEnv` + calls it + mutates globals for backward compat, emitting a dev-mode console warning pointing at the new API. Removed entirely in a future breaking release. The shim still pulls jsdom — consumers who care about bundle size **must migrate**.

---

## 3. API

### 3.1 `DomEnv` + factory helpers

```ts
// packages/dom/src/dom-env.ts — new public type module

export interface DomEnv { /* see §2.1 */ }

/**
 * Wrap the browser globals as a DomEnv. Used as the default env for
 * `mountApp` / `hydrateApp` on the client. Evaluates `globalThis` lazily
 * so the env itself is construct-safe on a server process that
 * evaluates the module before a DOM exists.
 */
export function browserEnv(): DomEnv
```

The `browserEnv()` call constructs a lightweight proxy-like object whose methods delegate to `document.*` / `window.*`. It does NOT mutate `globalThis`. The env can be constructed safely on a server process (the delegation lookups happen only when methods are called).

### 3.2 `jsdomEnv` and `linkedomEnv`

```ts
// packages/dom/src/ssr/jsdom.ts — new sub-entry

import type { DomEnv } from '../dom-env.js'
export async function jsdomEnv(): Promise<DomEnv> { /* …constructs a fresh jsdom per call… */ }
```

```ts
// packages/dom/src/ssr/linkedom.ts — new sub-entry

import type { DomEnv } from '../dom-env.js'
export async function linkedomEnv(): Promise<DomEnv> { /* …linkedom-backed… */ }
```

Both return fresh `DomEnv`s per call. No process-level state, no singletons, no global mutation.

### 3.3 `renderToString` + `renderNodes` — new required `env`

```ts
// packages/dom/src/ssr.ts

export function renderToString<S, M, E, D = void>(
  def: ComponentDef<S, M, E, D>,
  initialState: S | undefined,
  env: DomEnv,
): string

export function renderNodes<S, M, E, D = void>(
  def: ComponentDef<S, M, E, D>,
  initialState: S | undefined,
  env: DomEnv,
  parentLifetime?: Lifetime,
): { nodes: Node[]; inst: ComponentInstance<S, M, E> }
```

`env` is required — call sites without an env fail compile. This is the main breaking change.

`serializeNodes` does not gain an env (it operates on already-built nodes and only reads node properties — `nodeType`, `tagName`, `attributes`).

### 3.4 `mountApp` / `hydrateApp` — optional `env` in `MountOptions`

```ts
export interface MountOptions {
  devTools?: boolean
  parentLifetime?: Lifetime
  /**
   * DOM env override. Defaults to `browserEnv()` — the browser globals.
   * Only specify when mounting into a non-browser DOM (e.g. a jsdom
   * instance held by a test harness, or an isolated DOM per shadow
   * root).
   */
  env?: DomEnv
}
```

Client-side callers don't pay any API cost: existing `mountApp(container, def)` continues to work. The SSR side was the one that demanded the global shim.

### 3.5 `onMount` + DOM-reading helpers

Primitives that read from the DOM at runtime (not just construct it) — `onMount` callbacks, `foreign.mount`, event handlers — continue to receive real DOM nodes. These primitives don't need env injection at the callback level; they're invoked in a lifetime that already has env bound via its render context, and the DOM nodes they receive are already env-created.

### 3.6 `initSsrDom` — deprecated

```ts
/** @deprecated Call `jsdomEnv()` + pass the result to `renderToString`.
 *  `initSsrDom()` mutates `globalThis` — bad for concurrent SSR and
 *  forbidden on strict isolate runtimes (Cloudflare Workers).
 *  This shim will be removed in a future breaking release. */
export async function initSsrDom(): Promise<void>
```

Keeps jsdom in its bundle so existing callers don't break, but logs a deprecation warning. Documentation points at the migration.

---

## 4. Runtime integration

### 4.1 `RenderContext` gains a `dom` field

```ts
// packages/dom/src/render-context.ts
export interface RenderContext {
  rootLifetime: Lifetime
  state: unknown
  allBindings: Binding[]
  structuralBlocks: StructuralBlock[]
  send?: (msg: unknown) => void
  container?: HTMLElement
  instance?: ComponentInstance
  dom: DomEnv  // NEW — required
}
```

`getRenderContext(primitiveName)` throws with a clearer error when `dom` isn't set (current code assumes `document` exists).

### 4.2 Internal DOM call migration

Every `document.createElement` / `new Comment(...)` / etc. call in `@llui/dom`'s src becomes `ctx.dom.createElement(...)` / `ctx.dom.createComment(...)`. Touch map (exhaustive — 19 files, ~40 call sites from grep):

- `elements.ts`, `svg-elements.ts`, `mathml-elements.ts` — element helper factories: every `document.createElement(...)` → `ctx.dom.createElement(...)`, `createElementNS` for SVG/MathML.
- `el-split.ts`, `el-template.ts` — compiler-output targets: template clones go through `ctx.dom.createElement`.
- `primitives/{text,branch,each,show,portal,foreign,child,lazy,virtual-each,selector,on-mount,unsafe-html}.ts` — structural primitives that synthesize anchor comments and fragments.
- `mount.ts`, `hydrate.ts` — entry points that read `opts.env ?? browserEnv()` and seed the render context.

### 4.3 `browserEnv()` fast path

For client-side mounts (the common case), `browserEnv()` constructs a minimal object that delegates directly to `window.*`. The delegation is inlined by V8/SpiderMonkey; benchmark should confirm no measurable regression (`js-framework-benchmark` is the baseline).

A `isBrowser: true` marker on the env lets hot-path code elide env indirection when needed (e.g. `el-split.ts`'s template-clone path checks this flag and bypasses the env for pure-browser builds). Sparing use — only applied where profiling justifies it.

### 4.4 Element instance checks

`instanceof HTMLElement` appears in a few places (binding targeting, type guards). These go through `ctx.dom.HTMLElement`. Client-side, `ctx.dom.HTMLElement === globalThis.HTMLElement` so the check is semantically identical.

### 4.5 Non-render `document` touches

Some `@llui/dom` code touches `document` outside of the render path — devtools, MCP bridge instrumentation, test helpers. These continue to reference `globalThis.document` because they run in contexts where a browser global exists (or they're dev-only and never reach Workers). No change.

### 4.6 `unsafeHtml` parser

Currently `unsafeHtml` creates a `<template>` element and sets `innerHTML` to parse arbitrary HTML. Moves to `ctx.dom.parseHtmlFragment(html)`. Adapters implement this differently — jsdom exposes `DOMParser`, linkedom has its own fragment parser, browser uses template-element trick. The interface abstracts the choice.

---

## 5. Sub-entry details

### 5.1 `@llui/dom/ssr/jsdom` — `jsdomEnv()`

```ts
export async function jsdomEnv(): Promise<DomEnv> {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
  const w = dom.window
  return {
    createElement: (tag) => w.document.createElement(tag),
    createElementNS: (ns, tag) => w.document.createElementNS(ns, tag),
    createTextNode: (text) => w.document.createTextNode(text),
    createComment: (text) => w.document.createComment(text),
    createDocumentFragment: () => w.document.createDocumentFragment(),
    Element: w.Element,
    Node: w.Node,
    Text: w.Text,
    Comment: w.Comment,
    DocumentFragment: w.DocumentFragment,
    HTMLElement: w.HTMLElement,
    HTMLTemplateElement: w.HTMLTemplateElement,
    ShadowRoot: w.ShadowRoot,
    MouseEvent: w.MouseEvent,
    parseHtmlFragment: (html) => {
      const template = w.document.createElement('template')
      template.innerHTML = html
      return template.content
    },
  }
}
```

Each call returns a FRESH env — no process-level state, safe under concurrency.

### 5.2 `@llui/dom/ssr/linkedom` — `linkedomEnv()`

```ts
export async function linkedomEnv(): Promise<DomEnv> {
  const { parseHTML } = await import('linkedom')
  const { document, Element, Node, Text, Comment, DocumentFragment,
          HTMLElement, HTMLTemplateElement, ShadowRoot, MouseEvent } =
    parseHTML('<!DOCTYPE html><html><body></body></html>')
  return { /* same shape as jsdomEnv */ }
}
```

Identical shape; different underlying library. A test matrix verifies both envs pass the full render-suite.

### 5.3 `@llui/dom/ssr` — the generic entry

Exports:
- `renderToString(def, state?, env)`
- `renderNodes(def, state?, env, parentLifetime?)`
- `serializeNodes(nodes, bindings)`
- `type DomEnv`
- `browserEnv()` — for client-side tests or browser-in-node setups
- `initSsrDom()` — deprecated shim (keeps the `await import('jsdom')` line with a `/* @vite-ignore */` or moved to `./ssr/jsdom` re-export so it can be tree-shaken when unused)

No unconditional DOM implementation imports.

### 5.4 Package.json exports map

```json
{
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./devtools": { /* unchanged */ },
    "./ssr": { "types": "./dist/ssr.d.ts", "import": "./dist/ssr.js" },
    "./ssr/jsdom": { "types": "./dist/ssr/jsdom.d.ts", "import": "./dist/ssr/jsdom.js" },
    "./ssr/linkedom": { "types": "./dist/ssr/linkedom.d.ts", "import": "./dist/ssr/linkedom.js" },
    "./hmr": { /* unchanged */ },
    "./internal": { /* unchanged */ }
  },
  "peerDependenciesMeta": {
    "jsdom": { "optional": true },
    "linkedom": { "optional": true }
  }
}
```

Both DOM libraries are optional peer dependencies — consumers install whichever they use.

---

## 6. Migration — SSR consumers

### 6.1 Before

```ts
import { initSsrDom } from '@llui/dom/ssr'
import { renderToString } from '@llui/dom'

await initSsrDom()                           // mutates globalThis
const html = renderToString(MyApp, initialState)
```

### 6.2 After

```ts
import { renderToString } from '@llui/dom/ssr'
import { jsdomEnv } from '@llui/dom/ssr/jsdom'

const env = await jsdomEnv()                 // fresh, no globals
const html = renderToString(MyApp, initialState, env)
```

### 6.3 Linkedom (was: hand-patched globals)

Before:
```ts
import { parseHTML } from 'linkedom'
const { document, Element, /* ... */ } = parseHTML('<!DOCTYPE html>...')
Object.assign(globalThis, { document, Element, /* ... */ })
import { renderToString } from '@llui/dom'
renderToString(MyApp, state)
```

After:
```ts
import { renderToString } from '@llui/dom/ssr'
import { linkedomEnv } from '@llui/dom/ssr/linkedom'

const env = await linkedomEnv()
const html = renderToString(MyApp, state, env)
```

### 6.4 Cloudflare Workers

Before: 9+ MiB bundle with transitive jsdom (`tr46`, `whatwg-url`, `punycode`, …). Failed at runtime because `require("punycode/")` doesn't resolve under workerd.

After: import only `@llui/dom/ssr/linkedom`; rollup walks linkedom only. Bundle ~200 KiB, runs on workerd.

### 6.5 Vike adapter

`@llui/vike`'s `onRenderHtml` currently calls `initSsrDom` before `renderToString`. Migrates to accept an env factory in its setup options:

```ts
import { createOnRenderHtml } from '@llui/vike'
import { jsdomEnv } from '@llui/dom/ssr/jsdom'
export const onRenderHtml = createOnRenderHtml({
  Layout: MyLayout,
  domEnv: jsdomEnv,   // or linkedomEnv, or a user factory
})
```

The adapter caches the env per-process for repeat renders (configurable — passing a factory that returns fresh envs each call gives per-request isolation).

---

## 7. Testing strategy

### 7.1 `packages/dom/test/dom-env.test.ts`

New test file with parametrized render tests that run against every bundled env:

- `browserEnv()` (jsdom-backed via test setup)
- `jsdomEnv()`
- `linkedomEnv()`

Each runs the full render suite — mount a component, assert DOM shape, tick an update, assert new shape. Proves that `@llui/dom`'s internals are DOM-implementation-agnostic.

### 7.2 `packages/dom/test/concurrent-ssr.test.ts`

Test that two `renderToString` calls with different envs in the same process produce correct, independent output — proves the singleton is gone.

### 7.3 `packages/dom/test/ssr-bundle-shape.test.ts`

Static test: import `@llui/dom/ssr` (not any sub-entry), stringify the module's source, assert the string `'jsdom'` / `'linkedom'` / `'JSDOM'` does not appear. Guards against accidental imports creeping back in.

### 7.4 Vike e2e

`packages/vike`'s existing SSR tests retarget `createOnRenderHtml({ domEnv: jsdomEnv })`. Additional test: `createOnRenderHtml({ domEnv: linkedomEnv })` passes all existing assertions. Proves the adapter itself is env-agnostic.

### 7.5 Existing test regression

Every test under `packages/dom/test/` currently runs in a vitest-jsdom environment — `document` exists globally before `@llui/dom` is imported. Those tests continue to work without changes because `mountApp` defaults to `browserEnv()`, which delegates to `globalThis.document`.

---

## 8. Error handling

### 8.1 Missing env on SSR

`renderToString(def, state, undefined as never)` — TS rejects at compile. At runtime (JS callers, dynamic imports), throws `[LLui] renderToString requires a DomEnv. Import jsdomEnv/linkedomEnv from @llui/dom/ssr/{jsdom,linkedom} or provide a custom env.`

### 8.2 Env method missing

If a user-supplied env is incomplete (e.g. missing `parseHtmlFragment`), the runtime calls it, TS says function-or-undefined, runtime throws with a descriptive `[LLui] DomEnv.<method> not implemented` error. An optional dev-mode env validator (runs once at env creation) checks for required methods up-front.

### 8.3 `initSsrDom` shim

Emits one-time `console.warn` pointing at the migration guide, then does its old globals-mutating thing. Tests verify the warning fires exactly once per process.

---

## 9. Compiler interaction

None of the vite-plugin's passes depend on the DOM — it operates on TypeScript AST. No changes to `@llui/vite-plugin`.

The only compiler-adjacent consideration: the compiler's template-clone output (`el-split.ts`, `el-template.ts`) currently emits `document.createElement(...)` literals. Those become `ctx.dom.createElement(...)` — the compiler's generated code accesses the render context, which it already does for `__dirty`/`__mask` gating.

---

## 10. Out of scope

- **Client-only / island primitive** — a separate concern, will be addressed in a follow-up spec. Bundler semantics for `onMount` bodies are module-graph level, orthogonal to runtime DOM injection.
- **Streaming SSR** — `renderToString` stays synchronous-DOM-under-the-hood. Streaming is a future concern and will need its own render-pipeline refactor.
- **Web component / custom element registration** — `customElements.define` still touches globals. This spec leaves it alone; custom elements are a client-only concern today.
- **SSR hydration state for async-loaded data** — hydration is already separate from DOM injection; no coupling.

---

## 11. Rollout

### 11.1 Single commit series, one release

- Commit 1: `DomEnv` type + `browserEnv()` + RenderContext plumbing (no behavior change — default env, all tests still pass on the existing jsdom-via-globals setup).
- Commit 2: Migrate each internal `document.*` call to `ctx.dom.*` (mechanical find-and-replace with test-driven verification per file).
- Commit 3: Add `@llui/dom/ssr/jsdom` + `@llui/dom/ssr/linkedom` sub-entries.
- Commit 4: Change `renderToString` / `renderNodes` signatures — `env` becomes required.
- Commit 5: Deprecate `initSsrDom` — shim warns.
- Commit 6: Update `@llui/vike`'s SSR adapter to accept + thread the env factory.
- Commit 7: Docs + migration guide + CHANGELOG.

Ships as a single release. `@llui/dom` bumps a patch or minor (breaking for SSR consumers only). `@llui/vike` bumps in lockstep.

### 11.2 No feature flag

The deprecation shim is the compatibility bridge for consumers on old code paths. A feature flag (per-consumer env on/off) would create two code paths to maintain and hide the correctness wins behind opt-in.

### 11.3 Breaking change surface

- `renderToString(def, state?)` → `renderToString(def, state, env)` (new required arg). Type error at compile for every existing SSR call site.
- `@llui/dom/ssr`'s `initSsrDom` still exports but deprecated.
- `@llui/dom/ssr/jsdom` and `/linkedom` are new sub-entries; not breaking by themselves.

### 11.4 Follow-ups

- Remove `initSsrDom` shim in a later breaking release.
- Profile `browserEnv()` overhead; if non-negligible, add an `isBrowser` fast-path bypass at hot sites in `el-split.ts`.
- Extend `DomEnv` with a `scheduler` hook if/when streaming SSR arrives.
