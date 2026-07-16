# Core authoring depth (@llui/dom)

Everything an app author places in a view is a lazy **`Mountable`** — a recipe that
builds its live nodes where it is _placed_. This is why capturing one in a variable and
reusing it inside a toggling `show` arm rebuilds fresh on every remount, and why placing
one twice yields two independent instances.

## Element helpers

`el(tag, props?, children?)` plus 60+ tag shortcuts (`div`, `button`, `span`, `input`,
`a`, `h1`–`h6`, `ul`/`li`, `form`, `label`, …). SVG via `elNS(...)` or `svg`/`path`.

- `on*` function props become listeners (`onClick`, `onInput`, `onKeyDown`, …).
- All other props become attributes/properties; a `Signal`/`.map`/plain value is accepted (reactive when a signal).
- `class`, `style.*` (dotted individual style props like `'style.transform'`), `value`, `checked`, `selected` are handled correctly (the last three via IDL properties).
- Text nodes: `text(value: Reactive<string | number>)` (reactive) and `staticText(value: string)` (constant). In practice use `text()` everywhere; it accepts a plain string too.

```ts
input({
  type: 'checkbox',
  checked: item.at('completed'), // reactive attribute
  onChange: () => send({ type: 'toggle', id: item.at('id').peek() }), // peek in handler = fine
})
```

## Structural primitives

All are module imports from `@llui/dom`. They own child scopes and reconcile.

### `show(cond, render, orElse?, transition?)`

Mounts `render()` when `cond` is truthy, else `orElse?()`. `cond` is a `Signal`/`.map`.
The arm is its own scope that receives state updates while mounted; toggling swaps arms.

```ts
show(
  state.at('user'),
  (user) => [text(user.at('name'))],
  () => [text('Signed out')],
)
```

### `branch(value, arms, transition?)` (or `branch(value, discriminant, arms)`)

Discriminated-union render — mounts the arm matching the discriminant's current value.
Ideal for a `page`/`status` tagged union. An absent arm renders nothing.

```ts
branch(
  state.at('page').map((p) => p.type),
  {
    search: () => [searchView(state, send)],
    repo: () => [repoView(state, send)],
  },
)
```

### `each(items, { key, render, transition? })`

Keyed list. `items` is `Signal<readonly T[]>`. `key: (item) => string | number` — **stable
identity is mandatory**. `render: (item: Signal<T>, index: Signal<number>) => Renderable`
— both `item` and `index` are **signals** (the row is reused on reorder, so its position
and contents change under it).

```ts
each(state.at('todos'), {
  key: (t) => t.id, // value identity, never array index
  render: (item) => [
    li({ class: item.at('completed').map((c) => (c ? 'completed' : '')) }, [text(item.at('text'))]),
  ],
})
```

Rules that bite (see SKILL.md checklist for the why): the row root must be a stable
element (not a bare fragment/structural primitive); read `index` reactively, `.peek()` it
only inside a handler; keep the row's state reads on precise `.at()` paths so the list
stays gatable.

### `virtualEach({ items, key, itemHeight, containerHeight, overscan?, class?, render })`

Windowed keyed list — only visible rows (+overscan) exist in the DOM. `itemHeight` is a
uniform `number` or `(item, i) => number`. Same keying rules as `each`. Use it past a few
hundred rows.

```ts
virtualEach<LogEntry>({
  items: state.at('logs'),
  key: (l) => l.id,
  itemHeight: 32,
  containerHeight: 560,
  class: 'log-table',
  render: (item) => [
    div({ class: 'log-row', 'data-level': item.at('level') }, [span([text(item.at('message'))])]),
  ],
})
```

### `lazy`, `unsafeHtml`, `portal`, `foreign`

- `lazy({ loader, fallback, error })` — code-split / async content with a fallback and error arm.
- `unsafeHtml(value: Reactive<string>)` — inject an HTML string. **XSS sink**; only pass trusted/sanitized HTML.
- `portal(content, target = document.body)` — render outside the inline flow (overlays) while keeping bindings in the current scope. Client-only (SSR renders nothing there; the client hydrate rebuilds it).
- `foreign({ tag?, state?, mount, unmount? })` — mount a non-LLui widget (Lexical, a chart lib) with a reactive `state` bridge. `mount` returns the instance; `unmount` tears it down.

## Context (`provide` / `useContext` / `createContext`)

Build-time dependency injection for values that shouldn't thread through every prop
(theme, locale, a shared bus).

```ts
const Theme = createContext<string>('light')
// provide above:
provide(Theme, 'dark', () => [
  /* subtree */ show(state.at('open'), () => [
    span([text(useContext(Theme))]), // reads 'dark' — visible inside the show arm
  ]),
])
```

`useContext` reads the nearest provided value (or the default). It works inside structural
arms/rows (a value provided above an `each`/`show`/`branch`/`lazy` is visible in every
row/arm). Outside a build (e.g. a unit test calling `connect()` directly) it returns the
default rather than throwing.

## `onMount` and lifecycle

`onMount(cb)` runs `cb(root)` after the surrounding view's nodes are inserted; if `cb`
returns a function, that's the cleanup (run on unmount/dispose). **The returned `Mountable`
must be placed in the view array** or nothing registers.

```ts
view: ({ send }) => [
  onMount(() => {
    const off = watchHotkey((m) => send({ type: 'hotkey', msg: m }))
    return off                       // cleanup on unmount
  }),
  div(...),
]
```

`send()` after dispose is dropped (dev warns) — don't rely on a late async continuation
mutating a torn-down component.

## Scheduling and `batch`

- `send()` is **synchronous**: the reducer runs and the DOM commits immediately, before `send` returns. No implicit microtask batching.
- `batch(fn)` (on the view bag and on the mount handle) coalesces a burst of `send`s into **one** reconcile: every reducer still runs in order and effects still fire, but the DOM commit is deferred to a single pass at the end. Use it when draining a burst (a websocket frame of N ticks, a bulk import) — measured ~2.4× on a 1k-tick burst. The compiler also auto-wraps provably-safe straight-line multi-`send` handlers.
- Opt into frame-coalesced commits with `mountApp(container, def, { scheduler: 'raf' })`: reducers/effects stay synchronous (the data contract holds) but DOM commits + subscriber notifications collapse to one per animation frame. `handle.flush()` forces a synchronous commit. Good for high-frequency streams; measured at vanilla parity on the ticker benchmark.

## Composing sub-views

Factor sub-views as **plain functions that take signal handles** — this is the default
composition and needs no compilation:

```ts
function header(header: Signal<HeaderState>, send: (m: Msg) => void): Renderable {
  return [h1([text(header.at('title'))]), /* … */]
}
// in view:
view: ({ state, send }) => [header(state.at('header'), send), main([...])]
```

Pass `state.at('slice')` (or `state.map(...)`) down. Annotate the return as `Renderable`
(a list) or `Mountable` (a single element) — never `Node`/`Node[]`. A full child-component
boundary (its own `component()` with an update cycle) is only for independent effect
lifecycle or library packaging, not routine decomposition.

## The mount handle

`mountApp(container, def, opts?)` returns: `send(msg)`, `batch(fn)`, `getState(): State`,
`subscribe((s) => void): () => void` (external observers — e.g. syncing a `<textarea>`),
`flush()` (force a pending `raf` commit), `dispose()` (unmount, run teardowns).
`opts`: `{ hydrate?, initialState?, contexts?, scheduler?, devtools? }`.
