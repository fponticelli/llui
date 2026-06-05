// Keyboard-shortcut wiring: parse normalized chord strings and register them
// through a single KEY_DOWN command on the editor.

import { COMMAND_PRIORITY_NORMAL, KEY_DOWN_COMMAND, type LexicalEditor } from 'lexical'
import type { ShortcutSpec } from './plugin.js'

/** A parsed chord. `mod` means ⌘ on macOS / Ctrl elsewhere. */
export interface ParsedCombo {
  key: string
  mod: boolean
  shift: boolean
  alt: boolean
  ctrl: boolean
}

/** Parse a chord like `Mod-Shift-7` into its parts. Case-insensitive on
 * modifiers; the final segment is the key (lower-cased for letters). */
export function parseCombo(combo: string): ParsedCombo {
  const parts = combo
    .split('-')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  const result: ParsedCombo = { key: '', mod: false, shift: false, alt: false, ctrl: false }
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    const isLast = i === parts.length - 1
    const lower = part.toLowerCase()
    if (!isLast && (lower === 'mod' || lower === 'cmd' || lower === 'meta')) result.mod = true
    else if (!isLast && lower === 'ctrl') result.ctrl = true
    else if (!isLast && lower === 'shift') result.shift = true
    else if (!isLast && (lower === 'alt' || lower === 'option' || lower === 'opt'))
      result.alt = true
    else result.key = part.length === 1 ? part.toLowerCase() : part
  }
  return result
}

/** Does a keyboard event satisfy a parsed chord? `mod` maps to ⌘ on macOS and
 * Ctrl elsewhere; all declared modifiers must match exactly (no extras). */
export function matchesCombo(event: KeyboardEvent, combo: ParsedCombo, isMac: boolean): boolean {
  const eventKey = event.key.length === 1 ? event.key.toLowerCase() : event.key
  if (eventKey !== combo.key) return false
  const modActive = isMac ? event.metaKey : event.ctrlKey
  const otherCtrl = isMac ? event.ctrlKey : event.metaKey
  if (combo.mod !== modActive) return false
  // An explicit `ctrl` on macOS targets the control key specifically.
  if (combo.ctrl !== (isMac ? event.ctrlKey : false)) {
    if (!(combo.mod && !isMac)) return false
  }
  if (!combo.mod && !combo.ctrl && otherCtrl) return false
  if (combo.shift !== event.shiftKey) return false
  if (combo.alt !== event.altKey) return false
  return true
}

/** Best-effort macOS detection (browser only; defaults to false off-DOM). */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const platform = navigator.platform ?? ''
  const ua = navigator.userAgent ?? ''
  return /mac|iphone|ipad|ipod/i.test(platform) || /mac/i.test(ua)
}

/** Register a set of shortcuts on the editor through one KEY_DOWN handler.
 * Returns a disposer. The first matching shortcut whose `run` returns `true`
 * wins and the event is consumed. */
export function registerShortcuts(
  editor: LexicalEditor,
  shortcuts: readonly ShortcutSpec[],
): () => void {
  if (shortcuts.length === 0) return () => {}
  const parsed = shortcuts.map((s) => ({ spec: s, combo: parseCombo(s.combo) }))
  const mac = isMacPlatform()
  return editor.registerCommand(
    KEY_DOWN_COMMAND,
    (event: KeyboardEvent) => {
      for (const { spec, combo } of parsed) {
        if (matchesCombo(event, combo, mac)) {
          if (spec.run(editor)) {
            event.preventDefault()
            return true
          }
        }
      }
      return false
    },
    COMMAND_PRIORITY_NORMAL,
  )
}
