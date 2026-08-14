import { describe, it, expect } from 'vitest'
import * as ts from 'typescript'
import {
  getJSDoc,
  extractComponentFromText,
  memberRef,
  type ModuleReader,
} from '../src/generate-api.js'

/** Parse `text` and hand back its first statement plus the source file. */
function firstStatement(text: string): [ts.Node, ts.SourceFile] {
  const sf = ts.createSourceFile('fixture.ts', text, ts.ScriptTarget.Latest, true)
  return [sf.statements[0]!, sf]
}

function docOf(text: string): string | undefined {
  const [node, sf] = firstStatement(text)
  return getJSDoc(node, sf)
}

// ── issue #148: JSDoc paragraph breaks ───────────────────────────

describe('getJSDoc', () => {
  it('preserves the blank line between two prose paragraphs', () => {
    const doc = docOf(
      [
        '/**',
        ' * Line A.',
        ' *',
        ' * Line B starts a paragraph.',
        ' */',
        'export const x = 1',
      ].join('\n'),
    )
    expect(doc).toBe('Line A.\n\nLine B starts a paragraph.')
  })

  it('does not absorb a paragraph following a bulleted list into the last bullet', () => {
    const doc = docOf(
      [
        '/**',
        ' * Intro.',
        ' *',
        ' * - first bullet',
        ' * - second bullet',
        ' *',
        ' * Trailing prose that must stay its own paragraph.',
        ' */',
        'export const x = 1',
      ].join('\n'),
    )
    expect(doc).toBe(
      'Intro.\n\n- first bullet\n- second bullet\n\nTrailing prose that must stay its own paragraph.',
    )
    // The regression shape: the trailing paragraph glued onto the last bullet.
    expect(doc).not.toContain('- second bullet\nTrailing prose')
  })

  it('keeps a blank line inside a fenced code block', () => {
    const doc = docOf(
      [
        '/**',
        ' * Example.',
        ' *',
        ' * ```ts',
        ' * const a = 1',
        ' *',
        ' * const b = 2',
        ' * ```',
        ' */',
        'export const x = 1',
      ].join('\n'),
    )
    expect(doc).toBe('Example.\n\n```ts\nconst a = 1\n\nconst b = 2\n```')
  })

  it('still strips the leading asterisk and its single separating space', () => {
    const doc = docOf(
      ['/**', ' * Plain.', ' *   indented continuation', ' */', 'const x = 1'].join('\n'),
    )
    expect(doc).toBe('Plain.\n  indented continuation')
  })

  it('drops a lone @example tag line but leaves a paragraph break in its place', () => {
    const doc = docOf(
      [
        '/**',
        ' * Docs.',
        ' *',
        ' * @example',
        ' * ```ts',
        ' * f()',
        ' * ```',
        ' */',
        'const x = 1',
      ].join('\n'),
    )
    expect(doc).toBe('Docs.\n\n\n```ts\nf()\n```')
    expect(doc).not.toContain('@example')
  })

  it('ignores a non-JSDoc block comment', () => {
    expect(docOf(['/* not jsdoc */', 'const x = 1'].join('\n'))).toBeUndefined()
  })
})

// ── issue #151: component member kinds ───────────────────────────

const TABLE_LIKE = `
export interface WidgetState {
  open: boolean
}

export type WidgetMsg = { type: 'toggle' }

export const HEADER_ROW_INDEX = -1

export const LABELS = { a: 'a' }

export function init(): WidgetState {
  return { open: false }
}

export function update(state: WidgetState, msg: WidgetMsg): [WidgetState, never[]] {
  return [state, []]
}

export function isOpen(state: WidgetState): boolean {
  return state.open
}

export const describeWidget = (state: WidgetState) => String(state.open)

export function connect(get: unknown, send: unknown, opts: { id: string }) {
  return { root: {} }
}

export const widget = {
  init,
  update,
  connect,
  isOpen,
  HEADER_ROW_INDEX,
}

const notExported = 1
export type WidgetHelper = typeof isOpen
`

describe('extractComponentFromText (issue #151)', () => {
  const info = extractComponentFromText('widget', TABLE_LIKE)!

  it('extracts the component', () => {
    expect(info).not.toBeNull()
    expect(info.stateType).toBe('WidgetState')
  })

  it('classifies a namespace member that is a const as a const, not a function', () => {
    expect(info.extras).toContainEqual({ name: 'HEADER_ROW_INDEX', kind: 'const' })
    expect(info.extras).not.toContainEqual({ name: 'HEADER_ROW_INDEX', kind: 'function' })
  })

  it('classifies a namespace member that is a function as a function', () => {
    expect(info.extras).toContainEqual({ name: 'isOpen', kind: 'function' })
  })

  it('classifies an arrow-function const as a function', () => {
    expect(info.extras).toContainEqual({ name: 'describeWidget', kind: 'function' })
  })

  it('includes module-level exports that are not namespace members', () => {
    const names = info.extras.map((e) => e.name)
    expect(names).toContain('LABELS')
    expect(names).toContain('describeWidget')
  })

  it('classifies a module-level object const as a const', () => {
    expect(info.extras).toContainEqual({ name: 'LABELS', kind: 'const' })
  })

  it('omits init/update/connect, the namespace object itself, non-exports and types', () => {
    const names = info.extras.map((e) => e.name)
    expect(names).not.toContain('init')
    expect(names).not.toContain('update')
    expect(names).not.toContain('connect')
    expect(names).not.toContain('widget')
    expect(names).not.toContain('notExported')
    expect(names).not.toContain('WidgetHelper')
  })

  it('lists each member exactly once', () => {
    const names = info.extras.map((e) => e.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('namespace object detection (issue #151)', () => {
  // `switch.ts` exports `switchMachine`, `alert-dialog.ts` exports `alertDialog`:
  // matching the object by the FILE's basename missed both.
  const RENAMED = `
export interface SwitchState {
  on: boolean
}
export function init(): SwitchState {
  return { on: false }
}
export function update(state: SwitchState): [SwitchState, never[]] {
  return [state, []]
}
export function connect(get: unknown, send: unknown, opts: { id: string }) {
  return { root: {} }
}
export const switchMachine = { init, update, connect }
`

  it('finds the namespace object by shape, not by the file name', () => {
    const info = extractComponentFromText('switch', RENAMED)!
    expect(info.extras).toEqual([])
  })

  it('never lists the namespace object as one of its own members', () => {
    const info = extractComponentFromText('switch', RENAMED)!
    expect(info.extras.map((e) => e.name)).not.toContain('switchMachine')
  })
})

describe('kind resolution across bindings (issue #151)', () => {
  // `menu.ts` writes `export const isMounted = isPresent`. Both halves matter,
  // but only the CONST alias discriminates: an unresolved name falls back to
  // `function`, so a function alias passes even with resolution switched off.
  const ALIASES = `
export interface MenuState { open: boolean }
export function init(): MenuState { return { open: false } }
export function update(s: MenuState): [MenuState, never[]] { return [s, []] }
export function isPresent(s: MenuState): boolean { return s.open }
export const isMounted = isPresent
const SENTINEL = '\\u0000__menu__'
export const CREATE_VALUE = SENTINEL
export function connect(get: unknown, send: unknown, opts: { id: string }) { return { root: {} } }
export const menu = { init, update, connect, isPresent, isMounted, CREATE_VALUE }
`

  it('follows a local alias to a function declaration', () => {
    const info = extractComponentFromText('menu', ALIASES)!
    expect(info.extras).toContainEqual({ name: 'isMounted', kind: 'function' })
  })

  it('follows a local alias to a constant', () => {
    const info = extractComponentFromText('menu', ALIASES)!
    expect(info.extras).toContainEqual({ name: 'CREATE_VALUE', kind: 'const' })
  })

  it('follows a relative import into a sibling module', () => {
    const read: ModuleReader = (_from, specifier) =>
      specifier === './dialog.js'
        ? {
            id: 'dialog.ts',
            text: `
export function isMounted(s: unknown): boolean { return true }
export const DIALOG_ROLE = 'dialog'
`,
          }
        : undefined

    const info = extractComponentFromText(
      'alert-dialog',
      `
import { init, update, isMounted, DIALOG_ROLE } from './dialog.js'
export type AlertDialogState = { open: boolean }
export function connect(get: unknown, send: unknown, opts: { id: string }) { return { root: {} } }
export const alertDialog = { init, update, connect, isMounted, DIALOG_ROLE }
`,
      read,
    )!
    expect(info.extras).toContainEqual({ name: 'isMounted', kind: 'function' })
    expect(info.extras).toContainEqual({ name: 'DIALOG_ROLE', kind: 'const' })
  })

  it('falls back to function for a name no module in reach declares', () => {
    const info = extractComponentFromText(
      'widget',
      `
import { init, update, mystery } from './nowhere.js'
export type WidgetState = { on: boolean }
export function connect(get: unknown, send: unknown, opts: { id: string }) { return { root: {} } }
export const widget = { init, update, connect, mystery }
`,
    )!
    expect(info.extras).toContainEqual({ name: 'mystery', kind: 'function' })
  })
})

describe('memberRef (issue #151)', () => {
  it('parenthesizes functions only', () => {
    expect(memberRef({ name: 'isOpen', kind: 'function' })).toBe('`isOpen()`')
    expect(memberRef({ name: 'HEADER_ROW_INDEX', kind: 'const' })).toBe('`HEADER_ROW_INDEX`')
  })
})
