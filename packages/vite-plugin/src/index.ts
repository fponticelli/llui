import type { Plugin } from 'vite'

export default function llui(): Plugin {
  return {
    name: 'llui',
    enforce: 'pre',

    transform(_code, id) {
      if (!id.endsWith('.ts') && !id.endsWith('.tsx')) return
      // TODO: implement the 3-pass compiler
      // Pass 1: Static/Dynamic Prop Split
      // Pass 2: Dependency Analysis and Mask Injection
      // Pass 3: Import Cleanup
      return undefined
    },
  }
}
