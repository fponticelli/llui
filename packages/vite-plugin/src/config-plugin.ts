import type { Plugin } from 'vite'
import { isCliAvailable } from './notes/router.js'
import type { HudInjectionConfig } from './plugin-options.js'
import type { LluiPluginState } from './shared-state.js'
import {
  hasMcpPackage,
  resolveDevmodeAnnotateEditorEntry,
  loadAgentServer,
  resolveDevmodeAnnotateEntry,
  resolveMcpCliPath,
  resolveRouterInput,
} from './plugin-helpers.js'

export function createConfigPlugin(state: LluiPluginState) {
  return {
    name: 'llui:config',
    enforce: 'pre',

    config() {
      return {
        define: {
          __LLUI_AGENT__: JSON.stringify(Boolean(state.agent)),
          __LLUI_TRANSITIONS__: JSON.stringify(Boolean(state.transitions)),
        },
      }
    },

    async configResolved(config) {
      state.devMode = config.command === 'serve' || config.mode === 'development'
      state.crossFileRoot = config.root
      if (state.agent && state.devMode) {
        state.agentServer = await loadAgentServer(config.root, state.agentConfig)
      }

      if (state.devMode && state.options.devmodeAnnotate !== false) {
        const annotateConfig =
          typeof state.options.devmodeAnnotate === 'object' ? state.options.devmodeAnnotate : {}
        state.resolvedRouter = resolveRouterInput(
          annotateConfig.router,
          annotateConfig.routerTimeoutMs,
        )
        if (state.resolvedRouter) {
          const preset = state.resolvedRouter.preset ?? 'claude'
          const cliName =
            state.resolvedRouter.command ??
            (preset === 'claude' ? 'claude' : preset === 'codex' ? 'codex' : 'gemini')
          state.solveEnabled = isCliAvailable(cliName)
          if (!state.solveEnabled) {
            process.stderr.write(
              `[llui:router] '${cliName}' not found on PATH — task notes will be saved but not auto-solved.\n` +
                `              The HUD will hide its "Solve" button. Install the CLI or set\n` +
                `              \`devmodeAnnotate: { router: false }\` to silence.\n`,
            )
          }
        }

        const hudConfig = annotateConfig.hud
        if (hudConfig !== false) {
          state.hudEntryPath = resolveDevmodeAnnotateEntry(config.root)
          if (state.hudEntryPath) {
            state.hudEditorEntryPath = resolveDevmodeAnnotateEditorEntry(config.root)
            state.hudInjectEnabled = true
            const vikePresent = (config.plugins ?? []).some(
              (plugin) => typeof plugin?.name === 'string' && plugin.name.startsWith('vike'),
            )
            state.hudHtmlInject = !vikePresent
            if (vikePresent) {
              process.stderr.write(
                '[llui:devmode-annotate] Vike detected — the dev HUD is not auto-injected into the\n' +
                  '                        HTML (Vike owns the document pipeline). Mount it from your\n' +
                  '                        document template, or set `devmodeAnnotate: { hud: false }` to silence.\n',
              )
            }
            const forwarded: HudInjectionConfig = typeof hudConfig === 'object' ? hudConfig : {}
            state.hudOptionsJson = JSON.stringify({
              ...(forwarded.hidden ? { hidden: true } : {}),
              solveEnabled: state.solveEnabled,
              ...(state.solveEnabled ? { taskCapabilityToken: state.taskCapabilityToken } : {}),
              rehydrate: true,
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

      if (state.options.mcpPort === false) {
        state.mcpMode = 'disabled'
        state.mcpPort = null
      } else if (typeof state.options.mcpPort === 'number') {
        state.mcpMode = 'wire'
        state.mcpPort = state.options.mcpPort
      } else if (hasMcpPackage(config.root)) {
        state.mcpCliPath = resolveMcpCliPath(config.root)
        if (state.mcpCliPath) {
          state.mcpMode = 'spawn'
          state.mcpPort = 5200
        } else {
          state.mcpMode = 'wire'
          state.mcpPort = 5200
        }
      } else {
        state.mcpMode = 'disabled'
        state.mcpPort = null
      }
    },
  } satisfies Plugin
}
