import { existsSync, readFileSync } from 'node:fs'
import { lintIdiomatic } from '@llui/lint-idiomatic'
import type { ToolRegistry } from '../tool-registry.js'
import { generateReplayTest } from './replay-test-generator.js'
import { domDiff, diffState } from '../util/diff.js'

/**
 * Register the 23 debug-API-backed tools. Every handler here routes through
 * `ctx.relay!.call(method, args)` — which transparently dispatches to either
 * an in-process `LluiDebugAPI` or the WebSocket bridge, depending on how the
 * transport was wired.
 */
export function registerDebugApiTools(registry: ToolRegistry): void {
  registry.register(
    {
      name: 'llui_get_state',
      description:
        'Get the current state of the LLui component. Returns a JSON-serializable state object.',
      inputSchema: {
        type: 'object',
        properties: {
          component: {
            type: 'string',
            description: 'Component name (defaults to root)',
          },
        },
      },
    },
    'debug-api',
    async (_args, ctx) => ctx.relay!.call('getState', []),
  )

  registry.register(
    {
      name: 'llui_send_message',
      description:
        'Send a message to the component and return the new state and effects. Validates the message first. Calls flush() automatically.',
      inputSchema: {
        type: 'object',
        properties: {
          msg: {
            type: 'object',
            description: 'The message to send (must be a valid Msg variant)',
          },
        },
        required: ['msg'],
      },
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
      inputSchema: {
        type: 'object',
        properties: {
          msg: {
            type: 'object',
            description: 'The hypothetical message to evaluate',
          },
        },
        required: ['msg'],
      },
    },
    'debug-api',
    async (args, ctx) => ctx.relay!.call('evalUpdate', [args.msg]),
  )

  registry.register(
    {
      name: 'llui_validate_message',
      description:
        'Validate a message against the component Msg type. Returns errors or null if valid.',
      inputSchema: {
        type: 'object',
        properties: {
          msg: {
            type: 'object',
            description: 'The message to validate',
          },
        },
        required: ['msg'],
      },
    },
    'debug-api',
    async (args, ctx) => ctx.relay!.call('validateMessage', [args.msg]),
  )

  registry.register(
    {
      name: 'llui_get_message_history',
      description:
        'Get the chronological message history with state transitions, effects, and dirty masks. Supports pagination via `since` (exclusive, return entries with index > since) and `limit` (return at most N most-recent entries). Use both together for tail-fetching.',
      inputSchema: {
        type: 'object',
        properties: {
          since: {
            type: 'number',
            description: 'Return entries with index strictly greater than this.',
          },
          limit: {
            type: 'number',
            description: 'Max entries to return (the N most recent).',
          },
        },
      },
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
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    'debug-api',
    async (_args, ctx) => ctx.relay!.call('exportTrace', []),
  )

  registry.register(
    {
      name: 'llui_get_bindings',
      description:
        'Get all active reactive bindings with their masks, last values, and DOM targets.',
      inputSchema: {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            description: 'Filter by DOM selector or mask value',
          },
        },
      },
    },
    'debug-api',
    async (_args, ctx) => ctx.relay!.call('getBindings', []),
  )

  registry.register(
    {
      name: 'llui_why_did_update',
      description:
        'Explain why a specific binding re-evaluated: which mask bits were dirty, what the accessor returned, what the previous value was.',
      inputSchema: {
        type: 'object',
        properties: {
          bindingIndex: {
            type: 'number',
            description: 'The binding index to inspect',
          },
        },
        required: ['bindingIndex'],
      },
    },
    'debug-api',
    async (args, ctx) => ctx.relay!.call('whyDidUpdate', [args.bindingIndex as number]),
  )

  registry.register(
    {
      name: 'llui_search_state',
      description:
        'Search current state using a dot-separated path query. E.g., "cart.items" returns the items array.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Dot-separated path to search. E.g., "user.name", "items"',
          },
        },
        required: ['query'],
      },
    },
    'debug-api',
    async (args, ctx) => ctx.relay!.call('searchState', [args.query as string]),
  )

  registry.register(
    {
      name: 'llui_clear_log',
      description: 'Clear the message and effects history.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
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
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    'debug-api',
    async (_args, ctx) => ctx.relay!.call('getMessageSchema', []),
  )

  registry.register(
    {
      name: 'llui_decode_mask',
      description:
        "Decode a dirty-mask value from llui_get_message_history (the 'dirtyMask' field) into the list of top-level state fields that changed. Requires 'mask' param.",
      inputSchema: {
        type: 'object',
        properties: {
          mask: { type: 'number', description: 'The dirtyMask value to decode' },
        },
        required: ['mask'],
      },
    },
    'debug-api',
    async (args, ctx) => ctx.relay!.call('decodeMask', [args.mask as number]),
  )

  registry.register(
    {
      name: 'llui_mask_legend',
      description:
        'Return the compiler-generated bit→field map for this component. Example: { todos: 1, filter: 2, nextId: 4 } means bit 0 represents `todos`, etc.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    'debug-api',
    async (_args, ctx) => ctx.relay!.call('getMaskLegend', []),
  )

  registry.register(
    {
      name: 'llui_component_info',
      description:
        'Get component name and source location (file + line) of the component() declaration. Lets you find where to read or edit the component.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    'debug-api',
    async (_args, ctx) => ctx.relay!.call('getComponentInfo', []),
  )

  registry.register(
    {
      name: 'llui_describe_state',
      description:
        "Return the State type's shape (not its value). Fields map to type descriptors: 'string', 'number', 'boolean', {kind:'enum',values:[...]}, {kind:'array',of:...}, {kind:'object',fields:...}, {kind:'optional',of:...}. Use this to know what fields exist and their types even when currently undefined.",
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    'debug-api',
    async (_args, ctx) => ctx.relay!.call('getStateSchema', []),
  )

  registry.register(
    {
      name: 'llui_list_effects',
      description:
        'List all effect variants the component emits, with their field types (same format as llui_list_messages). Returns null if no Effect type is declared.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    'debug-api',
    async (_args, ctx) => ctx.relay!.call('getEffectSchema', []),
  )

  registry.register(
    {
      name: 'llui_trace_element',
      description:
        "Find all bindings targeting a DOM element matched by a CSS selector. Returns { bindingIndex, kind, key, mask, lastValue, relation }[] so you can answer 'why is this element wrong?' — combine with llui_why_did_update(bindingIndex) for a full narrative.",
      inputSchema: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS selector (e.g. `.todo.active`, `#submit`)',
          },
        },
        required: ['selector'],
      },
    },
    'debug-api',
    async (args, ctx) => ctx.relay!.call('getBindingsFor', [args.selector as string]),
  )

  registry.register(
    {
      name: 'llui_snapshot_state',
      description:
        'Capture the current state (deep clone). Returns the snapshot — store it, then call llui_restore_state later to roll back. Useful for safely exploring transitions during a debugging session.',
      inputSchema: { type: 'object', properties: {} },
    },
    'debug-api',
    async (_args, ctx) => ctx.relay!.call('snapshotState', []),
  )

  registry.register(
    {
      name: 'llui_restore_state',
      description:
        'Overwrite the current state with a previously-captured snapshot. Triggers a full re-render (FULL_MASK). Bypasses update() — snap must already be a valid state value.',
      inputSchema: {
        type: 'object',
        properties: {
          snapshot: {
            description: 'The state object returned by llui_snapshot_state.',
          },
        },
        required: ['snapshot'],
      },
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
      inputSchema: { type: 'object', properties: {} },
    },
    'debug-api',
    async (_args, ctx) => ctx.relay!.call('__listComponents', []),
  )

  registry.register(
    {
      name: 'llui_select_component',
      description:
        'Switch the active component (the one all other tool calls target). Use a key from llui_list_components.',
      inputSchema: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'Component key as returned by llui_list_components',
          },
        },
        required: ['key'],
      },
    },
    'debug-api',
    async (args, ctx) => ctx.relay!.call('__selectComponent', [args.key]),
  )

  registry.register(
    {
      name: 'llui_replay_trace',
      description:
        'Generate a ready-to-run vitest file that replays the current message history via `replayTrace()` from @llui/test. The output is a complete test file with the trace inlined — paste it into packages/<pkg>/test/ to reproduce the exact sequence of messages the component saw in this session. Use this to capture a debugging session as a regression test.',
      inputSchema: {
        type: 'object',
        properties: {
          importPath: {
            type: 'string',
            description:
              "Where to import the component def from in the generated test (default: '../src/index'). Example: '../src/todo-app'.",
          },
          exportName: {
            type: 'string',
            description:
              "Named export that holds the component def (default: the component's name).",
          },
        },
      },
    },
    'debug-api',
    async (args, ctx) => {
      const trace = (await ctx.relay!.call('exportTrace', [])) as {
        component: string
        entries: Array<{ msg: unknown; expectedState: unknown; expectedEffects: unknown[] }>
      }
      const importPath = (args.importPath as string | undefined) ?? '../src/index'
      const exportName = (args.exportName as string | undefined) ?? trace.component
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
      inputSchema: {
        type: 'object',
        properties: { selector: { type: 'string', description: 'CSS selector' } },
        required: ['selector'],
      },
    },
    'debug-api',
    async (args, ctx) => ctx.relay!.call('inspectElement', [args.selector as string]),
  )

  registry.register(
    {
      name: 'llui_get_rendered_html',
      description:
        "Get the outerHTML of the mounted component or a specific element. Pass 'selector' for a specific node (defaults to the mount root). Pass 'maxLength' to truncate output.",
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string' },
          maxLength: { type: 'number' },
        },
      },
    },
    'debug-api',
    async (args, ctx) => ctx.relay!.call('getRenderedHtml', [args.selector, args.maxLength]),
  )

  registry.register(
    {
      name: 'llui_dispatch_event',
      description:
        "Synthesize and dispatch a browser event at a DOM element. Returns the history indices of any Msgs the handler produced plus the resulting state. 'type' is the event name (e.g. 'click', 'input', 'keydown'). 'init' is an EventInit object (e.g. { key: 'Enter' } for keydown).",
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string' },
          type: { type: 'string' },
          init: { type: 'object' },
        },
        required: ['selector', 'type'],
      },
    },
    'debug-api',
    async (args, ctx) => ctx.relay!.call('dispatchDomEvent', [args.selector, args.type, args.init]),
  )

  registry.register(
    {
      name: 'llui_dom_diff',
      description:
        'Compare expected HTML against the currently rendered HTML (from selector, or the mount root). Returns { match, differences }. Pass ignoreWhitespace=true to normalize whitespace.',
      inputSchema: {
        type: 'object',
        properties: {
          expected: { type: 'string' },
          selector: { type: 'string' },
          ignoreWhitespace: { type: 'boolean' },
        },
        required: ['expected'],
      },
    },
    'debug-api',
    async (args, ctx) => {
      const actual = (await ctx.relay!.call('getRenderedHtml', [args.selector])) as string
      return domDiff(String(args.expected), actual, {
        ignoreWhitespace: Boolean(args.ignoreWhitespace),
      })
    },
  )

  registry.register(
    {
      name: 'llui_get_focus',
      description:
        'Return info about the currently focused element: { selector (if it has an id), tagName, selectionStart, selectionEnd }. Useful for catching "focus lost on re-render" bugs.',
      inputSchema: { type: 'object', properties: {} },
    },
    'debug-api',
    async (_args, ctx) => ctx.relay!.call('getFocus', []),
  )

  registry.register(
    {
      name: 'llui_lint',
      description:
        "Lint LLui source code against @llui/lint-idiomatic's 17 anti-pattern rules. Returns violations grouped by rule with line/column/suggestion fields, plus a 0–17 score (17 = fully idiomatic). Pass either `source` (raw TypeScript code) or `path` (absolute file path on the dev machine) — exactly one is required. The optional `exclude` array skips specific rule names. Use this after writing or editing LLui code to self-correct: catches state mutation, missing memo(), each() closure violations, view-bag-import (use the bag inside component bodies, see llm-guide.md), missing exhaustive update() cases, async update() (must be sync), nested send() in update(), spread-in-children (use each() instead), imperative DOM in view(), and more. The same rules run as a Vite plugin in dev — this tool gives LLMs the same feedback without requiring a build.",
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'TypeScript source code to lint. Mutually exclusive with `path`.',
          },
          path: {
            type: 'string',
            description:
              'Absolute file path to read and lint (must be a .ts/.tsx file). Mutually exclusive with `source`.',
          },
          exclude: {
            type: 'array',
            items: { type: 'string' },
            description:
              "Rule names to skip (e.g. ['map-on-state-array']). Useful when running in a project that already gets that rule from @llui/vite-plugin's diagnose() pass.",
          },
        },
      },
    },
    'debug-api',
    async (args, _ctx) => {
      const sourceArg = args.source as string | undefined
      const pathArg = args.path as string | undefined
      const excludeArg = args.exclude as string[] | undefined

      if (sourceArg !== undefined && pathArg !== undefined) {
        throw new Error("llui_lint: provide either 'source' or 'path', not both")
      }
      if (sourceArg === undefined && pathArg === undefined) {
        throw new Error("llui_lint: must provide either 'source' or 'path'")
      }

      let code: string
      let filename: string
      if (sourceArg !== undefined) {
        code = sourceArg
        filename = 'input.ts'
      } else {
        if (!pathArg!.endsWith('.ts') && !pathArg!.endsWith('.tsx')) {
          throw new Error(`llui_lint: path must end in .ts or .tsx (got ${pathArg!})`)
        }
        if (!existsSync(pathArg!)) {
          throw new Error(`llui_lint: file not found: ${pathArg!}`)
        }
        code = readFileSync(pathArg!, 'utf8')
        filename = pathArg!
      }

      const result = lintIdiomatic(code, filename, {
        exclude: excludeArg,
      })
      return {
        file: filename,
        score: result.score,
        violations: result.violations,
        summary: `${result.violations.length} violation(s), score ${result.score}/17`,
      }
    },
  )

  registry.register(
    {
      name: 'llui_force_rerender',
      description:
        "Re-evaluate every binding's accessor against the current state, apply changed values to the DOM, and return the indices of bindings that changed. If a binding's DOM value corrects itself after this call but not after a real message, the mask for that binding is wrong.",
      inputSchema: { type: 'object', properties: {} },
    },
    'debug-api',
    async (_args, ctx) => ctx.relay!.call('forceRerender', []),
  )

  registry.register(
    {
      name: 'llui_each_diff',
      description:
        "Per-each-site reconciliation diffs (added/removed/moved/reused keys) from the dev-time diff log. Pass 'sinceIndex' to filter to entries after a specific message history index.",
      inputSchema: {
        type: 'object',
        properties: { sinceIndex: { type: 'number' } },
      },
    },
    'debug-api',
    async (args, ctx) => ctx.relay!.call('getEachDiff', [args.sinceIndex]),
  )

  registry.register(
    {
      name: 'llui_scope_tree',
      description:
        "Walk the scope tree starting at the component root (or a specific scopeId). Returns a LifetimeNode tree with kind (root/show/each/branch/child/portal/foreign) and children. Pass 'depth' to limit traversal, 'scopeId' to start elsewhere.",
      inputSchema: {
        type: 'object',
        properties: {
          depth: { type: 'number' },
          scopeId: { type: 'string' },
        },
      },
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
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'number' } },
      },
    },
    'debug-api',
    async (args, ctx) => ctx.relay!.call('getDisposerLog', [args.limit]),
  )

  registry.register(
    {
      name: 'llui_list_dead_bindings',
      description:
        "Bindings that are inactive (scope disposed) OR never matched a dirty mask OR never changed value. Useful for finding wasted work and 'this never updates' bugs. Returns the subset of get_bindings with an annotation on why it's flagged.",
      inputSchema: { type: 'object', properties: {} },
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
      inputSchema: { type: 'object', properties: {} },
    },
    'debug-api',
    async (_args, ctx) => ctx.relay!.call('getBindingGraph', []),
  )

  registry.register(
    {
      name: 'llui_mock_effect',
      description:
        "Register a mock for an effect matching 'match' ({ type?, payloadPath?, payloadEquals? }). The next matching effect resolves with 'response' instead of running. Mocks are one-shot; pass { persist: true } to keep across matches. Returns { mockId } for later reference.",
      inputSchema: {
        type: 'object',
        properties: {
          match: { type: 'object' },
          response: {},
          opts: { type: 'object' },
        },
        required: ['match', 'response'],
      },
    },
    'debug-api',
    async (args, ctx) => ctx.relay!.call('mockEffect', [args.match, args.response, args.opts]),
  )

  registry.register(
    {
      name: 'llui_resolve_effect',
      description:
        "Manually resolve a pending effect with a given response. The effect's onSuccess callback (if any) runs as if it had actually resolved. Pass effectId from llui_pending_effects.",
      inputSchema: {
        type: 'object',
        properties: {
          effectId: { type: 'string' },
          response: {},
        },
        required: ['effectId', 'response'],
      },
    },
    'debug-api',
    async (args, ctx) => ctx.relay!.call('resolveEffect', [args.effectId, args.response]),
  )

  registry.register(
    {
      name: 'llui_pending_effects',
      description:
        "Current queued and in-flight effects. Each entry has { id, type, dispatchedAt, status, payload }. Use 'id' with llui_resolve_effect to manually resolve one.",
      inputSchema: { type: 'object', properties: {} },
    },
    'debug-api',
    async (_args, ctx) => ctx.relay!.call('getPendingEffects', []),
  )

  registry.register(
    {
      name: 'llui_effect_timeline',
      description:
        "Phased log of effect events: dispatched -> in-flight -> resolved/cancelled/resolved-mocked. Each entry has { effectId, type, phase, timestamp, durationMs? }. Pass 'limit' to cap the tail.",
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'number' } },
      },
    },
    'debug-api',
    async (args, ctx) => ctx.relay!.call('getEffectTimeline', [args.limit]),
  )

  registry.register(
    {
      name: 'llui_step_back',
      description:
        "Rewind state by replaying from init() with the last N messages excluded. 'mode' is 'pure' (default; suppresses effects) or 'live' (re-fires effects from replay). Returns the new state and rewindDepth.",
      inputSchema: {
        type: 'object',
        properties: {
          n: { type: 'number' },
          mode: { type: 'string', enum: ['pure', 'live'] },
        },
      },
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
      inputSchema: { type: 'object', properties: {} },
    },
    'debug-api',
    async (_args, ctx) => ctx.relay!.call('getCoverage', []),
  )

  registry.register(
    {
      name: 'llui_diff_state',
      description:
        "Structured JSON diff between two state values. Pass 'a' and 'b' — plain objects. Returns { added, removed, changed }.",
      inputSchema: {
        type: 'object',
        properties: {
          a: {},
          b: {},
        },
        required: ['a', 'b'],
      },
    },
    'debug-api',
    async (args) => diffState(args.a, args.b),
  )

  registry.register(
    {
      name: 'llui_assert',
      description:
        "Evaluate a predicate against current state. Pass 'path' (dot-separated), 'op' (eq/neq/exists/gt/lt/in), and 'value'. Returns { pass, actual, expected, op }.",
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          op: { type: 'string', enum: ['eq', 'neq', 'exists', 'gt', 'lt', 'in'] },
          value: {},
        },
        required: ['path', 'op'],
      },
    },
    'debug-api',
    async (args, ctx) => {
      const actual = await ctx.relay!.call('searchState', [args.path])
      const op = args.op as string
      const expected = args.value
      let pass = false
      switch (op) {
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
      return { pass, actual, expected, op }
    },
  )

  registry.register(
    {
      name: 'llui_search_history',
      description:
        "Filtered message history. Pass 'filter' with { type?, statePath?, effectType?, fromIndex?, toIndex? }. Entries match if all present fields match — type is the Msg discriminant, statePath is a dot path whose value differs pre->post, effectType is a type present in the effects array.",
      inputSchema: {
        type: 'object',
        properties: {
          filter: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              statePath: { type: 'string' },
              effectType: { type: 'string' },
              fromIndex: { type: 'number' },
              toIndex: { type: 'number' },
            },
          },
        },
        required: ['filter'],
      },
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
      const f = (args.filter ?? {}) as {
        type?: string
        statePath?: string
        effectType?: string
        fromIndex?: number
        toIndex?: number
      }
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
      inputSchema: {
        type: 'object',
        properties: { code: { type: 'string' } },
        required: ['code'],
      },
    },
    'debug-api',
    async (args, ctx) => ctx.relay!.call('evalInPage', [args.code]),
  )
}
