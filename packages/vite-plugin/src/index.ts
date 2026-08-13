import type { Plugin, ViteDevServer } from 'vite'

// Minimal subset of `http.ServerResponse` we use in the MCP-status
// handler. Avoids a heavy `node:http` import at the top of the file.
interface ServerResponseLike {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body?: string): void
}
import { existsSync, readFileSync, writeFileSync, watch as fsWatch, type FSWatcher } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { spawn, type ChildProcess } from 'node:child_process'
import {
  transformSignalComponentSourceWithMap,
  lintSignalSource,
  lintAnnotationSyntaxSource,
  applyLintFixes,
  type CrossFileResolution,
  type CrossFileResolutions,
  type SignalLintMessage,
  type PreExtractedSchemas,
} from '@llui/compiler'
import MagicString from 'magic-string'
import type { SourceMap } from 'magic-string'
import { transformUseClientSsr, hasUseClientDirective } from '@llui/compiler-ssr'
import { createCaptureRegistry } from './notes/capture-registry.js'
import { createEventBus } from './notes/event-bus.js'
import { createNotesMiddleware } from './notes/middleware.js'
import { createTrustedTaskRegistry } from './notes/trusted-tasks.js'
import type { NoteFormatConfig } from './notes/store.js'
import {
  isCliAvailable,
  startRouter,
  type LlmPreset,
  type LlmRouterConfig,
} from './notes/router.js'
import {
  findTypeSource,
  componentTypeNames,
  crossFileKey,
  extractMsgAnnotationsCrossFile,
  extractDiscriminatedUnionSchemaCrossFile,
  type ResolveContext,
} from '@llui/compiler'
import ts from 'typescript'

/**
 * Single pre-resolution pass run before the signal transform. Parses the
 * focal file ONCE, collects the type-argument names of EVERY `component()`
 * call in it, and resolves everything the transform's schema/annotation
 * extractors need from sibling files:
 *
 *   - `typeSources` — the declaring-file source for each type arg that
 *     lives in another module (the transform's file-local extractors would
 *     otherwise emit `null`). Only `state` is consumed downstream, but msg/
 *     effect are resolved too for completeness.
 *   - `preExtracted` — composition-aware msg annotations + discriminated-
 *     union schemas for Msg/Effect (following `type Msg = Imported | {…}`).
 *
 * Keyed PER CALL by {@link crossFileKey} (issue #91). This used to resolve
 * from the FIRST `component<>` call only, and the transform applied that one
 * result to every call in the file — so a component whose `Msg` is declared
 * locally was emitted with a sibling component's imported schema and
 * annotations. Since that metadata feeds the agent/devtools ABI, a wrong
 * schema is worse than a missing one; a call with no entry falls back to
 * file-local extraction.
 *
 * Cost: one resolution per DISTINCT name tuple, not per call — two components
 * sharing `<State, Msg, Effect>` share one entry, and the whole pass is still
 * gated on the file containing a typed `component<`. Sibling sources are read
 * through the caller's caching `ctx`, so a second tuple re-parses cached text
 * rather than re-reading it.
 */
async function preResolveAll(
  source: string,
  filePath: string,
  ctx: ResolveContext,
): Promise<CrossFileResolutions | undefined> {
  // Cheap filter: nothing to resolve unless the file contains a
  // component<...>() call. Avoids parsing every TS file in the project.
  // (An UNTYPED `component({…})` alongside a typed one is still resolved
  // below, under the State/Msg/Effect convention the transform falls back
  // to — but a file with only untyped calls stays off this path.)
  if (!/\bcomponent\s*</.test(source)) return undefined

  // Parse once; every call's tuple comes out of this one source file.
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true)
  const tuples = collectComponentTypeNames(sf)
  if (tuples.size === 0) return undefined

  // Resolve one type-arg name into an external source if it isn't declared
  // locally (or if the resolver chases through imports).
  const resolveTypeSource = async (
    typeName: string,
  ): Promise<{ source: string; typeName: string } | undefined> => {
    const found = await findTypeSource(typeName, source, filePath, ctx)
    if (!found) return undefined
    // Declared locally → the transform's own extractor path handles it.
    if (found.filePath === filePath) return undefined
    return { source: found.source, typeName: found.localName }
  }

  const resolutions = new Map<string, CrossFileResolution>()
  for (const [key, names] of tuples) {
    const [state, msg, effect, msgAnnotations, msgSchema, effectSchema] = await Promise.all([
      resolveTypeSource(names.state),
      resolveTypeSource(names.msg),
      resolveTypeSource(names.effect),
      extractMsgAnnotationsCrossFile(source, names.msg, filePath, ctx),
      extractDiscriminatedUnionSchemaCrossFile(source, names.msg, filePath, ctx),
      extractDiscriminatedUnionSchemaCrossFile(source, names.effect, filePath, ctx),
    ])

    const resolution: CrossFileResolution = {}
    if (state || msg || effect) resolution.typeSources = { state, msg, effect }
    if (msgAnnotations !== null || msgSchema !== null || effectSchema !== null) {
      const pe: PreExtractedSchemas = {}
      if (msgAnnotations !== null) pe.msgAnnotations = msgAnnotations
      if (msgSchema !== null) pe.msgSchema = msgSchema
      if (effectSchema !== null) pe.effectSchema = effectSchema
      resolution.preExtracted = pe
    }
    if (resolution.typeSources || resolution.preExtracted) resolutions.set(key, resolution)
  }
  return resolutions.size > 0 ? resolutions : undefined
}

/**
 * The effective `<State, Msg, Effect>` names of every `component()` call in the
 * file, de-duplicated by {@link crossFileKey}. Names are derived through
 * {@link componentTypeNames} — the SAME function the transform uses to build its
 * lookup key, so the two cannot drift apart into a silent lookup miss.
 */
function collectComponentTypeNames(
  sf: ts.SourceFile,
): Map<string, { state: string; msg: string; effect: string }> {
  const out = new Map<string, { state: string; msg: string; effect: string }>()
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'component'
    ) {
      const names = componentTypeNames(node)
      const key = crossFileKey(names)
      if (!out.has(key)) out.set(key, names)
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(sf, visit)
  return out
}

/**
 * Locate the workspace root so we share the MCP active marker file
 * with @llui/mcp regardless of which subdirectory the dev server runs in.
 * Mirrors `findWorkspaceRoot` from @llui/mcp — duplicated to avoid a
 * vite-plugin → mcp dependency cycle. The contract must stay in sync.
 */
function findWorkspaceRoot(start: string = process.cwd()): string {
  let dir = resolve(start)
  let lastPackageJson: string | null = null
  while (true) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir
    if (existsSync(resolve(dir, '.git'))) return dir
    if (existsSync(resolve(dir, 'package.json'))) lastPackageJson = dir
    const parent = dirname(dir)
    if (parent === dir) return lastPackageJson ?? start
    dir = parent
  }
}

/**
 * Directory holding the MCP handshake state (the `active.json` marker).
 * Mirrors `mcpStateDir` from @llui/mcp — same duplication, same contract,
 * including the `LLUI_MCP_STATE_DIR` override. BOTH ends must read that
 * variable or the plugin watches a marker the server never writes; it
 * exists so two instances driving one checkout (concurrent test runs,
 * two agents) do not overwrite each other's marker and hand each other's
 * browser the wrong port (issue #85).
 */
function mcpStateDir(start: string = process.cwd()): string {
  const override = process.env['LLUI_MCP_STATE_DIR']
  if (override) return resolve(override)
  return resolve(findWorkspaceRoot(start), 'node_modules/.cache/llui-mcp')
}

/** Serializable v3 source map handed back to Vite's transform hook. */
interface EncodedSourceMap {
  version: 3
  file?: string
  sources: (string | null)[]
  sourcesContent?: (string | null)[]
  names: string[]
  mappings: string
}

/**
 * Prepend whole lines of un-mapped content (the dev relay bootstrap) to a
 * transform result AND shift its map down by the same line count — one function
 * that owns both halves, so the text edit can never happen without the
 * compensation (issue #87: the shift used to sit behind its own `map ? … : null`
 * conditional and was skipped exactly when the transform lowered nothing but the
 * prepend still moved every line).
 *
 * The plugin is `enforce: 'pre'`, so nothing downstream can compensate: an
 * unshifted map makes `vite:esbuild` treat the prepended text as part of the
 * original file and every line number in the module is off by K for the whole
 * dev session (stack traces, breakpoints, coverage).
 *
 * `map === null` means the signal transform returned the source untouched. That
 * is not permission to skip the shift — it only means there is no map to shift
 * yet, so an IDENTITY map for `code` is synthesized first (hires, matching every
 * other map this plugin emits, so fidelity does not depend on whether the
 * transform happened to lower something). When `prepend` is empty there is no
 * shift to owe and the transform's own map (or its absence) passes through
 * unchanged — synthesizing one there would be pure cost on the untouched path.
 *
 * Prepending K full lines moves every generated line down by K without changing
 * any column, so the exact map transform is to prefix K empty generated-line
 * groups (`;`) to `mappings`. That equivalence REQUIRES whole lines: a prepend
 * not ending in a newline would also shift the columns of the original line 0,
 * which no number of `;` groups expresses — so it is rejected rather than
 * silently mapped wrong. The invariant is checked here, not left to the (single)
 * call site, so the guarantee is total rather than true-by-current-usage.
 */
function prependLines(
  code: string,
  map: SourceMap | null,
  prepend: string,
  fileName: string,
): { code: string; map: EncodedSourceMap | null } {
  if (prepend === '') return { code, map: map === null ? null : encodeMap(map) }
  if (!prepend.endsWith('\n')) {
    throw new Error(
      '[llui] prependLines: prepended content must end with a newline — a partial ' +
        'line shifts columns that a line-granular map shift cannot express.',
    )
  }
  let lines = 0
  for (let i = 0; i < prepend.length; i++) if (prepend.charCodeAt(i) === 10) lines++
  const base =
    map ??
    new MagicString(code).generateMap({ source: fileName, includeContent: true, hires: true })
  const encoded = encodeMap(base)
  return {
    code: prepend + code,
    map: { ...encoded, mappings: ';'.repeat(lines) + encoded.mappings },
  }
}

/** magic-string's `SourceMap` narrowed to the plain v3 object Vite expects. */
function encodeMap(map: SourceMap): EncodedSourceMap {
  return {
    version: 3,
    ...(map.file ? { file: map.file } : {}),
    sources: map.sources,
    ...(map.sourcesContent ? { sourcesContent: map.sourcesContent } : {}),
    names: map.names,
    mappings: map.mappings,
  }
}

export interface LluiPluginOptions {
  /**
   * Port for the MCP debug bridge. In dev mode, the runtime relay connects
   * to `ws://127.0.0.1:<port>` so an external `llui-mcp` server can forward
   * tool calls into the running app.
   *
   * When omitted, the plugin checks whether `@llui/mcp` is resolvable from
   * the Vite project root. If yes → defaults to `5200`. If no → stays
   * disabled. This means installing `@llui/mcp` (+ starting its server)
   * Just Works without an explicit config entry. Pass an explicit `false`
   * to opt out even when `@llui/mcp` is installed; pass a number to use
   * a non-default port. When enabled but the MCP server isn't running,
   * the plugin returns 404 from its discovery endpoint and the browser
   * silently skips the connection — no retry noise.
   */
  mcpPort?: number | false

  /**
   * Enables two things together when set:
   *
   *   1. Emits schemas + binding descriptors in prod builds so the
   *      @llui/agent runtime has metadata to advertise over its WS hello
   *      frame.
   *   2. Auto-mounts `@llui/agent/server`'s router at `/agent/*` and its
   *      WS upgrade handler at `/agent/ws` on the Vite dev server — so
   *      plain `vite dev` has working agent endpoints with no extra
   *      server.ts wiring. Requires `@llui/agent` installed; if it isn't,
   *      the plugin warns and skips dev mounting (prod emission still
   *      works from Plan 3b).
   *
   * Pass `true` for defaults (random signing key per dev session;
   * `identityResolver` returns `'dev-user'`). Pass an object to customize.
   * Default `false` — metadata is dev-only, no agent endpoints.
   */
  agent?: boolean | AgentPluginConfig

  /**
   * Whether any component in the app uses `each()`'s `enter` / `leave`
   * / `onTransition` options. When `false` (the default), the
   * vite-plugin substitutes `__LLUI_TRANSITIONS__ = false` into the
   * runtime bundle; Vite's dead-code eliminator then drops the
   * per-entry enter/leave helpers, the `leaving` queue plumbing, and
   * the `report` allocation in `each()`'s reconcile path. Saves
   * ~0.3 kB gz on jfb-shape bundles that don't animate.
   *
   * Apps using `@llui/transitions` or any custom `each({ enter, leave,
   * onTransition })` MUST pass `transitions: true` — otherwise the
   * options will be silently ignored at runtime.
   */
  transitions?: boolean

  /**
   * Surface compiler `perf` diagnostics as Vite warnings. Currently one
   * diagnostic exists: `llui/each-verbatim` — an `each` whose rows did not
   * compile to the cloneNode RowFactory (nor the render-callback lowering)
   * and render via the runtime authoring path instead, paying per-row
   * construction overhead. The message names the bail reason(s) with an
   * actionable hint (e.g. a row delegating to an imported helper, spread
   * connect-part props, an imperative render body).
   *
   * Advisory only — never blocks the build (a verbatim `each` is fully
   * correct, just slower per row). **Default: on in dev mode, off in
   * build.** Pass `false` to silence, `true` to also warn during builds.
   */
  perfDiagnostics?: boolean

  /**
   * Controls the devmode-annotate notebook surface — a single Connect
   * middleware mounted at `/_llui/*` that lets the HUD
   * (`@llui/devmode-annotate`) and the MCP server (`@llui/mcp`) read
   * and write a shared on-disk notebook under `.llui/notes/`. The HUD
   * developer drops notes from the running app; the LLM consumes them
   * via MCP subscriptions; both can initiate captures.
   *
   * **Default: on in dev mode.** Omitting the option (or passing `true`)
   * registers the middleware automatically — there's nothing to do.
   * Pass `false` to opt out (no routes registered, middleware tree-
   * shakes). Pass an object to keep it on while customizing the notes
   * directory or default timeout.
   *
   * The HUD is **auto-injected** in dev mode: the plugin emits a
   * `<script type="module">` into the served HTML that imports
   * `@llui/devmode-annotate` and mounts the floating button. Production
   * builds never run `configureServer` or `transformIndexHtml(dev)`, so
   * this is dev-only by construction. Disable just the HUD (keeping the
   * notes API on) with `devmodeAnnotate: { hud: false }`; disable
   * everything with `devmodeAnnotate: false`. The HUD package must be
   * resolvable from the project root — install
   * `@llui/devmode-annotate` alongside `@llui/vite-plugin`.
   *
   * Environment overrides (honored when not opted out):
   *   - `LLUI_NOTES_DIR` — override the notes root path
   *   - `LLUI_CAPTURE_TIMEOUT_MS` — override the default capture-request timeout
   *
   * The proposal (`docs/proposals/devmode-annotate/`) details what
   * lands on disk and what the LLM gets.
   */
  devmodeAnnotate?: boolean | DevmodeAnnotateConfig
}

export interface DevmodeAnnotateConfig {
  /** Override the on-disk notes root. Relative paths resolve against
   *  the Vite project root. Default: `.llui/notes`. The
   *  `LLUI_NOTES_DIR` env var takes precedence if set. */
  notesDir?: string
  /**
   * Override session-folder naming and/or slug derivation. The
   * id+author+kind prefix of each filename stays fixed so id ordering
   * and filename parsing keep working — only the trailing slug and
   * the session folder name are customizable.
   *
   * ```ts
   * format: {
   *   formatSessionFolder: (d) => `session-${d.toISOString().slice(0, 10)}`,
   *   deriveSlug: (prose) =>
   *     prose.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20).replace(/^-|-$/g, '') || 'capture',
   * }
   * ```
   *
   * Note: when the MCP server writes notes directly (out-of-process),
   * it uses defaults — only writes that go through the dev-server
   * middleware (the HUD path) honor these overrides.
   */
  format?: NoteFormatConfig
  /** Override the default capture-request long-poll timeout in
   *  milliseconds. The `LLUI_CAPTURE_TIMEOUT_MS` env var takes
   *  precedence if set. Default: 30000. */
  captureTimeoutMs?: number
  /**
   * The attention router auto-picks up task-mode notes (the developer
   * clicks "Solve" in the HUD) and spawns the configured LLM CLI to
   * propose a fix. Accepts:
   *
   *  - unset / `undefined` — DISABLED (the default). The router is
   *              OPT-IN: it spawns an LLM CLI with tool access in the
   *              project root, so it never turns on implicitly. Notes
   *              still save to disk; the HUD hides its "Solve" button.
   *  - `false` — explicitly disable (same effect as unset).
   *  - `'claude' | 'codex' | 'gemini'` — enable with a preset.
   *  - `LlmRouterConfig` — preset + overrides (model, timeoutMs,
   *              concurrency, env, extraArgs), or a fully custom
   *              invocation `{ command, args, promptVia }` (omit
   *              `preset` to opt out of preset defaults entirely). Set
   *              `dangerouslySkipPermissions: true` to run the agent
   *              fully unattended (no approval prompts) — dangerous.
   *
   * When the chosen CLI isn't on PATH the router degrades silently
   * to save-only and the HUD hides the Solve button — the user gets
   * a one-line install hint in the console.
   *
   * Default: disabled (opt-in).
   */
  router?: false | LlmPreset | LlmRouterConfig
  /** Override the per-task timeout for the router's spawn. Default
   *  5 minutes. Deprecated alias for `router.timeoutMs`. */
  routerTimeoutMs?: number
  /**
   * Controls the in-app HUD (`@llui/devmode-annotate`) auto-injection.
   *
   *  - `true` / omitted — inject in dev mode (default).
   *  - `false`          — skip injection. The notes API stays live so
   *                       MCP can still consume the notebook; only the
   *                       floating button + modal are skipped.
   *  - `HudInjectionConfig` — inject with forwarded options. Currently
   *                       supports `{ hidden: true }` to mount the HUD
   *                       programmatically (no floating button).
   *
   * Injection silently no-ops when `@llui/devmode-annotate` isn't
   * resolvable from the project root.
   */
  hud?: boolean | HudInjectionConfig
}

export interface HudInjectionConfig {
  /** Mount the HUD without rendering the floating button. The
   *  keyboard shortcut + programmatic API still work. */
  hidden?: boolean
  /** When `true` (default), the HUD installs `window.onerror` +
   *  `unhandledrejection` listeners. On an uncaught error it opens
   *  the modal pre-populated with the stack + a screenshot — turns
   *  "I saw something weird but can't reproduce it" into a
   *  one-click solve. Set `false` to opt out of the listeners
   *  entirely. */
  autoCaptureOnError?: boolean
  /** When `true` (default), the HUD shows a "● Record" toggle that
   *  captures clicks/inputs/route-changes/messages between toggle-on
   *  and submit, attaching them to the note for the LLM to replay.
   *  Set `false` to hide the toggle and skip the listener setup. */
  repro?: boolean
  /** When `true` (default), the HUD exposes the "⌖ Pick element"
   *  annotation mode alongside "⌖ Add region". Set `false` to hide
   *  the picker affordance. */
  elementPick?: boolean
}

/**
 * Reserved for future agent-server config. Empty today — opaque tokens
 * (post-0.0.35) need no signing key, and the dev server hard-codes the
 * identity resolver to `'dev-user'`. The shape is kept so callers can
 * pass `agent: { ... }` and we can grow options without churning the
 * public type.
 */
export type AgentPluginConfig = Record<string, never>

// Re-export the shared notebook types (devmode-annotate proposal, on-disk
// format in docs/proposals/devmode-annotate/01-on-disk-format.md). Both
// the HUD package (@llui/devmode-annotate) and the MCP server import
// these from here — one source of truth for the contract.
export type {
  Annotation,
  AgentSchemaSummary,
  Author,
  CaptureLevel,
  CaptureRequestPayload,
  CaptureRequestResponse,
  ComponentMetaRef,
  ConsoleLogEntry,
  CreateNoteRequest,
  CreateNoteResponse,
  CurrentSessionResponse,
  DirtyTraceEntry,
  ListNotesQuery,
  ListNotesResponse,
  LogLevel,
  MessageLogEntry,
  NoteBody,
  NoteFrontmatter,
  NoteIntent,
  NoteKind,
  NoteRect,
  NoteStatus,
  NoteSummary,
  PendingEffectEntry,
  PendingMessage,
  ProposedDiff,
  RecentEffectEntry,
  RuntimeErrorEntry,
  ServerEvent,
  SourceMapEntry,
  SseRole,
  StatusTransition,
  StructuralSnapshot,
  VerboseNoteBody,
} from './notes/types.js'

/**
 * Does `@llui/mcp` resolve from `root`'s node_modules? Uses
 * `require.resolve` so monorepo workspaces and hoisted installs both
 * work. Catches failures silently — the only consequence is that we
 * leave `mcpPort` disabled, which is the safe default.
 */
function hasMcpPackage(root: string): boolean {
  try {
    const req = createRequire(resolve(root, 'package.json'))
    req.resolve('@llui/mcp/package.json')
    return true
  } catch {
    return false
  }
}

/**
 * Resolve `@llui/devmode-annotate`'s ESM entry point so we can inject an
 * absolute file path into the dev HTML. The HUD is an OPTIONAL, consumer-
 * provided package: `@llui/vite-plugin` no longer depends on it (that would
 * drag the HUD's editor stack — lexical + friends, ~18 MB — into every app
 * that installs the plugin; only the zero-dependency `@llui/notes-format`
 * is a hard dep now). Consumers who want the in-app HUD add
 * `@llui/devmode-annotate` to their own devDependencies, so we resolve it
 * from the CONSUMER's `root` (not the plugin's own location): walk up the
 * `node_modules` chain and read the ESM entry from the package's `exports`
 * map. Returns null when it isn't installed — the caller logs a hint and
 * skips injection.
 */
function resolveDevmodeAnnotateEntry(root: string): string | null {
  let dir = resolve(root)
  for (;;) {
    const pkgDir = resolve(dir, 'node_modules', '@llui', 'devmode-annotate')
    const pkgJsonPath = resolve(pkgDir, 'package.json')
    if (existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
          exports?: { '.'?: { import?: string } }
        }
        const entry = pkg.exports?.['.']?.import
        return entry ? resolve(pkgDir, entry) : null
      } catch {
        return null
      }
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * Normalize the user's `router` setting into the public `LlmRouterConfig`
 * shape (or null when disabled). Accepts `false`, a preset string, or
 * a full config object. Used in `configResolved` so the rest of the
 * plugin (router startup + HUD bootstrap) sees one canonical shape.
 *
 * OPT-IN by default: an unset `router` resolves to `null` (disabled). The
 * attention router auto-spawns an LLM CLI (with tool access) in the project
 * root, so it must never turn on implicitly — a forgeable same-origin/loopback
 * task note reaching a default-on router is a local-RCE path. Enabling it
 * requires an explicit `router: 'claude'` (or a full config object).
 */
export function resolveRouterInput(
  router: false | LlmPreset | LlmRouterConfig | undefined,
  legacyTimeoutMs: number | undefined,
): LlmRouterConfig | null {
  if (router === false) return null
  // Unset → disabled. The deprecated `routerTimeoutMs` alias alone does NOT
  // enable the router; the user must explicitly select a preset/config.
  if (router === undefined) return null
  if (typeof router === 'string') {
    const base: LlmRouterConfig = { preset: router }
    return legacyTimeoutMs ? { ...base, timeoutMs: legacyTimeoutMs } : base
  }
  // Object form — honor legacy `routerTimeoutMs` only if the user
  // didn't set router.timeoutMs themselves.
  if (legacyTimeoutMs && router.timeoutMs === undefined) {
    return { ...router, timeoutMs: legacyTimeoutMs }
  }
  return router
}

/**
 * Resolve the path to the llui-mcp CLI entry. Reads `bin.llui-mcp`
 * from @llui/mcp's package.json and joins it against the package
 * directory. Returns null if @llui/mcp isn't resolvable.
 */
function resolveMcpCliPath(root: string): string | null {
  try {
    const req = createRequire(resolve(root, 'package.json'))
    const pkgJsonPath = req.resolve('@llui/mcp/package.json')
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
      bin?: string | Record<string, string>
    }
    const binEntry = typeof pkgJson.bin === 'string' ? pkgJson.bin : pkgJson.bin?.['llui-mcp']
    if (!binEntry) return null
    return resolve(dirname(pkgJsonPath), binEntry)
  } catch {
    return null
  }
}

type AgentServerInstance = {
  router: (req: Request) => Promise<Response | null>
  wsUpgrade: (
    req: import('http').IncomingMessage,
    socket: import('stream').Duplex,
    head: Buffer,
  ) => void
}

/**
 * Dynamically load @llui/agent/server relative to the app root and
 * construct an agent server instance. Returns null if @llui/agent isn't
 * installed — the plugin degrades to "prod schema emission only" mode.
 */
async function loadAgentServer(
  appRoot: string,
  _cfg: AgentPluginConfig,
): Promise<AgentServerInstance | null> {
  let serverModule: {
    createLluiAgentServer: (opts: {
      identityResolver?: (req: Request) => Promise<string | null>
    }) => AgentServerInstance
  }
  try {
    // Walk up from the app root to find node_modules/@llui/agent. Works
    // for both pnpm workspace and regular npm installs. Direct file-system
    // walk avoids "exports" / "subpath './package.json'" gymnastics that
    // require.resolve and Node's module resolver disagree on.
    const pkgDir = findPackageDir(appRoot, '@llui/agent')
    if (!pkgDir) throw new Error('not found in any ancestor node_modules')
    const pkg = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf8')) as {
      exports?: Record<string, { import?: string } | string>
    }
    const serverExport = pkg.exports?.['./server']
    const rel = typeof serverExport === 'string' ? serverExport : serverExport?.import
    if (!rel) throw new Error('missing ./server export in package.json')
    const modUrl = new URL(`file://${resolve(pkgDir, rel)}`).href
    serverModule = (await import(modUrl)) as typeof serverModule
  } catch (e) {
    console.warn(
      '[llui] agent: true is set but `@llui/agent` could not be loaded: ' +
        (e instanceof Error ? e.message : String(e)),
    )
    return null
  }

  // The pre-0.0.35 agent server required an HMAC signingKey for JWT
  // tokens. The opaque-token rewrite removed that option; the dev
  // server here just calls the factory with no auth config — the
  // in-memory token store is the source of truth.
  return serverModule.createLluiAgentServer({
    identityResolver: async () => 'dev-user',
  })
}

/**
 * Register the agent middleware + WS upgrade on the Vite dev server.
 * Must be called synchronously from configureServer so registration
 * happens BEFORE Vite installs its catch-all SPA fallback.
 */
function registerAgentMiddleware(server: ViteDevServer, agent: AgentServerInstance): void {
  // Connect-style middleware. Vite's middleware chain runs in order, so
  // synchronous registration during configureServer places us ahead of
  // Vite's catch-all fallback.
  //
  // Dual-path: handle the canonical `/agent/*` (every project) AND
  // `/cdn-cgi/agent/*` (defensive — Cloudflare's `@cloudflare/vite-plugin`
  // routes everything except `/cdn-cgi/*` to the worker, which means
  // canonical `/agent/*` paths are shadowed in cloudflare-vite projects).
  // The cdn-cgi prefix is stripped before forwarding so the agent
  // server's router sees its own canonical paths regardless of which
  // public URL the client used. This matches the dual-path strategy
  // used for `/__llui_mcp_status`.
  server.middlewares.use((req, res, next) => {
    const url = req.url ?? '/'
    let stripped: string | null = null
    if (url.startsWith('/agent/') || url === '/agent') stripped = url
    else if (url.startsWith('/cdn-cgi/agent/') || url === '/cdn-cgi/agent') {
      stripped = url.slice('/cdn-cgi'.length)
    }
    if (stripped === null) {
      next()
      return
    }
    // Rewrite the request URL in-place so handleAgentRequest's path
    // matching sees `/agent/*`. Connect middleware can mutate req.url
    // for downstream handlers; we own the request from here.
    req.url = stripped
    void handleAgentRequest(req, res, agent.router).catch((e) => {
      console.error('[llui] agent middleware error:', e)
      next(e)
    })
  })

  // WS upgrade: only /agent/ws goes to the agent. Vite's own HMR upgrade
  // uses a different path and runs as a separate listener on the same
  // event, so this filter keeps both coexisting. Same dual-path
  // accommodation as the HTTP middleware — the WS-upgrade path doesn't
  // actually matter to most cloudflare setups (the worker handles WS
  // upgrades natively), but keeping the parity simplifies the mental
  // model for ops.
  server.httpServer?.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/agent/ws' || url.pathname === '/cdn-cgi/agent/ws') {
      agent.wsUpgrade(req, socket, head)
    }
  })

  console.info(
    '[llui] agent dev endpoints active: POST /agent/mint, WS /agent/ws, LAP /agent/lap/v1/* (also reachable under /cdn-cgi/agent/* for cloudflare-vite parity)',
  )
}

/**
 * Walk up from `start` looking for `node_modules/<pkgName>`. Returns the
 * absolute path to the package directory, or null if not found.
 */
function findPackageDir(start: string, pkgName: string): string | null {
  let dir = resolve(start)
  while (true) {
    const candidate = resolve(dir, 'node_modules', pkgName)
    if (existsSync(resolve(candidate, 'package.json'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** Convert a Node http req → Web Request, call router, write the response. */
async function handleAgentRequest(
  req: import('http').IncomingMessage,
  res: import('http').ServerResponse,
  router: (req: Request) => Promise<Response | null>,
): Promise<void> {
  const method = req.method ?? 'GET'
  const url = req.url ?? '/'
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue
    headers[k] = Array.isArray(v) ? v.join(', ') : v
  }
  let body: BodyInit | undefined
  if (!['GET', 'HEAD'].includes(method)) {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    if (chunks.length > 0) body = new Uint8Array(Buffer.concat(chunks))
  }
  const origin = `http://${req.headers.host ?? 'localhost'}`
  const webReq = new Request(`${origin}${url}`, { method, headers, body })
  const webRes = await router(webReq)
  if (!webRes) {
    res.statusCode = 404
    res.end()
    return
  }
  res.statusCode = webRes.status
  webRes.headers.forEach((v, k) => res.setHeader(k, v))
  const buf = Buffer.from(await webRes.arrayBuffer())
  res.end(buf)
}

// Virtual-module ID for the dev HUD bootstrap script. Vite serves
// `\0`-prefixed ids only when referenced via `/@id/__x00__<id>` from
// HTML, which is the exact pattern used in transformIndexHtml below.
const HUD_VMOD_ID = 'virtual:llui-devmode-annotate-init'
const HUD_VMOD_RESOLVED_ID = '\0' + HUD_VMOD_ID

export default function llui(options: LluiPluginOptions = {}): Plugin {
  let devMode = false
  // Set when the transform hook lowers a signal component. The build-time
  // integrity check (in generateBundle) reads this to confirm the plugin
  // actually compiled at least one component; a build that reaches
  // generateBundle with it unset failed closed.
  let sawSignalComponent = false

  // Cross-file resolution caches (avoid re-reading sibling type files on
  // every component transform / watch rebuild). Keyed by path; validated by
  // mtime so an on-disk edit busts the entry.
  const sourceContentCache = new Map<string, { mtimeMs: number; content: string }>()
  // Dev reverse edges: sibling type file → component module ids that read it
  // during pre-resolution, so editing a Msg/State union re-transforms every
  // importing component (they carry that type's schema in their metadata).
  const typeFileImporters = new Map<string, Set<string>>()

  /** Read a file, serving the mtime-matched cached content when possible. */
  async function readSourceCached(p: string): Promise<string> {
    try {
      const st = await stat(p)
      const cached = sourceContentCache.get(p)
      if (cached && cached.mtimeMs === st.mtimeMs) return cached.content
      const content = await readFile(p, 'utf8')
      sourceContentCache.set(p, { mtimeMs: st.mtimeMs, content })
      return content
    } catch {
      // stat failed (race/permissions) — fall back to a direct read so the
      // caller's own error handling sees any ENOENT.
      return readFile(p, 'utf8')
    }
  }
  // `mcpPort` + `mcpMode` are resolved lazily in `configResolved` so we
  // can check for @llui/mcp in the consuming project's node_modules.
  //   - `options.mcpPort === false`  → disabled
  //   - explicit number              → wire-only (user manages the server)
  //   - undefined + @llui/mcp found  → spawn (plugin starts llui-mcp --http)
  //   - undefined + no @llui/mcp     → disabled
  let mcpPort: number | null = null
  let mcpMode: 'disabled' | 'wire' | 'spawn' = 'disabled'
  let mcpCliPath: string | null = null
  let mcpChild: ChildProcess | null = null
  const agent = options.agent ?? false
  const transitions = options.transitions ?? false
  const perfDiagnosticsOpt = options.perfDiagnostics
  // Set in `configResolved` to the Vite project root. Stays null when
  // `transform` is invoked outside the normal plugin lifecycle (e.g.
  // unit tests that call the hook directly) — those callers don't get
  // cross-file resolution, which is the right fallback: the Program
  // build scans the whole project's tsconfig and can take multiple
  // seconds on large repos, so it must wait for an explicit handshake.
  let crossFileRoot: string | null = null
  const agentConfig: AgentPluginConfig = typeof agent === 'object' ? agent : {}
  // Agent server instance — loaded in configResolved (async), registered
  // in configureServer (sync). Null until loaded, or if @llui/agent isn't
  // installed.
  let agentServer: {
    router: (req: Request) => Promise<Response | null>
    wsUpgrade: (
      req: import('http').IncomingMessage,
      socket: import('stream').Duplex,
      head: Buffer,
    ) => void
  } | null = null

  // HUD auto-injection state, computed in configResolved. The plugin
  // emits a <script type="module"> referencing a virtual module that
  // imports and mounts `@llui/devmode-annotate` from this package's own
  // node_modules — the consumer doesn't add it to their package.json.
  // `hudEntryPath` is the absolute file path to the HUD's ESM entry;
  // Vite serves it via /@fs/.
  let hudInjectEnabled = false
  let hudEntryPath: string | null = null
  let hudOptionsJson = '{}'
  // Whether to inject the HUD <script> via `transformIndexHtml`. Disabled when
  // Vike owns the HTML pipeline: Vike probes `transformIndexHtml` with a fixed
  // fake document and rejects ANY plugin that mutates it (it injects the page's
  // assets itself, via onRenderHtml), so a body-injected HUD tag throws a
  // "Wrong Usage" error. Vike apps that want the HUD mount it from their own
  // document template instead.
  let hudHtmlInject = false

  // Resolved router state. `resolvedRouter` is non-null when the
  // attention router should run; `solveEnabled` is the boolean signal
  // sent to the HUD so it conditionally renders the "Solve" button.
  // Computed once in configResolved; consumed by configureServer
  // (which calls startRouter) and the HUD bootstrap JSON.
  let resolvedRouter: LlmRouterConfig | null = null
  let solveEnabled = false

  // Per-launch capability token that authorizes marking a task note trusted
  // (which lets the attention router spawn a local CLI agent — potentially
  // with --dangerously-skip-permissions). It is injected into the HUD bundle
  // out-of-band (the bootstrap JSON below) and required on the task-create
  // POST via the `x-llui-task-capability` header. A same-origin page script
  // passes the CSRF guard but can't read this token, so it can't forge a
  // trusted task → can't trigger a local agent spawn. Generated once per
  // plugin instance so it never touches disk and never persists across runs.
  const taskCapabilityToken = randomBytes(32).toString('hex')

  // File-based handshake with @llui/mcp. The MCP server writes a marker
  // file when its bridge starts; we watch it and send a Vite HMR custom
  // event so the browser can call __lluiConnect() automatically — without
  // retry spam, regardless of whether MCP or Vite started first.
  const activeFilePath = resolve(mcpStateDir(), 'active.json')
  let dirWatcher: FSWatcher | null = null
  // Cached once Vite's HTTP server emits `listening`. `stampDevUrl()`
  // uses this to write the URL into the marker file — either immediately
  // (if MCP already started and wrote one) or later when the marker
  // appears via the directory watcher (MCP-starts-after-Vite path).
  let cachedDevUrl: string | null = null

  function readMcpMarker(): { port: number; devUrl?: string } | null {
    try {
      if (!existsSync(activeFilePath)) return null
      const data = JSON.parse(readFileSync(activeFilePath, 'utf8')) as {
        port?: number
        devUrl?: string
      }
      if (typeof data.port !== 'number') return null
      return { port: data.port, ...(data.devUrl ? { devUrl: data.devUrl } : {}) }
    } catch {
      return null
    }
  }

  /**
   * Idempotently write `cachedDevUrl` into the marker file. No-op if the
   * URL hasn't been captured yet (Vite hasn't emitted `listening`) or if
   * the marker file doesn't exist (MCP hasn't started yet). Covers both
   * orderings — the listening hook calls this after caching, and the
   * directory watcher calls it when the marker appears later.
   */
  function stampDevUrl(): void {
    if (cachedDevUrl === null) return
    if (!existsSync(activeFilePath)) return
    try {
      const marker = JSON.parse(readFileSync(activeFilePath, 'utf8')) as Record<string, unknown>
      if (marker.devUrl === cachedDevUrl) return
      marker.devUrl = cachedDevUrl
      writeFileSync(activeFilePath, JSON.stringify(marker))
    } catch {
      // Best-effort — failure to update the marker should not crash Vite
    }
  }

  function notifyMcpReady(server: ViteDevServer): void {
    const marker = readMcpMarker()
    if (marker === null) return
    server.ws.send({ type: 'custom', event: 'llui:mcp-ready', data: marker })
  }

  function notifyMcpOffline(server: ViteDevServer): void {
    server.ws.send({ type: 'custom', event: 'llui:mcp-offline', data: {} })
  }

  return {
    name: 'llui',
    enforce: 'pre',

    /**
     * Build-time feature flags substituted into the runtime bundle.
     * `__LLUI_AGENT__` gates the binding-descriptors registry in
     * `@llui/dom`; when `false`, the dead-code eliminator drops the
     * agent-only paths and the entire `binding-descriptors` module
     * tree-shakes out (~10 kB savings on a typical bench bundle).
     *
     * Resolves to `true` when the consumer passes `agent: true | { … }`
     * to the plugin; otherwise `false`. Tests that don't go through
     * the vite-plugin see `typeof __LLUI_AGENT__ === 'undefined'`,
     * which the runtime guard treats as off.
     */
    config() {
      return {
        define: {
          __LLUI_AGENT__: JSON.stringify(Boolean(agent)),
          __LLUI_TRANSITIONS__: JSON.stringify(Boolean(transitions)),
        },
      }
    },

    async configResolved(config) {
      devMode = config.command === 'serve' || config.mode === 'development'
      crossFileRoot = config.root
      // Load @llui/agent here (async) so we can register middleware
      // synchronously in configureServer — which must happen BEFORE Vite
      // installs its catch-all SPA/fallback middleware.
      if (agent && devMode) {
        agentServer = await loadAgentServer(config.root, agentConfig)
      }

      // ── HUD auto-injection (devmode-annotate) ─────────────────────
      // The floating-button HUD is an OPTIONAL, consumer-provided package
      // (`@llui/devmode-annotate`) — it is NOT a dependency of this plugin,
      // so its heavy editor stack never lands in apps that only want the
      // compiler + notes API. When the consumer has it installed, we resolve
      // its entry in dev and inject a <script type="module"> that mounts it
      // against the running app; when it isn't installed we skip injection
      // (the notes API still works). Disable via `devmodeAnnotate: false`
      // (turn the whole subsystem off) or `devmodeAnnotate: { hud:
      // false }` (keep the notes API; skip just the HUD).
      if (devMode && options.devmodeAnnotate !== false) {
        const annotateCfg =
          typeof options.devmodeAnnotate === 'object' ? options.devmodeAnnotate : {}

        // ── Resolve router + binary availability ────────────────────
        // `solveEnabled` reflects whether the HUD should render the
        // "Solve" button: true iff the user didn't disable the router
        // AND the chosen CLI is actually on PATH.
        resolvedRouter = resolveRouterInput(annotateCfg.router, annotateCfg.routerTimeoutMs)
        if (resolvedRouter) {
          const preset = resolvedRouter.preset ?? 'claude'
          const cliName =
            resolvedRouter.command ??
            (preset === 'claude' ? 'claude' : preset === 'codex' ? 'codex' : 'gemini')
          solveEnabled = isCliAvailable(cliName)
          if (!solveEnabled) {
            process.stderr.write(
              `[llui:router] '${cliName}' not found on PATH — task notes will be saved but not auto-solved.\n` +
                `              The HUD will hide its "Solve" button. Install the CLI or set\n` +
                `              \`devmodeAnnotate: { router: false }\` to silence.\n`,
            )
          }
        }

        const hudCfg = annotateCfg.hud
        if (hudCfg !== false) {
          hudEntryPath = resolveDevmodeAnnotateEntry(config.root)
          if (hudEntryPath) {
            hudInjectEnabled = true
            // Vike intercepts the HTML pipeline; injecting our HUD tag via
            // transformIndexHtml trips Vike's "Wrong Usage" guard. Detect Vike in
            // the resolved plugin list and skip the HTML injection (the notes API,
            // vmod, and middleware stay live for view-helper / manual use).
            const vikePresent = (config.plugins ?? []).some(
              (p) => typeof p?.name === 'string' && p.name.startsWith('vike'),
            )
            hudHtmlInject = !vikePresent
            if (vikePresent) {
              process.stderr.write(
                '[llui:devmode-annotate] Vike detected — the dev HUD is not auto-injected into the\n' +
                  '                        HTML (Vike owns the document pipeline). Mount it from your\n' +
                  '                        document template, or set `devmodeAnnotate: { hud: false }` to silence.\n',
              )
            }
            const forwarded: HudInjectionConfig = typeof hudCfg === 'object' ? hudCfg : {}
            hudOptionsJson = JSON.stringify({
              ...(forwarded.hidden ? { hidden: true } : {}),
              solveEnabled,
              // Out-of-band capability token: the HUD echoes this on the
              // task-create POST so the middleware can distinguish a real
              // in-HUD task (router may spawn an agent) from a forged
              // same-origin POST (created, but never spawned). Only forwarded
              // when the router is actually enabled — no router, no spawn, no
              // need to hand the token to the page.
              ...(solveEnabled ? { taskCapabilityToken } : {}),
              // Production bootstrap turns on server-side rehydrate so
              // a page reload restores in-flight tasks + chain history
              // + Accept toasts. Tests (mountAnnotateHud directly)
              // default to off so they don't see surprise fetches.
              rehydrate: true,
              // Opt-in features default ON; only forward an explicit
              // `false` so the bootstrap stays compact.
              ...(forwarded.autoCaptureOnError === false ? { autoCaptureOnError: false } : {}),
              ...(forwarded.repro === false ? { repro: false } : {}),
              ...(forwarded.elementPick === false ? { elementPick: false } : {}),
            })
          } else {
            process.stderr.write(
              '[llui:devmode-annotate] HUD not injected — `@llui/devmode-annotate` is not installed.\n' +
                '                        Run `pnpm add -D @llui/devmode-annotate` to enable the in-app HUD,\n' +
                '                        or set `devmodeAnnotate: { hud: false }` to silence this hint.\n',
            )
          }
        }
      }
      if (options.mcpPort === false) {
        mcpMode = 'disabled'
        mcpPort = null
      } else if (typeof options.mcpPort === 'number') {
        mcpMode = 'wire'
        mcpPort = options.mcpPort
      } else if (hasMcpPackage(config.root)) {
        mcpCliPath = resolveMcpCliPath(config.root)
        if (mcpCliPath) {
          mcpMode = 'spawn'
          mcpPort = 5200
        } else {
          mcpMode = 'wire'
          mcpPort = 5200
        }
      } else {
        mcpMode = 'disabled'
        mcpPort = null
      }
    },

    configureServer(server) {
      // ── Notes middleware (devmode-annotate proposal P1) ────────────
      // On by default in dev mode. Set `devmodeAnnotate: false` to opt
      // out; pass an object to customize while keeping it on.
      //
      // Mounts a single Connect handler that prefix-checks /_llui/ and
      // dispatches internally to notes, events, capture-request, and
      // session endpoints — so the HUD and the MCP server share one
      // on-disk notebook per dev-server lifetime.
      if (options.devmodeAnnotate !== false) {
        const notesConfig =
          typeof options.devmodeAnnotate === 'object' ? options.devmodeAnnotate : {}
        const projectRoot = crossFileRoot ?? process.cwd()
        const notesRoot = process.env['LLUI_NOTES_DIR']
          ? resolve(process.cwd(), process.env['LLUI_NOTES_DIR'])
          : notesConfig.notesDir
            ? resolve(projectRoot, notesConfig.notesDir)
            : resolve(projectRoot, '.llui/notes')
        const envTimeout = process.env['LLUI_CAPTURE_TIMEOUT_MS']
          ? parseInt(process.env['LLUI_CAPTURE_TIMEOUT_MS'], 10)
          : undefined
        const captureTimeoutMs = Number.isFinite(envTimeout)
          ? (envTimeout as number)
          : notesConfig.captureTimeoutMs
        const notesBus = createEventBus()
        const notesRegistry = createCaptureRegistry()
        // Shared provenance registry: the middleware marks task notes it
        // accepts from authenticated same-origin requests; the router only
        // spawns agents for tasks so marked. See notes/trusted-tasks.ts.
        const notesTrustedTasks = createTrustedTaskRegistry()
        const notesHandler = createNotesMiddleware({
          notesRoot,
          bus: notesBus,
          registry: notesRegistry,
          trustedTasks: notesTrustedTasks,
          // Only hand the middleware a live token when the router is enabled;
          // otherwise no task is ever marked trusted (nothing would spawn
          // anyway) and a forged POST can't fish for a valid token.
          ...(solveEnabled ? { taskCapabilityToken } : {}),
          defaultCaptureTimeoutMs: captureTimeoutMs,
          ...(notesConfig.format ? { format: notesConfig.format } : {}),
        })
        server.middlewares.use(notesHandler)

        // ── Attention router (P6/C) ────────────────────────────────
        // Resolved in configResolved into `resolvedRouter` (null when
        // disabled) and `solveEnabled` (false when the CLI binary is
        // missing). Only spawn the router when both are set — the HUD
        // already received `solveEnabled: false` so the Solve button
        // is hidden in either degraded case.
        if (resolvedRouter && solveEnabled) {
          const cliName = resolvedRouter.command ?? resolvedRouter.preset ?? 'claude'
          const routerHandle = startRouter({
            notesRoot,
            projectRoot,
            bus: notesBus,
            trustedTasks: notesTrustedTasks,
            ...resolvedRouter,
          })
          server.httpServer?.on('close', () => routerHandle.stop())
          process.stderr.write(
            `[llui:router] attention router started — task notes will be solved by ${cliName}\n`,
          )
        }
      }

      // Agent dev endpoints — runs regardless of mcp state. Must be before
      // any early-returns below. Registration is synchronous because
      // agentServer was preloaded in configResolved.
      if (agentServer) {
        registerAgentMiddleware(server, agentServer)
      }

      if (mcpPort === null) {
        // #3 diagnostic: MCP server is running but the plugin is opted
        // out. Users in this state usually don't realize the mismatch —
        // loud-and-early log saves the "why isn't my MCP attached" hunt.
        if (existsSync(activeFilePath)) {
          console.warn(
            `[llui] @llui/mcp server is running (marker at ${activeFilePath}) ` +
              `but the Vite plugin is opted out (mcpPort: false, or @llui/mcp ` +
              `isn't a dep of this project). Add \`llui({ mcpPort: 5200 })\` ` +
              `to vite.config to wire them up, or remove the marker file and ` +
              `stop the MCP server if the mismatch was unintended.`,
          )
        }
        return
      }

      // Spawn mode: plugin launches llui-mcp as a child process so
      // `pnpm dev` handles the whole stack. Skip spawning when a marker
      // already exists — something (usually a separate llui-mcp process
      // started before Vite) is already listening. The existing wire
      // behavior takes over from there.
      if (mcpMode === 'spawn' && mcpCliPath !== null && !existsSync(activeFilePath)) {
        mcpChild = spawn(process.execPath, [mcpCliPath, '--http', String(mcpPort)], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, LLUI_MCP_PORT: String(mcpPort) },
        })
        mcpChild.stdout?.on('data', (buf: Buffer) => {
          process.stdout.write(`[mcp] ${buf.toString()}`)
        })
        mcpChild.stderr?.on('data', (buf: Buffer) => {
          process.stderr.write(`[mcp] ${buf.toString()}`)
        })
        mcpChild.on('exit', (code) => {
          if (code !== 0 && code !== null) {
            console.warn(`[llui] @llui/mcp child exited with code ${code}`)
          }
          mcpChild = null
        })
        const killChild = (): void => {
          if (mcpChild && !mcpChild.killed) mcpChild.kill('SIGTERM')
        }
        server.httpServer?.on('close', killChild)
        process.once('exit', killChild)
      }

      // HTTP endpoint: the browser fetches this on load to discover the
      // current MCP port. Avoids the race where HMR events sent before
      // the import.meta.hot listener registers get dropped — and lets
      // the browser connect to the actual port (which may differ from
      // the compile-time default if MCP was started with LLUI_MCP_PORT).
      //
      // Two paths register the same handler:
      //  * `/__llui_mcp_status` — canonical, served from any Vite
      //    project.
      //  * `/cdn-cgi/llui_mcp_status` — fallback for projects that
      //    bundle `@cloudflare/vite-plugin`. The cloudflare plugin
      //    intercepts every HTTP request in `configureServer` and
      //    routes it to the worker, except `/cdn-cgi/*` which it
      //    explicitly lets through. Without this fallback, MCP
      //    auto-discovery silently fails under workerd.
      const mcpStatusHandler = (_req: unknown, res: ServerResponseLike): void => {
        const marker = readMcpMarker()
        if (marker === null) {
          res.statusCode = 404
          res.end()
          return
        }
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ port: marker.port }))
      }
      server.middlewares.use('/__llui_mcp_status', mcpStatusHandler)
      server.middlewares.use('/cdn-cgi/llui_mcp_status', mcpStatusHandler)

      // Watch the marker file for create/delete. fs.watch on the parent
      // directory catches both events; the file itself may not exist
      // when we start watching.
      const dir = dirname(activeFilePath)
      try {
        // Watch the parent directory for the marker file appearing/disappearing
        const watchDir = (): void => {
          if (!existsSync(dir)) return
          dirWatcher = fsWatch(dir, (_event, filename) => {
            if (filename !== 'active.json') return
            if (existsSync(activeFilePath)) {
              // Stamp BEFORE notifying so the `llui:mcp-ready` payload
              // carries the cached devUrl. This is the MCP-after-Vite
              // path: listening already fired and cached the URL; the
              // marker is only now appearing.
              stampDevUrl()
              notifyMcpReady(server)
            } else {
              notifyMcpOffline(server)
            }
          })
        }
        if (existsSync(dir)) {
          watchDir()
        } else {
          // Parent directory doesn't exist yet — poll for it briefly
          const poll = setInterval(() => {
            if (existsSync(dir)) {
              clearInterval(poll)
              watchDir()
            }
          }, 1000)
          // Clean up the poller if vite shuts down before MCP starts
          server.httpServer?.on('close', () => clearInterval(poll))
        }
      } catch {
        // fs.watch can fail on some filesystems — degrade silently
      }

      // Re-send the ready event when a new HMR client connects, in case
      // the page loads while MCP is already running.
      server.ws.on('connection', () => {
        if (existsSync(activeFilePath)) notifyMcpReady(server)
      })

      server.httpServer?.on('close', () => {
        dirWatcher?.close()
        dirWatcher = null
      })

      // Once Vite's HTTP server is listening, cache our dev URL and stamp
      // it into the marker file. Two orderings are possible:
      //   (a) MCP started FIRST → marker exists now → stampDevUrl() writes
      //       it, and we broadcast llui:mcp-ready so the browser picks up
      //       the devUrl without relying on an incidental fs.watch tick
      //       (which can miss on NFS/SMB).
      //   (b) MCP will start LATER → marker doesn't exist yet → stamp is a
      //       no-op. When MCP eventually writes the marker, the directory
      //       watcher fires, calls stampDevUrl(), and notifies.
      server.httpServer?.once('listening', () => {
        const address = server.httpServer?.address()
        if (!address || typeof address !== 'object') return
        const host =
          address.address === '::' || address.address === '0.0.0.0' ? 'localhost' : address.address
        cachedDevUrl = `http://${host}:${address.port}`
        stampDevUrl()
        // Broadcast after stamping so the payload carries devUrl. Only
        // fires in case (a) — notifyMcpReady no-ops when the marker is
        // absent.
        notifyMcpReady(server)
      })

      // ── Agent dev endpoints ──────────────────────────────────────
      // When `agent: true` (or `agent: {...}`), auto-mount /agent/* on
      // the Vite dev server so `pnpm dev` has working agent endpoints.
      // Users with a custom server.ts (SSR apps) mount createLluiAgentServer
      // themselves — configureServer also fires in middleware mode, but
      // there server.httpServer is null so the upgrade hook is a no-op.
    },

    // ── HUD auto-injection (dev only) ────────────────────────────────
    // A virtual module emits the `mountAnnotateHud(...)` call; the
    // index.html injection point references it by URL so Vite's normal
    // module graph + resolver handle `@llui/devmode-annotate`. Build
    // mode never calls `transformIndexHtml(serve)`, so the HUD is fully
    // tree-shaken from production output by construction.
    resolveId(id) {
      if (id === HUD_VMOD_ID) return HUD_VMOD_RESOLVED_ID
      return undefined
    },

    load(id) {
      if (id !== HUD_VMOD_RESOLVED_ID) return undefined
      if (!hudInjectEnabled || !hudEntryPath) return 'export {}'
      // Use the resolved absolute path so Vite's /@fs/ pipeline serves
      // the HUD from this plugin's own node_modules — the user's app
      // doesn't need to declare `@llui/devmode-annotate` itself.
      return [
        `import { mountAnnotateHud } from ${JSON.stringify(hudEntryPath)}`,
        `mountAnnotateHud(${hudOptionsJson})`,
      ].join('\n')
    },

    transformIndexHtml: {
      order: 'pre',
      handler() {
        if (!devMode || !hudInjectEnabled || !hudHtmlInject) return
        return [
          {
            tag: 'script',
            attrs: { type: 'module', src: `/@id/__x00__${HUD_VMOD_ID}` },
            injectTo: 'body',
          },
        ]
      },
    },

    // Dev reverse-edge invalidation. Type-only imports (a component's Msg /
    // State union living in a sibling file) are erased by TS and never become
    // real module-graph dependencies, so editing them wouldn't otherwise
    // re-transform the importing components — their embedded schema metadata
    // would go stale. During pre-resolution we recorded which components read
    // each type file (`typeFileImporters`); when one of those files changes,
    // invalidate + re-transform its importers.
    handleHotUpdate(hmr) {
      if (!devMode) return
      const importers = typeFileImporters.get(hmr.file)
      if (!importers || importers.size === 0) return
      const invalidated = []
      for (const importerId of importers) {
        const mod = hmr.server.moduleGraph.getModuleById(importerId)
        if (mod) {
          hmr.server.moduleGraph.invalidateModule(mod)
          invalidated.push(mod)
        }
      }
      if (invalidated.length === 0) return
      return [...hmr.modules, ...invalidated]
    },

    async transform(code, id, options) {
      // Strip any Vite query/hash suffix (`foo.tsx?v=abc`, `foo.ts#x`) before
      // testing the extension — otherwise a queried id would slip past the
      // gate. Accept `.mts`/`.cts` too (native ESM/CJS TS modules), not just
      // `.ts`/`.tsx`.
      const cleanId = id.replace(/[?#][^]*$/, '')
      if (!/\.(?:ts|tsx|mts|cts)$/.test(cleanId)) return

      // `'use client'` directive — SSR builds replace the module with a
      // stub so top-level imports and side effects never run on the
      // server. Client builds pass through to the normal transform; the
      // directive is effectively a no-op on the client.
      if (options?.ssr && hasUseClientDirective(code)) {
        const result = transformUseClientSsr(code, id)
        if (result) {
          const cwd = process.cwd()
          const rel = relative(cwd, id)
          const display = rel.startsWith('..') ? id : rel
          for (const warning of result.warnings) {
            this.warn(`${display}: ${warning}`)
          }
          // The SSR stub replaces the module wholesale, so there's no
          // token-level correspondence to preserve — but emit a real,
          // coherent map (whole output ← source start) rather than the
          // invalid `{ mappings: '' }` sentinel, so Vite's map chain
          // stays valid downstream.
          const ms = new MagicString(code)
          ms.overwrite(0, code.length, result.output)
          const map = ms.generateMap({ source: id, includeContent: true, hires: true })
          return { code: result.output, map }
        }
      }

      // A SIGNAL FILE: imports the `@llui/dom` runtime surface and has a
      // `component(` — OR an `each(` in a helper-only module. `@llui/dom` IS the
      // signal runtime (the legacy runtime is gone). The transform LOWERS the
      // direct view (an optimization); anything it can't lower (view-helper
      // functions, block bodies) runs via the runtime authoring helpers
      // (text/el/each/… consume runtime signal handles). Helper-only modules
      // (no `component(`) are routed for their `each(` sites: pass 2 lowers
      // those rows to `eachDirect` factories — without routing they'd run
      // verbatim in production regardless of lowerability (real apps keep most
      // eaches in helper modules). A cheap string pre-check avoids the extra
      // parse on irrelevant files. (`@llui/dom/internal`, `/ssr/*`, `/devtools`
      // don't match the closing-quote-anchored pattern, so type-only or SSR-env
      // imports never trip it.)
      // Left-anchored: `\b` before `component` so `myComponent(` (a call to
      // an unrelated helper) does NOT match — only a real `component(`/`component<`
      // token arms the routing + integrity signal.
      const hasComponentCall = /\bcomponent\s*[<(]/.test(code)
      const importsDomLiteral = /from\s*['"]@llui\/dom['"]/.test(code)
      // Fast-accept: a file that imports `@llui/dom` literally AND has a
      // `component(`/`each(` site. FALLBACK: route ANY qualifying module with a
      // real `component(` token even when it does NOT import `@llui/dom`
      // literally — the runtime surface is frequently re-exported through a
      // project barrel (`from './framework'`), so requiring the literal import
      // silently skipped barrel-imported components (they ran un-lowered and,
      // worse, un-linted). `each(`-only helper modules still require the
      // literal import: a bare `each(` is too common to arm routing on alone.
      if (hasComponentCall || (importsDomLiteral && /\beach\s*\(/.test(code))) {
        // NOTE: the build-integrity flag is NOT armed here. A loose pre-check
        // is too weak a "fail closed" guarantee — it fires before the transform
        // runs, so a false-positive string match would vacuously satisfy the
        // check. We arm `sawSignalComponent` below, keyed on the transform
        // actually producing a rewrite (`transformed.map !== null`) — the only
        // per-module bookkeeping this hook still owes the bundle. (Chunk
        // provenance used to be tracked here too, for a post-bundle rename
        // pass; the compiler emits its final names now, so the bundle is left
        // alone entirely — see the ANTI-RECIPE above `generateBundle`.)
        // Enforce signal lint rules. Lint the AUTHORED source. Two channels:
        //  - `convention` diagnostics carry a runtime-neutral rename fix (e.g.
        //    `tabIndex` → `tabindex`); auto-apply them to the emitted code and
        //    `this.warn` (the dev loop never blocks on a pure casing nit).
        //  - everything else (correctness rules, incl. fixable ones like a
        //    miscased handler that would silently not fire) stays a hard error —
        //    the only effective channel for LLMs (see CLAUDE.md). `this.error`
        //    throws → halts. We report blocking errors BEFORE applying any fix,
        //    so their positions still match the unmodified `code`.
        const lintMsgs = lintSignalSource(code, id)
        if (lintMsgs.length > 0) {
          const rel = relative(crossFileRoot ?? process.cwd(), id)
          const display = rel.length > 0 && !rel.startsWith('..') ? rel : id
          const autoFixable = lintMsgs.filter((m) => m.rule === 'convention' && m.fix)
          const blocking = lintMsgs.filter((m) => !(m.rule === 'convention' && m.fix))
          if (blocking.length > 0) {
            const first = blocking[0]!
            const body = blocking
              .map((m) => `  ${display}:${m.line}:${m.column}  [${m.rule}] ${m.message}`)
              .join('\n')
            this.error({
              message: `[llui] signal lint failed (${blocking.length} error${
                blocking.length > 1 ? 's' : ''
              }):\n${body}`,
              loc: { file: id, line: first.line, column: first.column },
            })
          }
          if (autoFixable.length > 0) {
            for (const m of autoFixable) {
              this.warn(`${display}:${m.line}:${m.column}  [${m.rule}] auto-fixed — ${m.message}`)
            }
            code = applyLintFixes(code, autoFixable).code
          }
        }
        // Resolve cross-file Msg/State/Effect types (same machinery the legacy
        // path uses) so types in sibling files still produce full agent metadata.
        // Helper-only files have no component to annotate — skip the resolution.
        const wantMeta = hasComponentCall && (Boolean(agent) || devMode)
        let signalCrossFile: CrossFileResolutions | undefined
        if (wantMeta && typeof this.resolve === 'function') {
          const rr = this.resolve.bind(this)
          const addWatch =
            typeof this.addWatchFile === 'function' ? this.addWatchFile.bind(this) : undefined
          // `agent-annotation-syntax` for the SIBLINGS this component's
          // metadata is built from. The transform hook below only sees modules
          // Vite actually transforms, and the canonical layout —
          // `import type { Msg } from './msg'` — is ERASED by esbuild: `msg.ts`
          // never enters the module graph, so it is never transformed, yet the
          // resolver reads it right here and its annotations ship as `$ma`.
          // Without this the gate this issue exists to close is still open in
          // the most common layout (#89).
          //
          // Collected, not thrown: `findTypeSource` wraps `readSource` in
          // best-effort try/catch blocks that would swallow a `this.error`.
          // Reported AFTER resolution, against the SIBLING's path — the
          // author needs the file that carries the annotation, not the
          // importer.
          const siblingLint: Array<{ file: string; msgs: SignalLintMessage[] }> = []
          const siblingSeen = new Set<string>()
          const ctx: ResolveContext = {
            resolveModule: async (spec, importer) => {
              const result = await rr(spec, importer)
              if (!result || result.external) return null
              // Rollup ids can carry query/hash suffixes for virtual modules;
              // strip them so fs sees a real path. Skip node_modules — we
              // don't chase third-party types.
              const idStripped = result.id.split('?')[0]?.split('#')[0]
              if (!idStripped) return null
              if (idStripped.includes('/node_modules/')) return null
              return idStripped
            },
            readSource: async (p) => {
              const content = await readSourceCached(p)
              // Watch every sibling the transform reads, so a Vite dev server
              // re-runs THIS transform when the type file changes (without
              // this the schema/annotation metadata goes stale on edit).
              addWatch?.(p)
              // Record the reverse edge so a change to `p` can invalidate the
              // importing component modules (type-only imports are erased and
              // never enter the module graph as dependencies otherwise).
              if (devMode) {
                let set = typeFileImporters.get(p)
                if (!set) {
                  set = new Set()
                  typeFileImporters.set(p, set)
                }
                set.add(id)
              }
              if (!siblingSeen.has(p)) {
                siblingSeen.add(p)
                const msgs = lintAnnotationSyntaxSource(content, p)
                if (msgs.length > 0) siblingLint.push({ file: p, msgs })
              }
              return content
            },
          }
          signalCrossFile = await preResolveAll(code, id, ctx)
          if (siblingLint.length > 0) {
            const first = siblingLint[0]!
            const firstMsg = first.msgs[0]!
            const body = siblingLint
              .flatMap(({ file, msgs }) => {
                const rel = relative(crossFileRoot ?? process.cwd(), file)
                const display = rel.length > 0 && !rel.startsWith('..') ? rel : file
                return msgs.map(
                  (m) => `  ${display}:${m.line}:${m.column}  [${m.rule}] ${m.message}`,
                )
              })
              .join('\n')
            const count = siblingLint.reduce((n, s) => n + s.msgs.length, 0)
            this.error({
              message: `[llui] signal lint failed (${count} error${count > 1 ? 's' : ''}):\n${body}`,
              loc: { file: first.file, line: firstMsg.line, column: firstMsg.column },
            })
          }
        }
        // Perf diagnostics (llui/each-verbatim): advisory warnings for each
        // sites that render via the authoring path. Default on in dev only.
        const perfDiagnosticsOn = perfDiagnosticsOpt ?? devMode
        const perfWarn = perfDiagnosticsOn
          ? (d: import('@llui/compiler').Diagnostic): void => {
              const rel = relative(crossFileRoot ?? process.cwd(), id)
              const display = rel.length > 0 && !rel.startsWith('..') ? rel : id
              const { line, column } = d.location.range.start
              this.warn(`${display}:${line + 1}:${column + 1}  [${d.id}] ${d.message}`)
            }
          : undefined
        // The map-returning transform composes every splice (view rewrites,
        // metadata, `batch` bag injection, the injected runtime import)
        // through one MagicString instance, so its map is coherent against
        // `code` (which already carries any convention autofixes applied
        // above; the map's sourcesContent reflects that post-fix text).
        const transformed = transformSignalComponentSourceWithMap(code, {
          emitAgentMetadata: Boolean(agent),
          devMode,
          fileName: id,
          onPerfDiagnostic: perfWarn,
          crossFile: signalCrossFile,
        })
        // Arm the build-integrity flag from the ACTUAL transform result: a
        // non-null map means the signal transform genuinely rewrote a
        // `component()` file (view lowering / metadata emission). Helper-only
        // modules (no `component(`) never arm it, even when they carry an
        // `each(` the transform touched — `hasComponentCall` gates that.
        if (hasComponentCall && transformed.map !== null) sawSignalComponent = true
        // Dev + MCP: signal files bypass the legacy compiler that injects the
        // relay, so inject startRelay (guarded to fire once) + the HMR handshake.
        // The bootstrap is prepended AFTER the transform — `prependLines` owns
        // BOTH halves (the text and the matching map shift) so they cannot
        // disagree, including when the transform lowered nothing and handed us
        // `map: null` (issue #87).
        const bootstrap =
          devMode && mcpPort !== null
            ? `import { startRelay as __llui_startRelay } from '@llui/dom/devtools'\n` +
              `if (!globalThis.__lluiRelayStarted) { globalThis.__lluiRelayStarted = true; __llui_startRelay(${mcpPort})\n` +
              `  if (import.meta.hot) import.meta.hot.on('llui:mcp-ready', (d) => { if (typeof globalThis.__lluiConnect === 'function') globalThis.__lluiConnect(d?.port) }) }\n`
            : ''
        return prependLines(transformed.code, transformed.map, bootstrap, id)
      }

      // Non-signal `.ts`/`.tsx` files pass through untouched — but they still
      // get `agent-annotation-syntax`. A Msg union routinely lives in a plain
      // `msg.ts` with no `component(` call, and that is precisely where
      // `@routeGated`/`@validates` are authored; without this the one rule that
      // can catch a malformed, silently-dropped predicate would never see them
      // (issue #89). The rule pre-checks the source string, so a module with no
      // annotation call never pays for a parse.
      const annotationMsgs = lintAnnotationSyntaxSource(code, id)
      if (annotationMsgs.length > 0) {
        const rel = relative(crossFileRoot ?? process.cwd(), id)
        const display = rel.length > 0 && !rel.startsWith('..') ? rel : id
        const first = annotationMsgs[0]!
        const body = annotationMsgs
          .map((m) => `  ${display}:${m.line}:${m.column}  [${m.rule}] ${m.message}`)
          .join('\n')
        this.error({
          message: `[llui] signal lint failed (${annotationMsgs.length} error${
            annotationMsgs.length > 1 ? 's' : ''
          }):\n${body}`,
          loc: { file: id, line: first.line, column: first.column },
        })
      }
      // The legacy accessor compiler was removed in the signal-runtime
      // migration; the signal branch above is now the only compilation path.
      return undefined
    },

    // Build-time integrity check. The signal transform is the ONLY
    // compilation path; it sets `sawSignalComponent` the moment it lowers a
    // `component()` file. If a production build reaches `generateBundle`
    // without that flag ever being set, another transform consumed the TS
    // ahead of us (plugin-order bug) or the project genuinely has no LLui
    // components — either way, fail closed. (The old `__lluiCompilerEmitted`
    // marker was a legacy-compiler artifact; the signal transform never
    // emits it, so scanning the bundle for it counted nothing. The flag is
    // the live signal.)
    //
    // Dev mode skips the check: dev users have HMR + warnings to find
    // misconfiguration interactively. SSR builds also skip — the SSR
    // pass may emit a stub module bundle that legitimately contains no
    // components.
    //
    // ANTI-RECIPE — this hook used to also run a post-bundle property-rename
    // pass over the compiler-emitted metadata keys, scoped by provenance to
    // chunks containing a compiled module. That is unfixable by construction:
    // the WRITER of those keys is app code, the READERS are `@llui/dom` and
    // `@llui/agent`, and any `manualChunks` vendor split (the stock
    // `{ vendor: ['@llui/dom'] }` included) puts them in different chunks —
    // so the pass renamed the writer and left the reader looking up the old
    // name, yielding `undefined` schemas in every production `agent: true`
    // build with no error anywhere (issue #45). The compiler now emits the
    // final short names itself (`COMPILER_META_KEYS`, mirrored in
    // `@llui/dom`'s `signals/compiler-keys.ts`), which gets the same bytes
    // with no bundle-shape dependency. Do NOT reintroduce bundle-time
    // renaming of compiler-emitted names.
    //
    // Related ANTI-RECIPE — property-MANGLING the compiler-emit fields with
    // terser/esbuild saves 570–1,406 bytes gz on the jfb bench bundle but
    // empirically regresses keyed-each ops (Update 10th, Select, Swap) by
    // 35–58 %. Verified 2026-05-20 across three measurements with both
    // implementations; the cost holds even with `compress: false`. Property
    // renames should be V8-transparent in theory; in practice V8's optimizer
    // on the jfb shape produces measurably slower code on the mangled bundle.
    // See commit d2855d7 (landed) + b63a6ef (reverted) for the full attempt.
    generateBundle(opts) {
      if (devMode) return
      if (opts.dir === undefined && opts.file === undefined) return
      // The `ssr` flag on the output options is the cleanest signal for
      // SSR builds; rollup adds it when Vite's build.ssr is set.
      if ((opts as { ssr?: boolean }).ssr) return
      if (!sawSignalComponent) {
        // `this.error` throws — no statements below this line execute.
        this.error(
          '[llui] integrity check failed: no compiled `component()` calls found in ' +
            'this build. Either the project has no LLui components (remove ' +
            '`@llui/vite-plugin` from vite.config.ts), or the plugin order is wrong ' +
            'and another transform is consuming TS before `@llui/vite-plugin` runs ' +
            "(check `enforce: 'pre'`). The signal transform sets an internal " +
            'flag whenever it lowers a `component()` file; that flag was never set.',
        )
      }
    },
  }
}
