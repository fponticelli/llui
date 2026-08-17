# Testing, compiler tooling, transitions, and annotations

## Compiler + Vite

Use `llui()` from `@llui/vite-plugin` in Vite. The plugin owns the TypeScript signal
transform and surfaces every LLui rule as a build error. Do not add a separate LLui ESLint
plugin and do not bypass a diagnostic by hand-writing compiler targets.

High-value diagnostics:

- `peek-in-slot`, `operator-on-signal`, `at-after-map`, `prefer-at-over-map` — reactive
  handle misuse.
- `pure-derive-body`, `no-node-construction-in-body` — side effects or DOM construction in
  a derive.
- `empty-props` — `div({}, [...])`; use the children-only call `div([...])`.
- `agent-annotation-syntax`, `tag-send-drift` — annotations or emitted-message metadata
  that would lie to agent/devtools consumers.

The compiler resolves LLui helpers by import provenance and aliases injected runtime imports
around local bindings. A helper-shaped local function is not an LLui helper. If lowering fails,
check the actual import, source extension, plugin registration, and dev-server restart before
changing author code. TypeScript is a peer of the compiler, SSR compiler, and Vite plugin;
resolve one supported `>=5 <7` instance in the app.

## @llui/test

- `testComponent(def)` drives the real headless TEA core and records effects.
- `testView(def, state?, options?)` mounts in jsdom. Its options forward to `mountApp`
  except `initialState` and `hydrate`; pass `{ scheduler: 'raf' }` when that is how the app
  runs, then use `handle.flush()` before DOM assertions.
- `assertEffects(actual, expected, { exact? })` deep-partial-matches equal-length lists.
  An expected `undefined` is an assertion that the key exists with that value, not a
  wildcard; omit a key to leave it unconstrained. Exact mode rejects unnamed keys.
- `propertyTest` can mount each generated sequence, assert DOM against state, and report or
  fail on live timers at disposal. Keep cleanup unconditional.
- `replayTrace` validates trace version and component identity before reducing. A legacy
  trace with no component is accepted with a warning; a present mismatched component is an
  error.

For focus-removal behavior in jsdom, use `emulateBlurOnRemoval` or
`withBlurOnRemoval`; browsers synchronously fire `blur`/`focusout` when removing the focused
subtree and jsdom does not. For focus restoration/traps whose result depends on real tab order,
use a browser test and make the action plus `document.activeElement` observation inside
`page.evaluate`; Playwright's `page.focus()` can overwrite the result being measured.

## Transitions

Pass transition bundles to `show`/`branch`/`each`, combine with `mergeTransitions`, and use
`fromTransition` at the Vike route seam. `waitForEnd` distinguishes transition properties and
handles `transitioncancel`; do not replace it with an unfiltered first-event listener.

`flip()` measures layout coordinates, batches all reads before writes, rebases through shared
offset-parent chains, and composes its translation with the author's transform. Do not infer
movement from a transformed `getBoundingClientRect()` alone. It retains/cancels the live WAAPI
animation so an interrupted reorder resumes from the visual position. A row whose author
transform changes while LLui's glide owns `transform` keeps the transform captured at glide
start until the next settled pass.

## Annotation HUD

`@llui/devmode-annotate` core intentionally uses a plain Markdown textarea. The optional
`@llui/devmode-annotate-editor` package registers the rich Lexical editor:

```ts
import '@llui/devmode-annotate-editor'
import { mountAnnotateHud } from '@llui/devmode-annotate'
```

The Vite plugin auto-registers it in development when both packages are installed. For a
live/production activation, dynamically import the editor immediately before activating core
so Lexical stays out of the initial bundle. Keep `@llui/devmode-annotate`, `@llui/dom`, and
`@llui/interactions` peers shared with the host.
