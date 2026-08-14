// Is this plugin's floating surface UP? — the one fact a typeahead's key handlers
// may gate on.
//
// A typeahead registers KEY_ESCAPE / KEY_ENTER / arrows at COMMAND_PRIORITY_HIGH
// and answers `true` to CLAIM the key from everyone below it. Claiming is only
// legitimate while there is a surface to drive: a claimed Escape with nothing on
// screen is a key the user pressed for no effect, and — the reason issue #130 was
// filed — it never reaches the host's own handler sitting at COMMAND_PRIORITY_LOW
// (a "move focus out of the editor", a surrounding dialog's dismiss).
//
// ## Why the gate cannot be re-derived plugin-side
//
// The open flag lives in the plugin's UI slice, and the `register` half runs
// BESIDE the editor, not inside the component — it can neither read the slice nor
// see the messages the plugin's own VIEW sends (a clicked row, the repoint
// panel's input). So all three typeaheads gated on a proxy instead: a `liveQuery`
// cached by their `onCommit` refresh, i.e. "the caret is on a trigger".
//
// That is a DIFFERENT fact, and it is wrong in both directions:
//
//   * Dismissing a menu changes no document state, so no commit follows, so the
//     cached query is never cleared — the handler goes on claiming Escape for a
//     menu that is already hidden, until the caret leaves the trigger text (#130).
//   * A trigger whose query matches NOTHING opens no menu at all (`open` is
//     `items.length > 0`), yet the cached query is set — so `/zzzz` swallowed all
//     four keys with nothing on screen either.
//
// ## The seam
//
// A plugin UI DECLARES when its surface is up ({@link PluginUISpec.isOpen}); the
// host publishes those readers per editor, here, as the plugin's `register` half
// is the one place that needs them. A reader is a PULL — `isOpen(slice.peek())`,
// evaluated at the moment the key handler asks — not a mirrored copy, so there is
// no cached second opinion that can drift from the state the user is looking at,
// and no dependence on when the DOM commit lands (`send` applies state
// synchronously in every scheduler mode; only the commit is deferrable).
//
// A plugin whose reader was never published reads CLOSED, so an unpublished gate
// makes a typeahead inert rather than making it swallow keys — the failure that
// costs a keystroke, never the one that steals every host handler's.

import type { LexicalEditor } from 'lexical'

/** `plugin name` → "is that plugin's surface up right now?". */
export type SurfaceReaders = ReadonlyMap<string, () => boolean>

// Per EDITOR — i.e. per mount, which is the granularity `register` runs at. Weak,
// so a disposed editor's entry cannot outlive it even if a host forgets to detach.
const published = new WeakMap<LexicalEditor, SurfaceReaders>()

/**
 * Publish the open-state readers for `editor`'s plugin UIs. Called by the host
 * from `onReady` (the editor exists, and no key can have been pressed yet).
 * Returns a detach for the host's dispose path.
 */
export function publishSurfaceOpen(editor: LexicalEditor, readers: SurfaceReaders): () => void {
  published.set(editor, readers)
  return () => {
    // Only clear OUR entry: a remount builds a new editor, so this can never
    // race a live one.
    if (published.get(editor) === readers) published.delete(editor)
  }
}

/**
 * The gate a plugin's `register` half reads: "is MY surface up?". Resolved at
 * call time, so it is correct however late the host publishes and however the
 * surface was closed (Escape, a chosen row, the caret leaving the trigger).
 */
export function surfaceGate(editor: LexicalEditor, plugin: string): () => boolean {
  return () => published.get(editor)?.get(plugin)?.() ?? false
}
