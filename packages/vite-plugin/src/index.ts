import type { Plugin } from 'vite'
import { transformLlui } from './transform.js'
import { diagnose } from './diagnostics.js'

export default function llui(): Plugin {
  return {
    name: 'llui',
    enforce: 'pre',

    transform(code, id) {
      if (!id.endsWith('.ts') && !id.endsWith('.tsx')) return

      // Emit diagnostics as warnings
      for (const d of diagnose(code)) {
        this.warn(d.message, { line: d.line, column: d.column })
      }

      return transformLlui(code, id) ?? undefined
    },
  }
}
