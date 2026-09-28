import type { AnnotateHudHandle } from '../../src/index.js'

const HUD_ID = 'llui-devmode-annotate-root'

/**
 * Tear down the HUD a test mounted — `destroy()`, not just removing its
 * element. Removing the element leaves the HUD LIVE (document keydown, window
 * error listeners, console patch, debounced persist), and the next test's
 * global events then reach it: that is how `auto-capture-and-escape.test.ts`
 * failed every loaded run once `retry` came off. `mountAnnotateHud` now reclaims
 * such an orphan on the NEXT mount, but a test that dispatches a global event
 * without mounting first (the installer's trigger tests) would still meet it.
 */
export function destroyMountedHud(): void {
  const el = document.getElementById(HUD_ID) as
    | (HTMLElement & { _lluiHandle?: AnnotateHudHandle })
    | null
  el?._lluiHandle?.destroy()
}
