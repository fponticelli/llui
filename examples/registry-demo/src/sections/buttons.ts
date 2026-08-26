import { text } from '@llui/dom'
import type { Mountable } from '@llui/dom'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { row, section } from './shared'

export type State = Record<string, never>
export type Msg = { type: 'noop' }

export const init = (): [State, never[]] => [{}, []]
export const update = (state: State): [State, never[]] => [state, []]

export function view(): Mountable {
  return section(
    'Button & Badge',
    'Variant and size recipes built with createVariants. `class` on any of them overrides the recipe — cn resolves the Tailwind conflict rather than concatenating.',
    [
      row('Variants', [
        Button([text('Default')]),
        Button({ variant: 'secondary' }, [text('Secondary')]),
        Button({ variant: 'destructive' }, [text('Destructive')]),
        Button({ variant: 'outline' }, [text('Outline')]),
        Button({ variant: 'ghost' }, [text('Ghost')]),
        Button({ variant: 'link' }, [text('Link')]),
      ]),
      row('Sizes', [
        Button({ size: 'sm' }, [text('Small')]),
        Button([text('Default')]),
        Button({ size: 'lg' }, [text('Large')]),
        Button({ size: 'icon', 'aria-label': 'Add' }, [text('+')]),
      ]),
      row('Disabled', [
        Button({ disabled: true }, [text('Default')]),
        Button({ variant: 'outline', disabled: true }, [text('Outline')]),
      ]),
      row('Class override', [
        // The recipe says `px-4`; the caller says `px-10`. With `cx` the recipe
        // would win by source order — `cn` lets the caller win, which is what
        // makes `class` a usable escape hatch.
        Button({ class: 'px-10' }, [text('px-10 wins')]),
      ]),
      row('Badges', [
        Badge([text('Default')]),
        Badge({ variant: 'secondary' }, [text('Secondary')]),
        Badge({ variant: 'destructive' }, [text('Destructive')]),
        Badge({ variant: 'outline' }, [text('Outline')]),
      ]),
    ],
  )
}
