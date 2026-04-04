import type { Plugin } from 'vite'
import MagicString from 'magic-string'
import { transformLlui } from './transform.js'
import { diagnose } from './diagnostics.js'

export default function llui(): Plugin {
  let devMode = false

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

      const result = transformLlui(code, id, devMode)
      if (!result) return undefined

      // Use MagicString for source map generation.
      // The transform produces a fully reprinted output, so we overwrite
      // the entire source — but MagicString tracks the replacement and
      // generates a source map that maps the output back to position 0
      // of the original. This is coarse but gives Vite enough to show
      // the original file in devtools.
      const s = new MagicString(code)
      s.overwrite(0, code.length, result.output)

      return {
        code: result.output,
        map: s.generateMap({ source: id, includeContent: true }),
      }
    },
  }
}
