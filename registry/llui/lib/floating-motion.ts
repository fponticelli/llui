/**
 * Shared overlay and transient motion policy. LLui's floating engine publishes
 * the resolved physical `data-side`, while presence machines publish
 * `data-state`; keeping those selectors and the reduced-motion lifecycle rule
 * together prevents copied skins from drifting on any of those contracts.
 *
 * `opening` / `closing` are the animated machine phases. `open` / `closed`
 * remain deliberate aliases for synchronous machines (select and menubar),
 * default skip-animation paths, and consumers that drive the attributes.
 *
 * Keep every utility in a literal `*Recipe`: the registry Tailwind scanner
 * reads those static positions even though callers compose the values through
 * imports.
 */

/**
 * Presence machines still need a real end event under reduced motion. A tiny
 * nonzero duration preserves that lifecycle contract without visible travel;
 * `animate-none` or a zero duration can strand `opening` / `closing` forever.
 */
export const overlayReducedMotionRecipe =
  'motion-reduce:[animation-duration:0.01ms]! motion-reduce:[transition-duration:0.01ms]!'

export const floatingOverlayMotionRecipe = `data-[state=opening]:animate-in data-[state=opening]:fade-in-0 data-[state=opening]:zoom-in-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closing]:animate-out data-[state=closing]:fade-out-0 data-[state=closing]:zoom-out-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ${overlayReducedMotionRecipe}`

/**
 * The SYNCHRONOUS twin of the recipe above (#265 finding 5). `select` /
 * `combobox` (which re-exports `SelectContent`) / `menubar` are all boolean
 * open/closed machines with NO `opening`/`closing` presence phase — `data-state`
 * on their content is only ever `open` or `closed` (see each machine's own
 * `data-state` publication). `data-[state=opening]:*` / `data-[state=closing]:*`
 * selectors on such a node can NEVER match: not a visual bug (nothing ever sets
 * that attribute value, so nothing ever animates wrong), but dead vocabulary
 * that documents a four-phase lifecycle the consumer does not have and that a
 * future stricter dead-selector guard would have to special-case around
 * forever. Keep the two real, reachable phases (`open`/`closed`) plus the
 * physical-side slide-in and the reduced-motion rule; drop `opening`/`closing`
 * entirely rather than aliasing them to `open`/`closed` (#265's predecessor
 * design), which cannot be told apart from a real four-phase consumer by
 * reading the class list alone.
 */
export const floatingSyncMotionRecipe = `data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ${overlayReducedMotionRecipe}`
