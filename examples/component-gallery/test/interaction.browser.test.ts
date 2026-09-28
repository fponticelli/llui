// @vitest-environment node
/**
 * Keyboard and pointer interaction, per component family, on BOTH styling
 * paths (#268). Each flow drives a real scenario document — the same machine
 * code on both paths, reached through each path's own renderer and skin — and
 * asserts through ARIA and focus, never through a path's classes, so one flow
 * is one contract that both paths must honour.
 *
 * The flows cover the foundational interaction patterns: focus restoration,
 * focus trapping, roving focus, selection, dismissal (Escape and outside
 * pointer), drag and resize (pointer and keyboard), reordering a live list
 * (pointer and keyboard), and live validation.
 * `the flow set` below pins that every family and every pattern is covered on
 * both paths, so the matrix cannot quietly thin out.
 *
 * Titles are `<entry> › <path> › <case> › <flow>`.
 *
 * Focus probes follow docs/agents/verification.md: the action moves focus
 * with the element's own `HTMLElement.focus()` (never Playwright's
 * `page.focus()`, which can re-assert focus after the action), and
 * `document.activeElement` is read in the page.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { chromium, type Browser, type Locator, type Page } from 'playwright'
import { GALLERY_PATH_SEGMENTS } from '@llui/cli/gallery'
import type { PresentationFamily } from '@llui/cli'
import { DocumentPool } from './gates/document-page'
import { renderedCases, type GalleryCase } from './gates/matrix'

const base = inject('galleryBase')
let browser: Browser
let pool: DocumentPool

beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
  pool = new DocumentPool(browser, base, 4)
})
afterAll(async () => {
  await pool?.close()
  await browser?.close()
})

type Pattern =
  | 'focus-restoration'
  | 'focus-trap'
  | 'roving-focus'
  | 'selection'
  | 'dismissal'
  | 'drag'
  | 'resize'
  | 'validation'
  | 'keyboard-activation'
  | 'reorder'

interface Flow {
  readonly entry: string
  readonly caseId: string
  readonly name: string
  readonly patterns: readonly Pattern[]
  run(page: Page): Promise<void>
}

const part = (page: Page, scope: string, name: string): Locator =>
  page.locator(`[data-scope="${scope}"][data-part="${name}"]`)

/** The id of `document.activeElement`, or its tag when it has none. */
const active = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const element = document.activeElement
    if (element === null) return 'null'
    return element.id !== '' ? `#${element.id}` : element.tagName.toLowerCase()
  })

const activeMatches = (page: Page, selector: string): Promise<boolean> =>
  page.evaluate((query) => document.activeElement?.matches(query) ?? false, selector)

/** Focus with the element's OWN `focus()` (verification.md focus probes). */
async function focus(locator: Locator): Promise<void> {
  await locator.evaluate((element) => (element as HTMLElement).focus())
}

async function center(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox()
  if (box === null) throw new Error('element has no box')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  // Several steps: pointer-move handlers see a real gesture, not a jump.
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 })
  await page.mouse.up()
}

/** The sortable's item labels, in DOM order. */
const sortableOrder = (page: Page): Promise<string[]> =>
  page
    .locator('[data-scope="sortable"][data-part="item"]')
    .evaluateAll((elements) => elements.map((element) => element.textContent?.trim() ?? ''))

const FLOWS: readonly Flow[] = [
  // ── forms-controls ────────────────────────────────────────────────────
  {
    entry: 'checkbox',
    caseId: 'default',
    name: 'pointer and Space toggle the checked state',
    patterns: ['selection', 'keyboard-activation'],
    async run(page) {
      const box = page.locator('[role="checkbox"]').first()
      expect(await box.getAttribute('aria-checked')).toBe('false')
      await box.click()
      expect(await box.getAttribute('aria-checked')).toBe('true')
      await focus(box)
      await page.keyboard.press('Space')
      expect(await box.getAttribute('aria-checked')).toBe('false')
    },
  },
  {
    entry: 'radio-group',
    caseId: 'default',
    name: 'arrow keys rove focus and select',
    patterns: ['roving-focus', 'selection'],
    async run(page) {
      const radios = page.locator('[role="radio"]')
      expect(await radios.count()).toBeGreaterThan(1)
      // One tab stop: exactly one radio is in the tab sequence.
      const stops = await radios.evaluateAll(
        (elements) => elements.filter((element) => element.getAttribute('tabindex') === '0').length,
      )
      expect(stops).toBe(1)
      await focus(radios.nth(0))
      await page.keyboard.press('ArrowDown')
      expect(await activeMatches(page, '[role="radio"]')).toBe(true)
      expect(await radios.nth(1).evaluate((element) => element === document.activeElement)).toBe(
        true,
      )
      expect(await radios.nth(1).getAttribute('aria-checked')).toBe('true')
      expect(await radios.nth(0).getAttribute('aria-checked')).toBe('false')
    },
  },
  {
    entry: 'slider',
    caseId: 'default',
    name: 'arrow keys step the value and a pointer drag moves the thumb',
    patterns: ['drag', 'keyboard-activation'],
    async run(page) {
      const thumb = page.locator('[role="slider"]').first()
      const before = Number(await thumb.getAttribute('aria-valuenow'))
      await focus(thumb)
      await page.keyboard.press('ArrowRight')
      const stepped = Number(await thumb.getAttribute('aria-valuenow'))
      expect(stepped).toBeGreaterThan(before)
      const track = part(page, 'slider', 'control').first()
      const box = (await track.boundingBox())!
      const from = await center(thumb)
      await drag(page, from, box.x + box.width - from.x + 20, 0)
      expect(Number(await thumb.getAttribute('aria-valuenow'))).toBe(
        Number(await thumb.getAttribute('aria-valuemax')),
      )
    },
  },
  // ── navigation-data ───────────────────────────────────────────────────
  {
    entry: 'tabs',
    caseId: 'active',
    name: 'arrow keys rove focus and activate the next tab',
    patterns: ['roving-focus', 'selection'],
    async run(page) {
      const tabs = page.locator('[role="tab"]')
      const selected = page.locator('[role="tab"][aria-selected="true"]')
      const first = await selected.getAttribute('id')
      await focus(selected)
      await page.keyboard.press(
        (await page.evaluate(() => document.documentElement.dir)) === 'rtl'
          ? 'ArrowLeft'
          : 'ArrowRight',
      )
      const now = await page.locator('[role="tab"][aria-selected="true"]').getAttribute('id')
      expect(now).not.toBe(first)
      expect(await active(page)).toBe(`#${now}`)
      expect(await tabs.count()).toBeGreaterThan(1)
      const panel = page.locator(`[role="tabpanel"][aria-labelledby="${now}"]`)
      await panel.waitFor({ state: 'visible', timeout: 5_000 })
    },
  },
  {
    entry: 'accordion',
    caseId: 'closed',
    name: 'Enter expands a section and reveals its region',
    patterns: ['keyboard-activation'],
    async run(page) {
      const trigger = page.locator('[aria-expanded][aria-controls]').first()
      expect(await trigger.getAttribute('aria-expanded')).toBe('false')
      await focus(trigger)
      await page.keyboard.press('Enter')
      expect(await trigger.getAttribute('aria-expanded')).toBe('true')
      const region = page.locator(
        `#${(await trigger.getAttribute('aria-controls'))!.replace(/:/g, '\\:')}`,
      )
      // Retrying: a skin may reveal the region over an enter transition.
      await region.waitFor({ state: 'visible', timeout: 5_000 })
    },
  },
  {
    entry: 'tree-view',
    caseId: 'collapsed',
    name: 'arrow keys expand a branch and rove into it',
    patterns: ['roving-focus', 'keyboard-activation'],
    async run(page) {
      const branch = page.locator('[role="treeitem"][aria-expanded="false"]').first()
      const branchId = await branch.getAttribute('id')
      await focus(branch)
      await page.keyboard.press('ArrowRight')
      expect(
        await page.locator(`[role="treeitem"][id="${branchId}"]`).getAttribute('aria-expanded'),
      ).toBe('true')
      await page.keyboard.press('ArrowDown')
      expect(await activeMatches(page, '[role="treeitem"]')).toBe(true)
      expect(await active(page)).not.toBe(`#${branchId}`)
    },
  },
  // ── menus-overlays ────────────────────────────────────────────────────
  {
    entry: 'dialog',
    caseId: 'modal',
    name: 'Escape dismisses; reopened from the keyboard, Tab is trapped and focus returns',
    patterns: ['focus-trap', 'dismissal', 'focus-restoration', 'keyboard-activation'],
    async run(page) {
      const dialog = page.locator('[role="dialog"]').first()
      await dialog.waitFor()
      await focus(dialog)
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached' })
      // Reopen the way a user does, so the engine records a real return target.
      const trigger = page.locator('[aria-haspopup="dialog"]').first()
      await focus(trigger)
      await page.keyboard.press('Enter')
      await dialog.waitFor()
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
        true,
      )
      // Shift+Tab from the FIRST focusable must wrap to the LAST — the
      // direction that crosses the trap's edge (verification.md).
      const inside = dialog.locator('button, [href], input, [tabindex]:not([tabindex="-1"])')
      expect(await inside.count()).toBeGreaterThan(0)
      await focus(inside.first())
      await page.keyboard.press('Shift+Tab')
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
        true,
      )
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached' })
      expect(await trigger.evaluate((element) => element === document.activeElement)).toBe(true)
    },
  },
  {
    entry: 'menu',
    caseId: 'open',
    name: 'the keyboard opens it, arrows move the highlight, Escape restores focus',
    patterns: ['roving-focus', 'dismissal', 'focus-restoration', 'keyboard-activation'],
    async run(page) {
      const menu = page.locator('[role="menu"]').first()
      await menu.waitFor()
      await focus(menu)
      await page.keyboard.press('Escape')
      await menu.waitFor({ state: 'detached' })
      const trigger = page.locator('[aria-haspopup="menu"]').first()
      await focus(trigger)
      await page.keyboard.press('ArrowDown')
      await menu.waitFor()
      const first = await menu.getAttribute('aria-activedescendant')
      await page.keyboard.press('ArrowDown')
      const next = await menu.getAttribute('aria-activedescendant')
      expect(next).not.toBeNull()
      expect(next).not.toBe(first)
      expect(await page.locator(`[id="${next}"]`).getAttribute('role')).toMatch(/^menuitem/)
      await page.keyboard.press('Escape')
      await menu.waitFor({ state: 'detached' })
      expect(await trigger.evaluate((element) => element === document.activeElement)).toBe(true)
    },
  },
  {
    entry: 'menu',
    caseId: 'overflow',
    name: 'End highlights the last item and scrolls it into view',
    patterns: ['roving-focus'],
    async run(page) {
      const menu = page.locator('[role="menu"]').first()
      await menu.waitFor()
      // Vacuity: the case really overflows, or scrolling proves nothing.
      expect(await menu.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
        true,
      )
      await focus(menu)
      await page.keyboard.press('End')
      const last = await menu.getAttribute('aria-activedescendant')
      const items = menu.locator('[role^="menuitem"]')
      expect(last).toBe(await items.last().getAttribute('id'))
      const visible = await menu.evaluate((element, id) => {
        const item = document.getElementById(id!)!
        const outer = element.getBoundingClientRect()
        const inner = item.getBoundingClientRect()
        return inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1
      }, last)
      expect(visible).toBe(true)
    },
  },
  {
    entry: 'popover',
    caseId: 'open',
    name: 'a pointer press outside dismisses it',
    patterns: ['dismissal'],
    async run(page) {
      const content = part(page, 'popover', 'content').first()
      await content.waitFor()
      await page.mouse.click(5, 5)
      await content.waitFor({ state: 'detached' })
      expect(await part(page, 'popover', 'trigger').first().getAttribute('aria-expanded')).toBe(
        'false',
      )
    },
  },
  {
    entry: 'command-menu',
    caseId: 'open',
    name: 'typing filters the listbox, arrows move the active option, Escape clears then closes',
    patterns: ['selection', 'keyboard-activation', 'dismissal'],
    async run(page) {
      const search = page.locator('input[role="combobox"]').first()
      await search.waitFor()
      const listbox = page.locator(`[id="${await search.getAttribute('aria-controls')}"]`)
      expect(await listbox.getAttribute('role')).toBe('listbox')
      const options = listbox.locator('[role="option"]')
      const labels = await options.allTextContents()
      expect(labels.length).toBeGreaterThan(1)
      // The palette highlights its first command, and the input names it.
      const first = await search.getAttribute('aria-activedescendant')
      expect(first).toBe(await options.nth(0).getAttribute('id'))
      await focus(search)
      await page.keyboard.press('ArrowDown')
      const next = await search.getAttribute('aria-activedescendant')
      expect(next).toBe(await options.nth(1).getAttribute('id'))
      expect(await page.locator(`[id="${next}"]`).getAttribute('data-highlighted')).toBe('')

      // Filtering keeps only the matching commands as options.
      const target = labels[1] ?? ''
      await page.keyboard.type(target)
      expect(await options.allTextContents()).toEqual([target])
      expect(await search.getAttribute('aria-activedescendant')).toBe(
        await options.nth(0).getAttribute('id'),
      )
      await page.keyboard.press('Escape')
      expect(await search.inputValue()).toBe('')
      expect(await options.allTextContents()).toEqual(labels)
      await page.keyboard.press('Escape')
      await listbox.waitFor({ state: 'detached' })
    },
  },
  {
    entry: 'select',
    caseId: 'closed',
    name: 'the keyboard opens the list and commits a selection',
    patterns: ['selection', 'keyboard-activation', 'focus-restoration'],
    async run(page) {
      const trigger = page.locator('[role="combobox"]').first()
      await focus(trigger)
      await page.keyboard.press('ArrowDown')
      const listbox = page.locator('[role="listbox"]').first()
      await listbox.waitFor()
      await page.keyboard.press('ArrowDown')
      const highlighted = await trigger.getAttribute('aria-activedescendant')
      expect(highlighted).not.toBeNull()
      await page.keyboard.press('Enter')
      await listbox.waitFor({ state: 'detached' })
      expect(await page.locator(`[id="${highlighted}"]`).count()).toBe(0)
      expect(await trigger.getAttribute('data-placeholder')).toBeNull()
      expect(await activeMatches(page, '[role="combobox"]')).toBe(true)
    },
  },
  // ── specialized-tools ─────────────────────────────────────────────────
  {
    entry: 'splitter',
    caseId: 'horizontal',
    name: 'the separator resizes by keyboard and by pointer drag',
    patterns: ['resize', 'drag'],
    async run(page) {
      const separator = page.locator('[role="separator"]').first()
      const start = Number(await separator.getAttribute('aria-valuenow'))
      await focus(separator)
      await page.keyboard.press('ArrowRight')
      const stepped = Number(await separator.getAttribute('aria-valuenow'))
      expect(stepped).not.toBe(start)
      await drag(page, await center(separator), -60, 0)
      expect(Number(await separator.getAttribute('aria-valuenow'))).not.toBe(stepped)
    },
  },
  {
    entry: 'floating-panel',
    caseId: 'open',
    name: 'the title bar drags the panel and a corner grip resizes it',
    patterns: ['drag', 'resize'],
    async run(page) {
      const root = part(page, 'floating-panel', 'root').first()
      const before = (await root.boundingBox())!
      await drag(page, await center(part(page, 'floating-panel', 'drag-handle').first()), 40, 30)
      const moved = (await root.boundingBox())!
      expect(Math.round(moved.x - before.x)).toBe(40)
      expect(Math.round(moved.y - before.y)).toBe(30)
      await drag(
        page,
        await center(page.locator('[data-part="resize-handle"][data-handle="se"]')),
        30,
        20,
      )
      const resized = (await root.boundingBox())!
      expect(Math.round(resized.width - moved.width)).toBe(30)
      expect(Math.round(resized.height - moved.height)).toBe(20)
    },
  },
  {
    entry: 'sortable',
    caseId: 'idle',
    name: 'Space grabs, arrows move the drop target, Space drops and the list reorders',
    patterns: ['reorder', 'keyboard-activation', 'focus-restoration'],
    async run(page) {
      const items = part(page, 'sortable', 'item')
      const before = await sortableOrder(page)
      expect(before).toHaveLength(3)
      const handle = items.nth(0).locator('[data-part="handle"]')
      expect(await handle.getAttribute('role')).toBe('button')
      expect(await handle.getAttribute('aria-grabbed')).toBe('false')

      // Escape puts a grabbed item back where it was.
      await focus(handle)
      await page.keyboard.press('Space')
      expect(await handle.getAttribute('aria-grabbed')).toBe('true')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Escape')
      expect(await sortableOrder(page)).toEqual(before)
      expect(await page.locator('[aria-grabbed="true"]').count()).toBe(0)

      await page.keyboard.press('Space')
      expect(await items.nth(0).getAttribute('data-dragging')).toBe('')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowDown')
      // Past the end is not a slot: the target stays on the last item.
      await page.keyboard.press('ArrowDown')
      const over = page.locator('[data-scope="sortable"][data-part="item"][data-over]')
      expect(await over.count()).toBe(1)
      expect(await over.getAttribute('data-id')).toBe(await items.nth(2).getAttribute('data-id'))
      await page.keyboard.press('Space')

      expect(await sortableOrder(page)).toEqual([before[1], before[2], before[0]])
      expect(await page.locator('[aria-grabbed="true"]').count()).toBe(0)
      // Focus stays on the handle of the item just placed, now last.
      expect(
        await items
          .nth(2)
          .locator('[data-part="handle"]')
          .evaluate((element) => element === document.activeElement),
      ).toBe(true)

      // The moved item is grabbed from where it NOW is, not where it rendered.
      await page.keyboard.press('Space')
      await page.keyboard.press('ArrowUp')
      await page.keyboard.press('Space')
      expect(await sortableOrder(page)).toEqual([before[1], before[0], before[2]])
    },
  },
  {
    entry: 'sortable',
    caseId: 'idle',
    name: 'a pointer drag on a handle reorders the list',
    patterns: ['reorder', 'drag'],
    async run(page) {
      const items = part(page, 'sortable', 'item')
      const before = await sortableOrder(page)
      const from = await center(items.nth(0).locator('[data-part="handle"]'))
      const to = await center(items.nth(2))
      await drag(page, from, 0, to.y - from.y)
      expect(await sortableOrder(page)).toEqual([before[1], before[2], before[0]])
      expect(
        await page
          .locator('[data-scope="sortable"][data-part="root"]')
          .getAttribute('data-dragging'),
      ).toBeNull()
      expect(await page.locator('[aria-grabbed="true"]').count()).toBe(0)
    },
  },
  {
    entry: 'date-input',
    caseId: 'empty',
    name: 'an invalid entry is flagged and described on commit',
    patterns: ['validation'],
    async run(page) {
      const field = part(page, 'date-input', 'input').first()
      expect(await field.getAttribute('aria-invalid')).toBeNull()
      await field.click()
      await page.keyboard.type('2026-13-45')
      await page.keyboard.press('Enter')
      expect(await field.getAttribute('aria-invalid')).toBe('true')
      const describedBy = (await field.getAttribute('aria-describedby')) ?? ''
      expect(describedBy).not.toBe('')
      const message = await page.evaluate(
        (ids) =>
          ids
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? '')
            .join(' ')
            .trim(),
        describedBy,
      )
      expect(message).not.toBe('')
    },
  },
]

const PATTERNS: readonly Pattern[] = [
  'focus-restoration',
  'focus-trap',
  'roving-focus',
  'selection',
  'dismissal',
  'drag',
  'resize',
  'validation',
  'keyboard-activation',
  'reorder',
]

function flowCases(flow: Flow): GalleryCase[] {
  return renderedCases().filter(
    ({ entry, caseId }) => entry === flow.entry && caseId === flow.caseId,
  )
}

describe('the flow set', () => {
  it('names only rendered cases, each on both paths', () => {
    for (const flow of FLOWS) {
      expect(
        flowCases(flow)
          .map(({ path }) => path)
          .sort(),
        `${flow.entry}/${flow.caseId}`,
      ).toEqual(['baseline', 'registryTailwind'])
    }
  })

  it('covers every component family and every foundational pattern', () => {
    const families = new Set<PresentationFamily>(
      FLOWS.flatMap((flow) => flowCases(flow).map(({ family }) => family)),
    )
    expect([...families].sort()).toEqual([
      'forms-controls',
      'menus-overlays',
      'navigation-data',
      'specialized-tools',
    ])
    const covered = new Set(FLOWS.flatMap(({ patterns }) => patterns))
    expect(PATTERNS.filter((pattern) => !covered.has(pattern))).toEqual([])
  })
})

describe.concurrent('keyboard and pointer flows (#268)', () => {
  const cases = FLOWS.flatMap((flow) =>
    flowCases(flow).map((galleryCase): [string, Flow, GalleryCase] => [
      [flow.entry, GALLERY_PATH_SEGMENTS[galleryCase.path], flow.caseId, flow.name].join(' › '),
      flow,
      galleryCase,
    ]),
  )
  it.each(cases)('%s', async (_title, flow, galleryCase) => {
    const faults = await pool.with(galleryCase, async (opened) => {
      expect(opened.status).toBe('ready')
      await flow.run(opened.page)
      return opened.faultLines()
    })
    expect(faults).toEqual([])
  })
})
