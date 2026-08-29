# Proposal — Widget state tiers: `constant()`, `island()`, and the SSR/context fixes behind them

> Status: **IMPLEMENTED** (2026-08-29). C1–C5 all landed on `main` in a three-lane batch.
> Spun off: **#238** (the compiler does not recognize `constant()` in a ternary/template),
> **#239** (an island as a bare `each` row root corrupts on reorder), **#240** (anonymous
> head keys collide between a host and an island). #231 is answered by C4's `island()`;
> #235's "pure geometry + attributes entry point" ask is answered by C1's `constant()`.
> Two claims in the original draft were proved WRONG during implementation and are
> corrected inline below — see the `Send<never>` note in C1 and the CORRECTION block in C3.

## TL;DR

#231 is filed as a documentation gap. It is not. The capability it asks for already
exists — `subApp()` at `@llui/dom/escape-hatch` — and the consumer never found it
because the docs actively steer away from it. When you do find it, it is **unfit for
the use case in two ways that fail silently**, both measured below: it loses its
ancestors' context, and it renders nothing under SSR.

There is also a genuine missing tier that #231 only half-names and #235/#236 name
directly: a widget with **no state at all** cannot use `connect()` today, because
`connect()` demands a `Signal<S>` and there is no way to build one from a plain value.

Four changes, sequenced. Documentation is the _last_ of them, not the first.

---

## 1. Diagnosis

### 1.1 The idiom exists and is hidden

`subApp({ reason, def, initialState?, contexts?, onHandle? })` mounts an isolated
component instance at an anchor: its own update loop, its own mask scope, its own DOM
region, disposed with the host. That is exactly what #231 asks for, and it is strictly
better than the `foreign()` + `mountApp()` recipe the issue proposes (see §5).

It is unfindable for three compounding reasons:

- it is **not in the barrel** — only on the `@llui/dom/escape-hatch` subpath;
- the subpath, the module header ("rarely-needed boundaries kept off the main
  authoring surface") and the required `reason: string` field all frame it as an
  anti-pattern;
- `site/content/architecture.md` says to "reach for view functions (sliced signals)
  **before** the separate update loop of `subApp()`", and `composition-patterns.md`
  reserves it for "third-party 60fps layers".

A leaf widget used 13 times reads as everyday decomposition. An author who found
`subApp` would correctly conclude the docs were telling them not to use it.

### 1.2 An island silently loses its ancestors' context — MEASURED

```
provide(Theme, 'PROVIDED', () => [ ...subApp({ def: Leaf }) ])
  → Leaf's useContext(Theme) === 'DEFAULT'
```

`buildSignalSubApp` holds the live build context `c` (whose `c.contexts` map is right
there) and forwards only the caller's explicit `spec.contexts`. Every other structural
primitive — `show`, `branch`, `each`, `lazy` — snapshots `c.contexts` at placement.
This one does not.

**Consequence:** `@llui/components` routes _all_ i18n through
`ComponentLocaleContext`. Every component mounted as an island silently falls back to
default English. No error, no warning. This is the failure class CLAUDE.md is written
about — it is a straight bug, not a design limitation.

There is no test covering `contexts` in `packages/dom/test/signals/sub-app.test.ts`
(two tests, neither touches it), which is why it has survived.

### 1.3 An island renders nothing under SSR — MEASURED

```
renderToString(Page)  →  '<div class="shell">shell</div><!--subApp-->'
```

`buildSignalSubApp` bails on `c.ssr` and emits a bare anchor. The client hydrate pass
does bring the instance up, so this is not a correctness bug — but it means every
island is a post-hydration pop-in (layout shift) and is absent without JS. For a
"copy" button that is tolerable; for #236's sparkline in a table it is not.

### 1.4 The cost objection is real but points the other way — MEASURED

#231 asks whether a TEA runtime per instance is too expensive. At N=500 in jsdom
(absolute numbers inflated; the ratio is the signal):

|               | mount   | 50 host updates |
| ------------- | ------- | --------------- |
| inline widget | 22.0 ms | 2.19 ms         |
| island        | 53.3 ms | **1.14 ms**     |

Islands cost **~2.4× at mount** and are **~2× cheaper on update**, because an island is
not registered as a child scope, so the host reconciler never walks it. The trade is
mount cost for update isolation — which is a _good_ trade for exactly the case #231
describes (many leaves, host state churning above them). This should be documented as
a measured number, not left to the reader's fear.

### 1.5 The missing tier

`connect(state: Signal<S>, send: Send<M>, opts)` is the only entry point for all 67
components. A widget whose values never change after build still needs a `Signal`.

There is no way to build one. The obvious user-land hack does not work and fails
_silently_: `pathHandle`'s `produce` resolves a path against **the binding's state**,
not against the value you closed over, so a hand-rolled constant renders empty. (Tried;
it renders `''`.) A real primitive is required.

Note four components — `meter`, `progress`, `fieldset`, `in-view` — already declare
their send parameter as `_send` and ignore it. They are stateless today and cannot be
called as such.

---

## 2. The frame: a ladder, not a cliff

Widget cost should be a ladder the author walks down, with each rung documented:

| Tier           | State                             | Example                       | Mechanism                                      |
| -------------- | --------------------------------- | ----------------------------- | ---------------------------------------------- |
| **T1 static**  | none after build                  | meter, sparkline, chip, badge | `connect(constant(v), noSend, opts)` — **new** |
| **T2 local**   | private, transient                | copy button, disclosure       | `island({ def })` — **fix + promote**          |
| **T3 hoisted** | app-level; URL, undo, persistence | dialog, tabs, form            | `connect(state.at('x'), send)` — unchanged     |

The cliff today is that T1 and T2 both land on T3, which is what produced #231's
13-state-slices dilemma and then the imperative `textContent` workaround.

---

## 3. Proposed changes

### C1 — `constant<T>(value: T): Signal<T>` in `@llui/dom` (~18 lines)

A handle whose `produce` ignores binding state and whose `deps` is `[]` — so it is
evaluated once at mount and is never dirty (the same mechanism `foreign`'s boot binding
already relies on). `.at()` and `.map()` compose, staying constant.

**Verified working**: renders, survives host updates without going stale, and drives a
real `meter.connect()` part bag (`aria-valuenow` resolves to 42) with correct
`.at()`/`.map()` chaining.

Ship alongside `noSend` so the T1 call reads:

```ts
const parts = meter.connect(constant(reading), noSend, { label: 'TSH' })
```

`noSend` must be typed `Send<unknown>`, **not** `Send<never>`. `Send<M>` is a function
type, so under `strictFunctionTypes` its parameter is contravariant: `Send<never>` is
assignable to nothing (`TS2345: Type 'MeterMsg' is not assignable to type 'never'`). The
intuitive "accepts no messages" spelling is exactly backwards for a value that must fit
every `M`. (Measured — an earlier draft of this proposal had it wrong.)

**Why this is the right shape:** it unlocks T1 for all 72 `connect()` entry points with one export,
instead of adding a per-component pure entry point (which is what #235 floats — that
would be 67 new exports for a problem solved once). `chart.geometry(state)` stays as
it is; it is a _derived-geometry_ accessor, a different thing.

### C2 — Inherit context into an island (bug fix)

Default `spec.contexts` to the placing build's `c.contexts`; merge an explicit map
_over_ the inherited one rather than replacing it. Add the regression test that is
missing today.

This also fixes `subApp` for anyone using it now.

### C3 — Give islands an SSR body

Under `c.ssr`, instead of emitting a bare anchor:

1. run `def.init()` for its seed state (discard its effects — the server does not run them);
2. build the view under a **synthetic parent ctx** — see the correction below;
3. mount-once against the seed state to bake initial values in;
4. splice the resulting nodes at the anchor.

> **CORRECTION (measured, 2026-08-29).** An earlier draft of this section said to pass
> the placing ctx as `runBuild`'s `inherit` argument. **That is wrong, and silently so.**
> `runBuild` falls back to the build _on the stack_ when given no `inherit`, but the
> CLIENT mount inherits nothing — `mountSignalComponent` runs from `runMounts`, after
> `ctx` is back to null. So an inheriting server build renders what the client never
> would. Measured: an island inside an `each` row inherits `inRow`, `derived` rebases its
> component-rooted inputs to `ctx.state`, and the server emits
> `<div class="leaf">undefined:undefined</div>`. `headAnon`, the descriptor registry and
> `getState` are the same class one step quieter. `renderSignalTree` has the identical
> defect (it passes `inherit: undefined`). The fix is a synthetic parent ctx that sets
> each field deliberately.
>
> Related correction: `onMount` suppression is **not** carried by the `ssr` flag on this
> path — the SSR body never calls `runMounts`, so the callback cannot run either way.
> The flag still matters (a nested island reads it), so it is still set.

No update loop, no effects, no `onMount` (the inherited `ssr` flag already suppresses
nested mounts). Hydration needs **no** new machinery: the client pass atomically
rebuilds and the real instance mounts then, and both sides start from `init()`, so
they agree by construction.

`runBuild` already accepts an `inherit?: BuildCtx`, which is what makes this tractable.

### C4 — Promote and reframe as `island()`

Move to the main barrel. Same builder. Three changes to the surface:

- `reason` becomes **optional** (it is friction that is correct for a 60fps layer and
  wrong for the 13th copy button);
- add a **declarative reactive-props channel**, so props are not an imperative
  `onHandle` dance — implemented as a binding spec exactly like `foreign`'s
  `SignalSpec` inputs:

  ```ts
  island({
    def: Clipboard,
    props: state.at('token'),
    onProps: (value) => ({ type: 'setValue', value }),
  })
  ```

- `subApp` becomes a deprecated alias on `escape-hatch` (breaking changes are allowed;
  two names for one primitive is worse than one rename).

Then the docs: the ladder table, per-component "for a leaf used many times, mount it as
an island" lines, and **the measured cost numbers from §1.4** — because #231's third ask
was "if there is a reason NOT to do this, say so explicitly", and the honest answer is a
measurement, not a caveat.

---

## 4. Optional C5 — a lint rule, in a separate PR

What actually shipped in the consumer app was not "no island" — it was **imperative
`textContent` / `classList` mutation from a click handler**, behind the reconciler's
back, with no `aria-live`. Per this repo's standing doctrine (compiler errors, never
warnings, because warnings get ignored), that is the lintable failure.

Scope: a write to `.textContent` / `.innerHTML` / `.classList` / `.style` on a node
reached from an event-handler parameter, inside a component view. Bail inside `foreign`
and `island` mount bodies, which are legitimately imperative.

**Risk: false positives**, which per doctrine break a build for a consumer who did
nothing wrong. This must be validated the way `tag-send-drift` was — a zero-report sweep
over the repo plus `examples/`, and a faithful mutation table — so it should **not** sit
on the critical path of C1–C4.

---

## 5. Rejected alternatives

**`foreign()` + `mountApp()`, as #231 proposes.** `foreign` is the _imperative
third-party_ seam: its body is opaque to the dep analyzer by design. Wrapping a pure
LLui component in it discards introspection metadata, the agent protocol surface and
devtools visibility for a subtree that is entirely ours. `island()` keeps all of it.

**A per-component pure `geometry()`/attributes entry point (#235's note).** 67 new
exports, 67 new drift surfaces, for what C1 solves once at the runtime layer.

**Leaving `subApp` where it is and only writing docs.** Does not fix §1.2 or §1.3, both
of which are silent. Documenting a primitive that quietly drops your locale is worse
than not documenting it.

---

## 6. Sequencing

1. **C1 `constant()`** — smallest, zero risk, unblocks the #235/#236 design conversation.
2. **C2 context fix** — a bug with a failing test available today.
3. **C3 SSR body** — moderate; independent of C4.
4. **C4 `island()` + props + docs** — the API commitment; design it against 1–3 rather than ahead of them.
5. **C5 lint rule** — separate PR, gated on a false-positive sweep.

C1 and C2 are independently shippable and independently valuable.
