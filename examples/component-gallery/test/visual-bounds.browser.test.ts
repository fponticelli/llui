// @vitest-environment node
/**
 * `paintedBounds` decides the region every visual baseline is cut from, so
 * what it counts is part of the gate's contract: a box that paints must widen
 * the capture, and a VISUALLY HIDDEN one (the screen-reader-only pattern) —
 * or anything inside it — must not. Before this was pinned, the sortable
 * list's polite live region (1x1, `margin: -1px`) grew every sortable capture
 * by one column of background.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser, Page } from 'playwright'
import { paintedBounds } from './gates/visual'
import { useHermeticBrowser } from '../../../scripts/lib/hermetic-browser.mjs'

const hermetic = useHermeticBrowser()

let browser: Browser
let page: Page

beforeAll(async () => {
  browser = await hermetic.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 })
})
afterAll(async () => {
  await browser?.close()
})

const SR_ONLY_CLIP =
  'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0'
const SR_ONLY_CLIP_PATH =
  'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0'
const SR_ONLY_OVERFLOW =
  'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;white-space:nowrap;border:0'

/** A 100x40 painted box at (40, 30), then `extra` after it inside the host. */
async function bounds(extra: string): Promise<ReturnType<typeof paintedBounds>> {
  await page.setContent(`<!doctype html>
    <body style="margin:0">
      <div id="gallery-document">
        <div id="gallery-scenario" style="position:relative">
          <div style="position:absolute;left:40px;top:30px;width:100px;height:40px;background:#08f"></div>
          ${extra}
        </div>
      </div>
    </body>`)
  return page.evaluate(paintedBounds)
}

const PAINTED_ONLY = { x: 32, y: 22, width: 116, height: 56 }

describe('paintedBounds', () => {
  it('is the painted box plus the 8px pad', async () => {
    expect(await bounds('')).toEqual(PAINTED_ONLY)
  })

  it.each([
    ['clip: rect(0 0 0 0)', SR_ONLY_CLIP],
    ['clip-path: inset(50%)', SR_ONLY_CLIP_PATH],
    ['a 1x1 box that clips its overflow', SR_ONLY_OVERFLOW],
  ])('ignores a visually hidden element (%s) placed beyond the painted box', async (_, style) => {
    const extra = `<div style="${style};left:180px;top:120px">Picked up Apple, item 2 of 5.</div>`
    expect(await bounds(extra)).toEqual(PAINTED_ONLY)
  })

  it('ignores what is INSIDE a visually hidden element too', async () => {
    const extra = `<div style="${SR_ONLY_CLIP};left:180px;top:120px"><span style="display:inline-block;width:300px;height:30px">long text</span></div>`
    expect(await bounds(extra)).toEqual(PAINTED_ONLY)
  })

  it('still counts a real 1px-thin rule and a real 1x1 dot that do not clip', async () => {
    // A separator is thin but wide; a dot with visible overflow paints.
    const rule = await bounds(
      '<div style="position:absolute;left:40px;top:200px;width:300px;height:1px;background:#000"></div>',
    )
    expect(rule).toEqual({ x: 32, y: 22, width: 316, height: 187 })
    const dot = await bounds(
      '<div style="position:absolute;left:200px;top:30px;width:1px;height:1px;background:#000"></div>',
    )
    expect(dot).toEqual({ x: 32, y: 22, width: 177, height: 56 })
  })

  it('counts content portaled outside the document root', async () => {
    await page.setContent(`<!doctype html>
      <body style="margin:0">
        <div id="gallery-document"><div id="gallery-scenario"></div></div>
        <div style="position:absolute;left:10px;top:10px;width:50px;height:20px;background:#f80"></div>
      </body>`)
    expect(await page.evaluate(paintedBounds)).toEqual({ x: 2, y: 2, width: 66, height: 36 })
  })
})
