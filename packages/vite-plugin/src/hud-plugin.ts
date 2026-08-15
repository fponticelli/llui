import type { Plugin } from 'vite'
import type { LluiPluginState } from './shared-state.js'

const HUD_VMOD_ID = 'virtual:llui-devmode-annotate-init'
const HUD_VMOD_RESOLVED_ID = '\0' + HUD_VMOD_ID

export function createHudPlugin(state: LluiPluginState) {
  return {
    name: 'llui:hud',
    enforce: 'pre',

    resolveId(id) {
      if (id === HUD_VMOD_ID) return HUD_VMOD_RESOLVED_ID
      return undefined
    },

    load(id) {
      if (id !== HUD_VMOD_RESOLVED_ID) return undefined
      if (!state.hudInjectEnabled || !state.hudEntryPath) return 'export {}'
      return [
        `import { mountAnnotateHud } from ${JSON.stringify(state.hudEntryPath)}`,
        `mountAnnotateHud(${state.hudOptionsJson})`,
      ].join('\n')
    },

    transformIndexHtml: {
      order: 'pre',
      handler() {
        if (!state.devMode || !state.hudInjectEnabled || !state.hudHtmlInject) return
        return [
          {
            tag: 'script',
            attrs: { type: 'module', src: `/@id/__x00__${HUD_VMOD_ID}` },
            injectTo: 'body',
          },
        ]
      },
    },
  } satisfies Plugin
}
