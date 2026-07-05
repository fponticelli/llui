# A2UI Renderer (`@llui/a2ui`)

Status: **v0.1 landed** (core + Basic catalog, tested). Phased roadmap below.

`@llui/a2ui` renders Google's [A2UI](https://a2ui.org) (Agent-to-UI) protocol
v0.9 on the LLui signal runtime. A2UI is a transport-agnostic JSON protocol in
which an agent streams declarative UI messages that reference components from a
catalog the client already trusts — the agent never ships code. This package is
a renderer for that stream, reusing `@llui/components` for the interactive parts.

## Why LLui is a good fit

A2UI's data model maps almost 1:1 onto LLui's chunked-mask reconciler, and its
message set maps onto The Elm Architecture:

| A2UI                                                                 | LLui                                                      |
| -------------------------------------------------------------------- | --------------------------------------------------------- |
| `createSurface`/`updateComponents`/`updateDataModel`/`deleteSurface` | `Msg` variants applied by a pure reducer (`a2uiUpdate`)   |
| Surface data model + JSON-Pointer `{path}`                           | reactive bindings via `state.map`/pointer resolution      |
| `updateDataModel` (streaming)                                        | reconciler re-commits only bound values — no tree rebuild |
| flat component adjacency list                                        | registry-dispatch tree walk (`render`/`renderChildren`)   |
| template children `{componentId,path}`                               | `each` over the collection, relative paths scoped per row |
| two-way inputs                                                       | `onInput` → `setData` reducer message                     |
| component actions                                                    | resolved → delivered to `onAction`                        |

## Architecture

- **Reducer** (`state.ts`) — the four server→client messages are the reducer;
  `apply(envelope)` = `send`. Surfaces are keyed by id in immutable state.
- **Renderer** (`render.ts`) — structure reacts to the component map; data reacts
  to the data model. Because a data update never changes the component map's
  identity, a high-frequency `updateDataModel` stream re-commits only bound
  values and never rebuilds the tree (structural `each` key stays stable).
- **Scope model** — a subtle LLui rule: a signal handle used inside an
  `each`/`show`/`branch` row reads that row's scoped state, not root. So the
  renderer iterates surfaces AS DATA and carries the whole surface in the
  structural unit. Inside a template the item is the local root: per the A2UI
  spec, template paths are item-scoped, so both relative (`name`) and
  leading-slash (`/name`, v0.8-style) bindings resolve against the item.
  Templates iterate arrays (by index) and objects (by key).
- **Catalog seam** (`catalog.ts`) — an open registry (`defineCatalog`) mapping an
  A2UI component-type name to a live LLui build; custom catalogs may extend the
  Basic catalog. `catalogId` selects the catalog; unknown ids fall back to Basic.
- **`@llui/components` reuse** — `CheckBox`/`Tabs`/`Modal` are driven by their own
  headless state machine's reducer; the rest are semantic HTML / native controls.
- **`uiState`** — client-local view state the protocol does not model (a tab's
  active index, a modal's open flag) lives in a per-surface `uiState` store,
  driven by the component's own reducer via `setUi` — the clean way to give a
  stateful headless component local state under pure TEA.

## Discovered gaps (from real sample payloads)

Running the shipped `google/A2UI` v0.9 samples surfaced the real-world gaps
(notably: the samples use **no** functions or `checks` — the actual gaps are
elsewhere):

1. ~~**Template iteration over objects**~~ ✅ — `contact_list` binds a template to
   an object (`/contacts = {contact1,…}`); templates now iterate object values.
   Also corrected: template paths are item-scoped (leading-slash included).
2. ~~**Modal initial-open**~~ ✅ (resolved as non-gap) — the Basic-catalog Modal
   schema is `{trigger, content}` with no open field, so our trigger-driven Modal
   is spec-faithful; `action_confirmation`'s empty trigger is a sample quirk.
   Stateful components repeated in templates now get per-row state, and Modal
   reuses `@llui/components` focus-trap + scroll-lock.
3. **Inline catalogs** — `org_chart`/`multi_surface` send an in-band
   `inline_catalog` with a custom `OrgChart` type. Needs inline-catalog support.
4. ~~**Client-defined functions + `checks`**~~ ✅ — the full Basic function set
   (`formatString`, `formatNumber/Currency/Date`, `pluralize`, `required`,
   `regex`, `length`, `numeric`, `email`, `and/or/not`) is implemented as pure
   `(call, env) => value` functions with reactivity applied at the binding site;
   `checks` show error messages on inputs and disable buttons. Note: **no**
   shipped sample uses these — inline catalogs (3) were the surprise real-world
   gap, and they resolve to consumer-provided catalogs (already supported), so
   the graceful-skip is correct.

## Roadmap

- **Phase 0 — Land & discover** ✅ commit + this doc; real-payload conformance
  fixtures (5 render fully; 4 documented gaps).
- **Phase 1 — Spec faithfulness** — functions + `checks`; object-template
  iteration; Modal initial-open; stateful-in-templates + focus-trap; conformance
  green gate.
- **Phase 2 — Transport & interop** ✅ — `sendDataModel` client→server sync (the
  data model rides on `A2uiActionEvent`); `SUPPORTED_VERSIONS` best-effort
  version negotiation; `handle.capabilities()` advertises supported catalog ids.
- **Phase 3 — Polish & strategic** — richer `@llui/components` reuse ✅
  (`Slider`→slider drag+keyboard, `ChoicePicker`→combobox typeahead+chips,
  `DateTimeInput`→date-picker calendar; native kept for time/datetime, which is
  platform-optimal); A2UI ↔ `@llui/agent-bridge` proposal written (prototype
  pending); release prep next.
