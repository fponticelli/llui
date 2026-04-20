# LLui Agent — Plan 3b: Production-Mode Metadata Emission

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an `agent: true` option to `@llui/vite-plugin` that causes agent-required metadata (`__msgSchema`, `__stateSchema`, `__effectSchema`, `__msgAnnotations`, `__bindingDescriptors`) to be emitted even in production builds. Default (`agent: false`) preserves existing behavior — metadata gated behind Vite's `devMode`.

**Architecture:** Plumbing only. The `LluiPluginOptions` interface at `packages/vite-plugin/src/index.ts:31-80` grows one new boolean field. The `transformLlui` signature already takes `devMode` — we extend it to take `emitAgentMetadata` and replace the sole `if (devMode)` gate guarding those emissions with `if (emitAgentMetadata)`. `__componentMeta` (file/line for debug) stays dev-only. `__schemaHash` is already always-emitted — unchanged.

**Tech Stack:** Existing Vite plugin infrastructure, vitest.

**Why this matters:** Plan 4 (agent server) runs in production against deployed apps. The browser sends `hello { msgSchema, stateSchema, ... }` on WS open (spec §7.4). Without `agent: true`, a production build ships no schema, so `describe_app` has nothing to return and Claude can't understand the app. This closes that gap before Plan 4 starts.

---

## File Structure

- `packages/vite-plugin/src/index.ts` — extend `LluiPluginOptions` with `agent?: boolean`; compute `emitAgentMetadata = opts.agent ?? false || devMode`; pass to `transformLlui`.
- `packages/vite-plugin/src/transform.ts` — accept `emitAgentMetadata` parameter; replace the current `if (devMode)` gate for the schema-and-descriptor emissions with `if (emitAgentMetadata)`. Keep `__componentMeta` dev-only.
- `packages/vite-plugin/test/transform.test.ts` — new describe block asserting prod-mode emission under `agent: true` vs. baseline omission.
- `packages/vite-plugin/README.md` — add `agent` option to the documented options.

---

## Task 1: Failing integration test — prod-mode + `agent: true` emits metadata

**Files:**

- Modify: `packages/vite-plugin/test/transform.test.ts`

- [ ] **Step 1: Read the existing `transformLlui` signature**

Inspect how `transformLlui` is currently called in existing tests (search for `transformLlui(`). If it takes 3 args today — `(code, id, devMode)` — after this plan it will take 4: `(code, id, devMode, emitAgentMetadata)`. The failing test should reflect that signature.

- [ ] **Step 2: Append the failing test**

Add a new describe block:

```ts
describe('transformLlui — agent-mode metadata emission', () => {
  // Production-mode harness: devMode = false. emitAgentMetadata varies.
  const tProd = (src: string, emitAgentMetadata: boolean) =>
    transformLlui(src, 'test.ts', /* devMode */ false, /* emitAgentMetadata */ emitAgentMetadata)
      ?.output ?? src

  const sample = `
import { component, button } from '@llui/dom'
type State = { n: number }
type Msg =
  /** @intent("Increment") */
  | { type: 'inc' }
export const App = component<State, Msg, never>({
  name: 'App', init: () => [{ n: 0 }, []],
  update: (s, _m) => [s, []],
  view: ({ send, text }) => [
    button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
  ],
})
`

  it('omits schemas and descriptors in prod mode with agent: false (baseline)', () => {
    const out = tProd(sample, false)
    expect(out).not.toContain('__msgSchema:')
    expect(out).not.toContain('__stateSchema:')
    expect(out).not.toContain('__msgAnnotations:')
    expect(out).not.toContain('__bindingDescriptors:')
    // __schemaHash is already always-emitted; expect it:
    expect(out).toMatch(/__schemaHash:/)
  })

  it('emits schemas and descriptors in prod mode with agent: true', () => {
    const out = tProd(sample, true)
    expect(out).toContain('__msgSchema:')
    expect(out).toContain('__stateSchema:')
    expect(out).toContain('__msgAnnotations:')
    expect(out).toContain('__bindingDescriptors:')
    expect(out).toMatch(/__schemaHash:/)
  })

  it('omits __componentMeta (file/line) even with agent: true in prod', () => {
    // __componentMeta carries developer file paths — dev-debug only;
    // not part of the agent's runtime surface.
    const out = tProd(sample, true)
    expect(out).not.toContain('__componentMeta:')
  })
})
```

- [ ] **Step 3: Run — confirm fail**

```bash
cd packages/vite-plugin && pnpm vitest run test/transform.test.ts -t "agent-mode"
```

Expected: FAIL — `transformLlui` doesn't yet accept a 4th parameter; or if it does, the emissions don't change under it.

---

## Task 2: Extend `transformLlui` signature + flip the emission gate

**Files:**

- Modify: `packages/vite-plugin/src/transform.ts`

- [ ] **Step 1: Update the function signature**

Find the `export function transformLlui(...)` declaration. Add a 4th parameter:

```ts
export function transformLlui(
  code: string,
  id: string,
  devMode: boolean,
  emitAgentMetadata: boolean = false, // NEW — defaults false for backward-compat
): TransformResult | null
```

Default value is `false` so existing call sites that pass 3 args keep working.

- [ ] **Step 2: Flip the emission gate**

Find the `if (devMode)` block where `__msgSchema`, `__stateSchema`, `__effectSchema`, `__msgAnnotations`, and `__bindingDescriptors` are injected. Replace with a wider gate:

```ts
const shouldEmitAgentMetadata = devMode || emitAgentMetadata
if (shouldEmitAgentMetadata) {
  // existing emissions: __msgSchema, __stateSchema, __effectSchema,
  // __msgAnnotations, __bindingDescriptors
}
```

- [ ] **Step 3: Keep `__componentMeta` (file/line) inside a `devMode`-only guard**

If `__componentMeta` is currently inside the same `if (devMode)` block, pull it out into its own guard:

```ts
if (devMode) {
  // __componentMeta emission only
  newProps.push(ts.factory.createPropertyAssignment('__componentMeta', ...))
}
```

Do NOT emit `__componentMeta` under `agent: true` alone — it leaks developer filesystem paths into production bundles and isn't needed by the agent runtime.

- [ ] **Step 4: Run tests**

```bash
cd packages/vite-plugin && pnpm vitest run test/transform.test.ts -t "agent-mode"
cd packages/vite-plugin && pnpm test    # full suite
cd packages/vite-plugin && pnpm check   # strict type-check
cd packages/vite-plugin && pnpm lint
```

All must pass. If any pre-existing test now fails because it was calling `transformLlui` with 3 args and relying on specific emission behavior — those still work because the 4th arg defaults to `false`.

If `pnpm check` fails, fix the type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/vite-plugin/src/transform.ts packages/vite-plugin/test/transform.test.ts
git commit -m "$(cat <<'COMMIT'
feat(vite-plugin): emitAgentMetadata flag — hoist schemas out of devMode gate

transformLlui grows a 4th param (default false); when true, schemas
and descriptors are emitted in prod builds so the agent runtime has
a payload to send over WS hello. __componentMeta stays dev-only
(avoids leaking developer file paths).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 3: Surface the option in the plugin entry

**Files:**

- Modify: `packages/vite-plugin/src/index.ts`

- [ ] **Step 1: Add `agent` to `LluiPluginOptions`**

Find the `LluiPluginOptions` interface (around line 31–80 of `src/index.ts`). Add:

```ts
/**
 * When true, include schemas and binding descriptors in prod builds so
 * the @llui/agent runtime has metadata to advertise over its WS hello
 * frame. Default false — matches prior behavior (metadata is dev-only).
 * See agent spec §7.4 and Plan 3b.
 */
agent?: boolean
```

Place it alongside the other top-level options (`mcpPort`, `failOnWarning`, `disabledWarnings`, `verbose`).

- [ ] **Step 2: Plumb the option through**

Locate the code where `transformLlui` is invoked (around line 396). It currently passes `devMode`:

```ts
transformLlui(code, id, devMode)
```

Change to:

```ts
transformLlui(code, id, devMode, options.agent ?? false)
```

Use whatever variable name the options are bound to in scope (likely `options` or `opts`).

- [ ] **Step 3: Type-check**

```bash
cd packages/vite-plugin && pnpm check
cd packages/vite-plugin && pnpm test
```

Both must pass.

- [ ] **Step 4: Commit**

```bash
git add packages/vite-plugin/src/index.ts
git commit -m "$(cat <<'COMMIT'
feat(vite-plugin): expose agent option — opt-in metadata in prod

New LluiPluginOptions.agent (default false). When set, hoists schemas
and descriptors out of the dev-only gate so production builds carry
agent-required metadata. See agent spec §7.4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 4: Document the option

**Files:**

- Modify: `packages/vite-plugin/README.md`

- [ ] **Step 1: Update the options section**

Find the `## Options` section (around line 21–27). Replace with:

````markdown
## Options

```ts
llui({
  mcpPort: 5200, // MCP debug server port (default: 5200, false to disable)
  agent: true, // Emit LLui Agent metadata in prod builds (default: false)
})
```
````

- `mcpPort` — MCP debug bridge port. Default 5200. Set to `false` to disable.
- `agent` — Opt into emitting schemas + binding descriptors in prod builds.
  Required when the app is deployed with `@llui/agent/client`. Default `false`
  (metadata is dev-only to keep production bundle size minimal).

````

- [ ] **Step 2: Commit**

```bash
git add packages/vite-plugin/README.md
git commit -m "$(cat <<'COMMIT'
docs(vite-plugin): document agent option

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
````

---

## Task 5: Workspace verify

**Files:** none — verification.

- [ ] **Step 1: Run the full workspace**

```bash
cd /Users/franco/projects/llui
pnpm turbo build
pnpm turbo check
pnpm turbo lint
pnpm turbo test
```

All must pass.

- [ ] **Step 2: Confirm baseline unchanged**

```bash
cd /Users/franco/projects/llui/examples/todomvc && pnpm build
grep -c '__msgSchema' examples/todomvc/dist/**/*.js 2>/dev/null | tr '\n' ',' | head -c 200
```

Expected: 0 — todomvc's prod build (no `agent: true` in its vite config) still doesn't ship schemas.

- [ ] **Step 3: No commit for this task.**

---

## Task 6: Commit the plan file

```bash
cd /Users/franco/projects/llui
git add docs/superpowers/plans/2026-04-20-llui-agent-3b-production-metadata.md
git commit -m "$(cat <<'COMMIT'
docs(agent): Plan 3b production-metadata — implementation plan

6-task interstitial plan adding vite-plugin's `agent: true` option
so prod builds can ship the metadata the agent runtime needs.
Clears Plan 4 to proceed with server implementation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Completion Criteria

- `LluiPluginOptions` has `agent?: boolean`.
- `transformLlui` has a 4th parameter `emitAgentMetadata: boolean = false`.
- Schema + descriptor emissions now gate on `devMode || emitAgentMetadata`.
- `__componentMeta` stays devMode-only.
- Under `agent: true` in prod, `__msgSchema`/`__stateSchema`/`__effectSchema`/`__msgAnnotations`/`__bindingDescriptors` all appear in compiled output.
- todomvc (no `agent` set) still ships no schemas — backward-compat confirmed.
- README documents the new option.
- Full workspace `pnpm turbo build/check/lint/test` green.
