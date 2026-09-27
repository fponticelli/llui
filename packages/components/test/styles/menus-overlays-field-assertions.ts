/**
 * Shared per-field EXACT assertion table for the menus-overlays dimension
 * tests (#265 finding #1/#2 follow-up). Both
 * `menus-overlays-baseline-renderer.test.ts` and
 * `registry/test/menus-overlays-scenario-renderer.test.ts` drive the SAME
 * real machines (`connect()`/`overlay()` from `packages/components/src`), so
 * the machine-published `data-*`/`aria-*`/`role` facts a given case field
 * must produce are identical across both renderers — only the decorative
 * skin differs, which is out of scope here (covered by
 * `tailwind-classes.test.ts`/`registry-attrs.test.ts`).
 *
 * Replaces the prior `expect(mutated).not.toBe(baseline)` proof, which the
 * #265 review history rejected as inadmissible: it can pass because SOME
 * unrelated fact moved, and it structurally cannot see a field the mutation
 * loop never reaches (array-of-objects fields, e.g. a menu item's own
 * `disabled` — the exact shape of the accepted mutation survivors A5/A3/B7).
 * Every field declared on a case input now resolves to a `FieldAssertion`
 * (checked in TWO ways — see below) or to a documented allowance; nothing
 * may fall through silently, enforced by the two test files' own
 * "every field is in the table or allowlisted" sweep.
 *
 * Each `FieldAssertion` is checked twice, differently:
 *  1. `attrNames` — the field's mutation must change the SET of `attr=value`
 *     facts under at least one of these attribute names (proves the mutation
 *     reached a SPECIFIC named channel, not merely "some" fact).
 *  2. `expectedFacts`, where given — an exact `attr=value`/`text=…` token
 *     this field's value must produce, checked independently at BOTH the
 *     original and the mutated value (proves the real value, not just that
 *     something changed — this is what "asserted exactly" buys over (1)
 *     alone, and it is what would have caught a component silently emitting
 *     the wrong literal on an otherwise-sensitive field).
 */

export interface FieldAssertionContext {
  readonly scenarioId: string
  readonly caseId: string
  /** The full, pre-mutation case input (for fields whose expected fact
   * depends on a SIBLING field, e.g. `skipAnimations` depends on the case's
   * own `presence`). */
  readonly input: Readonly<Record<string, unknown>>
}

export interface FieldAssertion {
  readonly attrNames: readonly string[]
  readonly expectedFacts?: (value: unknown, ctx: FieldAssertionContext) => readonly string[]
}

const bool = (name: string) => (v: unknown) => (v ? [`${name}=true`] : ([] as const))
const dataFlag = (name: string) => (v: unknown) => (v ? [`${name}=`] : ([] as const))
const textFact = (v: unknown) => [`text=${String(v)}`]
const identityAttr = (name: string) => (v: unknown) => [`${name}=${String(v)}`]

/** `dialog`/`alert-dialog`/`drawer`/`popover`/`hover-card`/`menu` share ONE
 * adapter shape: an 'opening'/'closing' case drives a REAL transition
 * (`machine.update(machine.init(...), {type:'open'|'close'})`), gated by
 * `skipAnimations`; an 'open'/'closed' case seeds the FINAL status directly
 * via `machine.init({open, skipAnimations})` with no transition at all, so
 * the requested label is exactly what `data-state` reads regardless of
 * `skipAnimations`. Verified against each adapter in
 * `menus-overlays-baseline-renderer.ts` (all five share the identical
 * `presence==='opening' ? … : presence==='closing' ? … : init(...)` shape).
 * `component:context-menu` does NOT share this shape — see
 * `contextMenuResolvedState` below, it has no direct path at all. */
function resolvedStatus(presence: string, skipAnimations: boolean): string {
  if (presence === 'opening') return skipAnimations ? 'open' : 'opening'
  if (presence === 'closing') return skipAnimations ? 'closed' : 'closing'
  return presence
}

/** `presence` on the five direct-path products above: `data-state` resolves
 * via `resolvedStatus`, reading the CASE's own `skipAnimations`/`animated`
 * (unaffected by mutating `presence` alone, since that field stays fixed). */
function presenceAssertionFor(
  getSkipAnimations: (input: Record<string, unknown>) => boolean,
): FieldAssertion {
  return {
    attrNames: ['data-state'],
    expectedFacts: (value, ctx) => {
      const status = resolvedStatus(String(value), getSkipAnimations(ctx.input))
      // A 'closed' resting status gates the whole positioner/content subtree
      // out of the mount (`presenceIsMounted`/`visibleWhen`) — no `data-state`
      // fact is published at all, so nothing exact can be asserted here (the
      // attribute-name CHANGE is still real and still checked via
      // `attrNames`, since the fact simply vanishes).
      return status === 'closed' ? [] : [`data-state=${status}`]
    },
  }
}

/** `skipAnimations`/`animated`: with the flag effectively TRUE the machine
 * lands directly on the FINAL status for that transition; with it FALSE it
 * rests at the intermediate one. Only meaningful on an 'opening'/'closing'
 * case — an 'open'/'closed' case's INSENSITIVE_DIMENSIONS entry covers the
 * rest (no scenario here declares a 'closed' case for these products).
 *
 * `tooltip`'s own flag is named `animated` and spells the SAME mechanism
 * INVERTED (tooltip.ts: `toOpen = presenceOpen(state, !state.animated)`) —
 * `animated: true` rests at the intermediate status, `animated: false`
 * lands directly on the final one — hence `invert`. */
function skipAnimationsAssertion(invert: boolean): FieldAssertion {
  return {
    attrNames: ['data-state'],
    expectedFacts: (value, ctx) => {
      const presence = String(ctx.input.presence)
      if (presence !== 'opening' && presence !== 'closing') return []
      const skips = invert ? !value : Boolean(value)
      return [`data-state=${resolvedStatus(presence, skips)}`]
    },
  }
}

const presenceAssertionSkipAnimations = presenceAssertionFor((input) =>
  Boolean(input.skipAnimations),
)
const presenceAssertionAnimated = presenceAssertionFor((input) => !input.animated)

/** `component:context-menu` is NOT like the other presence-bearing
 * products: its adapter has no direct "resting open/closed" path at all —
 * requesting anything other than the literal `'closed'` presence label
 * always calls the real `openAt` message (`context-menu.ts`), which routes
 * through `statusOnOpen` exactly as an 'opening'->'open' transition would,
 * and `'closing'` additionally calls `close` afterward. So `'open'` and
 * `'opening'` resolve IDENTICALLY (both are skipAnimations-gated), and only
 * the literal string `'closed'` ever bypasses the transition (the adapter's
 * own `input.presence !== 'closed'` guard). Verified directly against
 * `context-menu.ts:openAt`/`statusOnOpen`/`statusOnClose` — do not model
 * this as the generic `resolvedStatus` the other five presence products
 * share, it gives the wrong answer for 'open' and 'closed'. */
function contextMenuResolvedState(presence: string, skipAnimations: boolean): string {
  if (presence === 'closed') return 'closed'
  if (presence === 'closing') return skipAnimations ? 'closed' : 'closing'
  return skipAnimations ? 'open' : 'opening'
}

/** When the resolved status is `'closed'`, `isVisible` (context-menu.ts)
 * gates the whole positioner/content subtree out of the mount entirely — no
 * `data-state` fact is published at all, so nothing exact can be asserted
 * (the attribute-name CHANGE is still real and still checked, via
 * `attrNames`: the fact simply vanishes). */
const contextMenuPresenceAssertion: FieldAssertion = {
  attrNames: ['data-state'],
  expectedFacts: (value, ctx) => {
    const status = contextMenuResolvedState(String(value), Boolean(ctx.input.skipAnimations))
    return status === 'closed' ? [] : [`data-state=${status}`]
  },
}

const contextMenuSkipAnimationsAssertion: FieldAssertion = {
  attrNames: ['data-state'],
  expectedFacts: (value, ctx) => {
    const status = contextMenuResolvedState(String(ctx.input.presence), Boolean(value))
    return status === 'closed' ? [] : [`data-state=${status}`]
  },
}

const dialogModalAssertion: FieldAssertion = {
  attrNames: ['aria-modal'],
  expectedFacts: bool('aria-modal'),
}

const drawerSideAssertion: FieldAssertion = {
  attrNames: ['data-side'],
  expectedFacts: identityAttr('data-side'),
}

const textFieldAssertion: FieldAssertion = {
  attrNames: ['text'],
  expectedFacts: textFact,
}

/** `inputValue` (combobox/searchable-select): a controlled `<input>`'s live
 * VALUE is a DOM property, reflected in `factSet` as `#value=…` — never a
 * `text` child node (there is no text child on an `<input>`). */
const inputValueFieldAssertion: FieldAssertion = {
  attrNames: ['#value'],
  expectedFacts: (v) => [`#value=${String(v)}`],
}

/** Menu-tree item `disabled` (menu/context-menu/menubar's nested items):
 * `aria-disabled='true'` + `data-disabled=''` when true, both ABSENT when
 * false (menu-machine.ts:808/817). */
const itemDisabledAssertion: FieldAssertion = {
  attrNames: ['aria-disabled', 'data-disabled'],
  expectedFacts: (v) => (v ? ['aria-disabled=true', 'data-disabled='] : []),
}

/** Menu-tree item `kind`: only a `'checkbox'` item ever carries
 * `aria-checked` at all (menu-machine.ts:809-815); an `'action'` item has
 * neither the attribute nor the alternate role. */
const itemKindAssertion: FieldAssertion = {
  attrNames: ['aria-checked', 'role'],
  expectedFacts: (v) => (v === 'checkbox' ? ['role=menuitemcheckbox'] : ['role=menuitem']),
}

const menubarMenuDisabledAssertion: FieldAssertion = {
  attrNames: ['aria-disabled'],
  expectedFacts: bool('aria-disabled'),
}

const selectionModeAssertion: FieldAssertion = {
  attrNames: ['aria-multiselectable'],
  expectedFacts: (v) => (v === 'multiple' ? ['aria-multiselectable=true'] : []),
}

/** combobox/searchable-select `status`: `aria-busy` reflects `'loading'`
 * only; `data-status` is the exact literal (combobox.ts:765/768) — both live
 * on the CONTENT subtree, which a `'closed'` case unmounts entirely (the
 * registry skin's trigger still shows SOME status-derived text while closed,
 * which is what keeps this field out of `INSENSITIVE_DIMENSIONS` there, but
 * its exact formula is registry-skin-specific and not asserted here). */
const statusAssertion: FieldAssertion = {
  attrNames: ['data-status', 'aria-busy', 'text'],
  expectedFacts: (v, ctx) => {
    if (ctx.caseId === 'closed') return []
    return v === 'loading'
      ? [`data-status=${String(v)}`, 'aria-busy=true']
      : [`data-status=${String(v)}`]
  },
}

/** toast `toastType`: `data-type` is the literal; `role`/`aria-live` are
 * `alert`/`assertive` for `'error'`, `status`/`polite'` otherwise
 * (toast.ts:286-288, 423-428). */
const toastTypeAssertion: FieldAssertion = {
  attrNames: ['data-type', 'role', 'aria-live'],
  expectedFacts: (v) => {
    const type = String(v)
    const live = type === 'error' ? 'assertive' : 'polite'
    const role = type === 'error' ? 'alert' : 'status'
    return [`data-type=${type}`, `role=${role}`, `aria-live=${live}`]
  },
}

const orientationAssertion: FieldAssertion = {
  attrNames: ['data-orientation'],
  expectedFacts: identityAttr('data-orientation'),
}

const navMenuDisabledAssertion: FieldAssertion = {
  attrNames: ['data-disabled'],
  expectedFacts: dataFlag('data-disabled'),
}

const openBooleanDataStateAssertion: FieldAssertion = {
  attrNames: ['data-state'],
  // A CLOSED content subtree is unmounted entirely (`presenceIsMounted`-style
  // gating), so no `data-state='closed'` fact is ever published to assert —
  // only the OPEN direction has a mounted fact to check exactly.
  expectedFacts: (v) => (v ? ['data-state=open'] : []),
}

/** toast `closing` (the case's own seed flag, not a machine transition): the
 * toast's own root `data-state` is `'closing'` or `'open'` directly
 * (toastAdapter seeds `status: input.closing ? 'closing' : 'open'`). */
const closingAssertion: FieldAssertion = {
  attrNames: ['data-state'],
  expectedFacts: (v) => [`data-state=${v ? 'closing' : 'open'}`],
}

const dismissableAssertion: FieldAssertion = {
  // No machine attribute names the flag directly — it gates whether the
  // close-trigger BUTTON is mounted at all (toastAdapter's `t.dismissable ?
  // [button(...)] : []`). A mounted/absent element is itself a `data-part`
  // fact appearing/disappearing, which the generic tag-presence walk in
  // `projectPublishedState` already reports as a `data-scope`/`data-part`
  // change — asserted structurally rather than by attribute name.
  attrNames: ['data-part'],
}

/** `highlighted` (menu/context-menu): the named value's own item gains
 * `data-highlighted=''`; nothing else does. Checked structurally (attribute
 * NAME only) because the exact fact also depends on WHICH item id carries
 * it, which is case-specific case data, not a fixed formula. */
const highlightedAssertion: FieldAssertion = {
  attrNames: ['data-highlighted'],
}

/** `checked` (menu, checkbox items): `aria-checked` flips per named value. */
const checkedAssertion: FieldAssertion = {
  attrNames: ['aria-checked'],
}

/** `nestedOpen` (menu/context-menu): mounts/unmounts the submenu's own
 * `data-part='sub-content'` subtree entirely — structural presence, not a
 * fixed attribute value. */
const nestedOpenAssertion: FieldAssertion = {
  attrNames: ['data-part'],
}

/** `open`/`focused` on menubar/navigation-menu/command-menu: which id/whether
 * any id is open shifts `data-state` on the addressed sub-part, but WHICH
 * part is case-specific (an id from case data), so only the attribute NAME
 * is fixed generically. */
const openIdAssertion: FieldAssertion = {
  attrNames: ['data-state'],
}
const focusedIdAssertion: FieldAssertion = {
  attrNames: ['data-highlighted', 'tabindex'],
}

const listOfStringsAssertion: FieldAssertion = {
  // `items`/`disabledItems`/`value` (select/combobox/toolbar, string
  // arrays): each entry drives its own item's presence/`aria-selected`/
  // `aria-disabled`/`data-disabled`, or — for `value` while the trigger's
  // OWN content is closed (select/combobox) — the trigger's own
  // `data-placeholder` (whether a value is selected at all). Checked
  // structurally, since exactness needs the item's own value, not a fixed
  // formula.
  attrNames: [
    'data-part',
    'aria-selected',
    'aria-disabled',
    'data-disabled',
    'data-placeholder',
    'text',
  ],
}

const highlightedValueAssertion: FieldAssertion = {
  attrNames: ['data-highlighted'],
}

const queryAssertion: FieldAssertion = {
  // command-menu's `query` reflects onto the filter `<input>`'s own live
  // VALUE (`#value`) and filters which commands are mounted (`data-index`
  // renumbering, `data-empty` toggling) — never a fixed attribute value.
  attrNames: ['#value', 'data-index', 'data-empty', 'data-part'],
}

/** Keyed `${scenarioId}.${field}`, checked generically across every case of
 * that scenario. A `${scenarioId}/${caseId}.${field}` key overrides it for a
 * case where the generic entry does not hold (see `skipAnimations`, resolved
 * dynamically instead since it needs the case's own `presence`). */
export const FIELD_ASSERTIONS: Record<string, FieldAssertion> = {
  'component:alert-dialog.presence': presenceAssertionSkipAnimations,
  'component:alert-dialog.title': textFieldAssertion,
  'component:alert-dialog.description': textFieldAssertion,
  'component:dialog.presence': presenceAssertionSkipAnimations,
  'component:dialog.modal': dialogModalAssertion,
  'component:dialog.title': textFieldAssertion,
  'component:dialog.description': textFieldAssertion,

  'component:drawer.presence': presenceAssertionSkipAnimations,
  'component:drawer.side': drawerSideAssertion,
  'component:drawer.title': textFieldAssertion,
  'component:drawer.description': textFieldAssertion,

  'component:hover-card.presence': presenceAssertionSkipAnimations,
  'component:hover-card.label': textFieldAssertion,
  'component:popover.presence': presenceAssertionSkipAnimations,
  'component:popover.label': textFieldAssertion,
  'component:tooltip.presence': presenceAssertionAnimated,
  'component:tooltip.label': textFieldAssertion,

  'component:menu.presence': presenceAssertionSkipAnimations,
  'component:menu.highlighted': highlightedAssertion,
  'component:menu.checked': checkedAssertion,
  'component:menu.nestedOpen': nestedOpenAssertion,
  'component:context-menu.presence': contextMenuPresenceAssertion,
  'component:context-menu.skipAnimations': contextMenuSkipAnimationsAssertion,
  'component:context-menu.highlighted': highlightedAssertion,
  'component:context-menu.nestedOpen': nestedOpenAssertion,

  'component:menubar.open': openIdAssertion,
  'component:menubar.focused': focusedIdAssertion,
  'component:navigation-menu.open': openIdAssertion,
  'component:navigation-menu.focused': focusedIdAssertion,
  'component:navigation-menu.disabled': navMenuDisabledAssertion,

  'component:select.open': openBooleanDataStateAssertion,
  'component:select.value': listOfStringsAssertion,
  'component:select.items': listOfStringsAssertion,
  'component:select.disabledItems': listOfStringsAssertion,
  'component:select.highlightedValue': highlightedValueAssertion,
  'component:select.selectionMode': selectionModeAssertion,

  'component:combobox.open': openBooleanDataStateAssertion,
  'component:combobox.value': listOfStringsAssertion,
  'component:combobox.inputValue': inputValueFieldAssertion,
  'component:combobox.items': listOfStringsAssertion,
  'component:combobox.disabledItems': listOfStringsAssertion,
  'component:combobox.highlightedValue': highlightedValueAssertion,
  'component:combobox.status': statusAssertion,
  'pattern:searchable-select.open': openBooleanDataStateAssertion,
  'pattern:searchable-select.value': listOfStringsAssertion,
  'pattern:searchable-select.inputValue': inputValueFieldAssertion,
  'pattern:searchable-select.items': listOfStringsAssertion,
  'pattern:searchable-select.disabledItems': listOfStringsAssertion,
  'pattern:searchable-select.highlightedValue': highlightedValueAssertion,
  'pattern:searchable-select.status': statusAssertion,

  'component:toast.toastType': toastTypeAssertion,
  'component:toast.title': textFieldAssertion,
  'component:toast.description': textFieldAssertion,
  'component:toast.dismissable': dismissableAssertion,
  'component:toast.closing': closingAssertion,

  'component:toolbar.items': listOfStringsAssertion,
  'component:toolbar.disabledItems': listOfStringsAssertion,
  'component:toolbar.orientation': orientationAssertion,

  'pattern:command-menu.open': openBooleanDataStateAssertion,
  'pattern:command-menu.query': queryAssertion,

  'pattern:confirm-dialog.open': openBooleanDataStateAssertion,
  'pattern:confirm-dialog.title': textFieldAssertion,
  'pattern:confirm-dialog.description': textFieldAssertion,
}

/** `skipAnimations` needs the case's own `presence` to compute its expected
 * fact, so it is resolved as a FUNCTION of the scenarioId rather than a
 * static table entry — every presence-bearing scenario shares the same
 * formula. */
const SKIP_ANIMATIONS_SCENARIOS = new Set([
  'component:alert-dialog',
  'component:dialog',
  'component:drawer',
  'component:hover-card',
  'component:popover',
  'component:menu',
  // `component:context-menu` is NOT here: its `skipAnimations` field has its
  // own generic table entry above (`contextMenuSkipAnimationsAssertion`),
  // since it needs `contextMenuResolvedState`'s different formula.
])
const ANIMATED_SCENARIOS = new Set(['component:tooltip'])

export function fieldAssertionFor(
  scenarioId: string,
  caseId: string,
  field: string,
): FieldAssertion | undefined {
  const caseKey = `${scenarioId}/${caseId}.${field}`
  if (FIELD_ASSERTIONS[caseKey]) return FIELD_ASSERTIONS[caseKey]
  if (field === 'skipAnimations' && SKIP_ANIMATIONS_SCENARIOS.has(scenarioId)) {
    return skipAnimationsAssertion(false)
  }
  if (field === 'animated' && ANIMATED_SCENARIOS.has(scenarioId)) {
    return skipAnimationsAssertion(true)
  }
  const genericKey = `${scenarioId}.${field}`
  return FIELD_ASSERTIONS[genericKey]
}

/** Nested array-of-objects fields worth checking on their own (#265 finding:
 * a menu/context-menu/menubar item's own `disabled`/`kind` is exactly the
 * shape the generic top-level mutation loop cannot reach, since
 * `mutateFieldValue` declines every array of objects as "structural, not
 * scalar"). Keyed by the OUTER field name that holds the array. */
export const NESTED_ITEM_FIELD_ASSERTIONS: Record<string, FieldAssertion> = {
  disabled: itemDisabledAssertion,
  kind: itemKindAssertion,
}

export const NESTED_MENUBAR_MENU_FIELD_ASSERTIONS: Record<string, FieldAssertion> = {
  disabled: menubarMenuDisabledAssertion,
}

/** Fields genuinely unobservable in jsdom (real `floating-ui` layout
 * measurement / a real `getBoundingClientRect`), with the exact real-browser
 * test that proves them instead — the closed-at-both-ends counterpart to
 * `INSENSITIVE_DIMENSIONS` in each renderer's own test file. Every entry in
 * a renderer's `SKIPPED_FIELDS` must have one of these. */
export const GEOMETRY_ALLOWLIST: Record<string, string> = {
  placement:
    'measured only via floating-ui autoUpdate + a real getBoundingClientRect, which jsdom never performs; proven in packages/components/test/styles/menus-overlays-live-render.browser.test.ts ("mirrors floating placement under RTL", "places every real ToastType and every real toast placement") and menu-overlay-rtl-floating.browser.test.ts',
  x: 'the virtual anchor point is resolved only through a real getBoundingClientRect; proven in menus-overlays-live-render.browser.test.ts ("anchors ContextMenu at the real virtual pointer coordinates it was opened with")',
  y: 'same as x — see menus-overlays-live-render.browser.test.ts ("anchors ContextMenu at the real virtual pointer coordinates it was opened with")',
}
