import { div, h2, text } from '@llui/dom'
import type { Renderable, Mountable } from '@llui/dom'

export function sectionGroup(title: string, sections: Renderable): Mountable {
  return div([
    h2({ class: 'mt-8 mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted' }, [
      text(title),
    ]),
    div({ class: 'grid grid-cols-1 gap-4 md:grid-cols-2' }, sections),
  ])
}

export function card(title: string, body: Renderable): Mountable {
  const children: Mountable[] = [h2({ class: 'demo-title' }, [text(title)])]
  for (const node of body) children.push(node)
  return div({ class: 'demo-section' }, children)
}
