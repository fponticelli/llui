/**
 * Registry skins sync fixture — entry point (see this app's README).
 *
 * The app is one signal component whose state is a record of section slices.
 * Sections that need no state still declare an empty slice so the root's
 * routing stays uniform.
 */
import { mountApp } from '@llui/dom'
import { App } from './app'

const host = document.getElementById('app')
if (host === null) throw new Error('missing #app host')
mountApp(host, App)
