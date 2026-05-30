import type { Plugin, ViteDevServer } from 'vite'

// Minimal subset of `http.ServerResponse` we use in the MCP-status
// handler. Avoids a heavy `node:http` import at the top of the file.
interface ServerResponseLike {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body?: string): void
}
import { existsSync, readFileSync, writeFileSync, watch as fsWatch, type FSWatcher } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawn, type ChildProcess } from 'node:child_process'
import {
  transformSignalComponentSource,
  lintSignalSource,
  registerIntrospectionFactory,
  registerDevtoolsFactory,
  COMPILER_RENAMEABLE_KEYS,
  type ExternalTypeSources,
  type PreExtractedSchemas,
} from '@llui/compiler'
import { transformUseClientSsr, hasUseClientDirective } from '@llui/compiler-ssr'
import { introspectionFactory } from '@llui/compiler-introspection'
import { devtoolsFactory } from '@llui/compiler-devtools'

// Register opt-in module factories at plugin-import time.
// @llui/compiler doesn't depend on its sibling packages (would
// create a workspace cycle), so the host wires them.
registerIntrospectionFactory(introspectionFactory)
registerDevtoolsFactory(devtoolsFactory)
import { createCaptureRegistry } from './notes/capture-registry.js'
import { createEventBus } from './notes/event-bus.js'
import { createNotesMiddleware } from './notes/middleware.js'
import type { NoteFormatConfig } from './notes/store.js'
import {
  isCliAvailable,
  startRouter,
  type LlmPreset,
  type LlmRouterConfig,
} from './notes/router.js'
import {
  findTypeSource,
  readComponentTypeArgNames,
  extractMsgAnnotationsCrossFile,
  extractDiscriminatedUnionSchemaCrossFile,
  type ResolveContext,
} from '@llui/compiler'
import ts from 'typescript'

/**
 * Pre-resolution step run before `transformLlui`. Scans the source for
 * `component<State, Msg, Effect>(...)` calls; for each type argument that
 * is an identifier (the common case), walks imports and re-exports to
 * find the source file declaring that alias. The result is plumbed into
 * `transformLlui` so the schema/annotation extractors operate on the
 * declaring file's source instead of silently returning `null` when the
 * type lives in a separate file.
 *
 * Returns `undefined` (no external sources) when:
 *   - No `component<...>()` call is in the file
 *   - No type arguments are identifiers we can chase
 *   - All type arguments are declared locally (the resolver returns the
 *     same source we already have, so external sources are redundant)
 *
 * `resolveModule` comes from Rollup's `this.resolve()`; we wrap it to
 * return the absolute id (or null when unresolved) and read the source
 * via `fs/promises.readFile`.
 */
async function preResolveTypeSources(
  source: string,
  filePath: string,
  rollupResolve: (
    spec: string,
    importer: string,
  ) => Promise<{ id: string; external?: boolean | 'absolute' | 'relative' } | null>,
): Promise<ExternalTypeSources | undefined> {
  // Cheap filter: nothing to resolve unless the file contains a
  // component<...>() call. Avoids parsing every TS file in the project.
  if (!/\bcomponent\s*</.test(source)) return undefined

  // Find the first component<...>() call and read its type arg names.
  // Multiple component() calls in one file would each technically need
  // their own type-arg lookup; we resolve based on the first call and
  // accept the (rare) edge case where two component() calls in one file
  // use different non-local Msg types. The lint rule catches divergence.
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true)
  const args = findFirstComponentTypeArgs(sf)
  if (!args) return undefined

  const ctx: ResolveContext = {
    resolveModule: async (spec, importer) => {
      const result = await rollupResolve(spec, importer)
      if (!result || result.external) return null
      // Rollup ids can include query/hash suffixes for virtual modules;
      // strip those so fs.readFile sees a real path. Also skip files
      // outside our control (node_modules) — we don't want to follow
      // imports into third-party packages just to scrape types.
      const idStripped = result.id.split('?')[0]?.split('#')[0]
      if (!idStripped) return null
      if (idStripped.includes('/node_modules/')) return null
      return idStripped
    },
    readSource: async (p) => {
      return await readFile(p, 'utf8')
    },
  }

  // Helper to resolve one type-arg name into an external source if it
  // isn't declared locally (or if the resolver chases through imports).
  const resolve = async (
    typeName: string | null,
  ): Promise<{ source: string; typeName: string } | undefined> => {
    if (!typeName) return undefined
    const found = await findTypeSource(typeName, source, filePath, ctx)
    if (!found) return undefined
    // If the alias was declared locally, the existing extractor path
    // already handles it — no need to populate external sources.
    if (found.filePath === filePath) return undefined
    return { source: found.source, typeName: found.localName }
  }

  const [state, msg, effect] = await Promise.all([
    resolve(args.state),
    resolve(args.msg),
    resolve(args.effect),
  ])

  if (!state && !msg && !effect) return undefined
  return { state, msg, effect }
}

/**
 * Cross-file + composition-aware schema extraction. The extractors
 * follow imports/re-exports AND walk into TypeReferences inside Msg /
 * Effect unions, so a developer who organises types as
 * `type Msg = ImportedFoo | { type: 'extra' }` gets every variant in
 * `__msgAnnotations` and `__msgSchema`. Without this step the
 * file-local sync extractors would silently emit half-annotations
 * (only the inline TypeLiteral members) — the worst kind of failure
 * mode because the build appears to succeed.
 *
 * Returns `undefined` (no pre-extraction) when there's no
 * `component()` call to resolve types for.
 */
async function preExtractCompositional(
  source: string,
  filePath: string,
  rollupResolve: (
    spec: string,
    importer: string,
  ) => Promise<{ id: string; external?: boolean | 'absolute' | 'relative' } | null>,
): Promise<PreExtractedSchemas | undefined> {
  if (!/\bcomponent\s*</.test(source)) return undefined
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true)
  const args = findFirstComponentTypeArgs(sf)
  if (!args) return undefined
  // No identifier type args at all → nothing for the resolver to chase.
  if (!args.msg && !args.effect && !args.state) return undefined

  const ctx: ResolveContext = {
    resolveModule: async (spec, importer) => {
      const result = await rollupResolve(spec, importer)
      if (!result || result.external) return null
      const idStripped = result.id.split('?')[0]?.split('#')[0]
      if (!idStripped) return null
      if (idStripped.includes('/node_modules/')) return null
      return idStripped
    },
    readSource: async (p) => readFile(p, 'utf8'),
  }

  const [msgAnnotations, msgSchema, effectSchema] = await Promise.all([
    args.msg
      ? extractMsgAnnotationsCrossFile(source, args.msg, filePath, ctx)
      : Promise.resolve(null),
    args.msg
      ? extractDiscriminatedUnionSchemaCrossFile(source, args.msg, filePath, ctx)
      : Promise.resolve(null),
    args.effect
      ? extractDiscriminatedUnionSchemaCrossFile(source, args.effect, filePath, ctx)
      : Promise.resolve(null),
  ])

  // Only return a populated payload when we actually extracted
  // something useful. Returning `undefined` lets transformLlui fall
  // back to its file-local extractors, which is the right behavior
  // for the (rare) case where every type the resolver sees is
  // unreachable.
  if (msgAnnotations === null && msgSchema === null && effectSchema === null) return undefined

  // Note: state schema isn't a discriminated union, so composition
  // doesn't apply. We leave state on the simpler `typeSources` path
  // (already plumbed through preResolveTypeSources) which the
  // file-local `extractStateSchema` consumes.
  const out: PreExtractedSchemas = {}
  if (msgAnnotations !== null) out.msgAnnotations = msgAnnotations
  if (msgSchema !== null) out.msgSchema = msgSchema
  if (effectSchema !== null) out.effectSchema = effectSchema
  return out
}

function findFirstComponentTypeArgs(
  sf: ts.SourceFile,
): { state: string | null; msg: string | null; effect: string | null } | null {
  let result: ReturnType<typeof readComponentTypeArgNames> | null = null
  const visit = (node: ts.Node): boolean => {
    if (result) return true
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'component' &&
      node.typeArguments
    ) {
      result = readComponentTypeArgNames(node)
      return true
    }
    let stopped = false
    ts.forEachChild(node, (child) => {
      if (stopped) return
      if (visit(child)) stopped = true
    })
    return stopped
  }
  ts.forEachChild(sf, (child) => {
    visit(child)
  })
  return result
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
   * Emit `[llui]`-prefixed `console.info` logs for every transformed
   * component file — state-path bit assignments, mask injections, and
   * helper compile/bail counts. Useful when diagnosing why a binding
   * isn't gated the way you expect, or why a call fell back from
   * template-clone to `elSplit`. Off by default.
   */
  verbose?: boolean

  /**
   * Enables two things together when set:
   *
   *   1. Emits schemas + binding descriptors in prod builds so the
   *      @llui/agent runtime has metadata to advertise over its WS hello
   *      frame (see agent spec §7.4).
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
   * Opt-in cross-file accessor walking (v2c pipeline integration of v2b's
   * cross-file walker). When enabled, the plugin builds a `ts.Program`
   * over the project at `configResolved` and feeds each `transform` call
   * the cross-file paths read through in-repo view-helpers — replacing
   * the v0.x sentinel-`show()` workaround for helpers in sibling files.
   *
   * Prototype-grade caveats:
   *   - The Program builds once at startup; it does NOT refresh on file
   *     change. HMR-edited files see stale cross-file edges until the
   *     next dev-server restart. (v2c's module decomposition lands the
   *     proper incremental Program; this is the v2b pipeline-integration
   *     deferral.)
   *   - The Program covers `.ts` / `.tsx` files reachable from the Vite
   *     project root's `tsconfig.json`. Out-of-project imports are not
   *     followed; manifest-driven library helpers cover those in
   *     `@llui/cli publish-deps` (v2c, deferred).
   *   - The walker emits `llui/opaque-view-call` diagnostics for helpers
   *     it can't classify; in dev these surface as Vite warnings. Set
   *     `crossFile: 'silent'` to suppress the diagnostics while still
   *     getting the path merging.
   *
   * Default `'silent'` — paths read through in-file-graph helpers
   * (`(s) => s.route.kind` from a predicate helper, etc.) are folded
   * into the host component's `__prefixes` automatically, without
   * polluting dev logs with opaque-call diagnostics. Set `crossFile:
   * true` to surface the diagnostics in dev, or `false` to disable
   * cross-file resolution entirely (saves the startup Program build
   * cost on very large repos; falls back to per-file analysis).
   */
  crossFile?: boolean | 'silent'

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
   *  - `false` — disable. The HUD hides its "Solve" button; notes
   *              still save to disk so MCP-side consumers can act on
   *              them.
   *  - `'claude' | 'codex' | 'gemini'` — preset; everything defaults.
   *  - `LlmRouterConfig` — preset + overrides (model, timeoutMs,
   *              concurrency, env, extraArgs), or a fully custom
   *              invocation `{ command, args, promptVia }` (omit
   *              `preset` to opt out of preset defaults entirely).
   *
   * When the chosen CLI isn't on PATH the router degrades silently
   * to save-only and the HUD hides the Solve button — the user gets
   * a one-line install hint in the console.
   *
   * Default: `'claude'`.
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
 * Resolve `@llui/devmode-annotate`'s ESM entry point against the plugin's
 * own location, so it works without the consumer adding it to their
 * package.json — it ships as a direct dep of `@llui/vite-plugin` and we
 * inject an absolute file path into the dev HTML. Uses ESM's
 * `import.meta.resolve` (sync, Node 20+) so the package's `exports`
 * map only needs an `import` condition. Returns null only when the
 * install is broken (the dep is declared but the file isn't there).
 */
function resolveDevmodeAnnotateEntry(): string | null {
  try {
    const url = import.meta.resolve('@llui/devmode-annotate')
    return fileURLToPath(url)
  } catch {
    return null
  }
}

/**
 * Normalize the user's `router` setting into the public `LlmRouterConfig`
 * shape (or null when disabled). Accepts `false`, a preset string, or
 * a full config object. Used in `configResolved` so the rest of the
 * plugin (router startup + HUD bootstrap) sees one canonical shape.
 */
function resolveRouterInput(
  router: false | LlmPreset | LlmRouterConfig | undefined,
  legacyTimeoutMs: number | undefined,
): LlmRouterConfig | null {
  if (router === false) return null
  if (router === undefined) {
    return legacyTimeoutMs ? { preset: 'claude', timeoutMs: legacyTimeoutMs } : { preset: 'claude' }
  }
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
 * Detects when the consumer has `@llui/devmode-annotate` listed in their
 * own package.json. The HUD now ships with `@llui/vite-plugin`, so a
 * direct declaration is redundant — and worse, it pins a possibly-
 * older version that diverges from what the plugin loads. Logged once
 * during `configResolved` as a removal hint.
 */
function declaresDevmodeAnnotateDirectly(root: string): boolean {
  try {
    const pkgPath = resolve(root, 'package.json')
    if (!existsSync(pkgPath)) return false
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
    }
    return (
      Boolean(pkg.dependencies?.['@llui/devmode-annotate']) ||
      Boolean(pkg.devDependencies?.['@llui/devmode-annotate']) ||
      Boolean(pkg.peerDependencies?.['@llui/devmode-annotate']) ||
      Boolean(pkg.optionalDependencies?.['@llui/devmode-annotate'])
    )
  } catch {
    return false
  }
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
  // Set when the transform hook lowers a signal component (which routes around
  // the legacy compiler, so it never carries the `__lluiCompilerEmitted` marker).
  // The build-time integrity check uses this so a pure-signal bundle passes.
  let sawSignalComponent = false
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
  const verbose = options.verbose === true
  const agent = options.agent ?? false
  const transitions = options.transitions ?? false
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

  // Resolved router state. `resolvedRouter` is non-null when the
  // attention router should run; `solveEnabled` is the boolean signal
  // sent to the HUD so it conditionally renders the "Solve" button.
  // Computed once in configResolved; consumed by configureServer
  // (which calls startRouter) and the HUD bootstrap JSON.
  let resolvedRouter: LlmRouterConfig | null = null
  let solveEnabled = false

  // File-based handshake with @llui/mcp. The MCP server writes a marker
  // file when its bridge starts; we watch it and send a Vite HMR custom
  // event so the browser can call __lluiConnect() automatically — without
  // retry spam, regardless of whether MCP or Vite started first.
  const activeFilePath = resolve(findWorkspaceRoot(), 'node_modules/.cache/llui-mcp/active.json')
  let mcpWatcher: FSWatcher | null = null
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
      // The floating-button HUD ships as a direct dep of this plugin.
      // In dev mode we resolve its entry against the plugin's own
      // location and inject a <script type="module"> that mounts it
      // against the running app — the consumer doesn't add anything
      // to their package.json. Disable via `devmodeAnnotate: false`
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
          hudEntryPath = resolveDevmodeAnnotateEntry()
          if (hudEntryPath) {
            hudInjectEnabled = true
            const forwarded: HudInjectionConfig = typeof hudCfg === 'object' ? hudCfg : {}
            hudOptionsJson = JSON.stringify({
              ...(forwarded.hidden ? { hidden: true } : {}),
              solveEnabled,
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
              '[llui:devmode-annotate] HUD not injected — `@llui/devmode-annotate` could not be resolved\n' +
                '                        from the plugin location. Reinstall or set `devmodeAnnotate: { hud: false }`.\n',
            )
          }
        }
        // Warn when the consumer redundantly lists `@llui/devmode-annotate`
        // in their own package.json. The HUD ships with this plugin now;
        // a direct entry pins a (possibly older) duplicate version and
        // adds nothing.
        if (declaresDevmodeAnnotateDirectly(config.root)) {
          process.stderr.write(
            '[llui:devmode-annotate] `@llui/devmode-annotate` is listed in your package.json — remove it.\n' +
              '                        It ships with `@llui/vite-plugin`; a direct entry is redundant and\n' +
              '                        risks pinning a stale version. Drop the dep and run install again.\n',
          )
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
        const notesHandler = createNotesMiddleware({
          notesRoot,
          bus: notesBus,
          registry: notesRegistry,
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
        mcpWatcher?.close()
        dirWatcher?.close()
        mcpWatcher = null
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
        if (!devMode || !hudInjectEnabled) return
        return [
          {
            tag: 'script',
            attrs: { type: 'module', src: `/@id/__x00__${HUD_VMOD_ID}` },
            injectTo: 'body',
          },
        ]
      },
    },

    async transform(code, id, options) {
      if (!id.endsWith('.ts') && !id.endsWith('.tsx')) return

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
          return { code: result.output, map: { mappings: '' } }
        }
      }

      // Signal components: if this file uses the signal authoring surface
      // (a `view: ({ state, … }) => [...]` bag with `state.at(…)`), lower it to
      // the `@llui/dom/signals` runtime and SKIP the legacy accessor compiler.
      // A file is either signal-flavored or legacy (per-file-flip migration).
      // Cheap string pre-check avoids the extra parse on non-signal files.
      // A SIGNAL FILE: imports the @llui/dom/signals surface and has a component.
      // (No `.at()` requirement — a signal component may use only `.map()` or a
      // static view; importing the signals surface + `component(` is unambiguous.)
      // The transform LOWERS the direct view (an optimization); anything it can't
      // lower (view-helper functions, block bodies) runs via the runtime authoring
      // helpers (text/el/each/… consume runtime signal handles). We always: enforce
      // lint, lower-what-we-can, inject the relay, and SKIP the legacy compiler.
      if (/component\s*[<(]/.test(code) && /from\s*['"]@llui\/dom\/signals['"]/.test(code)) {
        sawSignalComponent = true
        // Enforce signal lint rules as build errors (the only effective channel —
        // see CLAUDE.md). Lint the AUTHORED source; `this.error` throws → halts.
        const lintMsgs = lintSignalSource(code, id)
        if (lintMsgs.length > 0) {
          const rel = relative(crossFileRoot ?? process.cwd(), id)
          const display = rel.length > 0 && !rel.startsWith('..') ? rel : id
          const first = lintMsgs[0]!
          const body = lintMsgs
            .map((m) => `  ${display}:${m.line}:${m.column}  [${m.rule}] ${m.message}`)
            .join('\n')
          this.error({
            message: `[llui] signal lint failed (${lintMsgs.length} error${
              lintMsgs.length > 1 ? 's' : ''
            }):\n${body}`,
            loc: { file: id, line: first.line, column: first.column },
          })
        }
        // Resolve cross-file Msg/State/Effect types (same machinery the legacy
        // path uses) so types in sibling files still produce full agent metadata.
        const wantMeta = Boolean(agent) || devMode
        let signalTypeSources: ExternalTypeSources | undefined
        let signalPreExtracted: PreExtractedSchemas | undefined
        if (wantMeta && typeof this.resolve === 'function') {
          const rr = this.resolve.bind(this)
          ;[signalTypeSources, signalPreExtracted] = await Promise.all([
            preResolveTypeSources(code, id, rr),
            preExtractCompositional(code, id, rr),
          ])
        }
        let out = transformSignalComponentSource(code, {
          emitAgentMetadata: Boolean(agent),
          devMode,
          fileName: id,
          preExtracted: signalPreExtracted,
          typeSources: signalTypeSources?.state ? { state: signalTypeSources.state } : undefined,
        })
        // Dev + MCP: signal files bypass the legacy compiler that injects the
        // relay, so inject startRelay (guarded to fire once) + the HMR handshake.
        if (devMode && mcpPort !== null) {
          out =
            `import { startRelay as __llui_startRelay } from '@llui/dom/devtools'\n` +
            `if (!globalThis.__lluiRelayStarted) { globalThis.__lluiRelayStarted = true; __llui_startRelay(${mcpPort})\n` +
            `  if (import.meta.hot) import.meta.hot.on('llui:mcp-ready', (d) => { if (typeof globalThis.__lluiConnect === 'function') globalThis.__lluiConnect(d?.port) }) }\n` +
            out
        }
        return { code: out, map: { mappings: '' } }
      }

      // Non-signal `.ts`/`.tsx` files pass through untouched. The legacy
      // accessor compiler was removed in the signal-runtime migration; the
      // signal branch above is now the only compilation path.
      return undefined
    },

    // Build-time integrity check (v2a §2.4; shared.md §20.12). Every
    // compiled component carries `__lluiCompilerEmitted: 1`; we scan the
    // final bundle for that literal text. Zero occurrences in a production
    // build means the project routed its TS through some other pipeline
    // and the runtime would silently degrade to FULL_MASK — fail closed.
    //
    // Dev mode skips the check: dev users have HMR + warnings to find
    // misconfiguration interactively. SSR builds also skip — the SSR
    // pass may emit a stub module bundle that legitimately contains no
    // components.
    //
    // ANTI-RECIPE — property-mangling the `__`-prefixed compiler-emit
    // fields (`__view`, `__prefixes`, `__handlers`, …) saves 570–1,406
    // bytes gz on the jfb bench bundle but empirically regresses
    // keyed-each ops (Update 10th, Select, Swap) by 35–58 %. Verified
    // 2026-05-20 across three measurements with both terser and
    // esbuild-post-process implementations; perf cost holds even with
    // `compress: false`. Property renames should be V8-transparent in
    // theory; in practice V8's optimizer on the jfb shape produces
    // measurably slower code on the mangled bundle. Do NOT mangle
    // these names unless someone first identifies why and produces a
    // mangle-safe implementation. See commit d2855d7 (landed) +
    // b63a6ef (reverted) for the full attempt.
    generateBundle(opts, bundle) {
      if (devMode) return
      if (opts.dir === undefined && opts.file === undefined) return
      // The `ssr` flag on the output options is the cleanest signal for
      // SSR builds; rollup adds it when Vite's build.ssr is set.
      if ((opts as { ssr?: boolean }).ssr) return
      let markerCount = 0
      let viewCount = 0
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue
        // Count literal occurrences of the marker. `__lluiCompilerEmitted`
        // is unique enough that false positives from user source are
        // implausible.
        const code = chunk.code
        let from = 0
        while (true) {
          const i = code.indexOf('__lluiCompilerEmitted', from)
          if (i < 0) break
          markerCount++
          from = i + '__lluiCompilerEmitted'.length
        }
        // Count `__view` companion-marker occurrences in the same pass.
        // The compiler injects exactly one `__view: ...` per stamped
        // component. A stamped call missing `__view` would otherwise
        // crash at mount with the "missing __view despite being compiled"
        // throw from `getInstanceViewBag` — catching it here surfaces the
        // problem at build, with the file context that produced it still
        // in scope. Anchored on `__view:` to exclude prose mentions and
        // the `__view$` rename-allow-list entry.
        from = 0
        while (true) {
          const i = code.indexOf('__view:', from)
          if (i < 0) break
          viewCount++
          from = i + '__view:'.length
        }
      }
      if (markerCount === 0 && !sawSignalComponent) {
        // `this.error` throws — no statements below this line execute.
        this.error(
          '[llui] integrity check failed: no compiled `component()` calls found in ' +
            'this bundle. Either the project has no LLui components (remove ' +
            '`@llui/vite-plugin` from vite.config.ts), or the plugin order is wrong ' +
            'and another transform is consuming TS before `@llui/vite-plugin` runs ' +
            "(check `enforce: 'pre'`). The check looks for the `__lluiCompilerEmitted` " +
            'property the compiler injects into every component. See ' +
            'docs/proposals/v2-compiler/v2a.md §2.4.',
        )
      }
      if (viewCount < markerCount) {
        // Stamped-but-incomplete: a component() call carries the
        // `__lluiCompilerEmitted` / `__compilerVersion` markers but is
        // missing its `__view` synthesis. Pre-fix this happened when
        // `view:` was shorthand or an identifier reference that
        // `injectViewBag` couldn't introspect; the bug surfaced as a
        // runtime throw at mount. The symmetric check fails the build
        // instead so any future regression of the same shape is caught
        // before it reaches users.
        this.error(
          `[llui] integrity check failed: ${markerCount} compiled \`component()\` ` +
            `call(s) but only ${viewCount} \`__view\` synthesis marker(s) — ` +
            `${markerCount - viewCount} component(s) were stamped without a ` +
            `\`__view\` factory. This usually means a \`component()\` call was ` +
            'missing a `view` property, or the compiler bailed on an unexpected ' +
            'view-property shape. File a bug at @llui/compiler.',
        )
      }
      // Integrity check passed. The marker is a build-time signal only —
      // no runtime path reads it — so strip it from the final chunks to
      // reclaim ~25 bytes per compiled `component()`. Handles both the
      // `, __lluiCompilerEmitted: 1` (preceded-by-comma) and
      // `__lluiCompilerEmitted: 1,` (followed-by-comma) shapes; a bare
      // marker on its own (no surrounding comma) falls through to the
      // standalone replacement. The regex is anchored on the literal
      // property name + colon + 1 so it can't accidentally match other
      // identifiers that contain the substring.
      const STRIP_WITH_PRECEDING_COMMA = /,\s*__lluiCompilerEmitted:\s*1/g
      const STRIP_WITH_TRAILING_COMMA = /__lluiCompilerEmitted:\s*1\s*,/g
      const STRIP_STANDALONE = /__lluiCompilerEmitted:\s*1/g
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue
        chunk.code = chunk.code
          .replace(STRIP_WITH_PRECEDING_COMMA, '')
          .replace(STRIP_WITH_TRAILING_COMMA, '')
          .replace(STRIP_STANDALONE, '')
      }

      // Compiler-emit property rename pass. The compiler injects
      // descriptive names like `__view` / `__prefixes` / `__handlers`
      // for the runtime's reactive bookkeeping; production bundles
      // don't need the self-documenting names. Rename to `$a` /
      // `$b` / `$c` etc. — `$` is a valid identifier-start char,
      // uncommon as a property prefix in the surrounding heap
      // (jQuery's `$` is a global, RxJS uses `$` as a suffix), so
      // it preserves the heap-uniqueness that an esbuild/terser-
      // style single-char mangle lacked (which regressed jfb's
      // keyed-each ops; see ANTI-RECIPE comment above the
      // integrity check). `$X` saves 1 char per occurrence vs the
      // `__X` form this pass shipped at Tier 21.
      //
      // Allow-list approach: rename ONLY the specific `__`-prefixed
      // identifiers the LLui compiler is known to emit. Other tools
      // sharing the `__` convention — Vite's `__vite__mapDeps`, Vike's
      // `__VIKE__NOT_SERIALIZABLE__` marker, user-defined `__LLUI_STATE__`
      // hydration containers, the test-fixture `__test__` sentinel string
      // value — must pass through unmolested. A deny-list approach
      // (rename everything, exempt some) shipped at Tier 21 broke vike
      // SSR builds because the deny-list missed Vite/Vike internals
      // that didn't appear in the smaller bench bundle.
      //
      // The list is sourced from `@llui/compiler`'s
      // `COMPILER_RENAMEABLE_KEYS` constant — the single declaration of
      // "names that are safe to property-rename." Compiler-emitted
      // runtime helpers (`__bindUncertain`, `__cloneStaticTemplate`,
      // `__runPhase2`, `__handleMsg`, `__registerScopeVariants`,
      // `__clientOnlyStub`) are intentionally NOT in this list: they
      // travel through module imports, and rewriting the import
      // specifier (`from '@llui/dom/internal'`) against the original
      // export name produces a `MISSING_EXPORT` rolldown error on any
      // build that externalizes `@llui/dom/internal` (Vike SSR being
      // the common case). The compiler/dom contract puts them on the
      // `/internal` subpath; the rename invariant keeps them off the
      // rename list. A type-level disjointness assertion in
      // emit-names.ts enforces "renameable" ∩ "internal-import" = ∅.
      const RENAME_TARGETS = new Set<string>(COMPILER_RENAMEABLE_KEYS)
      const RENAME_PATTERN = /\b__[A-Za-z_][A-Za-z0-9_]*\b/g
      const counts = new Map<string, number>()
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue
        for (const m of chunk.code.matchAll(RENAME_PATTERN)) {
          const name = m[0]
          if (!RENAME_TARGETS.has(name)) continue
          counts.set(name, (counts.get(name) ?? 0) + 1)
        }
      }
      // Skip the pass entirely if nothing to rename — avoids the regex
      // compile + chunk rewrite for apps that don't emit any
      // compiler-internal fields (none in practice; ComponentDef
      // always carries at least `__prefixes` / `__view`).
      if (counts.size > 0) {
        // Order by total bytes saved per name (length × occurrence)
        // descending, so the most-used names get the shortest
        // replacements.
        const ranked = [...counts.entries()].sort(
          (a, b) => (b[0].length - 3) * b[1] - (a[0].length - 3) * a[1],
        )
        const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
        const shortNameAt = (i: number): string => {
          let s = ''
          do {
            s = ALPHABET[i % 52] + s
            i = Math.floor(i / 52) - 1
          } while (i >= 0)
          // `$` prefix instead of `__` — saves 1 char per occurrence and
          // is uncommon enough as a property prefix in the surrounding
          // JS heap (jQuery's `$` is a global identifier, RxJS uses `$`
          // as a SUFFIX) to keep cache-collision risk low.
          return '$' + s
        }
        const renames = new Map<string, string>()
        for (let i = 0; i < ranked.length; i++) {
          renames.set(ranked[i]![0], shortNameAt(i))
        }
        // Build one alternation regex so each chunk is rewritten in a
        // single pass — eliminates the collision risk where a newly
        // assigned short name (`__b`) could match an as-yet-unrenamed
        // original (`__b` from a prior pass).
        const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const alternation = [...renames.keys()].map(escapeRe).join('|')
        const replacer = new RegExp(`\\b(${alternation})\\b`, 'g')
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== 'chunk') continue
          chunk.code = chunk.code.replace(replacer, (match) => renames.get(match) ?? match)
        }
      }
    },
  }
}
