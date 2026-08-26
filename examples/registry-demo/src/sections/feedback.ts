import { div, text, type Mountable } from '@llui/dom'
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert'
import { Skeleton } from '../components/ui/skeleton'
import { section } from './shared'

export type State = Record<string, never>
export type Msg = { type: 'noop' }

export const init = (): [State, never[]] => [{}, []]
export const update = (state: State): [State, never[]] => [state, []]

export function view(): Mountable {
  return section(
    'Alert & Skeleton',
    'Alert puts role="alert" on the root, so assistive tech announces the subtree when it is inserted. Skeleton is aria-hidden — a loading shape is not content.',
    [
      Alert([
        AlertTitle([text('Heads up')]),
        AlertDescription([text('This is the default alert, sitting on the card surface token.')]),
      ]),
      Alert({ variant: 'destructive' }, [
        AlertTitle([text('Something went wrong')]),
        AlertDescription([text('The destructive variant tints the border and the text.')]),
      ]),
      div({ class: 'flex items-center gap-4' }, [
        Skeleton({ class: 'size-12 rounded-full' }),
        div({ class: 'flex flex-col gap-2' }, [
          Skeleton({ class: 'h-4 w-48' }),
          Skeleton({ class: 'h-4 w-32' }),
        ]),
      ]),
    ],
  )
}
