import { div, p, span, text, type Mountable } from '@llui/dom'
import { Button } from '../components/ui/button'
import { ButtonGroup, ButtonGroupSeparator, ButtonGroupText } from '../components/ui/button-group'
import { Badge } from '../components/ui/badge'
import { Chip } from '../components/ui/chip'
import { CHIP_HUES, RESERVED_HUE_ARCS, chipHue, chipHueAt } from '@llui/components/styles'
import { Kbd, KbdGroup } from '../components/ui/kbd'
import { Spinner } from '../components/ui/spinner'
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert'
import { Skeleton } from '../components/ui/skeleton'
import { Separator } from '../components/ui/separator'
import { AspectRatio } from '../components/ui/aspect-ratio'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from '../components/ui/empty'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '../components/ui/item'
import {
  TypographyBlockquote,
  TypographyH3,
  TypographyInlineCode,
  TypographyMuted,
  TypographyP,
} from '../components/ui/typography'
import { row, section } from './shared'

/** The shape of thing a value-hued chip labels: a category set the server owns,
 * that nobody wants to keep a colour map for. */
const CATEGORIES = [
  'lab',
  'visit',
  'imaging',
  'note',
  'vitals',
  'medication',
  'referral',
  'discharge',
  'allergy',
  'procedure',
]

export type State = Record<string, never>
export type Msg = { type: 'noop' }
export const init = (): [State, never[]] => [{}, []]
export const update = (state: State): [State, never[]] => [state, []]

export function view(): readonly Mountable[] {
  return [
    section('Button', 'Variant and size recipes built with createVariants.', [
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
        Button({ disabled: true }, [text('Disabled')]),
      ]),
      row('Class override', [
        // The recipe says px-4, the caller says px-10. `cn` resolves the
        // conflict so the caller wins; `cx` would lose it to source order.
        Button({ class: 'px-10' }, [text('px-10 wins')]),
      ]),
      row('Button group', [
        ButtonGroup([
          Button({ variant: 'outline' }, [text('Copy')]),
          Button({ variant: 'outline' }, [text('Paste')]),
          ButtonGroupSeparator(),
          Button({ variant: 'outline' }, [text('Cut')]),
        ]),
        ButtonGroup([
          ButtonGroupText([text('https://')]),
          Button({ variant: 'outline' }, [text('llui.dev')]),
        ]),
      ]),
    ]),

    section('Badge, Kbd & Spinner', 'Small inline primitives.', [
      row('Badges', [
        Badge([text('Default')]),
        Badge({ variant: 'secondary' }, [text('Secondary')]),
        Badge({ variant: 'destructive' }, [text('Destructive')]),
        Badge({ variant: 'outline' }, [text('Outline')]),
      ]),
      row('Keyboard', [
        KbdGroup([Kbd([text('⌘')]), Kbd([text('K')])]),
        KbdGroup([Kbd([text('Ctrl')]), Kbd([text('⇧')]), Kbd([text('P')])]),
        Kbd([text('Esc')]),
      ]),
      row('Spinner', [
        Spinner(),
        Spinner({ class: 'size-6 text-primary' }),
        Button({ variant: 'outline', disabled: true }, [Spinner(), text('Saving…')]),
      ]),
    ]),

    section('Chip', 'Categorical colour derived from the value — no colour map to maintain.', [
      row(
        'Hashed from the value',
        CATEGORIES.map((value) => Chip({ value })),
      ),
      row(
        'Same value, same colour — every time, everywhere',
        ['lab', 'lab', 'visit', 'lab', 'visit'].map((value) => Chip({ value })),
      ),
      row(
        `The whole scale (${CHIP_HUES.length} slots, 21° apart)`,
        CHIP_HUES.map((hue) => Chip({ hue }, [text(String(hue))])),
      ),
      row('Reserved: no chip can land on a status hue', [
        ...RESERVED_HUE_ARCS.map((arc) =>
          Chip({ hue: arc.center, class: 'opacity-60 line-through' }, [
            text(`${arc.name} ${arc.center}°`),
          ]),
        ),
        Badge({ variant: 'destructive' }, [text('critical')]),
      ]),
      row(
        'chipHueAt(i) — the sequential form, for a legend past --chart-5',
        Array.from({ length: 8 }, (_, i) => Chip({ hue: chipHueAt(i) }, [text(`series ${i + 1}`)])),
      ),
      p({ class: 'text-muted-foreground text-xs' }, [
        text(
          `Every hue in both themes measures at least 6.89:1 against its own ink as this browser rasterises it (6.896 at slot 188.5° in dark, the worst of the 24) — the HSL form of the same idea drops to 4.30:1 at hue 60. "lab" is ${chipHue('lab')}°.`,
        ),
      ]),
    ]),

    section('Alert, Empty & Skeleton', 'Feedback and placeholder states.', [
      Alert([
        AlertTitle([text('Heads up')]),
        AlertDescription([text('The default alert, on the card surface token.')]),
      ]),
      Alert({ variant: 'destructive' }, [
        AlertTitle([text('Something went wrong')]),
        AlertDescription([text('The destructive variant tints border and text.')]),
      ]),
      Empty([
        EmptyMedia([text('📭')]),
        EmptyContent([
          EmptyTitle([text('No notifications')]),
          EmptyDescription([text('When something happens, it will show up here.')]),
          Button({ size: 'sm', variant: 'outline' }, [text('Refresh')]),
        ]),
      ]),
      div({ class: 'flex items-center gap-4' }, [
        Skeleton({ class: 'size-12 rounded-full' }),
        div({ class: 'flex flex-col gap-2' }, [
          Skeleton({ class: 'h-4 w-48' }),
          Skeleton({ class: 'h-4 w-32' }),
        ]),
      ]),
    ]),

    section('Item & Separator', 'The generic row, and rules.', [
      ItemGroup([
        Item({ variant: 'outline', class: 'rounded-b-none' }, [
          ItemMedia([text('📦')]),
          ItemContent([
            ItemTitle([
              text('@llui/components'),
              Badge({ variant: 'secondary' }, [text('0.15.0')]),
            ]),
            ItemDescription([text('66 headless components — behaviour, ARIA and state machines.')]),
          ]),
          ItemActions([Button({ size: 'sm', variant: 'ghost' }, [text('View')])]),
        ]),
        Item({ variant: 'outline', class: 'rounded-t-none border-t-0' }, [
          ItemMedia([text('🎨')]),
          ItemContent([
            ItemTitle([text('@llui/cli')]),
            ItemDescription([text('Copies registry components into your project.')]),
          ]),
          ItemActions([Button({ size: 'sm', variant: 'ghost' }, [text('View')])]),
        ]),
      ]),
      Separator(),
      div({ class: 'flex h-8 items-center gap-3 text-sm' }, [
        text('Vertical'),
        Separator({ orientation: 'vertical' }),
        text('separator'),
      ]),
    ]),

    section('Aspect Ratio & Typography', 'Layout and prose primitives.', [
      row('16 / 9', [
        div({ class: 'w-64' }, [
          AspectRatio({ ratio: '16/9', class: 'rounded-lg bg-muted' }, [
            div(
              { class: 'flex size-full items-center justify-center text-sm text-muted-foreground' },
              [text('16 / 9')],
            ),
          ]),
        ]),
      ]),
      div({ class: 'max-w-prose' }, [
        TypographyH3([text('Own your components')]),
        TypographyP([
          text('Run '),
          TypographyInlineCode([text('llui add button')]),
          text(' and the source lands in your repo, compiled by your own vite plugin.'),
        ]),
        TypographyBlockquote([text('A class string that no build compiles is not tested.')]),
        TypographyMuted([text('— the reason this registry replaced the old class layer')]),
      ]),
      span({ class: 'sr-only' }, [text('end of presentational section')]),
    ]),
  ]
}
