import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { button, component, div, isFrameworkError, mountApp, text } from '@llui/dom'
import { createOverlay } from '../../src/utils/overlay-engine'

/**
 * `floating.reattachKey` (#265 LOWs): a key is only observable through the
 * `data-llui-reattach-key` marker the caller binds, so a key WITHOUT a marker
 * could never fire — that is an authoring error now, not a silent no-op. And
 * the persistent (mount-phase) floating branch honours the key exactly like
 * the interaction-phase branch; it used to attach without it.
 */

interface S {
  mounted: boolean
  visible: boolean
  side: 'top' | 'bottom'
}
type M = { type: 'side'; side: 'top' | 'bottom' }

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

let app: ReturnType<typeof mountApp> | null = null

beforeEach(() => {
  document.body.innerHTML = ''
  for (const [key, value] of [
    ['clientWidth', 800],
    ['clientHeight', 600],
  ] as const) {
    Object.defineProperty(document.documentElement, key, { configurable: true, value })
  }
})

afterEach(() => {
  app?.dispose()
  app = null
  document.body.innerHTML = ''
})

function mount(withMarker: boolean): (message: M) => void {
  let sendRef!: (message: M) => void
  const def = component<S, M, never>({
    name: 'ReattachKey',
    init: () => [{ mounted: true, visible: true, side: 'bottom' }, []],
    update: (state, message) => [{ ...state, side: message.side }, []],
    view: ({ state, send }) => {
      sendRef = send
      return [
        button({ id: 'rk:anchor' }, [text('anchor')]),
        createOverlay({
          state,
          host: undefined,
          positioner: {},
          content: () => [
            div(
              withMarker
                ? { id: 'rk:content', 'data-llui-reattach-key': state.map((s) => s.side) }
                : { id: 'rk:content' },
              [text('content')],
            ),
          ],
          contentId: 'rk:content',
          relationships: { placementAnchor: { id: 'rk:anchor' } },
          mountWhen: (s) => s.mounted,
          visibleWhen: (s) => s.visible,
          onDismiss: () => undefined,
          floating: {
            placement: () => state.peek().side,
            offset: 0,
            flip: false,
            shift: false,
            persistent: true,
            reattachKey: () => state.peek().side,
          },
        }),
      ]
    },
  })
  const host = document.createElement('div')
  document.body.append(host)
  app = mountApp(host, def)
  return (message) => sendRef(message)
}

describe('floating.reattachKey', () => {
  it('re-places a PERSISTENT floating attachment when its key changes', async () => {
    const send = mount(true)
    await flush()
    const content = document.getElementById('rk:content')!
    expect(content.getAttribute('data-placement')).toBe('bottom')
    send({ type: 'side', side: 'top' })
    await flush()
    expect(content.getAttribute('data-placement')).toBe('top')
  })

  it('rejects a key with no marker to observe, as a framework error', () => {
    let thrown: unknown
    try {
      mount(false)
    } catch (error) {
      thrown = error
    }
    expect(isFrameworkError(thrown)).toBe(true)
    expect(String(thrown)).toMatch(/reattachKey/)
  })
})
