# Roadmap

## Phase 1 — Core Runtime (`@llui/dom`) ✅

- [x] Scope tree, binding system, message queue, two-phase update
- [x] `mountApp()`, `hydrateApp()`, `component()`, `flush()`
- [x] View primitives: `text`, `branch`, `show`, `each`, `portal`, `memo`, `onMount`, `errorBoundary`, `child`, `foreign`
- [x] Element helpers: `div`, `span`, `button`, etc. (45+ tags)
- [x] `elSplit()` / `elTemplate()` compiled constructors
- [x] `mergeHandlers()` for composable update handlers
- [x] Per-item proxy accessor: `item.id` (shorthand) + `item(fn)` (computed) — invoke to read imperatively
- [x] `view(send)` and structural render callbacks take `send` only — state reads flow through accessor closures
- [x] `each()` render uses options bag `({ send, item, index })`

## Phase 2 — Compiler (`@llui/vite-plugin`) ✅

- [x] 3-pass transform: prop split → mask injection → import cleanup
- [x] Subtree collapse: nested elements → `elTemplate(html, patchFn)`
- [x] Placeholder text nodes, event delegation, selector dedup
- [x] Cross-file safety: FULL_MASK for bindings in non-component files
- [x] `__dirty` compares at top-level field (not nested paths)
- [x] Static subtree prerendering, constant folding, `@__PURE__` annotations
- [x] Diagnostics: accessibility, `each()` misuse, exhaustive `update()`
- [x] Source maps: per-statement edits via MagicString
- [x] HMR: `replaceComponent` in `accept()` callback, tree-shaken in production

## Phase 3 — Test & Effects ✅

- [x] `@llui/test`: testComponent, testView, propertyTest, replayTrace, assertEffects
- [x] `@llui/effects`: http, cancel, debounce, sequence, race, handleEffects().use()
- [x] `Async<T, E>` type + `ApiError` union (network, timeout, notfound, unauthorized, etc.)
- [x] `resolveEffects()` for server-side HTTP effect execution (SSR data loading)

## Phase 4 — SSR & Hydration ✅

- [x] `renderToString()` with `data-llui-hydrate` markers
- [x] `hydrateApp()` — atomic DOM swap (server HTML visible until JS loads)
- [x] `initSsrDom()` from `@llui/dom/ssr` (jsdom setup, server-only sub-path)
- [x] `resolveEffects()` — pre-load data server-side before rendering
- [x] Hydration code tree-shaken from SPA builds (zero bytes)
- [x] `@llui/vike` — onRenderHtml + onRenderClient hooks (untested)

## Phase 5 — Ecosystem ✅

- [x] DevTools: `installDevTools()` from `@llui/dom/devtools` (sub-path, tree-shaken)
- [x] `@llui/router`: createRouter, route, param, rest, connectRouter, routing.link/listener
- [x] `@llui/mcp` — MCP server exposing debug API as LLM tools
- [x] `@llui/lint-idiomatic` — AST linter for 6 anti-pattern rules
- [x] Evaluation suite — 15-task runner with reference implementations

## Optimizations ✅

**Runtime:**

- [x] `each()` fast paths: same-ref skip, append-only, swap detection, bulk clear, full-replace
- [x] Per-item direct updaters (bypass Phase 2 allBindings scan)
- [x] Fresh binding skip (Phase 1 bindings skip Phase 2 on same tick)
- [x] Scope disposal nulls binding references for prompt GC

**Compiler:**

- [x] Template cloning: subtree collapse, placeholder text, event delegation
- [x] Selector dedup, constant folding, static subtree prerendering

**Bundle:**

- [x] Sub-path exports: `@llui/dom/hmr`, `@llui/dom/ssr`, `@llui/dom/devtools`
- [x] All dev-only code tree-shaken from production builds
- [x] `sideEffects: false`, named re-exports

**jfb results (vs Solid/Svelte):**

- Create 1k / Replace / Append: within ~5%
- Update / Swap / Remove: within 5-20%
- Bundle: 5.8 KB gzip (competitive with Solid's 4.7 KB)

## GitHub Explorer (validation app) ✅

- [x] Search with debounce/cancel, pagination with URL params
- [x] Repo detail: file tree, README (foreign + shadow DOM), issues with label colors
- [x] File viewer with line numbers (foreign)
- [x] History-mode routing with `@llui/router`
- [x] SSR with server-side data loading via `resolveEffects()`
- [x] `Async<T, ApiError>` state modeling

---

## Remaining

### 5. ~~Package Polish~~ ✅

349 tests across 8 packages. Added: resolveEffects tests (8), MCP tool tests (9), Vike integration tests (5). All packages audited — exports match, gaps filled.

### 6. ~~Documentation~~ ✅

README rewritten. Getting-started guide with project setup + first component tutorial. Cookbook covering forms, async (Async/ApiError/debounce), composition (view functions, mergeHandlers), routing, SSR (resolveEffects, hydration), foreign libraries, and testing.

### 7. ~~Animation/transition helpers~~ ✅

New `@llui/transitions` package: `transition()` core + `fade`/`slide`/`scale`/`collapse` presets. Values can be CSS class strings, style objects, or mixed arrays. Wired `each()`'s inherited `enter`/`leave` as per-item hooks — `each({...opts, ...fade()})` works uniformly with `branch`/`show`. Bulk-clear/full-replace fast paths fall back to per-item removal only when `leave` is set. Added `flip()` (FLIP reorder via WAAPI) + `mergeTransitions()` for combining — wired `onTransition` hook on `each` (fires after each reconcile with entering/leaving nodes).

### 8. Headless components package (`@llui/components`) ✅

54 headless components shipped, state-machine-driven, no zag dependency, using `@llui/transitions` for enter/leave: accordion, alert-dialog, angle-slider, async-list, avatar, carousel, cascade-select, checkbox, clipboard, collapsible, color-picker, combobox, context-menu, date-input, date-picker, dialog, drawer, editable, file-upload, floating-panel, hover-card, image-cropper, listbox, marquee, menu, navigation-menu, number-input, pagination, password-input, pin-input, popover, presence, progress, qr-code, radio-group, rating-group, scroll-area, select, signature-pad, slider, splitter, steps, switch, tabs, tags-input, time-picker, timer, toast, toc, toggle, toggle-group, tooltip, tour, tree-view. Demo app at `examples/components-demo` exercises all 54 + `confirm-dialog` pattern across 8 sections.

**Opt-in styling layer:** CSS theme (`theme.css`) with design tokens + `data-scope`/`data-part` selectors for all 54 components. Dark mode via separate `theme-dark.css`. JS class helpers (`styles/`) with `createVariants()` engine returning Tailwind utility strings per part. Animations for overlays. 237 style tests. Demo migrated from custom CSS to theme.css.

### 9. Zag.js parity — missing components ✅

All 15 zag.js machines now shipped. 54 headless components total.

- **Broadly useful:** ~~qr-code~~, ~~scroll-area~~, ~~signature-pad~~, ~~navigation-menu~~, ~~angle-slider~~, ~~tour~~
- **Niche:** ~~async-list~~, ~~cascade-select~~, ~~date-input~~, ~~floating-panel~~, ~~image-cropper~~, ~~marquee~~, ~~presence~~, ~~timer~~, ~~toc~~

**Renames to align with zag naming:**

- ~~`stepper` → `steps`~~ ✅
- `alert-dialog` kept separate (matches zag's own separate package; wraps `dialog` with `role="alertdialog"`)

### 10. Zag.js parity — cross-cutting patterns

- ~~**Controlled/uncontrolled split.**~~ Removed — TEA's outer loop already owns controlled-ness. Adding `defaultValue` / `onValueChange` would duplicate what the architecture provides naturally.
- ~~**Collections abstraction.**~~ ✅ `TreeCollection` helper shipped. Listbox / combobox / select still feed string arrays directly — revisit if a unified `ListCollection` becomes useful.
- **i18n / RTL layer.** Universal `translations` object + `dir` prop flipping arrow-key semantics. Today labels are hardcoded English with per-connect overrides in spots.
- ~~**Validator / transform callbacks.**~~ ✅ `validate` + `transformFiles` shipped for file-upload. Remaining components (editable, number-input, tags-input, pin-input) can add `validate` to their ConnectOptions as needed — same thin pattern, not an architectural blocker.

(`ids?: ElementIds` override for SSR id collisions — explicitly not pursuing, single `opts.id` prefix is adequate.)

### 11. Zag.js parity — accessibility

- ~~**Typeahead first-letter search** across menu, listbox, select, tree-view, combobox.~~ ✅ (shared `utils/typeahead` shipped; wired into menu, listbox, select, tree-view. Combobox already has text-input filtering as its core behaviour.)
- ~~**Tri-state `aria-checked`** for hierarchical checkboxes in tree-view.~~ ✅ (`selectionMode: 'checkbox'` + checked/indeterminate state arrays).
- ~~**`aria-busy`** during async operations~~ ✅ (tree-view loading state). `aria-owns` for virtualized children still open.
- ~~**Orientation-aware keyboard** for tabs~~ ✅ (horizontal tabs use ArrowLeft/Right, vertical use ArrowUp/Down; orientation read from ancestor `[data-part=list]`).
- **Localized `aria-label`** strings via `translations`.
- ~~**Tab `indicator` part** with measured `Rect` for animated underlines.~~ ✅ (`watchTabIndicator(root)` utility installs MutationObserver + ResizeObserver and writes CSS custom properties).
- ~~**Tree-view ArrowLeft**: "collapse-then-jump-to-parent" WAI-ARIA semantics.~~ ✅ (plus ArrowRight "expand-then-focus-first-child"; requires caller to pass `parentId` to `item()`).
- ~~**Async load-children + in-place rename** for tree-view.~~ ✅ (`loading[]` state + `loadingStart`/`loadingEnd` messages; `renaming`/`renameDraft` + full rename flow).

### 12. Zag.js parity — per-component gaps — all shipped

All §12 items shipped across commits 865db49..9095b81.
