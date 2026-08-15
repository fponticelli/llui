import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { createCompilePlugin } from './compile-plugin.js'
import { createConfigPlugin } from './config-plugin.js'
import { createDevServerPlugin } from './dev-server-plugin.js'
import { createHudPlugin } from './hud-plugin.js'
import { mcpStateDir } from './plugin-helpers.js'
import { createPluginState } from './shared-state.js'
import type { LluiPluginOptions } from './plugin-options.js'

export type {
  AgentPluginConfig,
  DevmodeAnnotateConfig,
  HudInjectionConfig,
  LluiPluginOptions,
} from './plugin-options.js'
export { resolveRouterInput } from './plugin-helpers.js'

// Re-export the shared notebook types used by the HUD and MCP server.
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

// Compose LLui's four named plugins while preserving the original public
// `Plugin` return type. The array is the value Vite flattens; the compatibility
// properties preserve the established direct-hook seam used by consumers and
// the package's characterization tests. They are properties of the array, not
// a fifth array element, so Vite never schedules them as another plugin.
export default function llui(options: LluiPluginOptions = {}): Plugin {
  const state = createPluginState(options, resolve(mcpStateDir(), 'active.json'))
  const config = createConfigPlugin(state)
  const devServer = createDevServerPlugin(state)
  const hud = createHudPlugin(state)
  const compile = createCompilePlugin(state)
  const plugins: Plugin[] = [config, devServer, hud, compile]

  const compatibilitySurface = {
    name: 'llui',
    enforce: 'pre' as const,
    config: config.config,
    configResolved: config.configResolved,
    configureServer: devServer.configureServer,
    resolveId: hud.resolveId,
    load: hud.load,
    transformIndexHtml: hud.transformIndexHtml,
    handleHotUpdate: compile.handleHotUpdate,
    transform: compile.transform,
    generateBundle: compile.generateBundle,
  } satisfies Plugin

  const composed = Object.assign(plugins, compatibilitySurface)
  for (const key of Object.keys(compatibilitySurface)) {
    Object.defineProperty(composed, key, { enumerable: false })
  }
  const publicPlugin: Plugin = composed
  return publicPlugin
}
