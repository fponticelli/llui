import type { Plugin } from 'vite'
import { transformLlui } from './transform.js'

export default function llui(): Plugin {
  return {
    name: 'llui',
    enforce: 'pre',

    transform(code, id) {
      if (!id.endsWith('.ts') && !id.endsWith('.tsx')) return
      return transformLlui(code, id) ?? undefined
    },
  }
}
