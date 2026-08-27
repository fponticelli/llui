import { div, span, text, type Mountable } from '@llui/dom'
import {
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CircleIcon,
  FolderIcon,
  GripVerticalIcon,
  LayoutDashboardIcon,
  LoaderIcon,
  MinusIcon,
  SearchIcon,
  SettingsIcon,
  XIcon,
  icon,
} from '../components/ui/icons'
import { Button } from '../components/ui/button'
import { row, section } from './shared'

export type State = Record<string, never>
export type Msg = { type: 'noop' }
export const init = (): [State, never[]] => [{}, []]
export const update = (state: State): [State, never[]] => [state, []]

/** A glyph with its name underneath, so the page doubles as a lookup. */
function labelled(name: string, glyph: Mountable): Mountable {
  return div({ class: 'flex w-24 flex-col items-center gap-1.5' }, [
    glyph,
    span({ class: 'text-muted-foreground text-[10px] break-all text-center' }, [text(name)]),
  ])
}

const BAKED: [string, Mountable][] = [
  ['check', CheckIcon()],
  ['chevron-down', ChevronDownIcon()],
  ['chevron-up', ChevronUpIcon()],
  ['chevron-right', ChevronRightIcon()],
  ['chevron-left', ChevronLeftIcon()],
  ['x', XIcon()],
  ['minus', MinusIcon()],
  ['search', SearchIcon()],
  ['circle', CircleIcon()],
  ['grip-vertical', GripVerticalIcon()],
  ['loader-circle', LoaderIcon()],
  ['layout-dashboard', LayoutDashboardIcon()],
  ['folder', FolderIcon()],
  ['calendar', CalendarIcon()],
  ['settings-2', SettingsIcon()],
]

/** Named exports carry no size, so give them one here the way a recipe would. */
const sized = 'size-5'

export function view(): readonly Mountable[] {
  return [
    section(
      'Icons — the baked set',
      'The fifteen glyphs shadcn/ui bakes into its own components. They are ordinary named exports and every registry component here already renders them; nothing about the call site changed when they moved to Iconify.',
      [
        div({ class: 'flex flex-wrap gap-4' }, [
          ...BAKED.map(([name]) => labelled(name, icon(`lucide:${name}`)({ class: sized }))),
        ]),
      ],
    ),

    section(
      'Icons — any glyph, by name',
      'Geometry is no longer inlined: `icon("lucide:star")` names an Iconify glyph and the body is fetched at mount. Different sets are just different prefixes, and every icon mounted in the same tick is batched into ONE request per prefix — the 71 glyphs on this page are four requests.',
      [
        row('lucide', [
          div({ class: 'flex flex-wrap gap-4' }, [
            ...['star', 'heart', 'rocket', 'zap', 'bell', 'sparkles', 'palette', 'flame'].map((n) =>
              labelled(`lucide:${n}`, icon(`lucide:${n}`)({ class: sized })),
            ),
          ]),
        ]),
        row('other sets', [
          div({ class: 'flex flex-wrap gap-4' }, [
            labelled('simple-icons:github', icon('simple-icons:github')({ class: sized })),
            labelled('simple-icons:typescript', icon('simple-icons:typescript')({ class: sized })),
            labelled('simple-icons:cloudflare', icon('simple-icons:cloudflare')({ class: sized })),
            labelled('mdi:language-typescript', icon('mdi:language-typescript')({ class: sized })),
            labelled(
              'material-symbols:rocket-launch',
              icon('material-symbols:rocket-launch')({ class: sized }),
            ),
          ]),
        ]),
      ],
    ),

    section(
      'Icons — sizing, colour and failure',
      'A glyph carries NO size of its own, which is what lets a recipe size it and a caller override that. It strokes in `currentColor`, so colour comes from whatever it sits in. And a name the set does not have is an empty box plus one console warning — a typo and an offline CDN look identical on screen, so both have to say so.',
      [
        row('Sizes', [
          div({ class: 'flex items-end gap-4' }, [
            labelled('size-4', icon('lucide:rocket')({ class: 'size-4' })),
            labelled('size-6', icon('lucide:rocket')({ class: 'size-6' })),
            labelled('size-10', icon('lucide:rocket')({ class: 'size-10' })),
          ]),
        ]),
        row('Colour is inherited', [
          div({ class: 'flex items-center gap-4' }, [
            span({ class: 'text-primary' }, [icon('lucide:flame')({ class: sized })]),
            span({ class: 'text-destructive' }, [icon('lucide:flame')({ class: sized })]),
            span({ class: 'text-muted-foreground' }, [icon('lucide:flame')({ class: sized })]),
            // Inside a Button it takes the button's foreground, like every
            // other icon the recipes render.
            Button({ size: 'sm' }, [
              icon('lucide:sparkles')({ class: 'size-4' }),
              text('Generate'),
            ]),
          ]),
        ]),
        row('Animated', [
          div({ class: 'flex items-center gap-3' }, [
            icon('lucide:loader-circle')({ class: 'size-5 animate-spin' }),
            span({ class: 'text-muted-foreground text-xs' }, [text('animate-spin on the glyph')]),
          ]),
        ]),
        row('A name that does not exist', [
          div({ class: 'flex items-center gap-3' }, [
            labelled('lucide:not-a-real-icon', icon('lucide:not-a-real-icon')({ class: sized })),
            span({ class: 'text-muted-foreground text-xs' }, [
              text('Empty box, and one [icons] warning in the console.'),
            ]),
          ]),
        ]),
      ],
    ),
  ]
}
