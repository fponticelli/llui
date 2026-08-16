import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { stat } from 'node:fs/promises'
import type { ChildProcess } from 'node:child_process'
import type { FSWatcher } from 'node:fs'
import type { LlmRouterConfig } from './notes/router.js'
import type { AgentPluginConfig, LluiPluginOptions } from './plugin-options.js'

export type AgentServerInstance = {
  router: (req: Request) => Promise<Response | null>
  wsUpgrade: (
    req: import('http').IncomingMessage,
    socket: import('stream').Duplex,
    head: Buffer,
  ) => void
}

export interface LluiPluginState {
  readonly options: LluiPluginOptions
  readonly agent: boolean | AgentPluginConfig
  readonly agentConfig: AgentPluginConfig
  readonly transitions: boolean
  readonly perfDiagnosticsOpt: boolean | undefined
  readonly taskCapabilityToken: string
  devMode: boolean
  sawSignalComponent: boolean
  crossFileRoot: string | null
  agentServer: AgentServerInstance | null
  hudInjectEnabled: boolean
  hudEntryPath: string | null
  hudEditorEntryPath: string | null
  hudOptionsJson: string
  hudHtmlInject: boolean
  resolvedRouter: LlmRouterConfig | null
  solveEnabled: boolean
  mcpPort: number | null
  mcpMode: 'disabled' | 'wire' | 'spawn'
  mcpCliPath: string | null
  mcpChild: ChildProcess | null
  activeFilePath: string
  dirWatcher: FSWatcher | null
  cachedDevUrl: string | null
  readonly typeFileImporters: Map<string, Set<string>>
  readSourceCached(path: string): Promise<string>
}

export function createPluginState(
  options: LluiPluginOptions,
  activeFilePath: string,
): LluiPluginState {
  const sourceContentCache = new Map<string, { mtimeMs: number; content: string }>()

  return {
    options,
    agent: options.agent ?? false,
    agentConfig: typeof options.agent === 'object' ? options.agent : {},
    transitions: options.transitions ?? false,
    perfDiagnosticsOpt: options.perfDiagnostics,
    taskCapabilityToken: randomBytes(32).toString('hex'),
    devMode: false,
    sawSignalComponent: false,
    crossFileRoot: null,
    agentServer: null,
    hudInjectEnabled: false,
    hudEntryPath: null,
    hudEditorEntryPath: null,
    hudOptionsJson: '{}',
    hudHtmlInject: false,
    resolvedRouter: null,
    solveEnabled: false,
    mcpPort: null,
    mcpMode: 'disabled',
    mcpCliPath: null,
    mcpChild: null,
    activeFilePath,
    dirWatcher: null,
    cachedDevUrl: null,
    typeFileImporters: new Map(),
    async readSourceCached(path) {
      try {
        const fileStat = await stat(path)
        const cached = sourceContentCache.get(path)
        if (cached && cached.mtimeMs === fileStat.mtimeMs) return cached.content
        const content = await readFile(path, 'utf8')
        sourceContentCache.set(path, { mtimeMs: fileStat.mtimeMs, content })
        return content
      } catch {
        return readFile(path, 'utf8')
      }
    },
  }
}
