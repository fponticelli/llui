/**
 * Client entry point.
 * Hydrates server-rendered HTML when present, otherwise mounts fresh.
 */
import { mountApp } from '@llui/dom'
import { appDef, initialState } from './app'

const container = document.getElementById('app')!

mountApp(container, appDef)

// Suppress unused variable warning — initialState is exported for use by
// entry-server.ts but imported here to keep the module graph consistent.
void initialState
