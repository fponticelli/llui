import { existsSync } from 'node:fs'
import { z } from 'zod'
import type { ToolRegistry } from '../tool-registry.js'
import { generateReplayTest } from './replay-test-generator.js'
import { domDiff, diffState } from '../util/diff.js'

/**
 * Register the 33 debug-API-backed tools. Every handler routes through
 * `ctx.relay!.call(method, args)` — which transparently dispatches to
 * either an in-process `LluiDebugAPI` or the WebSocket bridge,
 * depending on how the transport was wired.
 *
 * Zod schemas drive both runtime input validation (the registry's
 * `dispatch()` calls `schema.safeParse()` before invoking the handler)
 * and the JSON Schema published in `tools/list` (derived once at
 * registration time). Handlers receive parsed/typed arguments.
 */
export function registerDebugApiTools(registry: ToolRegistry): void {
  registry.register(
    {
      name: 'llui_get_state',
      description:
        'Get the current state of the LLui component. Returns a JSON-serializable state object.',
      schema: z.object({
        component: z.string().optional().describe('Component name (defaults to root)'),
      }),
    },
    'debug-api',
    async (_args, ctx) => ctx.relay!.call('getState', []),
  )

  registry.register(
    {
      name: 'llui_send_message',
      description:
        'Send a message to the component and return the new state and effects. Validates the message first. Calls flush() automatically.',
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
        'Get the chronological message history with state transitions, effects, and dirty masks. Supports pagination via `since` (exclusive, return entries with index > since) and `limit` (return at most N most-recent entries). Use both together for tail-fetching.',
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
      const opts: { since?: number; limit?: number } = {}
      if (typeof args.since === 'number') opts.since = args.since
      if (typeof args.limit === 'number') opts.limit = args.limit
      return ctx.relay!.call('getMessageHistory', [opts])
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
      name: 'llui_get_bindings',
      description:
        'Get all active reactive bindings with their masks, last values, and DOM targets.',
      schema: z.object({
        filter: z.string().optional().describe('Filter by DOM selector or mask value'),
      }),
    },
    'debug-api',
    async (_args, ctx) => ctx.relay!.call('getBindings', []),
  )

  registry.register(
    {
      name: 'llui_why_did_update',
      description:
        'Explain why a specific binding re-evaluated: which mask bits were dirty, what the accessor returned, what the previous value was.',
      schema: z.object({
        bindingIndex: z.number().describe('The binding index to inspect'),
      }),
    },
    'debug-api',
    async (args, ctx) => ctx.relay!.call('whyDidUpdate', [args.bindingIndex]),
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
      name: 'llui_decode_mask',
      description:
        "Decode a dirty-mask value from llui_get_message_history (the 'dirtyMask' field) into the list of top-level state fields that changed. Requires 'mask' param.",
      schema: z.object({
        mask: z.number().describe('The dirtyMask value to decode'),
      }),
    },
    'debug-api',
    async (args, ctx) => ctx.relay!.call('decodeMask', [args.mask]),
  )

  registry.register(
    {
      name: 'llui_mask_legend',
      description:
        'Return the compiler-generated bit→field map for this component. Example: { todos: 1, filter: 2, nextId: 4 } means bit 0 represents `todos`, etc.',
      schema: z.object({}),
    },
    'debug-api',
    async (_args, ctx) => ctx.relay!.call('getMaskLegend', []),
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
      name: 'llui_trace_element',
      description:
        "Find all bindings targeting a DOM element matched by a CSS selector. Returns { bindingIndex, kind, key, mask, lastValue, relation }[] so you can answer 'why is this element wrong?' — combine with llui_why_did_update(bindingIndex) for a full narrative.",
      schema: z.object({
        selector: z.string().describe('CSS selector (e.g. `.todo.active`, `#submit`)'),
      }),
    },
    'debug-api',
    async (args, ctx) => ctx.relay!.call('getBindingsFor', [args.selector]),
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
        'Overwrite the current state with a previously-captured snapshot. Triggers a full re-render (FULL_MASK). Bypasses update() — snap must already be a valid state value.',
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
      name: 'llui_inspect_element',
      description:
        'Get a rich report for a DOM element: tag, attributes, classes, data-*, text, bounding box, a computed-style subset (display/visibility/position/dimensions), and the bindings targeting this node. Pass a CSS selector. Returns null if no element matches.',
      schema: z.object({ selector: z.string().describe('CSS selector') }),
    },
    'debug-api',
    async (args, ctx) => ctx.relay!.call('inspectElement', [args.selector]),
  )

  registry.register(
    {
      name: 'llui_get_rendered_html',
      description:
        "Get the outerHTML of the mounted component or a specific element. Pass 'selector' for a specific node (defaults to the mount root). Pass 'maxlength' to truncate output.",
      schema: z.object({
        selector: z.string().optional(),
        maxlength: z.number().optional(),
      }),
    },
    'debug-api',
    async (args, ctx) => ctx.relay!.call('getRenderedHtml', [args.selector, args.maxlength]),
  )

  registry.register(
    {
      name: 'llui_dispatch_event',
      description:
        "Synthesize and dispatch a browser event at a DOM element. Returns the history indices of any Msgs the handler produced plus the resulting state. 'type' is the event name (e.g. 'click', 'input', 'keydown'). 'init' is an EventInit object (e.g. { key: 'Enter' } for keydown).",
      schema: z.object({
        selector: z.string(),
        type: z.string(),
        init: z.record(z.string(), z.unknown()).optional(),
      }),
    },
    'debug-api',
    async (args, ctx) => ctx.relay!.call('dispatchDomEvent', [args.selector, args.type, args.init]),
  )

  registry.register(
    {
      name: 'llui_dom_diff',
      description:
        'Compare expected HTML against the currently rendered HTML (from selector, or the mount root). Returns { match, differences }. Pass ignoreWhitespace=true to normalize whitespace.',
      schema: z.object({
        expected: z.string(),
        selector: z.string().optional(),
        ignoreWhitespace: z.boolean().optional(),
      }),
    },
    'debug-api',
    async (args, ctx) => {
      const actual = (await ctx.relay!.call('getRenderedHtml', [args.selector])) as string
      return domDiff(args.expected, actual, {
        ignoreWhitespace: Boolean(args.ignoreWhitespace),
      })
    },
  )

  registry.register(
    {
      name: 'llui_get_focus',
      description:
        'Return info about the currently focused element: { selector (if it has an id), tagName, selectionStart, selectionEnd }. Useful for catching "focus lost on re-render" bugs.',
      schema: z.object({}),
    },
    'debug-api',
    async (_args, ctx) => ctx.relay!.call('getFocus', []),
  )

  registry.register(
    {
      name: 'llui_lint',
      description:
        "Lint LLui source code against ESLint LLui rules. Returns violations grouped by rule. Pass 'path' (absolute file path on the dev machine).",
      schema: z.object({
        path: z.string().describe('Absolute file path to read and lint.'),
      }),
    },
    'debug-api',
    async (args, _ctx) => {
      if (!args.path.endsWith('.ts') && !args.path.endsWith('.tsx')) {
        throw new Error(`llui_lint: only .ts/.tsx files are supported, got: ${args.path}`)
      }
      if (!existsSync(args.path)) {
        throw new Error(`llui_lint: file not found: ${args.path}`)
      }

      const { execSync } = await import('node:child_process')
      try {
        const output = execSync(`pnpm exec eslint --format json "${args.path}"`, {
          encoding: 'utf8',
        })
        const results = JSON.parse(output)
        const violations = results[0]?.messages || []
        return {
          file: args.path,
          score: Math.max(0, 20 - violations.length),
          violations,
          summary: `${violations.length} violation(s)`,
        }
      } catch (err: unknown) {
        const e = err as { stdout?: string; message?: string }
        if (e.stdout) {
          try {
            const results = JSON.parse(e.stdout)
            const violations = results[0]?.messages || []
            return {
              file: args.path,
              score: Math.max(0, 20 - violations.length),
              violations,
              summary: `${violations.length} violation(s)`,
            }
          } catch {
            // fall through to throw below
          }
        }
        throw new Error(`ESLint failed: ${e.message}`, { cause: err })
      }
    },
  )

  registry.register(
    {
      name: 'llui_force_rerender',
      description:
        "Re-evaluate every binding's accessor against the current state, apply changed values to the DOM, and return the indices of bindings that changed. If a binding's DOM value corrects itself after this call but not after a real message, the mask for that binding is wrong.",
      schema: z.object({}),
    },
    'debug-api',
    async (_args, ctx) => ctx.relay!.call('forceRerender', []),
  )

  registry.register(
    {
      name: 'llui_each_diff',
      description:
        "Per-each-site reconciliation diffs (added/removed/moved/reused keys) from the dev-time diff log. Pass 'sinceIndex' to filter to entries after a specific message history index.",
      schema: z.object({ sinceIndex: z.number().optional() }),
    },
    'debug-api',
    async (args, ctx) => ctx.relay!.call('getEachDiff', [args.sinceIndex]),
  )

  registry.register(
    {
      name: 'llui_scope_tree',
      description:
        "Walk the scope tree starting at the component root (or a specific scopeId). Returns a LifetimeNode tree with kind (root/show/each/branch/child/portal/foreign) and children. Pass 'depth' to limit traversal, 'scopeId' to start elsewhere.",
      schema: z.object({
        depth: z.number().optional(),
        scopeId: z.string().optional(),
      }),
    },
    'debug-api',
    async (args, ctx) =>
      ctx.relay!.call('getScopeTree', [{ depth: args.depth, scopeId: args.scopeId }]),
  )

  registry.register(
    {
      name: 'llui_disposer_log',
      description:
        "Recent onDispose firings with scope id and cause. Pass 'limit' to cap results to the N most recent entries. Catches 'leak on branch swap' class bugs.",
      schema: z.object({ limit: z.number().optional() }),
    },
    'debug-api',
    async (args, ctx) => ctx.relay!.call('getDisposerLog', [args.limit]),
  )

  registry.register(
    {
      name: 'llui_list_dead_bindings',
      description:
        "Bindings that are inactive (scope disposed) OR never matched a dirty mask OR never changed value. Useful for finding wasted work and 'this never updates' bugs. Returns the subset of get_bindings with an annotation on why it's flagged.",
      schema: z.object({}),
    },
    'debug-api',
    async (_args, ctx) => {
      const bindings = (await ctx.relay!.call('getBindings', [])) as Array<{
        index: number
        mask: number
        lastValue: unknown
        kind: string
        key: string | undefined
        dead: boolean
        perItem: boolean
      }>
      return bindings
        .filter((b) => b.dead || b.lastValue === undefined)
        .map((b) => ({
          ...b,
          reason: b.dead ? 'scope_disposed' : 'never_changed',
        }))
    },
  )

  registry.register(
    {
      name: 'llui_binding_graph',
      description:
        'Edge list: state path → binding indices that depend on it. Inverts the compiler-emitted mask legend to show, for each top-level state field, which bindings will re-evaluate when it changes.',
      schema: z.object({}),
    },
    'debug-api',
    async (_args, ctx) => ctx.relay!.call('getBindingGraph', []),
  )

  registry.register(
    {
      name: 'llui_mock_effect',
      description:
        "Register a mock for an effect matching 'match' ({ type?, payloadPath?, payloadEquals? }). The next matching effect resolves with 'response' instead of running. Mocks are one-shot; pass { persist: true } to keep across matches. Returns { mockId } for later reference.",
      schema: z.object({
        match: z.record(z.string(), z.unknown()),
        response: z.unknown(),
        opts: z.record(z.string(), z.unknown()).optional(),
      }),
    },
    'debug-api',
    async (args, ctx) => ctx.relay!.call('mockEffect', [args.match, args.response, args.opts]),
  )

  registry.register(
    {
      name: 'llui_resolve_effect',
      description:
        "Manually resolve a pending effect with a given response. The effect's onSuccess callback (if any) runs as if it had actually resolved. Pass effectId from llui_pending_effects.",
      schema: z.object({
        effectId: z.string(),
        response: z.unknown(),
      }),
    },
    'debug-api',
    async (args, ctx) => ctx.relay!.call('resolveEffect', [args.effectId, args.response]),
  )

  registry.register(
    {
      name: 'llui_pending_effects',
      description:
        "Current queued and in-flight effects. Each entry has { id, type, dispatchedAt, status, payload }. Use 'id' with llui_resolve_effect to manually resolve one.",
      schema: z.object({}),
    },
    'debug-api',
    async (_args, ctx) => ctx.relay!.call('getPendingEffects', []),
  )

  registry.register(
    {
      name: 'llui_effect_timeline',
      description:
        "Phased log of effect events: dispatched -> in-flight -> resolved/cancelled/resolved-mocked. Each entry has { effectId, type, phase, timestamp, durationMs? }. Pass 'limit' to cap the tail.",
      schema: z.object({ limit: z.number().optional() }),
    },
    'debug-api',
    async (args, ctx) => ctx.relay!.call('getEffectTimeline', [args.limit]),
  )

  registry.register(
    {
      name: 'llui_step_back',
      description:
        "Rewind state by replaying from init() with the last N messages excluded. 'mode' is 'pure' (default; suppresses effects) or 'live' (re-fires effects from replay). Returns the new state and rewindDepth.",
      schema: z.object({
        n: z.number().optional(),
        mode: z.enum(['pure', 'live']).optional(),
      }),
    },
    'debug-api',
    async (args, ctx) => {
      const n = typeof args.n === 'number' ? args.n : 1
      const mode = args.mode === 'live' ? 'live' : 'pure'
      return ctx.relay!.call('stepBack', [n, mode])
    },
  )

  registry.register(
    {
      name: 'llui_coverage',
      description:
        "Per-Msg-variant coverage for the current session: { fired: { variant: { count, lastIndex } }, neverFired: [variants] }. Shows which message types have run and which haven't — useful for finding untested paths.",
      schema: z.object({}),
    },
    'debug-api',
    async (_args, ctx) => ctx.relay!.call('getCoverage', []),
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
        dirtyMask: number
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
