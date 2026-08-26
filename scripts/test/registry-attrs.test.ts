import { describe, it, expect } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
// @ts-expect-error -- plain-JS script helpers, consumed by the repo's own tooling
import { extractClassCandidates } from '../lib/registry-classes.mjs'
// @ts-expect-error -- plain-JS script helpers, consumed by the repo's own tooling
import { attrsInCandidate, publishedAttrs } from '../lib/registry-attrs.mjs'

const ROOT = path.resolve(__dirname, '../..')
const UI = path.join(ROOT, 'registry/llui/ui')
const MACHINES = path.join(ROOT, 'packages/components/src/components')
const PATTERNS = path.join(ROOT, 'packages/components/src/patterns')

/**
 * A registry skin styles a headless machine, but its FILENAME is shadcn's name
 * and the machine's is LLui's. This maps the ones that differ; anything not
 * listed is looked up by its own name. A skin with no machine at all (pure
 * layout, or several machines) maps to `[]` and is checked against the union of
 * whatever it does list.
 */
const MACHINE_OF: Record<string, readonly string[]> = {
  // shadcn name → LLui machine
  breadcrumb: ['breadcrumbs'],
  calendar: ['date-picker'],
  'context-menu': ['context-menu', 'menu-machine'],
  'dropdown-menu': ['menu', 'menu-machine'],
  menubar: ['menubar', 'menu', 'menu-machine'],
  'navigation-menu': ['navigation-menu'],
  resizable: ['splitter'],
  sheet: ['drawer', 'dialog'],
  sonner: ['toast'],
  'input-otp': ['pin-input'],
  command: ['combobox'],
  combobox: ['combobox'],
  select: ['select', 'listbox'],
  'alert-dialog': ['alert-dialog', 'dialog'],
  field: ['field', 'fieldset', 'form'],
  'radio-group': ['radio-group'],
  'toggle-group': ['toggle-group', 'toggle'],
  // Composite / layout-only skins: no single machine publishes their state, so
  // the union of the machines they DO drive is the contract.
  sidebar: ['collapsible'],
  carousel: ['carousel'],
  'scroll-area': ['scroll-area'],
  pagination: ['pagination'],
  'tree-view': ['tree-view'],
  // Lives under `patterns/`, which the vacuity check does not scan.
  'data-table': ['data-table'],
  'button-group': [],
  'input-group': [],
  typography: [],
  skeleton: [],
  spinner: [],
  kbd: [],
  card: [],
  empty: [],
  item: [],
  alert: [],
  badge: [],
  button: [],
  input: [],
  label: [],
  textarea: [],
  separator: ['separator'],
  'aspect-ratio': [],
  icons: [],
  table: ['table'],
  steps: ['steps'],
}

/**
 * Attributes a recipe may name that no PART bag declares, with the reason.
 *
 * Keyed `file.ts: attr`, NOT by attribute name alone. A bare-name allowlist
 * would switch the check off for that attribute in EVERY skin — allowing
 * `calendar`'s upstream `data-[state=today]` would have silenced the exact
 * `data-[state=active]` bug this test exists to catch, in `carousel`, and the
 * suite would still have been green. Scope every exemption to the one file that
 * earned it.
 *
 * The `*` file is for attributes that are genuinely universal: written by the
 * CONSUMER on an element rather than by any part bag.
 */
interface Allowance {
  reason: string
  /**
   * The LLui spelling that carries the SAME state, when this entry is upstream
   * parity rather than a consumer-set value. Given one, the test additionally
   * requires the file to reference it — which is what makes a parity allowance
   * checkable instead of a hole. Without it, deleting the working half leaves
   * the file referencing only the dead upstream spelling and the allowance
   * silently approves it: measured, by putting the shipped `scroll-area` bug
   * back and watching the suite stay green.
   */
  pairedWith?: string
}

const ALLOWED: Record<string, Allowance> = {
  // Written by the consumer on the element itself, not by any machine.
  '*: data-slot': {
    reason: 'upstream leftover, guarded separately — see the data-slot rule in CLAUDE.md',
  },
  '*: data-side': { reason: 'overlay positioners: written by the floating engine, not a part bag' },
  '*: aria-invalid': { reason: 'set by the consumer on any control' },
  '*: aria-selected': { reason: 'set by the consumer on any option' },
  '*: aria-checked': { reason: 'set by the consumer on any toggle' },
  '*: aria-disabled': { reason: 'set by the consumer on any control' },
  '*: aria-current': { reason: 'set by the consumer on a current link' },
  '*: aria-expanded': { reason: 'set by the consumer on any disclosure' },
  '*: aria-pressed': { reason: 'set by the consumer on any toggle button' },
  '*: aria-hidden': { reason: 'set by the consumer on decorative content' },
  '*: aria-busy': { reason: 'set by the consumer during a load' },
  '*: aria-readonly': { reason: 'set by the consumer on any control' },

  'navigation-menu.ts: data-viewport': {
    reason: 'the consumer sets it to pick inline vs shared-viewport presentation',
  },
  'input-group.ts: data-align': { reason: 'an addon position the consumer chooses' },
  'date-picker.ts: data-empty': {
    reason:
      'upstream\'s own spelling for "no date chosen yet", set by the CONSUMER — ' +
      '`@llui/components/date-picker` has no trigger part at all, because the trigger ' +
      'belongs to whatever surface is hosting the calendar.',
  },
  'sidebar.ts: data-variant': { reason: 'a presentational variant the consumer sets' },
  'sidebar.ts: data-size': { reason: 'a menu-button size the consumer sets' },
  'sidebar.ts: data-collapsible': {
    reason: 'the consumer declares which collapse mode the panel uses (icon / offcanvas)',
  },
  'alert.ts: data-variant': { reason: 'a presentational variant the consumer sets' },
  'toggle-group.ts: data-variant': { reason: 'a presentational variant the consumer sets' },
  'toggle-group.ts: data-spacing': { reason: 'a presentational variant the consumer sets' },
  'button-group.ts: data-variant': { reason: 'a presentational variant the consumer sets' },
  'field.ts: data-error': { reason: 'the consumer marks the errored row' },
  'dropdown-menu.ts: data-inset': { reason: 'an indent flag the consumer sets on an item' },
  'context-menu.ts: data-inset': { reason: 'an indent flag the consumer sets on an item' },
  'menubar.ts: data-inset': { reason: 'an indent flag the consumer sets on an item' },
  'table.ts: data-selected': { reason: 'the consumer marks a selected row' },
  'table.ts: data-state': { reason: 'the consumer marks a selected row (upstream spelling)' },
  'toc.ts: data-active': { reason: 'also settable by the consumer for a current-page link' },
  'navigation-menu.ts: data-active': { reason: 'the consumer marks the current-page link' },
  'sidebar.ts: data-active': { reason: 'the consumer marks the current-page item' },
  'card.ts: data-part': {
    reason: 'a part NAME, not a state — the has-[] selector targets a sibling part',
  },
  'alert-dialog.ts: data-size': { reason: 'a presentational size the consumer sets' },
  'avatar.ts: data-size': { reason: 'a presentational size the consumer sets' },
  'select.ts: data-size': { reason: 'a presentational size the consumer sets' },
  'switch.ts: data-size': { reason: 'a presentational size the consumer sets' },
  'dropdown-menu.ts: data-variant': { reason: 'a destructive-item variant the consumer sets' },
  'field.ts: data-variant': { reason: 'a presentational variant the consumer sets' },
  'tabs.ts: data-variant': { reason: 'a presentational variant the consumer sets' },
  'input-otp.ts: data-active': {
    reason:
      'documented upstream parity: `input-otp` marks the active slot in state, while ' +
      '`pin-input` moves REAL focus, so the LLui path lights the same ring through ' +
      '`focus-visible:` and this spelling is carried for a pasted shadcn snippet.',
  },
  'scroll-area.ts: data-orientation': {
    reason:
      'upstream Radix renders one scrollbar per orientation; the LLui machine has ONE part per ' +
      'axis and distinguishes them with `data-axis`. Both spellings are carried so a pasted ' +
      'shadcn snippet keeps working.',
    pairedWith: 'data-axis',
  },
  'steps.ts: data-orientation': {
    reason: 'the consumer declares the layout axis; the machine takes no view on it',
  },
  'calendar.ts: data-hidden': {
    reason: 'react-day-picker parity; unreachable from the LLui machine',
  },
  'calendar.ts: data-range-middle': {
    pairedWith: 'data-in-range',
    reason:
      'react-day-picker parity. LLui publishes `data-in-range`, which the same recipe also ' +
      'carries — this spelling is here so a pasted upstream snippet keeps working.',
  },
  'calendar.ts: data-selected-single': {
    pairedWith: 'data-selected',
    reason: 'react-day-picker parity. LLui publishes `data-selected`; see data-range-middle.',
  },
  'calendar.ts: data-state': {
    pairedWith: 'data-today',
    reason:
      'react-day-picker parity (`data-[state=today|outside|selected]`). LLui publishes ' +
      '`data-today` / `not-data-in-month` / `data-selected`, all of which the same recipe carries.',
  },
}

async function machineAttrs(names: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>()
  for (const name of names) {
    for (const dir of [MACHINES, PATTERNS]) {
      const file = path.join(dir, `${name}.ts`)
      if (!existsSync(file)) continue
      for (const a of publishedAttrs(file, await readFile(file, 'utf8'))) out.add(a)
    }
  }
  return out
}

describe('registry recipes only style attributes their machine publishes', () => {
  it('maps every ui/ file to a machine (or explicitly to none)', async () => {
    // Without this the check silently stops covering a file the moment one is
    // added — the same vacuity trap the class guard has.
    const files = (await readdir(UI)).filter((f) => f.endsWith('.ts')).map((f) => f.slice(0, -3))
    const unmapped = files.filter(
      (f) => MACHINE_OF[f] === undefined && !existsSync(path.join(MACHINES, `${f}.ts`)),
    )
    expect(
      unmapped,
      `These skins name no machine and have none of their own — add them to MACHINE_OF ` +
        `(use [] for a layout-only skin):\n  ${unmapped.join('\n  ')}`,
    ).toEqual([])
  })

  it('reports no recipe attribute that its machine never emits', async () => {
    const files = (await readdir(UI)).filter((f) => f.endsWith('.ts'))
    const problems: string[] = []
    for (const file of files) {
      const slug = file.slice(0, -3)
      const names = MACHINE_OF[slug] ?? [slug]
      if (names.length === 0) continue
      const published = await machineAttrs(names)
      if (published.size === 0) continue
      const full = path.join(UI, file)
      const candidates: string[] = extractClassCandidates(full, await readFile(full, 'utf8'))
      const referenced = new Set(candidates.flatMap((c) => attrsInCandidate(c) as string[]))
      for (const attr of [...referenced].sort()) {
        if (published.has(attr)) continue
        const allowance = ALLOWED[`${file}: ${attr}`] ?? ALLOWED[`*: ${attr}`]
        if (allowance !== undefined) {
          const paired = allowance.pairedWith
          if (paired === undefined || referenced.has(paired)) continue
          problems.push(
            `  ${file}: ${attr} is allowed ONLY alongside ${paired}, which this file no longer ` +
              `references — the upstream spelling is now the only one, and it matches nothing`,
          )
          continue
        }
        problems.push(`  ${file}: ${attr} (machine: ${names.join(', ')})`)
      }
    }
    expect(
      problems,
      'These recipes style an attribute their machine does not publish, so the rule ' +
        'can never match. Fix the spelling, or add it to ALLOWED with a reason:\n' +
        problems.join('\n'),
    ).toEqual([])
  })

  /**
   * A recipe that puts a property behind `data-[x=default]:` is porting a shadcn
   * component whose React signature DEFAULTS that prop (`size = "default"`). A
   * recipe-only port keeps the class and loses the default, so unless the part
   * supplies it the rule matches nothing.
   *
   * `Switch` is why this exists: its entire geometry sits behind
   * `data-[size=default]:h-[1.15rem] w-8` with the thumb behind
   * `group-data-[size=default]/switch:size-4`. Without the attribute it rendered
   * as a ~2px sliver with a zero-size thumb — toggling correctly, looking like
   * nothing happened, and passing every check including the attribute guard
   * above (which allows `data-size` precisely because the consumer sets it).
   */
  it('every data-[x=default] recipe supplies that attribute as a default', async () => {
    const files = (await readdir(UI)).filter((f) => f.endsWith('.ts'))
    const problems: string[] = []
    for (const file of files) {
      const full = path.join(UI, file)
      const source = await readFile(full, 'utf8')
      const candidates: string[] = extractClassCandidates(full, source)
      // The bracketed form is the only one that can carry `=default`:
      // `data-[size=default]:h-9`, `group-data-[size=default]/switch:size-4`.
      const gated = new Set<string>()
      for (const c of candidates) {
        for (const m of c.matchAll(/(?:data|aria)-\[([a-zA-Z0-9-]+)=default\]/g)) {
          gated.add(`data-${m[1]}`)
        }
      }
      // COMMENTS STRIPPED FIRST. Checking the raw source passed on a `switch.ts`
      // whose default had been deleted, because its own doc comment explains the
      // attribute and mentions `'data-size': 'sm'` — the guard read the prose as
      // the fix. Measured: the mutation survived until this line existed.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
      for (const attr of [...gated].sort()) {
        // The default may arrive through `classPartWithDefaults` or be written
        // before the spread in a hand-rolled part; both spell the key literally.
        if (code.includes(`'${attr}':`)) continue
        problems.push(
          `  ${file}: styles \`${attr}=default\` but never supplies ${attr}, so those rules ` +
            `match nothing (shadcn defaults it as a prop)`,
        )
      }
    }
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('detects a misspelled attribute', async () => {
    // The check is only worth its runtime if it can fail. This is the exact
    // shape that shipped: the carousel indicator styling `data-[state=active]`
    // against a machine that publishes a bare `data-active`.
    const published = await machineAttrs(['carousel'])
    const referenced = attrsInCandidate('data-[state=active]:bg-primary') as string[]
    expect(referenced).toEqual(['data-state'])
    expect(published.has('data-state')).toBe(false)
    expect(published.has('data-active')).toBe(true)
  })
})
