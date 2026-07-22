import { test, expect, type Page } from '@playwright/test'

// The FULL editor is the first contenteditable on the page (the example also
// mounts smaller comment-box / single-block editors further down).
const fullEditor = (page: Page) => page.locator('[contenteditable="true"]').first()

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(fullEditor(page)).toBeVisible()
})

test.describe('floating toolbar ↔ link dialog', () => {
  test('the floating toolbar dismisses when the link dialog opens', async ({ page }) => {
    const editor = fullEditor(page)
    await editor.click()
    // A non-collapsed selection summons the floating bubble. Keyboard selection
    // is deterministic (no coordinates): type a word, then extend over it.
    await page.keyboard.type(' linkme')
    for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowLeft')

    const bar = page.locator('[data-scope="md-floating"][data-part="bar"]')
    await expect(bar).toBeVisible()

    // Open the link dialog from the bubble's link button.
    await bar.locator('[data-part="item"][aria-label="Link"]').click()
    await expect(page.locator('[data-md-link="box"]')).toBeVisible()

    // The bubble must not linger over the modal — it should be gone.
    await expect(bar).toBeHidden()
  })
})

test.describe('markdown link typing', () => {
  test('typing [text](url) creates a live link (no dialog)', async ({ page }) => {
    const editor = fullEditor(page)
    await editor.click()
    await page.keyboard.type(' see [docs](https://llui.dev) end')

    // The closing `)` fires the LINK markdown shortcut → a real anchor node.
    const link = editor.locator('a[href="https://llui.dev"]')
    await expect(link).toHaveText('docs')
    // And no modal was opened by typing.
    await expect(page.locator('[data-md-link="box"]')).toHaveCount(0)
    // The live-Markdown mirror round-trips it.
    await expect(page.locator('#markdown-output')).toContainText('[docs](https://llui.dev)')
  })
})

test.describe('regular link click', () => {
  test('plain click opens the edit dialog pre-filled; ⌘/Ctrl-click follows', async ({ page }) => {
    const followed: string[] = []
    page.on('console', (msg) => {
      if (msg.text().startsWith('[link] follow →')) followed.push(msg.text())
    })

    const editor = fullEditor(page)
    await editor.click()
    await page.keyboard.type(' [docs](https://llui.dev) ')
    const link = editor.locator('a[href="https://llui.dev"]')
    await expect(link).toHaveText('docs')

    // Plain click → edit: the link dialog opens, pre-filled with the URL.
    await link.click()
    const dialog = page.locator('[data-md-link="box"]')
    await expect(dialog).toBeVisible()
    await expect(page.locator('[data-md-link="input"]')).toHaveValue('https://llui.dev')
    expect(followed).toHaveLength(0) // editing is not following
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    // ⌘/Ctrl-click → follow via the host's onFollow seam.
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
    await link.click({ modifiers: [mod] })
    await expect.poll(() => followed.length).toBeGreaterThan(0)
    expect(followed[0]).toContain('https://llui.dev')
  })
})
