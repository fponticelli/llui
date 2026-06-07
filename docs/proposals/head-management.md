# Proposal: head / metadata management (`title` / `meta` / `link` / `htmlAttr` / `bodyAttr`)

**Status:** ✅ Implemented (Phases 1–4) in `@llui/dom` + `@llui/vike`. · **Audience:** future session.

**What shipped:** `title`/`titleTemplate`/`meta`/`link`/`htmlAttr`/`bodyAttr` plus the full tag set `base`/`style`/`script`/`noscript` (`packages/dom/src/signals/head.ts`), the `HeadSink` contract with `domHeadSink` (client) + `collectHeadSink` (server) + `mergeStaticHead`, the `registerBinding`/`onTeardown`/`currentDoc` public extension points + `SignalDoc.head`/`documentElement` (`dom.ts`), `escapeAttr` export (`ssr.ts`), and the Vike SSR wiring (`on-render-html.ts`: shared collector threaded through `_renderChain`, `DocumentContext.htmlAttrs`/`bodyAttrs`, default-template `<html>`/`<body>` interpolation, static-head override). `style`/`script` dedup by a static `id`/`src` (or are anonymous, keyed by stable construction order). Tests: `packages/dom/test/signals/head.test.ts`, `head-ssr.test.ts`, `head-prop.test.ts`, `packages/vike/test/ssr-head.test.ts`. API reference regenerated into `site/content/api/{dom,vike}.md`. Full repo build + check + lint + test green.

**One design refinement vs. the original plan below:** sink resolution is **per-document** (a `WeakMap<Document, HeadSink>` fallback in `head.ts`), not per-root-seeded-in-`mount()`. Per-document is the correct granularity for the single shared `document.head` (two app roots on one page coordinate deterministically rather than fight), it is _not_ a harmful cross-document global (the server uses a fresh `DomEnv` per request and seeds a `collectHeadSink` via context anyway), and it removed the need for any `on-render-client` change — `domHeadSink` adopts server-rendered `data-llui-head` elements automatically, so hydration neither duplicates nor flashes. The original per-root note is kept below for the reasoning.

---

**Original design (pre-implementation).** **Cites files as starting points; re-verify against current code** (memory/code drift).

LLui has `portal()` (full React-portal equivalent, `packages/dom/src/signals/dom.ts:540`) but **no Helmet-equivalent**: there is no way to set `document.title`, `<meta>`, `<link>`, or `<html>`/`<body>` attributes reactively from page/component content, and SSR only accepts a static `head` string from Vike's `+Head.ts` (`packages/vike/src/on-render-html.ts:53`). This proposal adds that, with full SSR collection and hydration adoption.

## Design decisions (locked)

- **Location:** `@llui/dom` core — separate tree-shakeable exports alongside `portal`/`foreign`. An app that imports no head primitive pays nothing.
- **Dedup:** full last-writer-wins registry (per-key stack), so a nested page overrides its layout's title/meta and restores on unmount. The keyed registry doubles as the SSR collector.
- **html/body attrs:** included. Requires extending `DocumentContext` + `DEFAULT_DOCUMENT` (`on-render-html.ts:56`, `:72`) with `htmlAttrs`/`bodyAttrs` — breaking for custom Vike templates, acceptable (all consumers controlled).
- **No compiler change.** Head primitives are view-helper functions that consume signal handles via the `isSignalHandle` path (same as `foreign`, `authoring.ts:372`) — a first-class supported form per CLAUDE.md. Compiler lowering would be a premature optimization; gated behind a future profile per the measure-first rule.

## The unifying insight

A head primitive is **a `BindingSpec` whose `commit` target is a node in `document.head` (or an html/body attribute), not an inline element**. It reuses the existing binding machinery (`deps`/`produce`/`commit`, `dom.ts:54`) and the chunked-mask reconciler verbatim — so reactivity, mask gating, and `batch()` single-pass coalescing all come for free. It returns an inline placeholder comment (the `portal`/`onMount` pattern: comment inline, real effect elsewhere) and registers a teardown.

On the server the same binding commits into a **collector** instead of a live node; the collector serializes to the `head` string Vike already threads into the document template. One abstraction (`HeadSink`) backs both client and server.

Why not `portal(() => [el('title', …)], document.head)`? Portal-to-head cannot dedup, cannot produce an SSR string, and cannot express html/body attributes (they are not nodes). The sink earns its existence.

## Public API

```ts
import { title, meta, link, htmlAttr, bodyAttr } from '@llui/dom'

view: ({ state }) => [
  title(state.map(s => s.pageTitle)),                    // <title>…</title>
  meta({ name: 'description', content: state.map(s => s.desc) }),
  meta({ property: 'og:image', content: imageUrl }),     // static value
  link({ rel: 'canonical', href: state.map(s => s.url) }),
  htmlAttr({ lang: state.map(s => s.lang) }),            // <html lang="…">
  bodyAttr({ class: state.map(s => s.theme) }),
  // …page content…
  div([...]),
]
```

- Value type everywhere: `HeadValue<T> = T | Signal<T>`. A `state.map(...)`/`state.at(...)` handle carries `produce`+`deps`; a plain value becomes a `deps: []` static spec. Normalized via `isSignalHandle` exactly like `foreign`.
- Each returns a `Mountable`, built lazily at placement under the live `ctx` — so capture/reuse and `show`/`branch` remount work like every other primitive.
- **`titleTemplate(tpl: HeadValue<string>)`** — a layout declares `titleTemplate('%s · LLui')`, a page declares `title('Docs')` → resolves to `Docs · LLui`. The per-key stack makes this nearly free (a template entry the title entry composes against at commit). This is the actual reason Helmet's layout/page model exists; included for completeness.
- **Tag-generic from day one.** The sink's `register(key, tag)` is tag-agnostic, so `base` / `style` / `script` / `noscript` are thin authoring wrappers with no redesign. Ship title/meta/link/htmlAttr/bodyAttr/titleTemplate first; the rest are trivial follow-ons.

## Architecture — the `HeadSink`

A single mutable coordinator, **owned per app-root** and seeded into root contexts by the runtime mount/hydrate path. Resolved via the existing context system (`useContext`, `dom.ts:608`) so layout + page share one and dedup works across the chain.

> ⚠️ **No module-global singleton.** An early draft used a lazily-created module-level `domHeadSink()` as the default. That is global mutable state: it breaks with multiple `mount()` roots on one page (they stomp each other's head and dedup across unrelated apps) and mirrors the SSR-concurrency footgun. The sink MUST be created per root by `mount()`/`hydrateSignalApp` and provided at the root context. `document.head` is genuinely shared, so each root owns and cleans up only its own keys (last root to set `<title>` wins) — but there is zero hidden global state.

```ts
interface HeadEntry {
  key: string
  tag: string
  attrs: Record<string, unknown>
  text?: string
}

interface HeadSink {
  // register an entry under a key; returns a controller the binding commits through.
  register(
    key: string,
    tag: string,
  ): {
    set(attrs: Record<string, unknown>, text?: string): void // called by commit()
    release(): void // called by teardown
  }
}
```

Two implementations:

1. **`domHeadSink(headEl, htmlEl, bodyEl)`** (client) — writes to live DOM. On `register`, first **adopts** an existing server-rendered element matching the key (marked `data-llui-head="<key>"`) and snapshots its current value; otherwise creates one. `set` applies attrs via the existing `applyAttr` (`dom.ts:288`) / sets `<title>` text / sets an html/body attribute.

2. **`collectHeadSink()`** (server) — accumulates `HeadEntry` records keyed; `set` overwrites in place. Exposes `serialize(): { head: string; htmlAttrs: string; bodyAttrs: string }`, **escaping every attribute value and title text through `@llui/dom`'s existing SSR serializer** (`ssr.ts` `serializeNodes`) — never hand-rolled string concatenation (XSS).

### Last-writer-wins stack (the hard part)

Per key, the sink keeps a **stack of live writers**, each holding its **current** committed value (kept up to date on every commit, even while not the active/top writer). Only the top writer's value is applied to the DOM/collector.

- A layout's `title` binding keeps firing on layout-state changes while a page is on top — the sink records the new value into the layout's (non-top) stack entry but does not apply it.
- On `release` (page unmounts), pop the entry and re-apply the **latest** value of the new top writer — not a registration-time snapshot. (An early draft said "restore the previous value," which would ship a stale-restore bug.)
- For html/body attrs, the base entry of the stack is the **pre-existing/server-rendered attribute value** captured at adoption, so full teardown restores the original `lang="en"` rather than deleting it.
- When the stack **fully empties** (no live writer remains — the last `show`/`branch`/component arm that placed the entry unmounts), an _element_ entry is handled by ownership: an **LLui-owned** element (client-created, OR an SSR tag we emitted and re-adopted via its `data-llui-head` marker) is **removed** from `<head>`; only a genuinely **foreign** pre-existing element (an unmarked static `<title>` in the HTML template) is **restored** to its captured base. Restoring an adopted SSR tag instead of removing it would leak it onto the next client route (e.g. a home-only JSON-LD `<script>` gated by `show()` surviving a `/ → /docs` SPA navigation).

**Keys:** `title` → `"title"`; `meta` → `"meta:name=<name>"` / `"meta:property=<property>"` / `"meta:http-equiv=<x>"`; `link` → `"link:rel=<rel>:href=<href>"` (links are largely additive, so href is part of the key); `htmlAttr`/`bodyAttr` → `"html:<attr>"` / `"body:<attr>"`.

## Reactivity wiring (core of each primitive)

```ts
function meta(attrs): Mountable {
  return mountable(() => {
    const c = requireCtx()
    const sink = useContext(HEAD_SINK) // shared per-root coordinator
    const key = metaKey(attrs)
    const ctl = sink.register(key, 'meta')
    for (const [name, value] of Object.entries(attrs)) {
      const r = toReactive(value) // handle→{produce,deps}; plain→{()=>v,[]}
      c.specs.push({
        deps: r.deps,
        produce: r.produce,
        commit: (out) => ctl.set({ [name]: out }), // commit → sink, not a live node
      })
    }
    c.teardowns.push(() => ctl.release())
    return c.doc.createComment('head:meta') // inline placeholder
  })
}
```

`title`/`titleTemplate` are the same with a single text spec committing `ctl.set({}, String(out))`. Because these are ordinary `BindingSpec`s, the chunked-mask reconciler gates them like inline attributes — a change to `s.pageTitle` re-fires only the title spec, and a burst inside `batch()` coalesces into one commit.

## SSR collection (`@llui/vike` + `@llui/dom`)

The plumbing exists: `renderNodes`/`renderToString` accept a `contexts` map (`ssr.ts:84`), and `_renderChain` threads contexts across layers via slot-context replay (`on-render-html.ts`).

1. `_renderChain` / `createOnRenderHtml` (`on-render-html.ts:210`): create `const sink = collectHeadSink()`, seed `HEAD_SINK → sink` into the **outermost layer's** base contexts. Slot-context replay carries it inward to every layer (it copies the contexts map), so layout + page share one collector. After render: `const { head: collected, htmlAttrs, bodyAttrs } = sink.serialize()` — **before** `dispose()` runs teardowns.
2. **Static `+Head.ts` ↔ component-head collision.** If `+Head.ts` emits a static `<title>` and a component also emits one, naive append yields two `<title>` tags (browser silently uses the first → the reactive one loses). The collector **parses the static `pageContext.head` string for keys** and lets component entries override matching ones, rather than blindly concatenating. Heavier but correct; the append-and-hope version is a shipped bug.
3. Extend `DocumentContext` (`on-render-html.ts:56`) with `htmlAttrs: string` / `bodyAttrs: string`; `DEFAULT_DOCUMENT` (`:72`) becomes `<html ${htmlAttrs}>` / `<body ${bodyAttrs}>` (escaped).
4. Server-emitted tags carry `data-llui-head="<key>"` so the client adopts them.

## Hydration takeover (`@llui/vike` `on-render-client.ts`)

`hydrateSignalApp` already accepts `contexts` (`on-render-client.ts:393`). Seed one `domHeadSink()` (bound to `document.head`/`documentElement`/`body`) into the root contexts at both mount and hydrate. On `register`, the DOM sink adopts the matching `data-llui-head` element (and snapshots its value), updating it in place — no duplication, no flash. `<title>`: adopt the existing element.

## File-by-file

| File                                                              | Change                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/dom/src/signals/head.ts` _(new)_                        | `title`/`titleTemplate`/`meta`/`link`/`htmlAttr`/`bodyAttr`, `HEAD_SINK` context, `domHeadSink`, `collectHeadSink`, `HeadSink` types, `toReactive` helper (share with `foreign` if clean) |
| `packages/dom/src/signals/dom.ts`                                 | runtime `mount()` path creates + seeds a per-root `domHeadSink` into root contexts; export `HEAD_SINK` (reuse `createContext`)                                                            |
| `packages/dom/src/index.ts`                                       | re-export the public surface                                                                                                                                                              |
| `packages/dom/src/signals/ssr.ts`                                 | reuse existing escaper from `collectHeadSink.serialize`; (contexts already threaded)                                                                                                      |
| `packages/vike/src/on-render-html.ts`                             | seed collector, parse static head for keys + override, serialize, extend `DocumentContext`, update `DEFAULT_DOCUMENT`                                                                     |
| `packages/vike/src/on-render-client.ts`                           | seed per-root client sink into mount/hydrate contexts                                                                                                                                     |
| `docs/designs/08 Ecosystem Integration.md`, `09 API Reference.md` | document primitives + SSR collection                                                                                                                                                      |

## Test plan (TDD — write failing tests first)

- `packages/dom/test/head.test.ts`: static + reactive `title`/`meta`/`link`/`titleTemplate` commit to a mock head; reactive update re-fires only the matching spec (mask gating); teardown removes the element; capture-and-reuse inside a toggled `show` remounts cleanly.
- **`propertyTest`/`replayTrace` invariant** (`packages/dom/test/head-prop.test.ts`): for any sequence of mounts/unmounts/state-changes, `document.head` reflects exactly **top-of-stack-per-key**, and all owned keys are removed on full teardown. The stack reconciler is a state machine example tests under-cover.
- `packages/dom/test/head-ssr.test.ts`: `collectHeadSink` + `renderToString` with seeded context → serialized head/htmlAttrs/bodyAttrs; dedup across a layout+page chain; **escaping** of `"` / `<` / `>` in attribute values and title text.
- `packages/vike/test/`: `createOnRenderHtml` emits collected head + html/body attrs; static-`+Head.ts` title is overridden (no duplicate `<title>`); reactive title round-trips.
- `packages/vike/test/` hydration: server `data-llui-head` tags adopted (no duplicates), stay reactive after hydrate; html/body base attr restored on full teardown.

## Phasing

1. **Core client primitives** (`title`/`titleTemplate`/`meta`/`link`) + `domHeadSink` (adopt + per-key stack) + per-root seeding in `mount()`. No vike changes yet.
2. **SSR collection** (`collectHeadSink` + escaping + static-head parse/override + vike wiring + hydration adopt).
3. **`htmlAttr`/`bodyAttr`** (+ `DocumentContext`/`DEFAULT_DOCUMENT` extension + base-attr restore).
4. **`base`/`style`/`script`/`noscript`** thin wrappers + docs. ✅ done — `style`/`script` carry text content via the generalized `elementHead(key, tag, attrs, text?)`; dedup by static `id`/`src`.
