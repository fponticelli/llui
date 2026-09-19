import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mountApp, component, div } from '@llui/dom'
import { icon, iconConfig, CheckIcon, CircleIcon } from '../llui/ui/icons'
import { iconConfig as packageConfig } from '@llui/components/icon'

/**
 * The loading, batching and sanitizing are `@llui/components/icon`'s and are
 * tested there (`packages/components/test/icon.test.ts`). What this file pins
 * is the shadcn-shaped surface this registry item adds on top: a factory per
 * glyph, the class merge, and the one variant that carries a class of its own.
 */

/** Iconify's real response shape, from `api.iconify.design/lucide.json`. */
const lucide = (icons: Record<string, { body: string; width?: number; height?: number }>) => ({
  prefix: 'lucide',
  width: 24,
  height: 24,
  icons,
})

let fetchMock: ReturnType<typeof vi.fn>
let app: ReturnType<typeof mountApp> | null = null

function mountAll(bodies: readonly unknown[]): SVGSVGElement[] {
  const host = document.createElement('div')
  document.body.appendChild(host)
  app = mountApp(
    host,
    component<null, never, never>({
      name: 'IconHost',
      init: () => [null, []],
      update: (s) => [s, []],
      view: () => [div({}, bodies as never[])],
    }),
  )
  return [...host.querySelectorAll('svg')] as SVGSVGElement[]
}

function mount(body: unknown): SVGSVGElement {
  const [svg] = mountAll([body])
  if (svg === undefined) throw new Error('no <svg> rendered')
  return svg
}

/** Let the batch macrotask fire and the fetch promise chain settle. */
const settle = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  document.body.innerHTML = ''
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  app?.dispose()
  app = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

const ok = (payload: unknown) => ({ ok: true, status: 200, json: async () => payload })

describe('icons — a shadcn-shaped factory over @llui/components/icon', () => {
  it('renders a real <svg> synchronously, sized and hidden', () => {
    fetchMock.mockResolvedValue(ok(lucide({})))
    const el = mount(CheckIcon())
    // A real <svg>, NOT an <img> and not a web component: every recipe sizes
    // its icons through `[&_svg:not([class*='size-'])]:size-4`, and neither of
    // the alternatives would match that hook.
    expect(el.tagName.toLowerCase()).toBe('svg')
    expect(el.getAttribute('aria-hidden')).toBe('true')
    expect(el.getAttribute('viewBox')).toBe('0 0 24 24')
  })

  it('carries no size class of its own, so the recipe wins', () => {
    fetchMock.mockResolvedValue(ok(lucide({})))
    const [bare, sized] = mountAll([CheckIcon(), CheckIcon({ class: 'size-3' })])
    // Empty, not absent — `mergeClass('', undefined)` is ''. What matters is
    // that it names no size, so `[&_svg:not([class*='size-'])]:size-4` applies.
    expect(bare!.getAttribute('class')).toBe('')
    expect(sized!.getAttribute('class')).toContain('size-3')
  })

  it('merges the caller class with tailwind-merge, so an override wins', () => {
    fetchMock.mockResolvedValue(ok(lucide({})))
    const el = mount(icon('lucide:star', 'opacity-50')({ class: 'opacity-100' }))
    expect(el.getAttribute('class')).toBe('opacity-100')
  })

  it('passes other props through to the <svg>', () => {
    fetchMock.mockResolvedValue(ok(lucide({})))
    const el = mount(CheckIcon({ 'data-part': 'indicator' }))
    expect(el.getAttribute('data-part')).toBe('indicator')
  })

  it('paints the glyph the package resolves', async () => {
    fetchMock.mockResolvedValue(ok(lucide({ check: { body: '<path d="M20 6L9 17l-5-5"/>' } })))
    const el = mount(CheckIcon())
    await settle()
    expect(el.querySelector('path')!.getAttribute('d')).toBe('M20 6L9 17l-5-5')
  })

  it('re-exports the package iconConfig by identity, so one setting reaches both', () => {
    expect(iconConfig).toBe(packageConfig)
  })
})

describe('icons — CircleIcon is the radio dot', () => {
  // Lucide's circle is STROKED and upstream fills it from the class side. The
  // selector has to match the CHILD, not the <svg>: Iconify's body puts
  // `fill="none"` on the element itself, and a presentation attribute on an
  // element beats a value INHERITED from its parent. A plain `fill-current`
  // therefore renders a ring, which is what shipped for one commit.
  //
  // jsdom applies no Tailwind here, so this cannot assert a computed colour.
  // It asserts the two facts that make the hazard real instead — the attribute
  // survives sanitization, and the class reaches past the <svg> — and the
  // rendered result is checked in the browser.
  it('targets the CHILD, because the body carries its own fill="none"', async () => {
    fetchMock.mockResolvedValue(
      ok(
        lucide({
          circle: {
            body: '<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/>',
          },
        }),
      ),
    )
    const el = mount(CircleIcon())
    // A child-targeting variant, not a bare `fill-*` on the <svg>.
    expect(el.getAttribute('class')).toContain('[&>*]:fill-current')
    await settle()
    // The attribute that defeats an inherited fill is really there.
    expect(el.querySelector('circle')!.getAttribute('fill')).toBe('none')
  })
})
