/**
 * Shared motion policy for registry content positioned by LLui's floating
 * engine. The engine publishes the resolved physical `data-side` and the
 * presence machines publish `data-state`; keeping their selectors together
 * prevents copied floating skins from drifting on either contract.
 *
 * `opening` / `closing` are the animated machine phases. `open` / `closed`
 * remain deliberate aliases for synchronous machines (select and menubar),
 * default skip-animation paths, and consumers that drive the attributes.
 *
 * Keep this as one literal `*Recipe`: the registry Tailwind scanner reads that
 * static position even though callers compose the value through an import.
 */
export const floatingOverlayMotionRecipe =
  'data-[state=opening]:animate-in data-[state=opening]:fade-in-0 data-[state=opening]:zoom-in-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closing]:animate-out data-[state=closing]:fade-out-0 data-[state=closing]:zoom-out-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2'
