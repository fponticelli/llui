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

      const s = new MagicString(code)
      s.overwrite(0, code.length, result)

      return {
        code: result,
        map: s.generateMap({ source: id, includeContent: true }),
      }
    },
  }
}
