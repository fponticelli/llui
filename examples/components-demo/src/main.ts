/**
 * LLui components demo — single entry point (signal surface).
 *
 * The root App (src/app.ts) composes each section as a slice of one signal
 * component's state — the signal surface has a single update loop per mounted
 * component, so sections are modules (init + update + view) rather than
 * `subApp()` boundaries. Cross-section toast/confirm calls flow through a tiny
 * bus (src/shared/bus.ts): the Overlays section registers handlers on its first
 * view() call; other sections call showToast() / askConfirm() when needed.
 * Overlays is rendered first so its handlers are registered before any other
 * section's view() runs.
 */
import { mountApp } from '@llui/dom/signals'
import { App } from './app'

mountApp(document.getElementById('app')!, App)
