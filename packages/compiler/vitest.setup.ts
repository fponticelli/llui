// Test-time registration of the introspection + devtools module factories.
//
// `@llui/compiler` doesn't depend on its opt-in siblings as PACKAGES
// (would create a workspace cycle). For test-time wiring, this setup
// file imports the factory source files via relative paths instead of
// through the package names — vitest + TS resolve relative paths
// without requiring a declared workspace dep, so the cycle warning
// from pnpm goes away while the test setup still gets the factories
// registered before `transformLlui` runs.
//
// Tests that *don't* want introspection / devtools (e.g. bundle-strip
// goldens) call `registerIntrospectionFactory(null)` /
// `registerDevtoolsFactory(null)` to reset before their assert.

import {
  registerIntrospectionFactory,
  registerDevtoolsFactory,
} from './src/introspection-factory.js'
import { introspectionFactory } from '../compiler-introspection/src/index.js'
import { devtoolsFactory } from '../compiler-devtools/src/index.js'

registerIntrospectionFactory(introspectionFactory)
registerDevtoolsFactory(devtoolsFactory)
