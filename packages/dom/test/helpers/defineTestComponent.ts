// Test-only helper exposed inside `packages/dom/test/`. Re-exports the
// internal builder from @llui/dom's private `internal/` namespace —
// production bundles never include this file (tests aren't part of the
// publishable dist). v2b §6.

export {
  defineTestComponentInternal as defineTestComponent,
  type DefineTestComponentInput,
} from '../../src/internal/test-component-builder.js'
