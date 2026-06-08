// Lazy installer — the production entry point. This module is deliberately
// tiny: it registers an activation trigger and only dynamically imports the
// heavy HUD (`./index.js`, which pulls in Lexical, components, html-to-image)
// the first time it's activated. An app that wires the installer but never
// triggers it never downloads the HUD chunk.
//
// `import type` below is erased at compile time, so importing this module
// does NOT statically pull in the HUD — only the dynamic `import('./index.js')`
// inside `activate()` does, which bundlers code-split into a separate chunk.

import type { AnnotateHudHandle, MountAnnotateOptions } from './index.js'

export interface InstallAnnotateOptions extends MountAnnotateOptions {
  /** Register the Cmd/Ctrl+Shift+A keyboard trigger that lazily loads + opens
   *  the HUD. Default true. Set false to drive activation yourself via
   *  `activate()`. */
  trigger?: boolean
}

export interface AnnotateHudInstaller {
  /** Lazily import + mount the HUD (idempotent — repeat calls return the same
   *  handle). Resolves to the live handle. */
  activate(): Promise<AnnotateHudHandle>
  /** Remove the bootstrap trigger listener. Does not unmount a HUD that has
   *  already been activated. */
  dispose(): void
}

/**
 * Install the HUD lazily behind an activation trigger. Intended for live
 * apps: the host calls this (behind its own authorization), and the HUD code
 * only loads when a user activates it. Defaults to `allowProduction: true`
 * since the host is opting in deliberately.
 */
export function installAnnotateHud(opts: InstallAnnotateOptions = {}): AnnotateHudInstaller {
  const { trigger = true, ...mountOpts } = opts
  let handlePromise: Promise<AnnotateHudHandle> | null = null

  const activate = (): Promise<AnnotateHudHandle> => {
    // Production defaults: opt into mounting + shadow-DOM isolation. Both are
    // overridable via the passed options.
    handlePromise ??= import('./index.js').then((m) =>
      m.mountAnnotateHud({ allowProduction: true, isolate: true, ...mountOpts }),
    )
    return handlePromise
  }

  let onKey: ((e: KeyboardEvent) => void) | null = null
  const removeTrigger = (): void => {
    if (onKey && typeof document !== 'undefined') document.removeEventListener('keydown', onKey)
    onKey = null
  }

  if (trigger && typeof document !== 'undefined') {
    onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault()
        void activate().then((h) => h.open())
        // The mounted HUD owns the shortcut from here; drop our bootstrap
        // listener so the combo isn't handled twice.
        removeTrigger()
      }
    }
    document.addEventListener('keydown', onKey)
  }

  return { activate, dispose: removeTrigger }
}
