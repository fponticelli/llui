import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mountApp, component, div } from '@llui/dom'
import { icon, iconConfig, CheckIcon, CircleIcon } from '../llui/ui/icons'

/** Iconify's real response shape, from `api.iconify.design/lucide.json`. */
const lucide = (icons: Record<string, { body: string; width?: number; height?: number }>) => ({
  prefix: 'lucide',
  width: 24,
  height: 24,
  icons,
})

const CHECK_BODY =
  '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 6L9 17l-5-5"/>'

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

describe('icons — the empty box before the glyph arrives', () => {
  it('renders a real <svg> synchronously, sized and hidden', () => {
    fetchMock.mockResolvedValue(ok(lucide({})))
    const el = mount(CheckIcon())
    // A real <svg>, NOT an <img> and not a web component: every recipe sizes
    // its icons through `[&_svg:not([class*='size-'])]:size-4`, and neither of
    // the alternatives would match that hook.
    expect(el.tagName.toLowerCase()).toBe('svg')
    expect(el.getAttribute('aria-hidden')).toBe('true')
    // Sized up front so the glyph arriving later reflows nothing.
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
})

describe('icons — loading', () => {
  it('paints the glyph once it resolves', async () => {
    fetchMock.mockResolvedValue(ok(lucide({ check: { body: CHECK_BODY } })))
    const el = mount(CheckIcon())
    expect(el.querySelector('path')).toBeNull()
    await settle()
    const drawn = el.querySelector('path')
    expect(drawn).not.toBeNull()
    expect(drawn!.getAttribute('d')).toBe('M20 6L9 17l-5-5')
  })

  // One request per PREFIX per tick, not one per icon: a page with a dozen
  // chevrons must not open a dozen connections.
  it('batches every icon mounted in the same tick into one request', async () => {
    fetchMock.mockResolvedValue(
      ok(lucide({ batch1: { body: CHECK_BODY }, batch2: { body: '<path d="M1 1"/>' } })),
    )
    mountAll([icon('lucide:batch1')(), icon('lucide:batch2')()])
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = String(fetchMock.mock.calls[0]![0])
    expect(url).toContain('/lucide.json?icons=')
    expect(url).toContain('batch1')
    expect(url).toContain('batch2')
  })

  it('honours a per-icon viewBox that differs from the set default', async () => {
    fetchMock.mockResolvedValue(
      ok(lucide({ wide: { body: '<path d="M0 0"/>', width: 48, height: 16 } })),
    )
    const el = mount(icon('lucide:wide')())
    await settle()
    expect(el.getAttribute('viewBox')).toBe('0 0 48 16')
  })

  it('defaults an unprefixed name to lucide', async () => {
    fetchMock.mockResolvedValue(ok(lucide({ unprefixed: { body: CHECK_BODY } })))
    mount(icon('unprefixed')())
    await settle()
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/lucide.json?')
  })

  // A typo and a network failure look identical on screen — an empty box. Both
  // have to say so, or a misspelled glyph is a blank nobody can explain.
  it('warns and leaves the box empty for a name the set does not have', async () => {
    fetchMock.mockResolvedValue(ok(lucide({})))
    const el = mount(icon('lucide:nope')())
    await settle()
    expect(el.children).toHaveLength(0)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('lucide:nope'))
  })

  it('warns and leaves the box empty when the request fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    const el = mount(icon('lucide:boom')())
    await settle()
    expect(el.children).toHaveLength(0)
    expect(console.warn).toHaveBeenCalled()
  })

  it('survives a non-OK response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
    const el = mount(icon('lucide:down')())
    await settle()
    expect(el.children).toHaveLength(0)
  })

  it('fetches from iconConfig.api, so a consumer can self-host', async () => {
    const original = iconConfig.api
    iconConfig.api = 'https://icons.internal'
    try {
      fetchMock.mockResolvedValue(ok(lucide({ selfhosted: { body: '<path d="M0 0"/>' } })))
      mount(icon('lucide:selfhosted')())
      await settle()
      expect(String(fetchMock.mock.calls[0]![0])).toContain('https://icons.internal/lucide.json')
    } finally {
      iconConfig.api = original
    }
  })
})

// The response is third-party markup. It is never assigned to innerHTML; every
// node is REBUILT from an allowlist, which fails closed.
describe('icons — the response is untrusted markup', () => {
  let seq = 0
  // A distinct name per case: a resolved glyph IS cached, so reusing one
  // would paint the previous case's body.
  const paintedFrom = async (body: string): Promise<SVGSVGElement> => {
    const name = `evil${seq++}`
    fetchMock.mockResolvedValue(ok(lucide({ [name]: { body } })))
    const el = mount(icon(`lucide:${name}`)())
    await settle()
    return el
  }

  it('drops a <script> element entirely', async () => {
    const el = await paintedFrom('<script>globalThis.__pwned = true</script><path d="M1 1"/>')
    expect(el.querySelector('script')).toBeNull()
    expect((globalThis as Record<string, unknown>)['__pwned']).toBeUndefined()
    // The legitimate sibling still lands.
    expect(el.querySelector('path')).not.toBeNull()
  })

  it('drops an event-handler attribute', async () => {
    const el = await paintedFrom('<path d="M1 1" onload="globalThis.__pwned = true"/>')
    const p = el.querySelector('path')!
    expect(p.hasAttribute('onload')).toBe(false)
    expect(p.getAttribute('d')).toBe('M1 1')
  })

  it('drops href, style, id and class', async () => {
    const el = await paintedFrom(
      '<path d="M1 1" href="javascript:alert(1)" style="background:url(x)" id="leak" class="p-4"/>',
    )
    const p = el.querySelector('path')!
    for (const attr of ['href', 'style', 'id', 'class']) expect(p.hasAttribute(attr)).toBe(false)
  })

  it('drops a whole element that is not geometry, with its subtree', async () => {
    // `foreignObject` can host arbitrary HTML; `use` can reference an external
    // document. Neither is on the list, so both take their children with them.
    const el = await paintedFrom(
      '<foreignObject><path d="M9 9"/></foreignObject><use href="#x"/><path d="M1 1"/>',
    )
    expect(el.querySelectorAll('path')).toHaveLength(1)
    expect(el.querySelector('path')!.getAttribute('d')).toBe('M1 1')
  })

  it('keeps a nested <g>, which real Lucide bodies use', async () => {
    const el = await paintedFrom(
      '<g fill="none" stroke="currentColor"><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/></g>',
    )
    const g = el.querySelector('g')
    expect(g).not.toBeNull()
    expect(g!.getAttribute('stroke')).toBe('currentColor')
    expect(g!.querySelector('path')).not.toBeNull()
    expect(g!.querySelector('circle')).not.toBeNull()
  })

  it('sanitizes INSIDE a kept element, not only at the top level', async () => {
    const el = await paintedFrom(
      '<g><script>globalThis.__pwned = true</script><path d="M1 1"/></g>',
    )
    expect(el.querySelector('script')).toBeNull()
    expect((globalThis as Record<string, unknown>)['__pwned']).toBeUndefined()
    expect(el.querySelector('g path')).not.toBeNull()
  })

  // MUTATION NOTE, so nobody reads this as stronger than it is: deleting the
  // `parsererror` check does NOT redden this test, and cannot be made to. On a
  // malformed body the XML parser returns a document whose ROOT is
  // `parsererror` with no children at all (verified in jsdom for a truncated
  // tag, a truncated second tag, and a stray close tag), so there is nothing
  // for the allowlist to walk either way. The check stays as defence in depth —
  // it is the difference between "we looked and there was nothing" and "we
  // happened to find nothing" — but the allowlist is what actually holds here.
  it('paints nothing for a malformed body rather than a reinterpreted tree', async () => {
    const el = await paintedFrom('<path d="M1 1"')
    expect(el.children).toHaveLength(0)
  })
})

describe('icons — CircleIcon is the radio dot', () => {
  // Lucide's circle is STROKED; upstream fills it from the class side. A CSS
  // `fill` beats the body's `fill="none"` presentation attribute, which is the
  // whole reason this works.
  it('carries fill-current so the stroked glyph reads as a dot', () => {
    fetchMock.mockResolvedValue(ok(lucide({})))
    expect(mount(CircleIcon()).getAttribute('class')).toContain('fill-current')
  })
})
