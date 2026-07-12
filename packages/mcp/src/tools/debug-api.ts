import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { lintSignalSource } from '@llui/compiler'
import type { ToolRegistry } from '../tool-registry.js'
import { generateReplayTest } from './replay-test-generator.js'
import { diffState } from '../util/diff.js'
import { assertWithinWorkspace } from '../util/workspace.js'
import { findWorkspaceRoot } from '../index.js'

/**
 * The debug-API methods the LLui **signal runtime** (`installSignalDebug` in
 * `@llui/dom`) actually implements. This is the ground-truth capability set:
 * the signal runtime is the only runtime, and it registers exactly these
 * methods. The `LluiDebugAPI` interface also declares a raft of OPTIONAL
 * binding/scope/effect/DOM-introspection methods (`getBindings`,
 * `getScopeTree`, `inspectElement`, `mockEffect`, `stepBack`, …) that are
 * legacy-runtime concepts — the signal runtime does NOT implement them, so a
 * relay call to any of them fails with "unknown method". We therefore only
 * register tools backed by a servable method (plus the pure/local tools that
 * need no relay), rather than advertising tools no runtime can honour.
 *
 * (The registry-level pseudo-methods `__listComponents` / `__selectComponent`
 * are resolved by the relay itself against `globalThis.__lluiComponents`, so
 * they are always servable.)
 */
export const SERVABLE_DEBUG_METHODS = [
  'getState',
  'send',
  'flush',
  'getMessageHistory',
  'evalUpdate',
  'exportTrace',
  'clearLog',
  'validateMessage',
  'searchState',
  'getMessageSchema',
  'getStateSchema',
  'getEffectSchema',
  'getComponentInfo',
  'snapshotState',
  'restoreState',
] as const

/**
 * Register the servable debug-API tools. Every handler routes through
 * `ctx.relay!.call(method, args)` — which transparently dispatches to either
 * an in-process `LluiDebugAPI` or the WebSocket bridge, depending on how the
 * transport was wired — and every relay method used here is in
 * {@link SERVABLE_DEBUG_METHODS} (or is a pure/local computation).
 *
 * Zod schemas drive both runtime input validation (the registry's
 * `dispatch()` calls `schema.safeParse()` before invoking the handler)
 * and the JSON Schema published in `tools/list` (derived once at
 * registration time). Handlers receive parsed/typed arguments.
 */
export interface DebugApiToolOptions {
  /**
   * Register `llui_eval` — the arbitrary-JavaScript-in-page tool.
   *
   * SECURITY: `llui_eval` forwards a caller-supplied string to
   * `evalInPage`, which runs it verbatim in the user's live browser
   * session (full DOM, cookies, localStorage, network). That is remote
   * code execution against whoever has the dev app open, so it is OFF by
   * default and registered only when an operator explicitly opts in via
   * `LLUI_MCP_ENABLE_EVAL=1` (or this flag, threaded from the CLI). When
   * disabled the tool is never registered and therefore never appears in
   * `tools/list`. The structured `llui_eval_update` (dry-run
   * message-dispatch) tool is unaffected — only arbitrary code is gated.
   */
  enableEval?: boolean
}

/**
 * Whether arbitrary-eval tools should be registered. True only when the
 * operator explicitly opts in — via the `enableEval` flag (threaded from
 * the CLI) or the `LLUI_MCP_ENABLE_EVAL=1` environment variable. Defaults
 * to false so a fresh install never exposes RCE.
 */
export function evalEnabled(opts?: DebugApiToolOptions): boolean {
  if (opts?.enableEval) return true
  return process.env['LLUI_MCP_ENABLE_EVAL'] === '1'
}

export function registerDebugApiTools(registry: ToolRegistry, opts?: DebugApiToolOptions): void {
  registry.register(
    {
      name: 'llui_get_state',
      description:
        'Get the current state of the active LLui component. Returns a JSON-serializable state object. (Switch which component is targeted with llui_select_component.)',
      schema: z.object({}),
    },
    'debug-api',
    async (_args, ctx) => ctx.relay!.call('getState', []),
  )

  registry.register(
    {
      name: 'llui_send_message',
      description:
        'Send a message to the component and return the new state and effects. Validates the message first. send() is synchronous in the signal runtime.',
      schema: z.object({
        msg: z
          .object({})
          .passthrough()
          .describe('The message to send (must be a valid Msg variant)'),
      }),
    },
    'debug-api',
    async (args, ctx) => {
      const errors = (await ctx.relay!.call('validateMessage', [args.msg])) as unknown[] | null
      if (errors) return { errors, sent: false }
      await ctx.relay!.call('send', [args.msg])
      await ctx.relay!.call('flush', [])
      return { state: await ctx.relay!.call('getState', []), sent: true }
    },
  )

  registry.register(
    {
      name: 'llui_eval_update',
      description:
        'Dry-run: call update(state, msg) without applying. Returns what the new state and effects would be without modifying the running app.',
      schema: z.object({
        msg: z.object({}).passthrough().describe('The hypothetical message to evaluate'),
      }),
    },
    'debug-api',
    async (args, ctx) => ctx.relay!.call('evalUpdate', [args.msg]),
  )

  registry.register(
    {
      name: 'llui_validate_message',
      description:
        'Validate a message against the component Msg type. Returns errors or null if valid.',
      schema: z.object({
        msg: z.object({}).passthrough().describe('The message to validate'),
      }),
    },
    'debug-api',
    async (args, ctx) => ctx.relay!.call('validateMessage', [args.msg]),
  )

  registry.register(
    {
      name: 'llui_get_message_history',
      description:
        'Get the chronological message history with state transitions and effects. Supports pagination via `since` (exclusive, return entries with index > since) and `limit` (return at most N most-recent entries). Use both together for tail-fetching.',
      schema: z.object({
        since: z
          .number()
          .optional()
          .describe('Return entries with index strictly greater than this.'),
        limit: z.number().optional().describe('Max entries to return (the N most recent).'),
      }),
    },
    'debug-api',
    async (args, ctx) => {
      const opts2: { since?: number; limit?: number } = {}
      if (typeof args.since === 'number') opts2.since = args.since
      if (typeof args.limit === 'number') opts2.limit = args.limit
      return ctx.relay!.call('getMessageHistory', [opts2])
    },
  )

  registry.register(
    {
      name: 'llui_export_trace',
      description: 'Export the current session as a replayable LluiTrace JSON.',
      schema: z.object({}),
    },
    'debug-api',
    async (_args, ctx) => ctx.relay!.call('exportTrace', []),
  )

  registry.register(
    {
      name: 'llui_search_state',
      description:
        'Search current state using a dot-separated path query. E.g., "cart.items" returns the items array.',
      schema: z.object({
        query: z.string().describe('Dot-separated path to search. E.g., "user.name", "items"'),
      }),
    },
    'debug-api',
    async (args, ctx) => ctx.relay!.call('searchState', [args.query]),
  )

  registry.register(
    {
      name: 'llui_clear_log',
      description: 'Clear the message and effects history.',
      schema: z.object({}),
    },
    'debug-api',
    async (_args, ctx) => {
      await ctx.relay!.call('clearLog', [])
      return { cleared: true }
    },
  )

  registry.register(
    {
      name: 'llui_list_messages',
      description:
        'List all message variants the component accepts, with their field types. Returns { discriminant, variants: { [name]: { [field]: typeDescriptor } } }. Use this to discover what messages can be sent without reading source code.',
      schema: z.object({}),
    },
    'debug-api',
    async (_args, ctx) => ctx.relay!.call('getMessageSchema', []),
  )

  registry.register(
    {
      name: 'llui_component_info',
      description:
        'Get component name and source location (file + line) of the component() declaration. Lets you find where to read or edit the component.',
      schema: z.object({}),
    },
    'debug-api',
    async (_args, ctx) => ctx.relay!.call('getComponentInfo', []),
  )

  registry.register(
    {
      name: 'llui_describe_state',
      description:
        "Return the State type's shape (not its value). Fields map to type descriptors: 'string', 'number', 'boolean', {kind:'enum',values:[...]}, {kind:'array',of:...}, {kind:'object',fields:...}, {kind:'optional',of:...}. Use this to know what fields exist and their types even when currently undefined.",
      schema: z.object({}),
    },
    'debug-api',
    async (_args, ctx) => ctx.relay!.call('getStateSchema', []),
  )

  registry.register(
    {
      name: 'llui_list_effects',
      description:
        'List all effect variants the component emits, with their field types (same format as llui_list_messages). Returns null if no Effect type is declared.',
      schema: z.object({}),
    },
    'debug-api',
    async (_args, ctx) => ctx.relay!.call('getEffectSchema', []),
  )

  registry.register(
    {
      name: 'llui_snapshot_state',
      description:
        'Capture the current state (deep clone). Returns the snapshot — store it, then call llui_restore_state later to roll back. Useful for safely exploring transitions during a debugging session.',
      schema: z.object({}),
    },
    'debug-api',
    async (_args, ctx) => ctx.relay!.call('snapshotState', []),
  )

  registry.register(
    {
      name: 'llui_restore_state',
      description:
        'Overwrite the current state with a previously-captured snapshot and re-render. Bypasses update() — snap must already be a valid state value.',
      schema: z.object({
        snapshot: z.unknown().describe('The state object returned by llui_snapshot_state.'),
      }),
    },
    'debug-api',
    async (args, ctx) => {
      await ctx.relay!.call('restoreState', [args.snapshot])
      return { restored: true, state: await ctx.relay!.call('getState', []) }
    },
  )

  registry.register(
    {
      name: 'llui_list_components',
      description:
        'List all currently-mounted LLui components + which one is active (being targeted by subsequent tool calls). Multi-mount apps show one entry per mount.',
      schema: z.object({}),
    },
    'debug-api',
    async (_args, ctx) => ctx.relay!.call('__listComponents', []),
  )

  registry.register(
    {
      name: 'llui_select_component',
      description:
        'Switch the active component (the one all other tool calls target). Use a key from llui_list_components.',
      schema: z.object({
        key: z.string().describe('Component key as returned by llui_list_components'),
      }),
    },
    'debug-api',
    async (args, ctx) => ctx.relay!.call('__selectComponent', [args.key]),
  )

  registry.register(
    {
      name: 'llui_replay_trace',
      description:
        'Generate a ready-to-run vitest file that replays the current message history via `replayTrace()` from @llui/test. The output is a complete test file with the trace inlined — paste it into packages/<pkg>/test/ to reproduce the exact sequence of messages the component saw in this session. Use this to capture a debugging session as a regression test.',
      schema: z.object({
        importPath: z
          .string()
          .optional()
          .describe(
            "Where to import the component def from in the generated test (default: '../src/index'). Example: '../src/todo-app'.",
          ),
        exportName: z
          .string()
          .optional()
          .describe("Named export that holds the component def (default: the component's name)."),
      }),
    },
    'debug-api',
    async (args, ctx) => {
      const trace = (await ctx.relay!.call('exportTrace', [])) as {
        component: string
        entries: Array<{ msg: unknown; expectedState: unknown; expectedEffects: unknown[] }>
      }
      const importPath = args.importPath ?? '../src/index'
      const exportName = args.exportName ?? trace.component
      return {
        filename: `${trace.component.toLowerCase()}-replay.test.ts`,
        code: generateReplayTest(trace, importPath, exportName),
        entryCount: trace.entries.length,
      }
    },
  )

  registry.register(
    {
      name: 'llui_lint',
      description:
        'Lint an LLui source file against the @llui/compiler SIGNAL lint rules — the SAME non-bypassable rules the vite-plugin enforces as build errors (peek-in-slot, operator-on-signal, pure-derive-body, no-node-construction-in-body, plus the shared convention / event-handler-casing / attr-name checks). This does NOT run ESLint. Pass an absolute file path on the dev machine. Returns { file, score, violations, summary } where each violation is { rule, message, line, column, fix? } and score is max(0, 20 - violations.length) (20 = clean). For a whole-directory scan use llui_compiler_diagnostics.',
      schema: z.object({
        path: z.string().describe('Absolute file path to read and lint (.ts/.tsx).'),
      }),
    },
    'debug-api',
    async (args) => {
      if (!args.path.endsWith('.ts') && !args.path.endsWith('.tsx')) {
        throw new Error(`llui_lint: only .ts/.tsx files are supported, got: ${args.path}`)
      }
      // Contain the path to the workspace subtree — a `../../../etc`
      // traversal would let the tool lint (and thus read) files outside
      // the project.
      const workspaceRoot = findWorkspaceRoot()
      const safePath = assertWithinWorkspace(args.path, workspaceRoot)
      if (!existsSync(safePath)) {
        throw new Error(`llui_lint: file not found: ${args.path}`)
      }
      const source = await readFile(safePath, 'utf8')
      let msgs: ReturnType<typeof lintSignalSource>
      try {
        msgs = lintSignalSource(source, safePath)
      } catch (err) {
        throw new Error(
          `llui_lint: lintSignalSource threw: ${(err as Error).message ?? String(err)}`,
          { cause: err },
        )
      }
      const violations = msgs.map((m) => ({
        rule: m.rule,
        message: m.message,
        line: m.line,
        column: m.column + 1,
        ...(m.fix
          ? {
              fix: {
                title: m.fix.title,
                edits: m.fix.edits.map((e) => ({
                  start: e.start,
                  end: e.end,
                  oldText: source.slice(e.start, e.end),
                  newText: e.newText,
                })),
              },
            }
          : {}),
      }))
      return {
        file: args.path,
        score: Math.max(0, 20 - violations.length),
        violations,
        summary: `${violations.length} violation(s)`,
      }
    },
  )

  registry.register(
    {
      name: 'llui_diff_state',
      description:
        "Structured JSON diff between two state values. Pass 'a' and 'b' — plain objects. Returns { added, removed, changed }.",
      schema: z.object({
        a: z.unknown(),
        b: z.unknown(),
      }),
    },
    'debug-api',
    async (args) => diffState(args.a, args.b),
  )

  registry.register(
    {
      name: 'llui_assert',
      description:
        "Evaluate a predicate against current state. Pass 'path' (dot-separated), 'op' (eq/neq/exists/gt/lt/in), and 'value'. Returns { pass, actual, expected, op }.",
      schema: z.object({
        path: z.string(),
        op: z.enum(['eq', 'neq', 'exists', 'gt', 'lt', 'in']),
        value: z.unknown().optional(),
      }),
    },
    'debug-api',
    async (args, ctx) => {
      const actual = await ctx.relay!.call('searchState', [args.path])
      const expected = args.value
      let pass = false
      switch (args.op) {
        case 'eq':
          pass = Object.is(actual, expected)
          break
        case 'neq':
          pass = !Object.is(actual, expected)
          break
        case 'exists':
          pass = actual !== undefined
          break
        case 'gt':
          pass = typeof actual === 'number' && typeof expected === 'number' && actual > expected
          break
        case 'lt':
          pass = typeof actual === 'number' && typeof expected === 'number' && actual < expected
          break
        case 'in':
          pass = Array.isArray(expected) && expected.includes(actual)
          break
      }
      return { pass, actual, expected, op: args.op }
    },
  )

  registry.register(
    {
      name: 'llui_search_history',
      description:
        "Filtered message history. Pass 'filter' with { type?, statePath?, effectType?, fromIndex?, toIndex? }. Entries match if all present fields match — type is the Msg discriminant, statePath is a dot path whose value differs pre->post, effectType is a type present in the effects array.",
      schema: z.object({
        filter: z.object({
          type: z.string().optional(),
          statePath: z.string().optional(),
          effectType: z.string().optional(),
          fromIndex: z.number().optional(),
          toIndex: z.number().optional(),
        }),
      }),
    },
    'debug-api',
    async (args, ctx) => {
      type HRecord = {
        index: number
        timestamp: number
        msg: unknown
        stateBefore: unknown
        stateAfter: unknown
        effects: unknown[]
      }
      const history = (await ctx.relay!.call('getMessageHistory', [{}])) as HRecord[]
      const f = args.filter
      function pathValue(obj: unknown, path: string): unknown {
        const parts = path.split('.')
        let v: unknown = obj
        for (const p of parts) {
          if (v == null || typeof v !== 'object') return undefined
          v = (v as Record<string, unknown>)[p]
        }
        return v
      }
      return history.filter((r) => {
        if (f.fromIndex !== undefined && r.index < f.fromIndex) return false
        if (f.toIndex !== undefined && r.index > f.toIndex) return false
        if (f.type !== undefined) {
          const t = (r.msg as { type?: string } | null)?.type
          if (t !== f.type) return false
        }
        if (f.statePath !== undefined) {
          const before = pathValue(r.stateBefore, f.statePath)
          const after = pathValue(r.stateAfter, f.statePath)
          if (Object.is(before, after)) return false
        }
        if (f.effectType !== undefined) {
          if (!r.effects.some((e) => (e as { type?: string } | null)?.type === f.effectType)) {
            return false
          }
        }
        return true
      })
    },
  )

  // SECURITY: `llui_eval` is arbitrary RCE against the user's live
  // browser session — gated behind an explicit opt-in (OFF by default).
  // When disabled it is never registered, so it cannot appear in
  // `tools/list` or be dispatched. NOTE: `evalInPage` is an OPTIONAL
  // debug-API method the signal runtime does not implement; the tool
  // remains for rich/legacy debug APIs and surfaces the relay's
  // "unknown method" error otherwise.
  if (evalEnabled(opts)) {
    registry.register(
      {
        name: 'llui_eval',
        description:
          "Arbitrary JavaScript in the page context via the debug relay. Returns { result, sideEffects }. 'result' is the expression's return value or { error }. 'sideEffects' makes any state changes, new history entries, new pending effects, and dirty bindings visible. Phase 1 does not support async expressions; expose async results via globalThis instead.",
        schema: z.object({ code: z.string() }),
      },
      'debug-api',
      async (args, ctx) => ctx.relay!.call('evalInPage', [args.code]),
    )
  }
}
