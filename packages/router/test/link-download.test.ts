import { component, mountApp, text } from '@llui/dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { connectRouter } from '../src/connect'
import { createRouter, route } from '../src/index'

function mountLink(attrs: Record<string, unknown>) {
  const routing = connectRouter(
    createRouter({ home: route('/'), download: route('/download') }, { mode: 'history' }),
  )
  const send = vi.fn()
  const container = document.createElement('div')
  const App = component({
    name: 'NamedDownloadLink',
    init: () => [null, []] as const,
    update: (state: null) => [state, []] as const,
    view: () => [routing.link(send, 'download', attrs, [text('download')])],
  })
  const mounted = mountApp(container, App)
  return { anchor: container.querySelector('a')!, mounted, send }
}

function observedClick(anchor: HTMLAnchorElement): { routerPrevented: boolean } {
  let routerPrevented = true
  anchor.addEventListener('click', (event) => {
    routerPrevented = event.defaultPrevented
    event.preventDefault()
  })
  anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
  return { routerPrevented }
}

describe('named download links remain browser-native', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/')
  })

  it.each([{ download: 'file.txt' }, { download: '' }])(
    'does not intercept the download attribute %#',
    (attrs) => {
      const push = vi.spyOn(history, 'pushState')
      const { anchor, mounted, send } = mountLink(attrs)

      expect(anchor.hasAttribute('download')).toBe(true)
      expect(observedClick(anchor).routerPrevented).toBe(false)
      expect(push).not.toHaveBeenCalled()
      expect(send).not.toHaveBeenCalled()

      push.mockRestore()
      mounted.dispose()
    },
  )

  it('still intercepts an ordinary route link', () => {
    const { anchor, mounted, send } = mountLink({})
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })

    anchor.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(send).toHaveBeenCalledWith({
      type: 'navigate',
      location: { name: 'download', params: {} },
    })
    mounted.dispose()
  })
})
