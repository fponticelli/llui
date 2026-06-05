// Test helpers — mount markdown() into a real (jsdom) DOM via a component.

import { component, mountApp } from '@llui/dom'
import { markdown } from '../src/index.js'
import type { MarkdownOptions } from '../src/index.js'

export interface Mounted {
  container: HTMLElement
  cleanup: () => void
}

/** Mount a static (plain-string) markdown render. */
export function mountStatic(src: string, opts?: MarkdownOptions): Mounted {
  const container = document.createElement('div')
  document.body.append(container)
  const def = component<Record<string, never>, never>({
    init: () => ({}),
    update: (s) => s,
    view: () => [markdown(src, opts)],
  })
  const app = mountApp(container, def)
  return {
    container,
    cleanup: () => {
      app.dispose()
      container.remove()
    },
  }
}

interface DocState {
  src: string
}
type DocMsg = { type: 'set'; src: string }

export interface ReactiveMounted extends Mounted {
  set: (src: string) => void
}

/** Mount a reactive markdown render driven by a `src` signal; `set()` updates it. */
export function mountReactive(initial: string, opts?: MarkdownOptions): ReactiveMounted {
  const container = document.createElement('div')
  document.body.append(container)
  const def = component<DocState, DocMsg>({
    init: () => ({ src: initial }),
    update: (s, m) => (m.type === 'set' ? { src: m.src } : s),
    view: ({ state }) => [markdown(state.at('src'), opts)],
  })
  const app = mountApp(container, def)
  return {
    container,
    set: (src: string) => app.send({ type: 'set', src }),
    cleanup: () => {
      app.dispose()
      container.remove()
    },
  }
}

/** The root `.markdown-body` (or custom-class) wrapper element. */
export function body(container: HTMLElement, cls = 'markdown-body'): HTMLElement {
  const el = container.querySelector<HTMLElement>(`.${cls}`)
  if (!el) throw new Error(`no .${cls} wrapper found`)
  return el
}
