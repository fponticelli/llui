import { afterEach, describe, expect, it } from 'vitest'
import { component, mountApp, type MountHandle } from '@llui/dom'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as overlaysDemo from '../../examples/registry-demo/src/sections/overlays'
import * as mediaDemo from '../../examples/registry-demo/src/sections/media'
import * as menusDemo from '../../examples/registry-demo/src/sections/menus'
import type { ToastType } from '../../packages/components/src/components/toast'

const mounted: MountHandle<unknown>[] = []

function mountOverlaysDemo(): void {
  const host = document.createElement('div')
  document.body.append(host)
  mounted.push(
    mountApp(
      host,
      component<overlaysDemo.State, overlaysDemo.Msg, never>({
        name: 'RegistryOverlaysDemoContract',
        init: overlaysDemo.init,
        update: overlaysDemo.update,
        view: ({ state, send }) => overlaysDemo.view(state, send),
      }),
    ) as MountHandle<unknown>,
  )
}

function mountMediaDemo(): void {
  const host = document.createElement('div')
  document.body.append(host)
  mounted.push(
    mountApp(
      host,
      component<mediaDemo.State, mediaDemo.Msg, never>({
        name: 'RegistryMediaDemoContract',
        init: mediaDemo.init,
        update: mediaDemo.update,
        view: ({ state, send }) => mediaDemo.view(state, send),
      }),
    ) as MountHandle<unknown>,
  )
}

function mountMenusDemo(): void {
  const host = document.createElement('div')
  document.body.append(host)
  mounted.push(
    mountApp(
      host,
      component<menusDemo.State, menusDemo.Msg, never>({
        name: 'RegistryMenusDemoContract',
        init: menusDemo.init,
        update: menusDemo.update,
        view: ({ state, send }) => menusDemo.view(state, send),
      }),
    ) as MountHandle<unknown>,
  )
}

const click = (element: Element): void => {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

const tick = async (): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

afterEach(() => {
  for (const app of mounted.splice(0)) app.dispose()
  document.body.replaceChildren()
})

describe('registry demo menus/overlays contracts', () => {
  it('renders the alert-dialog machine through the alert-specific skin', async () => {
    mountOverlaysDemo()
    const trigger = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Delete project',
    )
    expect(trigger).toBeDefined()
    click(trigger!)
    await tick()

    const content = document.getElementById('demo-confirm:content')!
    expect(content.dataset['size']).toBe('default')
    expect(content.className).toContain('group/alert-dialog-content')
    expect(document.getElementById('demo-confirm:title')?.textContent).toBe('Delete project?')
    const actions = content.querySelector('[data-demo-alert-actions]')!
    expect(actions).not.toBeNull()
    expect(
      [...content.querySelectorAll('[data-part="close-trigger"]')].every((part) =>
        actions.contains(part),
      ),
    ).toBe(true)
  })

  it('lets the drawer machine own the live Sheet edge and describes that contract', async () => {
    mountOverlaysDemo()
    const trigger = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Sheet',
    )
    expect(trigger).toBeDefined()
    click(trigger!)
    await tick()

    const content = document.getElementById('demo-sheet:content')!
    expect(content.dataset['side']).toBe('right')
    expect(content.className).toContain('data-[side=right]:right-0')
    expect(content.textContent).toContain('machine-owned data-side')
    expect(content.textContent).not.toContain('variant on the content')
  })

  it('drives every real ToastType through matching live-region and skin output', async () => {
    mountMediaDemo()
    const types = [
      'info',
      'success',
      'warning',
      'error',
      'loading',
      'custom',
    ] as const satisfies readonly ToastType[]
    for (const type of types) {
      const trigger = document.querySelector(`[data-toast-demo-type="${type}"]`)
      expect(trigger, type).not.toBeNull()
      click(trigger!)
    }
    await tick()

    const region = document.querySelector<HTMLElement>('[data-scope="toast"][data-part="region"]')!
    expect(region.getAttribute('role')).toBe('region')
    expect(region.getAttribute('aria-label')).not.toBe('')
    const roots = [...region.querySelectorAll<HTMLElement>('[data-part="root"]')]
    expect(roots.map((root) => root.dataset['type'])).toEqual(types)
    // The six ToastType values are now STATE-DRIVEN off one shared `data-type`
    // recipe (`data-[type=…]:` Tailwind selectors), not a resolved `variant`
    // class per instance (#265 findings 8 & 12) — every root legitimately
    // carries the SAME className, and the type-carrying signal moved to the
    // `data-type` attribute above. What must still be per-type distinct is the
    // shared recipe's own forced-colors non-color cue (width + border-style +,
    // for `error` alone, a text-decoration) — assert that on the recipe text
    // itself, keyed per type, so two types silently sharing every one of those
    // fields (a "per-type mutation") still fails the build. `loading` is
    // exempt from the light/dark COLOR check (it distinguishes itself with
    // `cursor-progress` + muted text, not a tinted border) but not from the
    // forced-colors non-color cue below.
    const classNames = new Set(roots.map((root) => root.className))
    expect(classNames.size).toBe(1)
    const sharedClassName = [...classNames][0]!
    const colorTypes = types.filter((type) => type !== 'loading')
    const borderColorTokens = colorTypes.map((type) => {
      const match = sharedClassName.match(
        new RegExp(`(?<!forced-colors:)data-\\[type=${type}\\]:border-([a-z0-9./-]+)`),
      )
      return match?.[1]
    })
    expect(borderColorTokens.every((token) => token !== undefined)).toBe(true)
    expect(new Set(borderColorTokens).size).toBe(colorTypes.length)

    const forcedCuePairs = types.map((type) => {
      const width = sharedClassName.match(
        new RegExp(`forced-colors:data-\\[type=${type}\\]:border-s-(\\d+)`),
      )?.[1]
      const style = sharedClassName.match(
        new RegExp(`forced-colors:data-\\[type=${type}\\]:border-(solid|dashed|dotted|double)`),
      )?.[1]
      const decoration = sharedClassName.includes(`forced-colors:data-[type=${type}]:underline`)
        ? 'underline'
        : ''
      return `${width}/${style}/${decoration}`
    })
    expect(forcedCuePairs.every((pair) => !pair.includes('undefined'))).toBe(true)
    expect(new Set(forcedCuePairs).size).toBe(types.length)
    for (const root of roots) {
      const assertive = root.dataset['type'] === 'error'
      expect(root.getAttribute('role')).toBe(assertive ? 'alert' : 'status')
      expect(root.getAttribute('aria-live')).toBe(assertive ? 'assertive' : 'polite')
      expect(root.dataset['state']).toBe('open')
    }

    const dismissed = roots[0]!
    click(dismissed.querySelector('[data-part="close-trigger"]')!)
    await tick()
    expect(dismissed.isConnected).toBe(true)
    expect(dismissed.dataset['state']).toBe('closing')
    dismissed.dispatchEvent(new Event('animationend', { bubbles: true }))
    await tick()
    expect(dismissed.isConnected).toBe(false)
    expect(region.querySelectorAll('[data-part="root"]')).toHaveLength(types.length - 1)
  })

  it('uses the NavigationMenu recipe itself as the labeled native landmark', () => {
    mountMenusDemo()
    const nav = document.getElementById('demo-nav')!
    expect(nav.tagName).toBe('NAV')
    expect(nav.className).toContain('group/navigation-menu')
    expect(nav.getAttribute('aria-label')).not.toBe('')
    expect(nav.querySelector('nav')).toBeNull()

    const trigger = nav.querySelector<HTMLElement>('[data-part="trigger"]')!
    const content = nav.querySelector<HTMLElement>('[data-part="content"]')!
    expect(trigger.getAttribute('aria-controls')).toBe(content.id)
    expect(content.getAttribute('aria-labelledby')).toBe(trigger.id)
  })

  it('keeps navigation panels synchronous while the real machine drives the persistent indicator', async () => {
    mountMenusDemo()
    const nav = document.getElementById('demo-nav')!
    const trigger = nav.querySelector<HTMLElement>('[data-part="trigger"]')!
    const content = nav.querySelector<HTMLElement>('[data-part="content"]')!
    const indicator = nav.querySelector<HTMLElement>('[data-part="indicator"]')!

    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(content.hidden).toBe(true)
    expect(indicator.dataset['state']).toBe('hidden')

    click(trigger)
    await tick()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(content.hidden).toBe(false)
    expect(content.dataset['state']).toBe('open')
    expect(indicator.dataset['state']).toBe('visible')

    click(trigger)
    await tick()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(content.hidden).toBe(true)
    expect(content.dataset['state']).toBe('closed')
    expect(indicator.dataset['state']).toBe('hidden')

    for (const file of [
      resolve(import.meta.dirname, '../llui/ui/navigation-menu.ts'),
      resolve(
        import.meta.dirname,
        '../../examples/registry-demo/src/components/ui/navigation-menu.ts',
      ),
    ]) {
      expect(readFileSync(file, 'utf8'), file).not.toContain('data-[state=closed]:animate-out')
    }
  })

  it('documents context-menu ownership as event-scoped rather than unowned', () => {
    for (const file of [
      resolve(import.meta.dirname, '../llui/ui/context-menu.ts'),
      resolve(
        import.meta.dirname,
        '../../examples/registry-demo/src/components/ui/context-menu.ts',
      ),
    ]) {
      const source = readFileSync(file, 'utf8')
      expect(source, file).not.toContain('registers UNOWNED')
      expect(source, file).toContain('captures the actual region')
      expect(source, file).toContain('interaction phase')
      expect(source, file).toContain('clears that owner')
    }
  })
})
