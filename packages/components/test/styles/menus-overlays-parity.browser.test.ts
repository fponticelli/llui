// @vitest-environment node

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const STYLES = resolve(import.meta.dirname, '../../src/styles')
const baselineCss = [
  'semantic-tokens.css',
  'semantic-tokens-dark.css',
  'foundation.css',
  'menus-overlays.css',
]
  .map((file) => readFileSync(resolve(STYLES, file), 'utf8'))
  .join('\n')

const MENU_SCOPES = ['menu', 'context-menu', 'select', 'combobox', 'searchable-select'] as const
const FLOATING_SCOPES = [...MENU_SCOPES, 'popover', 'hover-card', 'tooltip'] as const

const element = (scope: string, part: string, id: string, attrs = ''): string =>
  `<div id="${id}" data-scope="${scope}" data-part="${part}" ${attrs}>${id}</div>`

const floatingSurface = (scope: string): string => `
  <div id="${scope}-positioner" data-scope="${scope}" data-part="positioner">
    <div id="${scope}-content" data-scope="${scope}" data-part="content" data-side="bottom" ${scope === 'combobox' || scope === 'searchable-select' ? 'aria-busy="true"' : ''}>
      ${element(scope, 'group-label', `${scope}-label`)}
      ${element(scope, 'item', `${scope}-item`)}
      ${element(scope, 'item', `${scope}-highlighted`, 'data-highlighted')}
      ${element(scope, 'item', `${scope}-selected`, 'data-state="selected"')}
      ${element(scope, 'item', `${scope}-checked`, 'role="menuitemcheckbox" aria-checked="true"')}
      ${element(scope, 'item', `${scope}-disabled`, 'data-disabled')}
      <div id="${scope}-destructive" data-variant="destructive" data-scope="${scope}" data-part="item">${scope}-destructive</div>
      ${element(scope, 'separator', `${scope}-separator`)}
      ${element(scope, 'empty', `${scope}-empty`)}
      ${scope === 'menu' || scope === 'context-menu' ? element(scope, 'subtrigger', `${scope}-subtrigger`, 'data-highlighted') : ''}
      ${scope === 'menu' || scope === 'context-menu' ? element(scope, 'subcontent', `${scope}-subcontent`) : ''}
    </div>
  </div>`

const fixture = `<!doctype html><html><head><style>${baselineCss}</style></head><body>
  ${FLOATING_SCOPES.map(floatingSurface).join('\n')}
  <div data-scope="dialog" data-part="positioner">
    ${element('dialog', 'content', 'dialog-content')}
  </div>
  <div data-scope="drawer" data-part="positioner">
    ${element('drawer', 'content', 'drawer-content', 'data-side="right"')}
  </div>
  <div id="toast-region" data-scope="toast" data-part="region" data-placement="bottom-end">
    <div id="toast-root" data-scope="toast" data-part="root" data-type="loading">
      ${element('toast', 'title', 'toast-title')}
      ${element('toast', 'description', 'toast-description')}
      <button id="toast-close" data-scope="toast" data-part="close-trigger">Close</button>
    </div>
  </div>
  <span id="forced-highlight" style="background:Highlight;color:HighlightText"></span>
</body></html>`

type SurfaceVisual = {
  backgroundColor: string
  borderColor: string
  borderRadius: string
  borderStyle: string
  boxShadow: string
  minWidth: string
  overflowY: string
  padding: string
}

const visual = async (page: Page, selector: string): Promise<SurfaceVisual> =>
  page.locator(selector).evaluate((node) => {
    const style = getComputedStyle(node)
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      borderRadius: style.borderRadius,
      borderStyle: style.borderStyle,
      boxShadow: style.boxShadow,
      minWidth: style.minWidth,
      overflowY: style.overflowY,
      padding: style.padding,
    }
  })

describe('menus and overlays baseline parity in Chromium', () => {
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true })
    page = await browser.newPage({ viewport: { width: 1024, height: 768 } })
  })

  beforeEach(async () => {
    await page.emulateMedia({ colorScheme: 'light', forcedColors: 'none' })
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.setContent(fixture)
  })

  afterAll(async () => {
    await page?.close()
    await browser?.close()
  })

  it('gives menu and selection popups one density, surface, and elevation hierarchy', async () => {
    const surfaces = await Promise.all(
      MENU_SCOPES.map((scope) => visual(page, `#${scope}-content`)),
    )
    const reference = surfaces[0]!
    for (const [index, surface] of surfaces.entries()) {
      expect(surface, MENU_SCOPES[index]).toMatchObject({
        backgroundColor: reference.backgroundColor,
        borderColor: reference.borderColor,
        borderRadius: reference.borderRadius,
        borderStyle: 'solid',
        boxShadow: reference.boxShadow,
        minWidth: '128px',
        overflowY: 'auto',
        padding: '4px',
      })
    }
    expect(reference.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    expect(reference.boxShadow).not.toBe('none')
  })

  it('aligns item, nested, selected, checked, disabled, destructive, empty, and separator states', async () => {
    for (const scope of MENU_SCOPES) {
      const item = await page.locator(`#${scope}-item`).evaluate((node) => {
        const style = getComputedStyle(node)
        return {
          alignItems: style.alignItems,
          display: style.display,
          fontSize: style.fontSize,
          minHeight: style.minHeight,
          paddingInline: style.paddingInline,
        }
      })
      expect(item, scope).toEqual({
        alignItems: 'center',
        display: 'flex',
        fontSize: '14px',
        minHeight: '32px',
        paddingInline: '8px',
      })

      const stateVisuals = await page.evaluate((scope) => {
        const state = (name: string): CSSStyleDeclaration =>
          getComputedStyle(document.querySelector<HTMLElement>(`#${scope}-${name}`)!)
        return {
          highlighted: {
            background: state('highlighted').backgroundColor,
            color: state('highlighted').color,
          },
          selectedWeight: state('selected').fontWeight,
          checkedWeight: state('checked').fontWeight,
          disabled: { cursor: state('disabled').cursor, opacity: state('disabled').opacity },
          destructive: { color: state('destructive').color, normalColor: state('item').color },
          separator: {
            height: state('separator').height,
            marginBlock: state('separator').marginBlock,
          },
          empty: {
            color: state('empty').color,
            normalColor: state('item').color,
            textAlign: state('empty').textAlign,
          },
        }
      }, scope)
      expect(stateVisuals.highlighted.background).not.toBe('rgba(0, 0, 0, 0)')
      if (scope === 'select' || scope === 'combobox' || scope === 'searchable-select') {
        expect(Number(stateVisuals.selectedWeight)).toBeGreaterThanOrEqual(500)
      }
      expect(Number(stateVisuals.checkedWeight)).toBeGreaterThanOrEqual(500)
      expect(stateVisuals.disabled).toEqual({ cursor: 'not-allowed', opacity: '0.5' })
      expect(stateVisuals.destructive.color).not.toBe(stateVisuals.destructive.normalColor)
      expect(stateVisuals.separator).toEqual({ height: '1px', marginBlock: '4px' })
      expect(stateVisuals.empty.textAlign).toBe('center')
      expect(stateVisuals.empty.color).not.toBe(stateVisuals.empty.normalColor)

      if (scope === 'menu' || scope === 'context-menu') {
        const nested = await Promise.all([
          visual(page, `#${scope}-subcontent`),
          page.locator(`#${scope}-subtrigger`).evaluate((node) => {
            const style = getComputedStyle(node)
            return { display: style.display, minHeight: style.minHeight }
          }),
        ])
        expect(nested[0]).toMatchObject({
          backgroundColor: (await visual(page, `#${scope}-content`)).backgroundColor,
          borderStyle: 'solid',
          minWidth: '128px',
        })
        expect(nested[1]).toEqual({ display: 'flex', minHeight: '32px' })
      }
    }

    const highlightPairs = await Promise.all(
      MENU_SCOPES.map((scope) =>
        page.locator(`#${scope}-highlighted`).evaluate((node) => {
          const style = getComputedStyle(node)
          return [style.backgroundColor, style.color]
        }),
      ),
    )
    expect(new Set(highlightPairs.map((pair) => pair.join('|')))).toHaveLength(1)
  })

  it('keeps floating layers ordered and surfaces in their visual hierarchy', async () => {
    for (const scope of FLOATING_SCOPES) {
      const zIndex = await page
        .locator(`#${scope}-positioner`)
        .evaluate((node) => getComputedStyle(node).zIndex)
      expect(zIndex, scope).toBe(scope === 'tooltip' ? '150' : '50')
    }
    expect(
      await page.locator('#popover-content').evaluate((node) => getComputedStyle(node).width),
    ).toBe('288px')
    expect(
      await page.locator('#hover-card-content').evaluate((node) => getComputedStyle(node).width),
    ).toBe('256px')
    expect(
      await page.locator('#tooltip-content').evaluate((node) => getComputedStyle(node).padding),
    ).toBe('6px 12px')
  })

  it('keeps modal positioners visibly separated when a view omits the optional backdrop part', async () => {
    for (const scope of ['dialog', 'drawer'] as const) {
      const background = await page
        .locator(`[data-scope="${scope}"][data-part="positioner"]`)
        .evaluate((node) => getComputedStyle(node).backgroundColor)
      expect(background, scope).not.toBe('rgba(0, 0, 0, 0)')
    }
  })

  it('contains wide and tall surfaces inside a narrow viewport', async () => {
    await page.setViewportSize({ width: 280, height: 240 })
    await page.locator('#menu-content').evaluate((node) => {
      ;(node as HTMLElement).style.width = '600px'
      ;(node as HTMLElement).style.height = '600px'
    })
    const menuBox = await page.locator('#menu-content').boundingBox()
    const dialogBox = await page.locator('#dialog-content').boundingBox()
    const drawerBox = await page.locator('#drawer-content').boundingBox()
    const toastBox = await page.locator('#toast-region').boundingBox()
    expect(menuBox?.width).toBeLessThanOrEqual(248)
    expect(menuBox?.height).toBeLessThanOrEqual(208)
    expect(dialogBox?.width).toBeLessThanOrEqual(248)
    expect(drawerBox?.width).toBeLessThanOrEqual(280)
    expect(toastBox?.width).toBeLessThanOrEqual(248)
    expect(
      await page
        .locator('#menu-content')
        .evaluate((node) => getComputedStyle(node).overscrollBehavior),
    ).toBe('contain')
  })

  it('distinguishes loading surfaces without replacing their live content', async () => {
    expect(
      await page.locator('#combobox-content').evaluate((node) => getComputedStyle(node).cursor),
    ).toBe('progress')
    expect(
      await page
        .locator('#searchable-select-content')
        .evaluate((node) => getComputedStyle(node).cursor),
    ).toBe('progress')
    expect(
      await page.locator('#toast-root').evaluate((node) => getComputedStyle(node).cursor),
    ).toBe('progress')
  })

  it('places every toast edge logically in LTR and RTL', async () => {
    const placements = [
      'top',
      'top-start',
      'top-end',
      'bottom',
      'bottom-start',
      'bottom-end',
    ] as const
    const readPlacement = async (
      direction: 'ltr' | 'rtl',
      placement: (typeof placements)[number],
    ) => {
      await page.locator('html').evaluate((html, dir) => {
        ;(html as HTMLHtmlElement).dir = dir
      }, direction)
      await page.locator('#toast-region').evaluate((node, value) => {
        node.setAttribute('data-placement', value)
      }, placement)
      return page.locator('#toast-region').evaluate((node) => {
        const style = getComputedStyle(node)
        return {
          top: style.top,
          right: style.right,
          bottom: style.bottom,
          left: style.left,
          transform: style.transform,
        }
      })
    }
    for (const direction of ['ltr', 'rtl'] as const) {
      for (const placement of placements) {
        const position = await readPlacement(direction, placement)
        expect(position.top === '16px', `${direction}/${placement}/top`).toBe(
          placement.startsWith('top'),
        )
        expect(position.bottom === '16px', `${direction}/${placement}/bottom`).toBe(
          placement.startsWith('bottom'),
        )
        if (placement.endsWith('start')) {
          expect(
            direction === 'ltr' ? position.left : position.right,
            `${direction}/${placement}/start`,
          ).toBe('16px')
        } else if (placement.endsWith('end')) {
          expect(
            direction === 'ltr' ? position.right : position.left,
            `${direction}/${placement}/end`,
          ).toBe('16px')
        } else {
          expect(position.left, `${direction}/${placement}/center`).toBe('512px')
          expect(position.transform, `${direction}/${placement}/center transform`).not.toBe('none')
        }
      }
    }
  })

  it('retains surface hierarchy in dark and forced-color modes', async () => {
    const light = await visual(page, '#menu-content')
    await page.emulateMedia({ colorScheme: 'dark', forcedColors: 'none' })
    const dark = await visual(page, '#menu-content')
    expect(dark.backgroundColor).not.toBe(light.backgroundColor)
    expect(dark.borderColor).not.toBe(light.borderColor)
    expect(dark.boxShadow).not.toBe('none')

    await page.emulateMedia({ colorScheme: 'light', forcedColors: 'active' })
    const forced = await page.evaluate(() => {
      const highlighted = getComputedStyle(document.querySelector('#menu-highlighted')!)
      const reference = getComputedStyle(document.querySelector('#forced-highlight')!)
      const surface = getComputedStyle(document.querySelector('#menu-content')!)
      return {
        background: highlighted.backgroundColor,
        color: highlighted.color,
        expectedBackground: reference.backgroundColor,
        expectedColor: reference.color,
        surfaceBorder: surface.borderColor,
      }
    })
    expect(forced.background).toBe(forced.expectedBackground)
    expect(forced.color).toBe(forced.expectedColor)
    expect(forced.surfaceBorder).not.toBe('rgba(0, 0, 0, 0)')
  })
})
