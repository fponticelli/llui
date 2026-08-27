import { describe, it, expect } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
// @ts-expect-error -- plain-JS script helpers, consumed by the repo's own tooling
import { extractClassCandidates } from '../lib/registry-classes.mjs'
// @ts-expect-error -- plain-JS script helpers, consumed by the repo's own tooling
import {
  attrsInCandidate,
  attrValuePairsInCandidate,
  bareAttrsInCandidate,
  publishedAttrs,
  publishedAttrValues,
} from '../lib/registry-attrs.mjs'

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
  // shadcn's `form` is a react-hook-form binding; LLui's equivalent is the
  // composed `patterns/form-field`, which is what these recipes are wired to.
  form: ['form', 'field', 'form-field'],
  'radio-group': ['radio-group'],
  'toggle-group': ['toggle-group', 'toggle'],
  // Composite / layout-only skins: no single machine publishes their state, so
  // the union of the machines they DO drive is the contract.
  sidebar: ['collapsible'],
  carousel: ['carousel'],
  chart: ['chart'],
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
  'chart.ts: data-mark': {
    reason: 'the mark KIND, published by `markProps` on the mark itself',
  },
  'field.ts: data-error': { reason: 'the consumer marks the errored row' },
  'form.ts: data-error': {
    reason:
      'upstream sets it on the LABEL from react-hook-form context; the LLui machine ' +
      'publishes the bare `data-invalid` on the field ROOT, which the label reads through ' +
      '`group/form-item`. Both are bound so a pasted shadcn snippet keeps working.',
    pairedWith: 'data-invalid',
  },
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

/**
 * Attribute VALUES a recipe may name that its machine never publishes, with the
 * reason. Keyed `file.ts: data-attr=value` — the same per-file scoping the name
 * allowlist uses, and for the same reason.
 */
const VALUE_ALLOWED: Record<string, Allowance> = {
  // Upstream parity, both spellings bound. shadcn writes `data-invalid="true"` /
  // `data-disabled="true"`; every LLui machine publishes the bare attribute.
  // `pairedWith` names the BARE spelling, so deleting the working half fails
  // here instead of leaving only the dead upstream rule.
  'field.ts: data-invalid=true': {
    reason: 'shadcn spelling; the LLui machines publish the bare attribute',
    pairedWith: 'data-invalid',
  },
  'field.ts: data-disabled=true': {
    reason: 'shadcn spelling; the LLui machines publish the bare attribute',
    pairedWith: 'data-disabled',
  },

  // react-day-picker parity, both spellings bound — see calendar.ts's own note.
  'calendar.ts: data-selected=true': {
    reason: 'react-day-picker spelling; `date-picker` publishes the bare attribute',
    pairedWith: 'data-selected',
  },
  'calendar.ts: data-focused=true': {
    reason: 'react-day-picker spelling; `date-picker` publishes the bare attribute',
    pairedWith: 'data-focused',
  },
  'calendar.ts: data-range-start=true': {
    reason: 'react-day-picker spelling; `date-picker` publishes the bare attribute',
    pairedWith: 'data-range-start',
  },
  'calendar.ts: data-range-end=true': {
    reason: 'react-day-picker spelling; `date-picker` publishes the bare attribute',
    pairedWith: 'data-range-end',
  },

  'sidebar.ts: data-state=collapsed': {
    reason:
      "the CONSUMER flips expanded/collapsed on the sidebar root — see SidebarTrigger's note. " +
      "The `collapsible` machine's own open/closed lives on a different element.",
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

/**
 * Attribute → the literal values the named machines can publish, or `null` when
 * at least one declaration is an OPEN type this syntax-only read cannot
 * enumerate. `null` is "no verdict", never "no values".
 */
async function machineAttrValues(
  names: readonly string[],
): Promise<Map<string, Set<string> | null>> {
  const out = new Map<string, Set<string> | null>()
  for (const name of names) {
    for (const dir of [MACHINES, PATTERNS]) {
      const file = path.join(dir, `${name}.ts`)
      if (!existsSync(file)) continue
      const found: Map<string, Set<string> | null> = publishedAttrValues(
        file,
        await readFile(file, 'utf8'),
      )
      for (const [attr, values] of found) {
        if (!out.has(attr)) {
          out.set(attr, values === null ? null : new Set(values))
          continue
        }
        const prev = out.get(attr)!
        if (prev === null || values === null) out.set(attr, null)
        else for (const v of values) prev.add(v)
      }
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
   * The VALUE half of the same bug class. A recipe can name the right attribute
   * and still match nothing, because upstream and LLui spell the same boolean
   * state differently: shadcn writes `data-invalid="true"`, and every boolean
   * `data-*` in `@llui/components` is published BARE (`'' | undefined`) — the
   * package-wide convention, used by roughly forty machines.
   *
   * `field.ts` shipped THREE such rules and the name-level check above was green
   * on all of them: the `Field` root's `data-[invalid=true]:text-destructive`,
   * and `group-data-[disabled=true]/field:opacity-50` on both `FieldLabel` and
   * `FieldTitle`. An invalid field never turned red and a disabled one never
   * dimmed, against a machine that was publishing the state correctly the whole
   * time.
   *
   * Same one-direction rule as the name check, and the same silence where there
   * is no verdict: an attribute whose declared type is OPEN (a `string`, an
   * imported alias) is skipped rather than guessed at.
   */
  it('reports no recipe attribute VALUE its machine never emits', async () => {
    const files = (await readdir(UI)).filter((f) => f.endsWith('.ts'))
    const problems: string[] = []
    for (const file of files) {
      const slug = file.slice(0, -3)
      const names = MACHINE_OF[slug] ?? [slug]
      if (names.length === 0) continue
      const published = await machineAttrValues(names)
      if (published.size === 0) continue
      const full = path.join(UI, file)
      const candidates: string[] = extractClassCandidates(full, await readFile(full, 'utf8'))
      const bare = new Set(candidates.flatMap((c) => bareAttrsInCandidate(c) as string[]))
      const pairs = new Set(candidates.flatMap((c) => attrValuePairsInCandidate(c) as string[]))
      for (const pair of [...pairs].sort()) {
        const eq = pair.indexOf('=')
        const attr = pair.slice(0, eq)
        const value = pair.slice(eq + 1)
        // `data-part` / `data-scope` name a PART, not a state, and a registry
        // component legitimately declares parts of its own that no machine has
        // (`select-value`, `sidebar-menu-action`). Checking their values would
        // report the convention working as designed.
        if (attr === 'data-part' || attr === 'data-scope') continue
        // A NAME-level allowance already says this attribute is not machine
        // state in this file, so its value is not the machine's to answer for.
        if (ALLOWED[`${file}: ${attr}`] !== undefined || ALLOWED[`*: ${attr}`] !== undefined)
          continue
        const values = published.get(attr)
        // Not published at all → the NAME check owns it. Open type → no verdict.
        if (values === undefined || values === null) continue
        if (values.has(value)) continue
        const allowance = VALUE_ALLOWED[`${file}: ${pair}`]
        if (allowance !== undefined) {
          const paired = allowance.pairedWith
          // Paired against the BARE spelling set, never the name set: the dead
          // bracketed form contributes its own name, so a name-level pairing
          // would be satisfied by the very rule it is meant to justify.
          if (paired === undefined || bare.has(paired) || pairs.has(paired)) continue
          problems.push(
            `  ${file}: ${pair} is allowed ONLY alongside ${paired}, which this file no longer ` +
              `references — the upstream spelling is now the only one, and it matches nothing`,
          )
          continue
        }
        const emitted =
          values.size === 0
            ? '(absent only)'
            : [...values].map((v) => (v === '' ? '"" (bare)' : `"${v}"`)).join(', ')
        problems.push(
          `  ${file}: styles \`${attr}=${value}\` but ${names.join('/')} emits ${emitted}`,
        )
      }
    }
    expect(
      problems,
      'These recipes style a VALUE their machine never publishes, so the rule can never ' +
        'match. Bind the LLui spelling too (see registry/README.md), or add it to ' +
        'VALUE_ALLOWED with a reason:\n' +
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

/**
 * The SAME invariant, applied to the other styling path.
 *
 * `theme.css` is the opt-in BASELINE stylesheet — 1748 lines of
 * `[data-scope][data-part]` rules that make components look finished without
 * Tailwind. It keys off exactly the same `data-*` contract the registry recipes
 * do, so it can rot in exactly the same way: a selector naming an attribute the
 * machine never publishes is valid CSS that never matches, with no error and no
 * warning.
 *
 * It had no check at all until this ran ad hoc and found one — the drawer's
 * enter animation selected `[data-placement=…]` against a machine publishing
 * `data-side`, so the baseline drawer slid in from nowhere. One dead rule in
 * 1748 lines is a healthy sheet; the point of putting it in CI is that the next
 * one is caught at the commit that writes it rather than whenever someone
 * thinks to look.
 */
const THEME_CSS = path.join(ROOT, 'packages/components/src/styles/theme.css')

/** scope → the `data-*` / `aria-*` names its rules select on. */
function themeAttrsByScope(css: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  // Selectors are everything before each `{`; splitting on `}` gives one block
  // per rule. Crude, and sufficient: this sheet has no nested selectors.
  for (const block of css.split('}')) {
    const selector = block.split('{')[0]
    if (selector === undefined) continue
    const scopes = [...selector.matchAll(/\[data-scope=['"]?([a-z-]+)/g)].map((m) => m[1]!)
    if (scopes.length === 0) continue
    const attrs = [...selector.matchAll(/\[((?:data|aria)-[a-z-]+)/g)]
      .map((m) => m[1]!)
      .filter((a) => a !== 'data-scope' && a !== 'data-part')
    for (const scope of scopes) {
      const set = out.get(scope) ?? new Set<string>()
      attrs.forEach((a) => set.add(a))
      out.set(scope, set)
    }
  }
  return out
}

/** Baseline scopes whose rules span several machines, as the registry's own
 * MACHINE_OF does. Anything unlisted is looked up by its own name. */
const THEME_MACHINE_OF: Record<string, readonly string[]> = {
  menu: ['menu', 'menu-machine'],
  'context-menu': ['context-menu', 'menu-machine'],
  menubar: ['menubar', 'menu', 'menu-machine'],
}

describe('the baseline stylesheet only styles attributes its machine publishes', () => {
  it('maps every styled scope to a machine', async () => {
    const byScope = themeAttrsByScope(await readFile(THEME_CSS, 'utf8'))
    expect(byScope.size).toBeGreaterThan(20)
    const unmapped = [...byScope.keys()].filter(
      (s) =>
        THEME_MACHINE_OF[s] === undefined &&
        !existsSync(path.join(MACHINES, `${s}.ts`)) &&
        !existsSync(path.join(PATTERNS, `${s}.ts`)),
    )
    expect(
      unmapped,
      `These scopes name no machine — add them to THEME_MACHINE_OF:\n  ${unmapped.join('\n  ')}`,
    ).toEqual([])
  })

  it('reports no dead rule', async () => {
    const byScope = themeAttrsByScope(await readFile(THEME_CSS, 'utf8'))
    const problems: string[] = []
    for (const [scope, attrs] of byScope) {
      const published = await machineAttrs(THEME_MACHINE_OF[scope] ?? [scope])
      if (published.size === 0) continue
      for (const attr of [...attrs].sort()) {
        if (published.has(attr) || ALLOWED[`*: ${attr}`] !== undefined) continue
        problems.push(`  [data-scope='${scope}'] … [${attr}] — the machine never publishes it`)
      }
    }
    expect(problems, 'These baseline rules can never match:\n' + problems.join('\n')).toEqual([])
  })

  it('detects a dead rule', async () => {
    // The shape that shipped: the drawer's slide-in on `data-placement`.
    const published = await machineAttrs(['drawer'])
    expect(published.has('data-side')).toBe(true)
    expect(published.has('data-placement')).toBe(false)
  })
})
