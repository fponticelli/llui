/**
 * LLui components demo — single entry point.
 *
 * The root App (src/app.ts) hosts each section as a `child()` boundary so
 * every section keeps its own bitmask. Cross-section toast/confirm calls
 * flow through a tiny bus (src/shared/bus.ts): the Overlays child registers
 * handlers on its first view() call, other children call showToast() /
 * askConfirm() when needed. Overlays is rendered first so its handlers are
 * registered before any other child's view() runs.
 */
import { mountApp } from '@llui/dom'
import { App } from './app'

mountApp(document.getElementById('app')!, App)
