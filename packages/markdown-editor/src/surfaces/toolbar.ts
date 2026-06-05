// Toolbar surface. `connectToolbar` returns a parts bag (the @llui/components
// idiom) driven reactively by the format signal; `toolbar` is a ready-made
// grouped toolbar Mountable for consumers who don't want to hand-render buttons.

import {
  button,
  div,
  span,
  text,
  tagSend,
  unsafeHtml,
  type Mountable,
  type Send,
  type Signal,
} from '@llui/dom'
import type { CommandItem } from '../plugins/types.js'
import type { EditorMsg, FormatState } from '../state.js'

export interface ToolbarItemParts {
  type: 'button'
  'data-scope': 'md-toolbar'
  'data-part': 'item'
  'data-id': string
  'aria-label': string
  title: string
  'aria-pressed': Signal<'true' | 'false'>
  'aria-disabled': Signal<'true' | undefined>
  disabled: Signal<boolean>
  'data-active': Signal<'' | undefined>
  onClick: (e: MouseEvent) => void
}

export interface ToolbarParts {
  root: {
    role: 'toolbar'
    'aria-label': string
    'data-scope': 'md-toolbar'
    'data-part': 'root'
  }
  item: (id: string) => ToolbarItemParts
}

/** Build reactive toolbar parts from the format signal. Spread `item(id)` onto a
 * `<button>`; `aria-pressed` / `data-active` / `disabled` track the format. */
export function connectToolbar(
  format: Signal<FormatState>,
  send: Send<EditorMsg>,
  items: readonly CommandItem[],
): ToolbarParts {
  const byId = new Map(items.map((i) => [i.id, i]))
  return {
    root: {
      role: 'toolbar',
      'aria-label': 'Formatting',
      'data-scope': 'md-toolbar',
      'data-part': 'root',
    },
    item: (id) => {
      const item = byId.get(id)
      const label = item?.label ?? id
      return {
        type: 'button',
        'data-scope': 'md-toolbar',
        'data-part': 'item',
        'data-id': id,
        'aria-label': label,
        title: label,
        'aria-pressed': format.map((f) => (item?.isActive?.(f) ? 'true' : 'false')),
        'aria-disabled': format.map((f) => (item?.isDisabled?.(f) ? 'true' : undefined)),
        disabled: format.map((f) => item?.isDisabled?.(f) ?? false),
        'data-active': format.map((f) => (item?.isActive?.(f) ? '' : undefined)),
        onClick: tagSend(send, ['runCommand'], () => send({ type: 'runCommand', id })),
      }
    },
  }
}

/** Inline SVG icon (monochrome, inherits `currentColor`) used where a glyph
 * reads poorly. A glyph string starting with `<svg` is rendered as markup. */
const LINK_ICON =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 1 0-5-5l-1 1"/><path d="M14.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 1 0 5 5l1-1"/></svg>'

/** Compact glyphs so the default toolbar reads as a real toolbar without icon
 * assets. SVG strings render as icons; everything else as text. Override via
 * `ToolbarOptions.glyphs`. */
export const DEFAULT_GLYPHS: Readonly<Record<string, string>> = {
  bold: 'B',
  italic: 'I',
  strikethrough: 'S',
  code: '</>',
  link: LINK_ICON,
  paragraph: '¶',
  h1: 'H1',
  h2: 'H2',
  h3: 'H3',
  quote: '❝',
  codeBlock: '{ }',
  bulletList: '•',
  numberList: '1.',
  checkList: '☑',
  undo: '↺',
  redo: '↻',
}

const GROUP_ORDER = ['inline', 'block', 'list', 'history']

function groupItems(items: readonly CommandItem[]): string[][] {
  const groups = new Map<string, string[]>()
  for (const item of items) {
    const key = item.group ?? 'other'
    const list = groups.get(key) ?? []
    list.push(item.id)
    groups.set(key, list)
  }
  const ordered: string[][] = []
  for (const key of GROUP_ORDER) {
    const list = groups.get(key)
    if (list) ordered.push(list)
  }
  for (const [key, list] of groups) {
    if (!GROUP_ORDER.includes(key)) ordered.push(list)
  }
  return ordered
}

export interface ToolbarOptions {
  format: Signal<FormatState>
  send: Send<EditorMsg>
  items: readonly CommandItem[]
  /** Explicit grouped layout of ids; defaults to grouping by `item.group`. */
  groups?: readonly (readonly string[])[]
  /** Glyph overrides (id → text/emoji). Merged over {@link DEFAULT_GLYPHS}. */
  glyphs?: Readonly<Record<string, string>>
  'aria-label'?: string
}

/** A ready-made grouped toolbar. Items not surfaced to `'toolbar'` are dropped. */
export function toolbar(opts: ToolbarOptions): Mountable {
  const surfaceItems = opts.items.filter((i) => i.surfaces?.includes('toolbar') ?? true)
  const byId = new Map(surfaceItems.map((i) => [i.id, i]))
  const parts = connectToolbar(opts.format, opts.send, surfaceItems)
  const glyphs = { ...DEFAULT_GLYPHS, ...(opts.glyphs ?? {}) }
  const groups = opts.groups ?? groupItems(surfaceItems)

  const groupEls = groups
    .filter((ids) => ids.length > 0)
    .map((ids) =>
      div(
        { 'data-scope': 'md-toolbar', 'data-part': 'group' },
        ids
          .filter((id) => byId.has(id))
          .map((id) => {
            const item = byId.get(id)!
            const glyph = glyphs[id] ?? item.label
            const glyphNode = glyph.trimStart().startsWith('<svg') ? unsafeHtml(glyph) : text(glyph)
            return button({ ...parts.item(id) }, [
              span({ 'data-part': 'glyph', 'aria-hidden': 'true' }, [glyphNode]),
            ])
          }),
      ),
    )

  return div(
    { ...parts.root, ...(opts['aria-label'] ? { 'aria-label': opts['aria-label'] } : {}) },
    groupEls,
  )
}
