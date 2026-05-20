---
title: '@llui/compiler-devtools'
description: 'Opt-in compiler module: __componentMeta emission for source navigation'
---

# @llui/compiler-devtools

Opt-in compiler module for development-mode tooling. Emits `__componentMeta` (file path + line number) alongside every compiled component so [`@llui/mcp`](/api/mcp) and other LLM tools can navigate from a running component back to its source.

Dev-mode only. Production builds drop these symbols.

Depends on [`@llui/compiler-introspection`](/api/compiler-introspection).

<!-- auto-api:start -->

## Constants

### `devtoolsFactory`

Builds the devtools module set for a single source file.
Activation gates mirror what `transformLlui` did inline before
decomp-27:

- `componentMetaModule` when `devMode` is true
  Future devtools modules (trace instrumentation) would gate on a
  separate `enableTraceInstrumentation` flag the host passes via
  the factory input.

```typescript
const devtoolsFactory: DevtoolsFactory
```

<!-- auto-api:end -->
