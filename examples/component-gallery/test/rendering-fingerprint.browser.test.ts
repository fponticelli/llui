// @vitest-environment node
/**
 * The RENDERING FINGERPRINT instrument (`gates/fingerprint.ts`), checked
 * before the visual gate trusts it (#268): it must cover the font stacks the
 * path documents really declare, it must be deterministic — a fingerprint
 * that varies between two runs on one host would switch compare mode off at
 * random — and it must SEE a font change, or it identifies nothing.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import type { Browser } from 'playwright'
import { GALLERY_PATH_SEGMENTS } from '@llui/cli/gallery'
import { PRESENTATION_SCENARIO_PATHS } from '@llui/cli/presentation-scenarios'
import { GATE_CONTEXT_OPTIONS } from './gates/document-page'
import {
  calibrationDigest,
  calibrationDocument,
  declaredFontStacks,
  measureRendering,
} from './gates/fingerprint'
import { decodePng } from './gates/png'
import { useHermeticBrowser } from '../../../scripts/lib/hermetic-browser.mjs'

const hermetic = useHermeticBrowser()
const base = inject('galleryBase')
const SHA256 = /^[0-9a-f]{64}$/

let browser: Browser

beforeAll(async () => {
  browser = await hermetic.launch({ headless: true })
})

afterAll(async () => {
  await browser?.close()
})

describe('the rendering fingerprint', () => {
  it('covers every font stack both path documents declare, their body text and mono among them', async () => {
    const stacks = await declaredFontStacks(browser, base)
    expect(stacks).toEqual([...new Set(stacks)].sort())
    // The documents' own body stacks — what nearly every case's text uses —
    // read independently of the harvester.
    for (const path of PRESENTATION_SCENARIO_PATHS) {
      const context = await browser.newContext(GATE_CONTEXT_OPTIONS)
      try {
        const page = await context.newPage()
        await page.goto(`${base}${GALLERY_PATH_SEGMENTS[path]}/`, { waitUntil: 'load' })
        const body = await page.evaluate(() => getComputedStyle(document.body).fontFamily)
        expect(stacks, path).toContain(body)
      } finally {
        await context.close()
      }
    }
    expect(stacks.some((stack) => /\bmonospace\b/.test(stack))).toBe(true)
    // Declared through a custom property (Tailwind's `font-mono` utility),
    // so harvesting resolved `var(--font-mono)` rather than recording it raw.
    expect(stacks.some((stack) => stack.includes('var('))).toBe(false)
  })

  it('is deterministic: independent measurements in fresh contexts are identical', async () => {
    const stacks = await declaredFontStacks(browser, base)
    const first = await measureRendering(browser, stacks)
    expect(first.calibration).toBe(calibrationDigest(stacks))
    expect(Object.keys(first.stacks)).toEqual(stacks)
    expect(first.raster).toMatch(SHA256)
    for (const stack of stacks) {
      expect(first.stacks[stack]?.fonts.length, stack).toBeGreaterThan(0)
      expect(first.stacks[stack]?.pixels, stack).toMatch(SHA256)
    }
    for (let run = 0; run < 2; run += 1) {
      expect(await measureRendering(browser, stacks)).toEqual(first)
    }
  })

  it("hashes the pixels Chromium's own decoder sees in a real capture", async () => {
    const context = await browser.newContext(GATE_CONTEXT_OPTIONS)
    try {
      const page = await context.newPage()
      await page.setContent(calibrationDocument(['monospace', 'serif']))
      const png = await page.screenshot({ fullPage: true, scale: 'css' })
      const ours = decodePng(png)
      const theirs = await page.evaluate(async (base64) => {
        const image = new Image()
        await new Promise<void>((done, fail) => {
          image.onload = () => done()
          image.onerror = () => fail(new Error('capture failed to decode'))
          image.src = `data:image/png;base64,${base64}`
        })
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const context2d = canvas.getContext('2d')
        if (context2d === null) throw new Error('no 2d canvas context')
        context2d.drawImage(image, 0, 0)
        const { data } = context2d.getImageData(0, 0, canvas.width, canvas.height)
        let binary = ''
        for (let index = 0; index < data.length; index += 0x8000) {
          binary += String.fromCharCode(...data.subarray(index, index + 0x8000))
        }
        return { width: canvas.width, height: canvas.height, rgba: btoa(binary) }
      }, png.toString('base64'))
      expect([ours.width, ours.height]).toEqual([theirs.width, theirs.height])
      expect(ours.height).toBeGreaterThan(500)
      expect(Buffer.from(ours.rgba).equals(Buffer.from(theirs.rgba, 'base64'))).toBe(true)
    } finally {
      await context.close()
    }
  })

  it('sees a font change: other fonts give other names and pixels, the raster stays', async () => {
    const serif = await measureRendering(browser, ['serif'])
    const mono = await measureRendering(browser, ['monospace'])
    expect(serif.stacks['serif']?.fonts).not.toEqual(mono.stacks['monospace']?.fonts)
    expect(serif.stacks['serif']?.pixels).not.toBe(mono.stacks['monospace']?.pixels)
    expect(serif.raster).toBe(mono.raster)
  })
})
