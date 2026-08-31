// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'

const STYLES = resolve(import.meta.dirname, '../../src/styles')
const semanticTokens = readFileSync(resolve(STYLES, 'semantic-tokens.css'), 'utf8')
const semanticTokensDark = readFileSync(resolve(STYLES, 'semantic-tokens-dark.css'), 'utf8')
const foundation = readFileSync(resolve(STYLES, 'foundation.css'), 'utf8')
const formControls = readFileSync(resolve(STYLES, 'form-controls.css'), 'utf8')

const fixture = `
  <main style="display:grid;gap:24px;max-width:480px;padding:24px">
    <button id="switch-root" data-scope="switch" data-part="root" data-state="checked" aria-checked="true">
      <span id="switch-track" data-scope="switch" data-part="track" data-state="checked">
        <span id="switch-thumb" data-scope="switch" data-part="thumb" data-state="checked"></span>
      </span>
    </button>

    <div style="display:flex;align-items:center;gap:16px">
      <button id="checkbox" data-scope="checkbox" data-part="root" data-state="checked" aria-checked="true">
        <span data-scope="checkbox" data-part="indicator" data-state="checked">✓</span>
      </button>
      <button id="checkbox-unchecked" data-scope="checkbox" data-part="root" data-state="unchecked" aria-checked="false"></button>
      <button id="checkbox-indeterminate" data-scope="checkbox" data-part="root" data-state="indeterminate" aria-checked="mixed">
        <span data-scope="checkbox" data-part="indicator" data-state="indeterminate">−</span>
      </button>
      <button id="radio" data-scope="radio-group" data-part="item" data-state="checked" aria-checked="true">
        <span data-scope="radio-group" data-part="indicator" data-state="checked"></span>
      </button>
      <button id="toggle" data-scope="toggle" data-part="root" data-state="off" aria-pressed="false">Bold</button>
      <div data-scope="toggle-group" data-part="root">
        <button id="toggle-group-item" data-scope="toggle-group" data-part="item" data-state="on" aria-pressed="true">Start</button>
      </div>
    </div>

    <div id="number" data-scope="number-input" data-part="root">
      <button data-scope="number-input" data-part="decrement">−</button>
      <input data-scope="number-input" data-part="input" value="4" />
      <button data-scope="number-input" data-part="increment">+</button>
    </div>

    <div id="password" data-scope="password-input" data-part="root">
      <input data-scope="password-input" data-part="input" value="correct horse" />
      <button data-scope="password-input" data-part="visibility-trigger">Show</button>
    </div>

    <div data-scope="pin-input" data-part="root">
      <label data-scope="pin-input" data-part="label">Verification code</label>
      <input id="pin" data-scope="pin-input" data-part="input" value="2" />
      <input data-scope="pin-input" data-part="input" value="7" />
      <input data-scope="pin-input" data-part="input" value="0" />
    </div>

    <div id="tags" data-scope="tags-input" data-part="root">
      <span data-scope="tags-input" data-part="tag">TypeScript<button data-scope="tags-input" data-part="tag-remove">×</button></span>
      <input data-scope="tags-input" data-part="input" placeholder="Add skill" />
    </div>

    <div data-scope="rating-group" data-part="root">
      <button id="rating" data-scope="rating-group" data-part="item" data-fill="full">★</button>
    </div>

    <div id="slider" data-scope="slider" data-part="control" data-orientation="horizontal" style="width:160px">
      <div id="slider-track" data-scope="slider" data-part="track" data-orientation="horizontal">
        <div data-scope="slider" data-part="range" data-orientation="horizontal" style="width:65%"></div>
      </div>
      <button id="slider-thumb" data-scope="slider" data-part="thumb" data-orientation="horizontal" style="position:absolute;left:65%;transform:translateX(-50%)"></button>
    </div>

    <div id="vertical-slider" data-scope="slider" data-part="control" data-orientation="vertical" style="height:176px">
      <div id="vertical-slider-track" data-scope="slider" data-part="track" data-orientation="vertical">
        <div id="vertical-slider-range" data-scope="slider" data-part="range" data-orientation="vertical" style="position:absolute;bottom:0;top:60%"></div>
      </div>
      <button id="vertical-slider-thumb" data-scope="slider" data-part="thumb" data-orientation="vertical" style="position:absolute;bottom:40%;transform:translateY(50%)"></button>
    </div>

    <div id="field" data-scope="field" data-part="root" data-invalid>
      <label id="field-label" for="field-control" data-scope="field" data-part="label">Email</label>
      <input
        id="field-control"
        data-scope="field"
        data-part="control"
        aria-labelledby="field-label"
        aria-describedby="field-help field-error"
        aria-invalid="true"
        aria-required="true"
        placeholder="name@example.com"
      />
      <p id="field-help" data-scope="field" data-part="description">Use a work address.</p>
      <p id="field-error" data-scope="field" data-part="error" role="alert" aria-live="polite">Enter a valid address.</p>
    </div>

    <div data-scope="field" data-part="root">
      <label for="readonly-control" data-scope="field" data-part="label">Account</label>
      <input id="readonly-control" data-scope="field" data-part="control" value="northstar" readonly />
    </div>

    <fieldset id="fieldset" data-scope="fieldset" data-part="root" role="group" aria-labelledby="fieldset-legend">
      <legend id="fieldset-legend" data-scope="fieldset" data-part="legend">Contact preferences</legend>
      <span data-scope="fieldset" data-part="error" role="alert">Choose one option.</span>
    </fieldset>

    <form id="form" data-scope="form" data-part="root" data-state="submitting" aria-busy="true">
      <div data-scope="form" data-part="field" data-touched>Profile field</div>
      <button class="btn btn-primary" data-scope="form" data-part="submit" data-state="submitting" disabled>Saving…</button>
    </form>

    <div id="listbox" data-scope="listbox" data-part="root" role="listbox" aria-label="Team">
      <div id="listbox-default" data-scope="listbox" data-part="item" role="option">Design</div>
      <div id="listbox-selected" data-scope="listbox" data-part="item" data-state="selected" role="option" aria-selected="true">Engineering</div>
    </div>

    <div data-scope="angle-slider" data-part="root">
      <button id="angle-control" data-scope="angle-slider" data-part="control" aria-label="Rotation">
        <span id="angle-thumb" data-scope="angle-slider" data-part="thumb"></span>
      </button>
      <output id="angle-value" data-scope="angle-slider" data-part="value-text">45°</output>
    </div>
  </main>`

const renderFixture = async (page: Page, theme: 'light' | 'dark' = 'light'): Promise<void> => {
  await page.setContent(`<!doctype html>
    <html data-theme="${theme}">
      <head>
        <style>${semanticTokens}</style>
        <style>${semanticTokensDark}</style>
        <style>${foundation}</style>
        <style>${formControls}</style>
      </head>
      <body>${fixture}</body>
    </html>`)
}

type Box = { width: number; height: number }

const box = async (page: Page, selector: string): Promise<Box> =>
  page.locator(selector).evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  })

describe('baseline forms-controls parity in Chromium', () => {
  let browser: Browser

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true })
  })

  afterAll(async () => {
    await browser?.close()
  })

  it('uses one compact registry-derived density scale across interactive controls', async () => {
    const page = await browser.newPage()
    await renderFixture(page)

    expect(await box(page, '#switch-track')).toEqual({ width: 32, height: 18.390625 })
    expect(await box(page, '#switch-thumb')).toEqual({ width: 16, height: 16 })
    expect(await box(page, '#checkbox')).toEqual({ width: 16, height: 16 })
    expect(await box(page, '#radio')).toEqual({ width: 16, height: 16 })
    expect((await box(page, '#toggle')).height).toBe(36)
    expect((await box(page, '#toggle')).width).toBeGreaterThanOrEqual(36)
    expect((await box(page, '#toggle-group-item')).height).toBe(36)
    expect((await box(page, '#number')).height).toBe(36)
    expect((await box(page, '#password')).height).toBe(36)
    expect(await box(page, '#pin')).toEqual({ width: 36, height: 36 })
    expect((await box(page, '#tags')).height).toBeGreaterThanOrEqual(36)
    expect(await box(page, '#rating')).toEqual({ width: 24, height: 24 })
    expect((await box(page, '#slider-track')).height).toBe(6)
    expect(await box(page, '#slider-thumb')).toEqual({ width: 16, height: 16 })
    expect(await box(page, '#vertical-slider')).toEqual({ width: 24, height: 176 })
    expect(await box(page, '#vertical-slider-track')).toEqual({ width: 6, height: 176 })
    expect((await box(page, '#vertical-slider-range')).width).toBe(6)
    expect(await box(page, '#vertical-slider-thumb')).toEqual({ width: 16, height: 16 })
    expect((await box(page, '#field-control')).height).toBe(36)
    expect((await box(page, '#listbox-selected')).height).toBeGreaterThanOrEqual(32)

    await page.close()
  })

  it('makes hierarchy, validation, interaction, loading, and touch states observable', async () => {
    const page = await browser.newPage()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await renderFixture(page)

    const hierarchy = await page.evaluate(() => {
      const style = (selector: string, pseudo?: string): CSSStyleDeclaration =>
        getComputedStyle(document.querySelector<HTMLElement>(selector)!, pseudo)
      return {
        fieldDisplay: style('#field').display,
        fieldGap: style('#field').gap,
        labelSize: style('#field-label').fontSize,
        labelWeight: style('#field-label').fontWeight,
        labelColor: style('#field-label').color,
        requiredMarker: style('#field-label', '::after').content,
        descriptionColor: style('#field-help').color,
        errorColor: style('#field-error').color,
        invalidBorder: style('#field-control').borderColor,
        readOnlyBackground: style('#readonly-control').backgroundColor,
        normalBackground: style('#field-control').backgroundColor,
        placeholderColor: style('#field-control', '::placeholder').color,
        formDisplay: style('#form').display,
        formGap: style('#form').gap,
        formCursor: style('#form').cursor,
        selectedBackground: style('#listbox-selected').backgroundColor,
        defaultBackground: style('#listbox-default').backgroundColor,
        checkboxBackgrounds: {
          checked: style('#checkbox').backgroundColor,
          unchecked: style('#checkbox-unchecked').backgroundColor,
          indeterminate: style('#checkbox-indeterminate').backgroundColor,
        },
        checkboxTarget: {
          width: style('#checkbox', '::before').width,
          height: style('#checkbox', '::before').height,
        },
        radioTarget: {
          width: style('#radio', '::before').width,
          height: style('#radio', '::before').height,
        },
      }
    })

    expect(hierarchy.fieldDisplay).toBe('grid')
    expect(Number.parseFloat(hierarchy.fieldGap)).toBeGreaterThan(0)
    expect(hierarchy.labelSize).toBe('14px')
    expect(hierarchy.labelWeight).toBe('500')
    expect(hierarchy.labelColor).toBe(hierarchy.errorColor)
    expect(hierarchy.requiredMarker).toBe('"*"')
    expect(hierarchy.descriptionColor).not.toBe(hierarchy.errorColor)
    expect(hierarchy.invalidBorder).toBe(hierarchy.errorColor)
    expect(hierarchy.readOnlyBackground).not.toBe(hierarchy.normalBackground)
    expect(hierarchy.placeholderColor).toBe(hierarchy.descriptionColor)
    expect(hierarchy.formDisplay).toBe('grid')
    expect(hierarchy.formGap).toBe('24px')
    expect(hierarchy.formCursor).toBe('progress')
    expect(hierarchy.selectedBackground).not.toBe(hierarchy.defaultBackground)
    expect(hierarchy.checkboxBackgrounds.checked).not.toBe(hierarchy.checkboxBackgrounds.unchecked)
    expect(hierarchy.checkboxBackgrounds.indeterminate).toBe(hierarchy.checkboxBackgrounds.checked)
    expect(hierarchy.checkboxTarget).toEqual({ width: '24px', height: '24px' })
    expect(hierarchy.radioTarget).toEqual({ width: '24px', height: '24px' })

    const toggle = page.locator('#toggle')
    const resting = await toggle.evaluate((element) => getComputedStyle(element).backgroundColor)
    await toggle.hover()
    const hovered = await toggle.evaluate((element) => getComputedStyle(element).backgroundColor)
    await page.mouse.down()
    expect(await toggle.evaluate((element) => element.matches(':active'))).toBe(true)
    const active = await toggle.evaluate((element) => getComputedStyle(element).backgroundColor)
    await page.mouse.up()
    expect(hovered).not.toBe(resting)
    expect(active).not.toBe(hovered)

    await page.locator('#field-label').click()
    await expect(
      page.locator('#field-control').evaluate((element) => element === document.activeElement),
    ).resolves.toBe(true)
    expect(
      await page
        .locator('#field-control')
        .evaluate((element) => getComputedStyle(element).outlineWidth),
    ).toBe('2px')
    expect(await page.locator('#field-control').getAttribute('aria-describedby')).toBe(
      'field-help field-error',
    )
    expect(await page.locator('#field-control').getAttribute('aria-required')).toBe('true')
    expect(await page.locator('#field-error').getAttribute('role')).toBe('alert')
    expect(
      await page.locator('#switch-root').evaluate((element) => getComputedStyle(element).opacity),
    ).toBe('1')

    await page.close()
  })

  it('preserves semantic state in dark, forced-colors, and RTL modes', async () => {
    const darkPage = await browser.newPage()
    await darkPage.emulateMedia({ reducedMotion: 'reduce' })
    await renderFixture(darkPage, 'light')
    const lightInput = await darkPage
      .locator('#readonly-control')
      .evaluate((element) => getComputedStyle(element).backgroundColor)
    await darkPage.locator('html').evaluate((element) => element.setAttribute('data-theme', 'dark'))
    const darkInput = await darkPage
      .locator('#readonly-control')
      .evaluate((element) => getComputedStyle(element).backgroundColor)
    expect(darkInput).not.toBe(lightInput)

    const rtlState = await darkPage.evaluate(async () => {
      const thumb = document.querySelector<HTMLElement>('#switch-thumb')!
      const offset = (): number => new DOMMatrix(getComputedStyle(thumb).transform).m41
      const settleDirection = async (): Promise<void> =>
        new Promise((resolveFrame) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame())),
        )
      document.documentElement.dir = 'ltr'
      await settleDirection()
      const ltr = offset()
      document.documentElement.dir = 'rtl'
      await settleDirection()
      const rtl = offset()
      const password = getComputedStyle(
        document.querySelector<HTMLElement>("[data-scope='password-input'][data-part='input']")!,
      )
      return {
        translations: { ltr, rtl },
        passwordPadding: {
          inlineStart: password.paddingInlineStart,
          inlineEnd: password.paddingInlineEnd,
        },
      }
    })
    expect(rtlState.translations).toEqual({ ltr: 14, rtl: -14 })
    expect(rtlState.passwordPadding).toEqual({ inlineStart: '12px', inlineEnd: '36px' })
    await darkPage.close()

    const forcedPage = await browser.newPage()
    await forcedPage.emulateMedia({ forcedColors: 'active' })
    await renderFixture(forcedPage)
    const forced = await forcedPage.evaluate(() => {
      const style = (selector: string): CSSStyleDeclaration =>
        getComputedStyle(document.querySelector<HTMLElement>(selector)!)
      const reference = document.createElement('span')
      reference.style.cssText = 'color:HighlightText;background:Highlight;border:1px solid Mark'
      document.body.append(reference)
      const referenceStyle = getComputedStyle(reference)
      return {
        checkedBackground: style('#checkbox').backgroundColor,
        indeterminateBackground: style('#checkbox-indeterminate').backgroundColor,
        selectedBackground: style('#listbox-selected').backgroundColor,
        selectedColor: style('#listbox-selected').color,
        invalidBorder: style('#field-control').borderColor,
        highlight: referenceStyle.backgroundColor,
        highlightText: referenceStyle.color,
        mark: referenceStyle.borderColor,
      }
    })
    expect(forced.checkedBackground).toBe(forced.highlight)
    expect(forced.indeterminateBackground).toBe(forced.highlight)
    expect(forced.selectedBackground).toBe(forced.highlight)
    expect(forced.selectedColor).toBe(forced.highlightText)
    expect(forced.invalidBorder).toBe(forced.mark)
    await forcedPage.close()
  })
})
