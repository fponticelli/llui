import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { button, component, div, mountApp, text } from '@llui/dom'
import { resolveDir } from '@llui/interactions'
import { createOverlay } from '../../src/utils/overlay-engine'

/**
 * Who decides a floating overlay's `dir` (#265 finding 6 + review): the
 * component's EXPLICIT direction, else the placement anchor's. The engine
 * OWNS `dir` on the floating wrapper while attached — a `dir` already on the
 * wrapper does not outrank either — and a consumer who wants a different
 * direction for their content puts `dir` on the content, which the engine
 * never touches.
 */

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

let app: ReturnType<typeof mountApp> | null = null

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  app?.dispose()
  app = null
  document.body.innerHTML = ''
})

function mount(opts: {
  anchorDir: 'ltr' | 'rtl'
  explicit?: 'ltr' | 'rtl'
  wrapperDir?: 'ltr' | 'rtl'
  contentDir?: 'ltr' | 'rtl'
  /** No positioner wrapper: the content IS the floating element. */
  bare?: boolean
}): HTMLElement {
  const def = component<{ open: boolean }, never, never>({
    name: 'DirPrecedence',
    init: () => [{ open: true }, []],
    update: (s) => [s, []],
    view: ({ state }) => [
      button({ id: 'dp:anchor' }, [text('anchor')]),
      createOverlay({
        state,
        host: undefined,
        positioner:
          opts.bare === true
            ? {}
            : {
                'data-part': 'positioner',
                ...(opts.wrapperDir !== undefined ? { dir: opts.wrapperDir } : {}),
              },
        content: () => [
          div(
            opts.contentDir === undefined
              ? { id: 'dp:content' }
              : { id: 'dp:content', dir: opts.contentDir },
            [text('content')],
          ),
        ],
        contentId: 'dp:content',
        relationships: { placementAnchor: { id: 'dp:anchor' } },
        mountWhen: (s) => s.open,
        onDismiss: () => undefined,
        floating: {
          placement: 'bottom',
          offset: 0,
          flip: false,
          shift: false,
          ...(opts.explicit !== undefined ? { dir: opts.explicit } : {}),
        },
      }),
    ],
  })
  const host = document.createElement('div')
  host.setAttribute('dir', opts.anchorDir)
  document.body.append(host)
  app = mountApp(host, def)
  return host
}

const wrapper = (): HTMLElement =>
  document.getElementById('dp:content')!.closest<HTMLElement>('[data-part="positioner"]')!

describe('floating overlay dir precedence', () => {
  it('explicit wins over the anchor AND over a dir already on the wrapper', async () => {
    mount({ anchorDir: 'rtl', explicit: 'ltr', wrapperDir: 'rtl' })
    await flush()
    expect(wrapper().getAttribute('dir')).toBe('ltr')
  })

  it('without an explicit dir, the anchor wins over a dir already on the wrapper', async () => {
    mount({ anchorDir: 'ltr', wrapperDir: 'rtl' })
    await flush()
    expect(wrapper().getAttribute('dir')).toBe('ltr')
  })

  it('a dir on the CONTENT is the consumer override: it wins, and the engine never writes over it', async () => {
    mount({ anchorDir: 'ltr', explicit: 'ltr', contentDir: 'rtl' })
    await flush()
    const content = document.getElementById('dp:content')!
    expect(content.getAttribute('dir')).toBe('rtl')
    expect(resolveDir(content)).toBe('rtl')
    // Placement follows it too, so geometry and content agree.
    expect(wrapper().getAttribute('dir')).toBe('rtl')
  })

  // Without a wrapper the engine writes `dir` on the content itself; it must
  // then tell its OWN write from a consumer's when the anchor changes.
  it("without a wrapper, the engine follows the anchor live and never mistakes its own dir for the consumer's", async () => {
    const host = mount({ anchorDir: 'rtl', bare: true })
    await flush()
    const content = document.getElementById('dp:content')!
    expect(content.getAttribute('dir')).toBe('rtl')
    host.setAttribute('dir', 'ltr')
    await flush()
    expect(content.getAttribute('dir')).toBe('ltr')
  })

  it('without a wrapper, a consumer dir on the content survives an anchor direction change', async () => {
    const host = mount({ anchorDir: 'ltr', contentDir: 'rtl', bare: true })
    await flush()
    const content = document.getElementById('dp:content')!
    host.setAttribute('dir', 'rtl')
    await flush()
    host.setAttribute('dir', 'ltr')
    await flush()
    expect(content.getAttribute('dir')).toBe('rtl')
  })
})
