/**
 * LLui components demo — decomposed into 3 independent apps.
 *
 * Each section owns its own State/update/view and mounts into its own
 * container. This keeps each component's state access path count well
 * below the 31-path tier limit, avoiding the FULL_MASK fallback.
 *
 * Cross-cutting actions (toasts, confirm dialogs) flow through a tiny
 * bus (src/shared/bus.ts): the Overlays app registers handlers on mount,
 * other apps call `showToast()` / `askConfirm()` when needed.
 */
import * as overlays from './sections/overlays'
import * as inputs from './sections/inputs'
import * as data from './sections/data'
import * as pickersEditing from './sections/pickers-editing'

// Overlays must mount first so its bus handlers are registered before any
// other section calls showToast/askConfirm.
overlays.mount(document.getElementById('sec-overlays')!)
inputs.mount(document.getElementById('sec-inputs')!)
data.mount(document.getElementById('sec-data')!)
pickersEditing.mount(document.getElementById('sec-pickers-editing')!)
