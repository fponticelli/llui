---
title: '@llui/compiler-introspection'
description: 'Opt-in compiler module: agent schemas, msg annotations, schema hash emission'
---

# @llui/compiler-introspection

Opt-in compiler module that emits runtime-introspection metadata. Consumed by [`@llui/agent`](/api/agent) (for end-user agent surfaces) and [`@llui/mcp`](/api/mcp) (for the dev MCP server).

When enabled, the compiler emits:

- **Msg schemas** — discriminated-union JSON Schema for every component's `Msg`, used by `llui_validate_message` and `llui_get_message_schema`.
- **Msg annotations** — `@intent`, `@should`, `@emits`, etc. surfaced as runtime metadata.
- **State schemas** — JSON Schema for every component's `State`.
- **Binding descriptors** — per-binding kind/mask/path data used by `llui_get_bindings`.
- **Schema hash** — a stable content hash so consumers can detect schema changes across reloads.

## Why it's separate

These payloads add bundle weight that production apps without agent/MCP integration don't need. Splitting them into an opt-in package keeps the [`@llui/compiler`](/api/compiler) engine lean.

<!-- auto-api:start -->

## Constants

### `introspectionFactory`

Builds the introspection module set for a single source file.
Activation order matches the v2c/decomp-7 design:

1. `bindingDescriptorsModule` — preTransform fires first so the
   universal handler-tagger + scope-variant-registration runs
   before any visitor or emit phase sees the file.
2. `msgSchemaModule`, `stateSchemaModule`, `msgAnnotationsModule`
   — producer modules populate the schema-hash inputs slot.
3. `schemaHashModule` — emit reads the populated slot.
   Per-module activation gates mirror what `transformLlui` did inline
   before decomp-26:

- `msgSchemaModule` when at least one of Msg / Effect schemas extracted
- `stateSchemaModule` when State schema extracted
- `msgAnnotationsModule` when annotation map non-null (includes empty)
- `schemaHashModule` always (well-defined hash over null inputs)
- `bindingDescriptorsModule` always when introspection is on
  The "always-on schemaHash" comes from spec §7.4: the hash ships in
  prod too, used by HMR re-send gating regardless of agent mode.

```typescript
const introspectionFactory: IntrospectionFactory
```

<!-- auto-api:end -->
