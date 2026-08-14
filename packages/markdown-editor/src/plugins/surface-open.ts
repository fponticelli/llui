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
// no cached second opinion to fall out of step with the STATE the overlay is
// rendered from. `peek()` is a plain read of live state (`@llui/dom`'s
// `handle.ts`), so asking during a commit neither throws nor re-enters the
// scheduler.
//
// It is STATE-truthful, not DOM-truthful, and the difference is measurable in
// exactly one place: under `mountApp(..., { scheduler: 'raf' })` the DOM commit
// is deferred to a frame while `send` still applies state synchronously, so
// between Escape #1 and the next frame the slice says CLOSED while the overlay is
// still on screen. A second Escape inside that sub-frame window falls through to
// the host instead of being claimed. Unreachable by a human at 16 ms, and the
// error direction is the safe one — fall through, never steal. Gating on the DOM
// instead would trade that for the failure this file exists to prevent.
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
 * Publish the open-state readers for `editor`'s plugin UIs, and return the
 * detach. For the HOST (`markdownEditor`, or any host built on the same plugin
 * contract); a plugin never calls this.
 *
 * Call it from the host's `lexicalForeign` **`register`** hook, whose return value
 * IS the disposer — attach and detach are then the same closure, in the same
 * disposer chain that releases the mount's other editor references. NOT from
 * `onReady`: that hook has no symmetric teardown, so the detach would have to be
 * written somewhere else and could drift out of step with the attach.
 *
 * `register` runs while the editor is being built, before any plugin's own
 * `register` can matter and long before a key can be pressed — the readers only
 * have to exist by the first keystroke, not by any earlier moment.
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
