// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, type Browser } from 'playwright'

const STYLES = resolve(import.meta.dirname, '../../src/styles')
const semanticTokens = readFileSync(resolve(STYLES, 'semantic-tokens.css'), 'utf8')
const disclosureNavigation = readFileSync(resolve(STYLES, 'disclosure-navigation.css'), 'utf8')
const foundation = readFileSync(resolve(STYLES, 'foundation.css'), 'utf8')
const menusOverlays = readFileSync(resolve(STYLES, 'menus-overlays.css'), 'utf8')
const motion = readFileSync(resolve(STYLES, 'motion.css'), 'utf8')

describe('baseline physical coordinate contracts in Chromium', () => {
  let browser: Browser

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true })
  })

  afterAll(async () => {
    await browser?.close()
  })

  it("keeps tabs' physical offsetLeft coordinate unchanged in RTL", async () => {
    const page = await browser.newPage()
    await page.setContent(`<!doctype html>
      <style>${semanticTokens}</style>
      <style>${disclosureNavigation}</style>
      <div id="list" data-scope="tabs" data-part="list" style="width: 400px; height: 20px">
        <div
          id="indicator"
          data-scope="tabs"
          data-part="indicator"
          style="--indicator-left: 72px; --indicator-width: 48px"
        ></div>
      </div>`)

    const offsets = await page.evaluate(() => {
      const list = document.querySelector<HTMLElement>('#list')!
      const indicator = document.querySelector<HTMLElement>('#indicator')!
      const measure = (): number =>
        indicator.getBoundingClientRect().left - list.getBoundingClientRect().left

      list.dir = 'ltr'
      const ltr = measure()
      list.dir = 'rtl'
      const rtl = measure()
      return { ltr, rtl }
    })
    await page.close()

    expect(offsets).toEqual({ ltr: 72, rtl: 72 })
  })

  it('positions and animates every drawer side from its physical edge in LTR and RTL', async () => {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
    await page.setContent(`<!doctype html>
      <style>${semanticTokens}</style>
      <style>${foundation}</style>
      <style>${menusOverlays}</style>
      <style>${motion}</style>
      <div data-scope="drawer" data-part="positioner">
        <div id="drawer" data-scope="drawer" data-part="content" data-state="closed"></div>
      </div>`)

    const measurements = await page.evaluate(() => {
      const drawer = document.querySelector<HTMLElement>('#drawer')!
      const sides = ['left', 'right', 'top', 'bottom'] as const
      const directions = ['ltr', 'rtl'] as const
      const rows: Array<{
        direction: (typeof directions)[number]
        side: (typeof sides)[number]
        rect: { left: number; right: number; top: number; bottom: number }
        from: string
      }> = []

      const firstTransform = (animationName: string): string => {
        for (const sheet of Array.from(document.styleSheets)) {
          for (const rule of Array.from(sheet.cssRules)) {
            if (rule instanceof CSSKeyframesRule && rule.name === animationName) {
              return (rule.cssRules.item(0) as CSSKeyframeRule | null)?.style.transform ?? ''
            }
          }
        }
        return ''
      }

      for (const direction of directions) {
        document.documentElement.dir = direction
        for (const side of sides) {
          drawer.dataset['side'] = side
          drawer.dataset['state'] = 'closed'
          const box = drawer.getBoundingClientRect()
          drawer.dataset['state'] = 'open'
          const animationName = getComputedStyle(drawer).animationName
          rows.push({
            direction,
            side,
            rect: {
              left: box.left,
              right: box.right,
              top: box.top,
              bottom: box.bottom,
            },
            from: firstTransform(animationName),
          })
        }
      }
      return rows
    })
    await page.close()

    const physical = [
      {
        side: 'left',
        rect: { left: 0, right: 320, top: 0, bottom: 600 },
        from: 'translateX(-100%)',
      },
      {
        side: 'right',
        rect: { left: 480, right: 800, top: 0, bottom: 600 },
        from: 'translateX(100%)',
      },
      {
        side: 'top',
        rect: { left: 0, right: 800, top: 0, bottom: 320 },
        from: 'translateY(-100%)',
      },
      {
        side: 'bottom',
        rect: { left: 0, right: 800, top: 280, bottom: 600 },
        from: 'translateY(100%)',
      },
    ] as const
    expect(measurements).toEqual(
      (['ltr', 'rtl'] as const).flatMap((direction) =>
        physical.map((expected) => ({ direction, ...expected })),
      ),
    )
  })
})
