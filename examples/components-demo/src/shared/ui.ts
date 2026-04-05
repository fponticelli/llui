import { div, h2, text } from '@llui/dom'

export function sectionGroup(title: string, sections: Node[]): Node {
  return div({}, [
    h2({ class: 'mt-8 mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500' }, [
      text(title),
    ]),
    div({ class: 'grid grid-cols-1 gap-4 md:grid-cols-2' }, sections),
  ])
}

export function card(title: string, body: Node[]): Node {
  return div({ class: 'demo-section' }, [h2({ class: 'demo-title' }, [text(title)]), ...body])
}
