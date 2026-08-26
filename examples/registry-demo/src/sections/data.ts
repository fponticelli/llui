import { text, type Mountable } from '@llui/dom'
import { Badge } from '../components/ui/badge'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table'
import { section } from './shared'

export type State = Record<string, never>
export type Msg = { type: 'noop' }

export const init = (): [State, never[]] => [{}, []]
export const update = (state: State): [State, never[]] => [state, []]

interface Row {
  item: string
  kind: string
  status: 'shipped' | 'planned'
}

// Written out rather than generated: the point of the section is the table
// SKIN, and a static body keeps the reader's attention on the markup.
const ROWS: readonly Row[] = [
  { item: 'button', kind: 'presentational', status: 'shipped' },
  { item: 'dialog', kind: 'skin', status: 'shipped' },
  { item: 'table', kind: 'presentational', status: 'shipped' },
  { item: 'sheet', kind: 'skin', status: 'planned' },
]

export function view(): Mountable {
  return section(
    'Table',
    'The Table part wraps itself in an overflow-x-auto box, so a wide table scrolls inside its own frame instead of scrolling the page.',
    [
      Table([
        TableCaption([text('A slice of the registry.')]),
        TableHeader([
          TableRow([
            TableHead([text('Item')]),
            TableHead([text('Kind')]),
            TableHead({ class: 'text-right' }, [text('Status')]),
          ]),
        ]),
        TableBody(
          ROWS.map((r) =>
            TableRow([
              TableCell({ class: 'font-medium' }, [text(r.item)]),
              TableCell({ class: 'text-muted-foreground' }, [text(r.kind)]),
              TableCell({ class: 'text-right' }, [
                Badge({ variant: r.status === 'shipped' ? 'secondary' : 'outline' }, [
                  text(r.status),
                ]),
              ]),
            ]),
          ),
        ),
      ]),
    ],
  )
}
