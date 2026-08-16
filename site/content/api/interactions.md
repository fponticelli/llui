---
title: '@llui/interactions'
description: 'Standalone focus, dismissal, floating-positioning, modal-isolation, scroll-lock, direction, and roving-focus primitives'
---

# @llui/interactions

Low-level DOM interaction primitives for applications and libraries that own their component
state machines and markup. It provides the interaction layer used by `@llui/components` without
requiring that package's component catalog.

```bash
pnpm add @llui/interactions @llui/dom
```

## Usage

```ts
import { attachFloating, pushDismissable, pushFocusTrap } from '@llui/interactions'
```

`@llui/components/utils` remains a compatibility re-export for existing component consumers.

<!-- auto-api:start -->

## Functions

### `_dismissableStackSize()`

@internal — for tests

```typescript
function _dismissableStackSize(): number
```

### `_focusTrapStackSize()`

@internal — tests only

```typescript
function _focusTrapStackSize(): number
```

### `_nestedLayerCount()`

@internal — tests only

```typescript
function _nestedLayerCount(): number
```

### `_scrollLockCount()`

@internal — tests only

```typescript
function _scrollLockCount(): number
```

### `attachFloating()`

Position `floating` relative to `anchor` with live updates on scroll/resize.
Applies `left` + `top` styles to the floating element. Returns a cleanup.

```typescript
function attachFloating(opts: FloatingOptions): () => void
```

### `engineFocus()`

Focus `el` as an engine-initiated move (see `runEngineFocus`).

```typescript
function engineFocus(el: HTMLElement, options?: FocusOptions): void
```

### `firstEnabled()`

Internal value navigation used by the public roving-focus primitive.

```typescript
function firstEnabled(items: readonly string[], disabled: readonly string[]): string | null
```

### `flipArrow()`

Map a horizontal arrow key to its logical direction, accounting for RTL.
This is the SINGLE SOURCE OF TRUTH every component routes horizontal arrow
interpretation through. Under rtl, ArrowLeft and ArrowRight swap meaning;
vertical arrows (Up/Down), Home/End, PageUp/PageDown and every non-arrow key
pass through unchanged.

The second argument is the direction source:

- an explicit `'ltr' | 'rtl'` — used directly (the authoritative form when a
  component stores `dir` in its own State and passes it in);
- an `Element` — direction is resolved by walking up the DOM (`dir="rtl"`
  ancestor or `document.documentElement.dir`);
- `null` — treated as `'ltr'` (no-op).

```typescript
function flipArrow(key: string, source: Element | null | TextDirection): string
```

### `focusRovingItem()`

Move DOM focus to the roving item identified by `value` within the same
widget instance as `origin`.

Roving-tabindex widgets track the active index in STATE, but assistive tech
follows real DOM focus — so after a keyboard move the handler MUST also move
focus, or arrow keys are silent for AT. `origin` is the event's
`currentTarget` (the item that received the key); its closest
`[data-scope][data-part="root"]` ancestor scopes the search so sibling
widgets of the same scope never cross-focus. No-op if nothing matches.

`send()` is synchronous and items already exist in the DOM, so this can be
called immediately after the navigation `send`.

```typescript
function focusRovingItem(
  origin: Element | null,
  scope: string,
  value: string,
  opts: { itemPart?: string; attr?: string } = {},
): void
```

### `focusRovingTab()`

Move DOM focus to the trigger whose `data-value` matches, within
`container`. Relies only on the `role="tab"` + `data-value` contract
(shared by `components/tabs` and any hand-rolled tablist). No-op when no
trigger matches. Call after the DOM reflects the new active tab (e.g. in
a microtask if activation triggers a re-render).

```typescript
function focusRovingTab(container: Element, value: string): void
```

### `getFocusables()`

```typescript
function getFocusables(container: Element): HTMLElement[]
```

### `getNestedLayers()`

Currently-registered nested-layer elements (resolvers re-read live).

With an `aspect`, only registrations that participate in it; without one, all
of them. With a `within` boundary, only registrations nested inside it (see
the module comment); without one, the flat, layer-agnostic answer.

```typescript
function getNestedLayers(aspect?: NestedLayerAspect, within?: NestedLayerScope): Element[]
```

### `isEngineFocusInProgress()`

Whether an engine-initiated focus move is in flight. Consulted by
`watchInteractOutside` to gate its `focusin` path.

```typescript
function isEngineFocusInProgress(): boolean
```

### `isFocusable()`

```typescript
function isFocusable(el: Element): boolean
```

### `isInNestedLayer()`

Whether `target` is inside (or equal to) a registered nested layer that
participates in `aspect` (any layer when `aspect` is omitted) and is nested
inside `within` (any layer when `within` is omitted).

```typescript
function isInNestedLayer(
  target: Node | null,
  aspect?: NestedLayerAspect,
  within?: NestedLayerScope,
): boolean
```

### `lastEnabled()`

```typescript
function lastEnabled(items: readonly string[], disabled: readonly string[]): string | null
```

### `lockBodyScroll()`

```typescript
function lockBodyScroll(): () => void
```

### `nextEnabled()`

```typescript
function nextEnabled(
  items: readonly string[],
  disabled: readonly string[],
  from: string,
  delta: 1 | -1,
  loop: boolean,
): string | null
```

### `pushDismissable()`

Register a dismissable layer. Escape is offered to the layers top-down until
one CLAIMS it (a layer declines via `disableEscape` or an `onEscape` router
returning `false`, and the key then falls through to the layer beneath);
outside-click is topmost-only. Returns a cleanup that removes the layer from
the stack.

Push a layer even when both dismissal routes are disabled: the layer is the
caller's PLACE ON THE STACK, which is what stops the layer beneath from
treating an interaction inside this one as an outside interaction.

```typescript
function pushDismissable(opts: DismissableOptions): () => void
```

### `pushFocusTrap()`

Push a focus trap onto the stack. Tab/Shift+Tab will cycle within the
container's focusable descendants. Returns a cleanup that removes the
trap and (optionally) restores focus to the element active before push.

```typescript
function pushFocusTrap(opts: FocusTrapOptions): () => void
```

### `registerNestedLayer()`

Register `source` (an element, array of elements, or a resolver returning
either) as a nested layer. Returns a cleanup that removes the registration.

Prefer the resolver form for a portaled overlay: register once on mount and
return the live root only while open (`[]` when closed), so a single
registration tracks the overlay's open/closed lifecycle without churn.

Pass `opts.owner` when scoped consumers must exempt the layer. Missing or
unresolved ownership fails closed and warns once per registration in development.

```typescript
function registerNestedLayer(source: ElementSource, opts?: NestedLayerOptions): () => void
```

### `resolveDir()`

Resolve the text direction for an element by walking up the DOM tree.
Returns 'rtl' or 'ltr' (default).

```typescript
function resolveDir(el: Element): TextDirection
```

### `resolveRovingMove()`

Map a keyboard key + the current tab value to a roving-tablist move,
or `null` when the key isn't a navigation/activation key or the move is
a no-op (empty list, no enabled sibling). Pure — does not touch the DOM
or call `preventDefault`; the caller decides (typically: prevent default
iff the result is non-null).

```typescript
function resolveRovingMove(
  key: string,
  current: string,
  items: readonly RovingItem[],
  opts: RovingOptions = {},
): RovingMove | null
```

### `resolveTextDirection()`

Normalize any accepted direction source to a concrete `TextDirection`.
An explicit `'ltr' | 'rtl'` wins; an `Element` is resolved from the DOM;
`null` / `undefined` default to `'ltr'`.

```typescript
function resolveTextDirection(source: Element | null | undefined | TextDirection): TextDirection
```

### `runEngineFocus()`

Run `body` with engine-focus suppression active. Any `focusin` raised inside
it is invisible to `watchInteractOutside` — including one raised by a focus
move that re-entrant consumer code makes from a `focusin` listener (see the
module comment: the window is the synchronous transitive closure, not just
the `.focus()` call).

SYNCHRONOUS BY CONTRACT, AND THE CONTRACT IS ENFORCED (#172). The suppression
is released when `body` RETURNS. An `async` body returns its promise at the
first `await`, so the depth counter drops immediately and the focus move that
eventually happens gets NO protection at all — a call that looks correct,
compiles, and does nothing. The failure is safe (no protection, never a stuck
guard: the decrement is in a `finally`), which is exactly why it is invisible,
and this is a PUBLIC export documented as the thing a custom overlay "must"
route its engine-initiated focus moves through. A consumer following that
advice with an async body would reintroduce #155 in their app while believing
they had prevented it.

Two guards, because neither covers the other's case:

- The SIGNATURE rejects a promise-returning body at compile time. It is the
  real guard — it fires before the code ever runs. Its one blind spot is a
  body whose return type is an unresolved type parameter (a generic
  pass-through wrapper): the conditional is deferred, so such a wrapper is
  rejected too and must carry its own constraint. No caller does.
- A DEV-MODE warning catches what the type system cannot see: a JavaScript
  consumer, an `any`-typed body, or a body that returns a thenable without
  being declared as returning one. It cannot restore the protection — by the
  time a thenable is in hand the guard is already released — so it only
  reports.

Deliberately NOT offered: an async-aware variant that holds the guard across
an `await`. The guard is safe _because_ no user event can be delivered inside
its window (see the module comment); holding it across a suspension point
hands the event loop back and would start swallowing genuine interactions.

```typescript
function runEngineFocus<T>(body: () => SyncEngineFocusBody<T>): T
```

### `setAriaHiddenOutside()`

```typescript
function setAriaHiddenOutside(target: Element): () => void
```

### `watchInteractOutside()`

Watch for pointer or focus events outside a given element. Returns a
cleanup function. Uses the capture phase so upstream `stopPropagation`
calls cannot hide events.

- pointerdown (or mousedown/touchstart fallback) triggers "outside" if the
  target is not contained by `element` or `ignore`.
- focusin triggers "outside" when focus moves outside the element, except
  when the new target is in `ignore`.

```typescript
function watchInteractOutside(opts: InteractOutsideOptions): () => void
```

## Types

### `DismissSource`

Reason a dismissable layer was closed.

```typescript
export type DismissSource = 'escape' | 'outside'
```

### `ElementSource`

Shared DOM helpers used by interaction utilities.

```typescript
export type ElementSource<T extends Element = Element> = T | T[] | (() => T | T[] | null)
```

### `NestedLayerAspect`

A consumer of the registry. A registration participates only in the aspects it
names, because a single answer is wrong for at least one consumer: engine
overlays leave `outside` to the ordered dismissable stack (see the module
comment).

The dialog-with-an-inner-`select` case is NOT what the aspect list protects.
That one is covered by a modal never registering AT ALL, whatever aspects it
would have named.

- `outside` — {@link watchInteractOutside} does not treat interactions inside
  the layer as outside interactions.
- `focus` — {@link pushFocusTrap} includes the layer as an extra focusable
  container, so Tab/Shift+Tab can reach it.
- `hide` — {@link setAriaHiddenOutside} hides AROUND the layer rather than
  hiding it.

```typescript
export type NestedLayerAspect = 'outside' | 'focus' | 'hide'
```

### `NestedLayerScope`

The asking layer's own boundary — what "nested inside ME" is measured against.
Omit it for the flat, layer-agnostic answer.

```typescript
export type NestedLayerScope = ElementSource
```

### `Placement`

```typescript
export declare type Placement = Prettify<Side | AlignedPlacement>
```

### `RovingMove`

The navigation a key implies on a roving tablist.

```typescript
export type RovingMove =
  /** An arrow / Home / End resolved to a (different, enabled) tab value. */
  | { type: 'focus'; value: string }
  /** Enter or Space — activate the currently focused tab (manual mode). */
  | { type: 'activate' }
```

### `RovingOrientation`

Headless roving-tablist navigation — the keyboard logic of a WAI-ARIA
tablist, decoupled from any particular DOM contract.

`components/tabs.ts` builds its reactive part-bags on top of this; a
consumer that wants its OWN markup (different classes, ids, no
`data-scope`/`data-part`) can drive the same keyboard behaviour by
calling `resolveRovingMove` from its trigger's `onKeyDown` and
`focusRovingTab` to move DOM focus — without adopting the component's
markup or its `connect()` state machine.

The resolver is pure (key + current value + items → a move); the only
shared DOM assumption lives in `focusRovingTab`, and it is the minimal
one both surfaces already satisfy: triggers carry `role="tab"` and
`data-value="<value>"`.

The list walk itself lives in `list-navigation.ts` — this module is the
keyboard + DOM-focus surface over it, nothing more.

```typescript
export type RovingOrientation = 'horizontal' | 'vertical'
```

### `SyncEngineFocusBodyRequired`

The type an ASYNC body collapses to in {@link runEngineFocus}'s parameter
position. Nothing is assignable to it, so `runEngineFocus(async () => …)` is a
compile error naming the contract rather than a silently inert call.

```typescript
export type SyncEngineFocusBodyRequired = {
  readonly [SYNC_BODY_REQUIRED]: 'runEngineFocus requires a SYNCHRONOUS body — the guard is released the moment body returns'
}
```

### `TextDirection`

Text reading direction. The single shared RTL vocabulary for the package.

```typescript
export type TextDirection = 'ltr' | 'rtl'
```

## Interfaces

### `DismissableOptions`

```typescript
export interface DismissableOptions {
  /** The layer element (e.g. a dialog content or popover). */
  element: ElementSource
  /** Trigger / anchor elements that should not count as outside interactions. */
  ignore?: ElementSource
  /** Called when the user dismisses the layer. */
  onDismiss: (source: DismissSource, event: Event) => void
  /**
   * Custom Escape router. When provided it runs for the Escape key INSTEAD of
   * `onDismiss('escape', …)`, letting the layer unwind an internal level first
   * (e.g. a menu closes its open submenu before closing the whole menu). Return
   * `false` to decline — the event is not claimed and propagates as if this
   * layer had `disableEscape`. Any other return (incl. `undefined`) claims it.
   */
  onEscape?: (event: KeyboardEvent) => boolean | void
  /** Disable outside-click dismissal (default: false). */
  disableOutside?: boolean
  /** Disable Escape-key dismissal (default: false). */
  disableEscape?: boolean
}
```

### `FloatingOptions`

```typescript
export interface FloatingOptions {
  /** The reference element (trigger/anchor). */
  anchor: Element
  /** The floating element (content). */
  floating: HTMLElement
  /** Preferred placement (default: 'bottom'). */
  placement?: Placement
  /** Gap between anchor and floating, in px (default: 0). */
  offset?: number
  /** Flip to opposite side when there isn't enough room (default: true). */
  flip?: boolean
  /** Shift along axis to stay in view (default: padding 8 unless false). */
  shift?: boolean | { padding?: number }
  /**
   * Reading direction. Under `'rtl'`, logical `*-start`/`*-end` placements
   * track the inline-start/inline-end edges. When given it is AUTHORITATIVE —
   * it overrides the direction the floating element happens to compute to,
   * which for a portaled overlay is the direction of wherever it landed.
   * Omit it to leave that decision to the page, as floating-ui does by default.
   */
  dir?: TextDirection
  /** Optional arrow element to position. */
  arrow?: HTMLElement
  /** Notify after each position computation. */
  onUpdate?: (data: {
    x: number
    y: number
    placement: Placement
    arrow?: { x?: number; y?: number }
  }) => void
}
```

### `FocusTrapOptions`

```typescript
export interface FocusTrapOptions {
  /** The container whose focusable descendants form the trap. */
  container: ElementSource
  /** Element to focus when the trap activates. Defaults to first focusable. */
  initialFocus?: Element | (() => Element | null)
  /** Restore focus to the previously active element on release (default: true). */
  restoreFocus?: boolean
}
```

### `InteractOutsideOptions`

```typescript
export interface InteractOutsideOptions {
  /** Element(s) that define the "inside" region. */
  element: ElementSource
  /** Additional elements whose interactions should not count as outside (e.g. triggers). */
  ignore?: ElementSource
  /** Called on pointerdown or focus outside the inside region. */
  onInteractOutside: (event: Event) => void
  /**
   * If provided, called first with the event. Return `false` to suppress the
   * outside callback (for an in-flight layer to claim the event).
   */
  shouldDispatch?: (event: Event) => boolean
}
```

### `NestedLayerOptions`

```typescript
export interface NestedLayerOptions {
  /**
   * Consumers this registration participates in. Defaults to all of them, which
   * is what a surface with no dismissable layer of its own needs. Narrow it when
   * another mechanism already covers an aspect — see the module comment.
   */
  aspects?: readonly NestedLayerAspect[]
  /**
   * The element this layer is logically nested INSIDE — its trigger/anchor, or
   * the host element it belongs to. This is what makes the registry per-layer:
   * an asking layer exempts this registration only when the owner is inside the
   * asker's own boundary (transitively through other nested layers).
   *
   * The owner is NOT the layer's portal root — that is the `source` argument.
   * It is the thing in the main document tree that the portal speaks for.
   *
   * Resolver form is supported and re-read on every lookup, so an owner that
   * mounts and unmounts with its component can be named once.
   *
   * A missing or unresolved owner grants no scoped exemption and emits a
   * development warning. Even a registration used only through the unscoped
   * registry-wide view should name its logical owner to keep the contract
   * explicit.
   */
  owner?: ElementSource
}
```

### `RovingItem`

```typescript
export interface RovingItem {
  value: string
  /** Disabled items are skipped by arrow/Home/End navigation. */
  disabled?: boolean
}
```

### `RovingOptions`

```typescript
export interface RovingOptions {
  /** Arrow axis — 'horizontal' uses Left/Right, 'vertical' uses Up/Down. Default 'horizontal'. */
  orientation?: RovingOrientation
  /** Whether arrow navigation wraps at the ends. Default true. */
  loop?: boolean
  /**
   * An element used to resolve text direction for RTL arrow flipping
   * (typically the event's `currentTarget`). When it resolves to
   * `dir="rtl"`, ArrowLeft/ArrowRight swap. Optional.
   */
  element?: Element | null
}
```

## Constants

### `ALL_NESTED_LAYER_ASPECTS`

Every aspect — the default for a registration that names none.

```typescript
const ALL_NESTED_LAYER_ASPECTS: readonly NestedLayerAspect[]
```

<!-- auto-api:end -->
