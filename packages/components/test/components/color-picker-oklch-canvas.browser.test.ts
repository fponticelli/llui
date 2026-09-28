// @vitest-environment node
//
// jsdom has no real `<canvas>` 2D context (`packages/components/test/components/
// color-picker.test.ts`'s own "paints into a real canvas 2D context when
// available" test logs jsdom's "Not implemented" warning and exercises only the
// graceful no-context-available branch). This file uses the same lightweight
// Playwright pattern as `test/styles/disabled-foundation.browser.test.ts` — no
// vite dev server, `hermetic.launch()` + `page.setContent()` — to verify the
// RAW BYTES `oklchPlanePixels` produces are exactly what a REAL browser Canvas
// 2D context reads back through `putImageData`/`getImageData`.
//
// What this DOES prove: the `Uint8ClampedArray` is valid non-premultiplied
// RGBA `ImageData` — right channel order, right length, right alpha semantics
// (0 for out-of-gamut, 255 for painted pixels) — round-tripped through a real
// browser's Canvas implementation, not a mock.
//
// What this does NOT prove: `paintOklchPlane` itself end to end. A live
// `HTMLCanvasElement` cannot cross the Node/Playwright-page boundary — only
// serializable data can be handed to `page.evaluate` — so `paintOklchPlane`'s
// own `canvas.getContext('2d')` + `ctx.putImageData(...)` call is exercised
// only by the jsdom test above (which can't verify real pixel output) plus
// this file's oracle (which verifies the pixel BYTES `paintOklchPlane` would
// hand to that same real API). Between the two, every line of the paint path
// is covered; no single test exercises all of it against a live canvas.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser, Page } from 'playwright'
import { oklchPlanePixels } from '../../src/components/color-picker'
import { inSrgbGamut } from '../../src/utils/color'
import { useHermeticBrowser } from '../../../../scripts/lib/hermetic-browser.mjs'

const hermetic = useHermeticBrowser()

let browser: Browser
let page: Page

beforeAll(async () => {
  browser = await hermetic.launch()
  page = await browser.newPage()
  await page.setContent(`<!doctype html><canvas id="c"></canvas>`)
})

afterAll(async () => {
  await browser.close()
})

describe('oklchPlanePixels bytes are real, browser-consumable Canvas ImageData (finding D)', () => {
  it('round-trips byte for byte through a real Chromium Canvas 2D context (putImageData -> getImageData)', async () => {
    const width = 32
    const height = 32
    const hue = 145 // the review's own reproduction case
    const maxChroma = 0.37
    const pixels = oklchPlanePixels(hue, width, height, maxChroma)
    expect(pixels).toHaveLength(width * height * 4)

    const readback = await page.evaluate(
      ({ bytes, w, h }: { bytes: number[]; w: number; h: number }) => {
        const canvas = document.getElementById('c') as HTMLCanvasElement
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')!
        const imageData = new ImageData(new Uint8ClampedArray(bytes), w, h)
        ctx.putImageData(imageData, 0, 0)
        return Array.from(ctx.getImageData(0, 0, w, h).data)
      },
      { bytes: Array.from(pixels), w: width, h: height },
    )

    expect(readback).toEqual(Array.from(pixels))
  })

  it('an in-gamut pixel paints real, fully-opaque sRGB bytes; an out-of-gamut one paints fully transparent', async () => {
    const width = 64
    const height = 64
    const hue = 30
    const maxChroma = 0.37
    const pixels = oklchPlanePixels(hue, width, height, maxChroma)

    // Row near the top (high lightness) at zero chroma is always in gamut;
    // the same row's rightmost column (max chroma at this hue) is the
    // high-chroma edge finding D's binary search has to get right.
    const y = 2
    const l = 1 - y / (height - 1)
    const inGamutIdx = (y * width + 0) * 4
    const edgeIdx = (y * width + (width - 1)) * 4
    const edgeInGamut = inSrgbGamut({ l, c: maxChroma, h: hue })

    const { inGamutAlpha, edgeAlpha } = await page.evaluate(
      ({
        bytes,
        w,
        h,
        inGamutIdx,
        edgeIdx,
      }: {
        bytes: number[]
        w: number
        h: number
        inGamutIdx: number
        edgeIdx: number
      }) => {
        const canvas = document.getElementById('c') as HTMLCanvasElement
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')!
        ctx.putImageData(new ImageData(new Uint8ClampedArray(bytes), w, h), 0, 0)
        const data = ctx.getImageData(0, 0, w, h).data
        return { inGamutAlpha: data[inGamutIdx + 3], edgeAlpha: data[edgeIdx + 3] }
      },
      { bytes: Array.from(pixels), w: width, h: height, inGamutIdx, edgeIdx },
    )

    expect(inGamutAlpha).toBe(255)
    expect(edgeAlpha).toBe(edgeInGamut ? 255 : 0)
  })
})
