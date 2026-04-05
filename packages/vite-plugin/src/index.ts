import type { Plugin } from 'vite'
import MagicString from 'magic-string'
import { transformLlui } from './transform.js'
import { diagnose } from './diagnostics.js'

export interface LluiPluginOptions {
  /**
   * Port for the MCP debug bridge. In dev mode, the runtime relay connects
   * to `ws://127.0.0.1:<port>` so an external `llui-mcp` server can forward
   * tool calls into the running app.
   *
   * Set to `false` to disable the relay injection entirely.
   * Default: 5200.
   */
  mcpPort?: number | false
}

export default function llui(options: LluiPluginOptions = {}): Plugin {
  let devMode = false
  const mcpPort = options.mcpPort === false ? null : (options.mcpPort ?? 5200)

  return {
    name: 'llui',
    enforce: 'pre',

    configResolved(config) {
      devMode = config.command === 'serve' || config.mode === 'development'
    },

    transform(code, id) {
      if (!id.endsWith('.ts') && !id.endsWith('.tsx')) return

      for (const d of diagnose(code)) {
        this.warn(d.message, { line: d.line, column: d.column })
      }

      const result = transformLlui(code, id, devMode, mcpPort)
      if (!result) return undefined

      // Apply per-statement edits via MagicString for accurate source maps.
      // Untouched statements keep their original positions.
      const s = new MagicString(code)
      for (const edit of result.edits) {
        if (edit.start === edit.end) {
          // Insert at position — appendRight for middle, append for end-of-file
          if (edit.start === code.length) s.append(edit.replacement)
          else s.appendRight(edit.start, edit.replacement)
        } else {
          s.overwrite(edit.start, edit.end, edit.replacement)
        }
      }

      return {
        code: s.toString(),
        map: s.generateMap({ source: id, includeContent: true, hires: true }),
      }
    },
  }
}
