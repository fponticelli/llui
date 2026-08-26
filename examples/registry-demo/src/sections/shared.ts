import { div, h2, p, text, type ChildNode, type Mountable } from '@llui/dom'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card'

/** One demo section, framed in a registry Card so the page itself exercises the
 * components it documents. */
export function section(title: string, blurb: string, children: readonly ChildNode[]): Mountable {
  return Card({ class: 'mb-6' }, [
    CardHeader([CardTitle([text(title)]), CardDescription([text(blurb)])]),
    CardContent({ class: 'flex flex-col gap-4' }, children),
  ])
}

/** A labelled row of examples — the repeated layout inside a section. */
export function row(label: string, children: readonly ChildNode[]): Mountable {
  return div({ class: 'flex flex-col gap-2' }, [
    p({ class: 'text-muted-foreground text-xs font-medium tracking-wide uppercase' }, [
      text(label),
    ]),
    div({ class: 'flex flex-wrap items-center gap-3' }, children),
  ])
}

/** Heading used by the page shell between groups of sections. */
export function groupHeading(title: string): Mountable {
  return h2({ class: 'mt-10 mb-3 text-sm font-semibold tracking-wide uppercase' }, [text(title)])
}
