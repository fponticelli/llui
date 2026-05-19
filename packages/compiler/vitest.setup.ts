// Test-time registration of the introspection module factory.
//
// `@llui/compiler` no longer imports `@llui/compiler-introspection`
// to avoid a workspace circular dependency (v2c/decomp-26). Tests
// that exercise agent metadata emission need the factory registered
// before `transformLlui` runs. This setup file runs once per test
// process via the vitest.config.ts `setupFiles` option.
//
// Tests that *don't* want introspection (e.g. tests asserting the
// "introspection disabled" path) can call
// `registerIntrospectionFactory(null)` to reset before their assert.

import { registerIntrospectionFactory } from './src/introspection-factory.js'
import { introspectionFactory } from '@llui/compiler-introspection'

registerIntrospectionFactory(introspectionFactory)
