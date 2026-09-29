/**
 * The RENDERING FINGERPRINT of the visual gate's environment (#268).
 *
 * A screenshot baseline is reproducible only where the rendering is, and the
 * browser build, platform and architecture do not determine the rendering:
 * which fonts a `font-family` stack resolves to (installed families,
 * fontconfig aliases and fallbacks), the font files' versions, hinting and
 * antialiasing, and the rasteriser all reach the pixels. A host running CI's
 * exact Chromium build on linux/x64 with other system fonts used to pass as
 * CI's environment and fail ~937 cases on sizes and pixels.
 *
 * So the manifest also records what the environment DRAWS: a small
 * deterministic calibration document, rendered in the gate's own context
 * options (`GATE_CONTEXT_OPTIONS`), is captured and its PIXELS hashed —
 *
 *   - per FONT STACK: every stack the two path documents declare (harvested
 *     from their live CSSOM, `var()` resolved — never listed here), drawn at
 *     the weights and sizes the recipes use, with the symbols UI text uses,
 *     roman, italic and inverse; plus the platform fonts Chromium actually
 *     used for it (CDP `CSS.getPlatformFontsForNode`, fallbacks included),
 *     so a mismatch can say WHICH fonts differ;
 *   - one RASTER sample of shapes (rounded borders, shadows, gradients,
 *     transforms, filters, SVG strokes) with no text at all.
 *
 * The manifest also records the digest of the calibration document itself,
 * and a run renders the RECORDED stacks, so a fingerprint compares like with
 * like even after the documents' CSS changed (`environmentDifferences` in
 * `visual.ts` then reports a declared stack the recording never rendered).
 */
import { createHash } from 'node:crypto'
import type { Browser, Page } from 'playwright'
import { GALLERY_PATH_SEGMENTS } from '@llui/cli/gallery'
import { PRESENTATION_SCENARIO_PATHS } from '@llui/cli/presentation-scenarios'
import { GATE_CONTEXT_OPTIONS } from './document-page'
import { decodePng } from './png'
import type { RenderingFingerprint, StackFingerprint } from './visual'

/** `font-medium`/`-semibold`/`-bold` and body text. */
const WEIGHTS = [400, 500, 600, 700] as const
/** `text-xs` … `text-2xl` (12–24 px), with integral line boxes. */
const SIZES = [12, 14, 16, 18, 24] as const
const PANGRAM = 'Sphinx of black quartz, judge my vow. 0123456789'
/** Characters UI text reaches for, several only through fallback fonts. */
const SYMBOLS = 'ÀÉÎõüß &@#%?!()[]{}<>/\\|~^*+=_ — – … • · ✓ × ← → ↑ ↓ ⌘ ⇧ ⌥ ⌃ ↵ €£¥'

const escapeHtml = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

function sample(style: string, text: string): string {
  return `<div data-sample style="${style}">${escapeHtml(text)}</div>`
}

function stackSection(stack: string, index: number): string {
  const rows: string[] = []
  for (const weight of WEIGHTS) {
    for (const size of SIZES) {
      const box = `font-size:${size}px;line-height:${size * 1.5}px;font-weight:${weight}`
      rows.push(sample(box, PANGRAM))
    }
  }
  for (const weight of [400, 700] as const) {
    rows.push(sample(`font-size:16px;line-height:24px;font-weight:${weight}`, SYMBOLS))
    rows.push(
      sample(`font-size:16px;line-height:24px;font-weight:${weight};font-style:italic`, PANGRAM),
    )
  }
  rows.push(
    sample(
      'font-size:14px;line-height:21px;font-weight:500;background:#18181b;color:#fafafa',
      PANGRAM,
    ),
  )
  return `<section data-stack="${index}" style="font-family:${escapeHtml(stack)}">${rows.join('')}</section>`
}

const RASTER = `<section data-raster>
<div style="left:8px;top:8px;width:80px;height:60px;border:1px solid #71717a;border-radius:12px;box-shadow:0 4px 12px rgb(0 0 0 / 0.25);background:#fff"></div>
<div style="left:104px;top:8px;width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,oklch(0.6 0.2 250),oklch(0.8 0.15 80))"></div>
<div style="left:188px;top:16px;width:40px;height:40px;background:#2563eb;opacity:0.8;transform:rotate(17deg)"></div>
<div style="left:248px;top:12px;width:56px;height:36px;border:2px dashed #dc2626;outline:2px solid #16a34a;outline-offset:3px;border-radius:6px"></div>
<div style="left:324px;top:12px;width:48px;height:48px;background:#7c3aed;filter:blur(2px);border-radius:8px"></div>
<svg style="left:8px;top:84px" width="380" height="64" viewBox="0 0 380 64"><circle cx="30" cy="32" r="22" fill="none" stroke="#0ea5e9" stroke-width="1.5"/><path d="M70 50 C 120 0, 170 64, 220 14 S 320 40, 370 10" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round"/><rect x="240" y="40" width="60" height="16" rx="8" fill="#10b981" fill-opacity="0.6"/></svg>
</section>`

/** The calibration document for these font stacks, sorted and de-duplicated. */
export function calibrationDocument(stacks: readonly string[]): string {
  const sections = normalizeStacks(stacks).map(stackSection).join('\n')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
html,body{margin:0;background:#fff;color:#0a0a0a}
section[data-stack]{box-sizing:border-box;width:1000px;padding:4px;overflow:hidden;white-space:pre;background:#fff}
section[data-raster]{position:relative;width:400px;height:160px;background:#f4f4f5}
section[data-raster]>*{position:absolute}
</style></head><body>
${sections}
${RASTER}
</body></html>`
}

/** SHA-256 of the calibration document: pins WHAT a fingerprint rendered. */
export function calibrationDigest(stacks: readonly string[]): string {
  return createHash('sha256').update(calibrationDocument(stacks)).digest('hex')
}

function normalizeStacks(stacks: readonly string[]): string[] {
  return [...new Set(stacks)].sort()
}

/**
 * Every `font-family` the document's style sheets declare — style rules at
 * any depth (`@layer`, `@media`, `@supports`, nesting, `@import`) — resolved
 * to the computed stack (so `var(--font-mono)` becomes the stack it names),
 * plus the root's and the body's own computed stacks. Runs IN THE PAGE, so it
 * must stay self-contained.
 */
export function fontStacksInPage(): string[] {
  const keywords = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer'])
  const declared = new Set<string>()
  const visit = (rules: CSSRuleList): void => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSImportRule) {
        if (rule.styleSheet !== null) visit(rule.styleSheet.cssRules)
        continue
      }
      if (rule instanceof CSSStyleRule) {
        const value = rule.style.getPropertyValue('font-family').trim()
        if (value !== '' && !keywords.has(value)) declared.add(value)
      }
      if (rule instanceof CSSGroupingRule) visit(rule.cssRules)
    }
  }
  for (const sheet of Array.from(document.styleSheets)) visit(sheet.cssRules)
  const resolved = new Set<string>([
    getComputedStyle(document.documentElement).fontFamily,
    getComputedStyle(document.body).fontFamily,
  ])
  const probe = document.createElement('span')
  document.body.append(probe)
  for (const value of declared) {
    probe.style.setProperty('font-family', value)
    resolved.add(getComputedStyle(probe).fontFamily)
  }
  probe.remove()
  return [...resolved]
}

/** The font stacks both path documents declare, sorted and de-duplicated. */
export async function declaredFontStacks(browser: Browser, base: string): Promise<string[]> {
  const stacks: string[] = []
  for (const path of PRESENTATION_SCENARIO_PATHS) {
    const context = await browser.newContext(GATE_CONTEXT_OPTIONS)
    try {
      const page = await context.newPage()
      await page.goto(`${base}${GALLERY_PATH_SEGMENTS[path]}/`, { waitUntil: 'load' })
      const found = await page.evaluate(fontStacksInPage)
      if (found.length === 0) throw new Error(`the ${path} document declares no font stack`)
      stacks.push(...found)
    } finally {
      await context.close()
    }
  }
  return normalizeStacks(stacks)
}

/**
 * Capture one calibration section the way the gate captures a case — a
 * screenshot clipped INSIDE the viewport — and hash its decoded pixels and
 * size. Never `fullPage`: measured on Chromium 147, one full-page screenshot
 * (Playwright overrides the device metrics for it) re-resolves the page's
 * generic families for the rest of its life — `monospace` drew DejaVu Sans
 * Mono before it and Liberation Mono after, different fonts and different
 * pixels on the same page. The gate never captures that way, so neither may
 * its fingerprint; a section that would not fit the viewport is refused.
 */
async function captureDigest(page: Page, selector: string): Promise<string> {
  const section = page.locator(selector)
  const box = await section.boundingBox()
  const { width, height } = GATE_CONTEXT_OPTIONS.viewport
  if (box === null || box.width > width || box.height > height) {
    throw new Error(`calibration ${selector} does not fit the ${width}x${height} viewport`)
  }
  const image = decodePng(
    await section.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' }),
  )
  return createHash('sha256')
    .update(`${image.width}x${image.height}\n`)
    .update(image.rgba)
    .digest('hex')
}

/**
 * Render the calibration document for `stacks` in a fresh context with the
 * gate's own options and fingerprint each section. Chromium only (the font
 * names come from CDP).
 */
export async function measureRendering(
  browser: Browser,
  stacks: readonly string[],
): Promise<RenderingFingerprint> {
  const sorted = normalizeStacks(stacks)
  const context = await browser.newContext(GATE_CONTEXT_OPTIONS)
  try {
    const page = await context.newPage()
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce', forcedColors: 'none' })
    await page.setContent(calibrationDocument(sorted), { waitUntil: 'load' })
    await page.evaluate(async () => {
      await document.fonts.ready
      const frame = (): Promise<void> =>
        new Promise((resolve) => requestAnimationFrame(() => resolve()))
      await frame()
      await frame()
    })
    const fingerprints: Record<string, StackFingerprint> = {}
    for (const [index, stack] of sorted.entries()) {
      const section = `section[data-stack="${index}"]`
      fingerprints[stack] = {
        fonts: await platformFonts(page, `${section} [data-sample]`),
        pixels: await captureDigest(page, section),
      }
    }
    return {
      calibration: calibrationDigest(sorted),
      stacks: fingerprints,
      raster: await captureDigest(page, 'section[data-raster]'),
    }
  } finally {
    await context.close()
  }
}

/**
 * The platform fonts Chromium drew the matched elements' text with —
 * fallbacks included — by PostScript name where the platform reports one
 * (it tells a real bold face from a synthesized one), sorted.
 */
async function platformFonts(page: Page, selector: string): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('DOM.enable')
    await cdp.send('CSS.enable')
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 })
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector })
    if (nodeIds.length === 0) throw new Error(`no calibration sample matches ${selector}`)
    const fonts = new Set<string>()
    for (const nodeId of nodeIds) {
      const used = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
      for (const font of used.fonts) {
        fonts.add(font.postScriptName === '' ? font.familyName : font.postScriptName)
      }
    }
    return [...fonts].sort()
  } finally {
    await cdp.detach()
  }
}
