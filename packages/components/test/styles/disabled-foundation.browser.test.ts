// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'

const STYLES = resolve(import.meta.dirname, '../../src/styles')
const semanticTokens = readFileSync(resolve(STYLES, 'semantic-tokens.css'), 'utf8')
const semanticTokensDark = readFileSync(resolve(STYLES, 'semantic-tokens-dark.css'), 'utf8')
const foundation = readFileSync(resolve(STYLES, 'foundation.css'), 'utf8')

const DISABLED_KINDS = ['native', 'aria', 'data'] as const
type DisabledKind = (typeof DISABLED_KINDS)[number]

const BUTTON_VARIANTS = [
  { name: 'primary', className: 'btn-primary' },
  { name: 'secondary', className: 'btn-secondary' },
  { name: 'ghost', className: 'btn-ghost' },
  { name: 'danger', className: 'btn-danger' },
  { name: 'danger ghost', className: 'btn-danger-ghost' },
] as const

const disabledMarkup = (id: string, kind: DisabledKind, children = ''): string => {
  const tag = kind === 'native' ? (children === '' ? 'button' : 'fieldset') : 'div'
  const attribute =
    kind === 'native' ? 'disabled' : kind === 'aria' ? 'aria-disabled="true"' : 'data-disabled'
  return `<${tag} id="${id}" data-scope="test" data-part="${id}" ${attribute}>${children}</${tag}>`
}

const renderFixture = async (page: Page): Promise<void> => {
  const nested = DISABLED_KINDS.flatMap((outer) =>
    DISABLED_KINDS.map((inner) =>
      disabledMarkup(
        `outer-${outer}-${inner}`,
        outer,
        disabledMarkup(`inner-${outer}-${inner}`, inner),
      ),
    ),
  ).join('\n')
  const singles = DISABLED_KINDS.map((kind) => disabledMarkup(`single-${kind}`, kind)).join('\n')

  await page.setContent(`<!doctype html>
    <style>${semanticTokens}</style>
    <style>${semanticTokensDark}</style>
    <style>${foundation}</style>
    <span id="gray-text-reference" style="color: GrayText; border: 1px solid GrayText"></span>
    ${nested}
    ${singles}`)
}

const buttonId = (variant: string, state: 'enabled' | DisabledKind): string =>
  `button-${variant.replace(' ', '-')}-${state}`

const renderButtonFixture = async (page: Page): Promise<void> => {
  const states = ['enabled', ...DISABLED_KINDS] as const
  const buttons = BUTTON_VARIANTS.flatMap(({ name, className }) =>
    states.map((state) => {
      const disabledAttribute =
        state === 'native'
          ? 'disabled'
          : state === 'aria'
            ? 'aria-disabled="true"'
            : state === 'data'
              ? 'data-disabled'
              : ''
      return `<button id="${buttonId(name, state)}" class="btn ${className}" ${disabledAttribute}>${name} ${state}</button>`
    }),
  ).join('\n')

  await page.setContent(`<!doctype html>
    <style>${semanticTokens}</style>
    <style>${semanticTokensDark}</style>
    <style>${foundation}</style>
    <main style="display: grid; grid-template-columns: repeat(4, max-content); gap: 8px; padding: 24px">
      ${buttons}
    </main>`)
}

type ButtonVisual = {
  backgroundColor: string
  borderColor: string
  color: string
  cursor: string
  opacity: string
}

const readButtonVisual = async (page: Page, id: string): Promise<ButtonVisual> =>
  page.locator(`#${id}`).evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      color: style.color,
      cursor: style.cursor,
      opacity: style.opacity,
    }
  })

const settleHover = async (page: Page): Promise<void> => {
  await page.evaluate(
    () => new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame())),
  )
}

describe('baseline disabled-state foundation in Chromium', () => {
  let browser: Browser

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true })
  })

  afterAll(async () => {
    await browser?.close()
  })

  it.each([
    { name: 'light', colorScheme: 'light', forcedColors: 'none' },
    { name: 'dark', colorScheme: 'dark', forcedColors: 'none' },
    { name: 'forced colors', colorScheme: 'light', forcedColors: 'active' },
  ] as const)(
    'applies disabled opacity once across native, ARIA, and data states in $name mode',
    async ({ colorScheme, forcedColors }) => {
      const page = await browser.newPage()
      await page.emulateMedia({ colorScheme, forcedColors })
      await renderFixture(page)

      const result = await page.evaluate(() => {
        const kinds = ['native', 'aria', 'data'] as const
        const styleOf = (id: string): CSSStyleDeclaration =>
          getComputedStyle(document.querySelector<HTMLElement>(`#${id}`)!)
        const nested = kinds.flatMap((outer) =>
          kinds.map((inner) => {
            const outerStyle = styleOf(`outer-${outer}-${inner}`)
            const innerStyle = styleOf(`inner-${outer}-${inner}`)
            return {
              outer,
              inner,
              outerOpacity: outerStyle.opacity,
              innerOpacity: innerStyle.opacity,
              effectiveOpacity: Number(outerStyle.opacity) * Number(innerStyle.opacity),
              outerCursor: outerStyle.cursor,
              innerCursor: innerStyle.cursor,
            }
          }),
        )
        const singles = kinds.map((kind) => {
          const style = styleOf(`single-${kind}`)
          return { kind, opacity: style.opacity, cursor: style.cursor }
        })
        const native = styleOf('single-native')
        const grayText = styleOf('gray-text-reference')
        return {
          nested,
          singles,
          forcedColorPair: {
            color: native.color,
            borderColor: native.borderColor,
            expectedColor: grayText.color,
            expectedBorderColor: grayText.borderColor,
          },
        }
      })
      await page.close()

      expect(result.nested).toEqual(
        (['native', 'aria', 'data'] as const).flatMap((outer) =>
          (['native', 'aria', 'data'] as const).map((inner) => ({
            outer,
            inner,
            outerOpacity: '0.5',
            innerOpacity: '1',
            effectiveOpacity: 0.5,
            outerCursor: 'not-allowed',
            innerCursor: 'not-allowed',
          })),
        ),
      )
      expect(result.singles).toEqual(
        (['native', 'aria', 'data'] as const).map((kind) => ({
          kind,
          opacity: '0.5',
          cursor: 'not-allowed',
        })),
      )
      if (forcedColors === 'active') {
        expect(result.forcedColorPair.color).toBe(result.forcedColorPair.expectedColor)
        expect(result.forcedColorPair.borderColor).toBe(result.forcedColorPair.expectedBorderColor)
      }
    },
  )

  it.each(['light', 'dark'] as const)(
    'lets enabled button variants hover without changing native, ARIA, or data-disabled visuals in %s mode',
    async (colorScheme) => {
      const page = await browser.newPage()
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
      await renderButtonFixture(page)

      for (const { name } of BUTTON_VARIANTS) {
        for (const state of ['enabled', ...DISABLED_KINDS] as const) {
          const id = buttonId(name, state)
          await page.mouse.move(0, 0)
          await settleHover(page)
          const before = await readButtonVisual(page, id)

          await page.locator(`#${id}`).hover()
          await settleHover(page)
          expect(
            await page.locator(`#${id}`).evaluate((element) => element.matches(':hover')),
          ).toBe(true)
          const after = await readButtonVisual(page, id)

          if (state === 'enabled') {
            expect(after.backgroundColor, `${name} enabled background`).not.toBe(
              before.backgroundColor,
            )
            expect(after.cursor, `${name} enabled cursor`).toBe('pointer')
            expect(after.opacity, `${name} enabled opacity`).toBe('1')
          } else {
            expect(after, `${name} ${state} visual`).toEqual(before)
            expect(after.cursor, `${name} ${state} cursor`).toBe('not-allowed')
            expect(after.opacity, `${name} ${state} opacity`).toBe('0.5')
          }
        }
      }

      await page.close()
    },
  )
})
