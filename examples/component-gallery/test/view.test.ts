import { afterEach, describe, expect, it } from 'vitest'
import { component, div, mountApp } from '@llui/dom'
import { initialState, update, type Effect, type Msg, type State } from '../src/shell/state'
import { shellChrome } from '../src/shell/view'

let handle: ReturnType<typeof mountApp<State, Msg, Effect>> | undefined
afterEach(() => {
  handle?.dispose()
  handle = undefined
  document.body.replaceChildren()
})

function mountShell(search: string): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  handle = mountApp(
    host,
    component<State, Msg, Effect>({
      name: 'ShellUnderTest',
      init: () => [initialState(search), []],
      update,
      view: ({ state, send }) => [div({ class: 'gallery' }, shellChrome(state, send))],
    }),
  )
  return host
}

function send(msg: Msg): void {
  handle!.send(msg)
  handle!.flush()
}

describe('the shell view (#267)', () => {
  it('lists every search result and marks the current entry', () => {
    const host = mountShell('?entry=tabs')
    const links = host.querySelectorAll('.entry-list .entry-link')
    expect(links).toHaveLength(handle!.getState().results.length)
    const current = host.querySelectorAll('.entry-link[aria-current="page"]')
    expect([...current].map((link) => link.getAttribute('href'))).toEqual(['?entry=tabs'])
    expect(host.querySelector('main h1')?.textContent).toBe('Tabs')
  })

  it('renders one frame per rendered path, and an explanation for a path that draws nothing', () => {
    const host = mountShell('?entry=button&view=compare')
    expect(host.querySelectorAll('iframe')).toHaveLength(1)
    expect(host.querySelector('iframe')?.getAttribute('src')).toBe(
      './registry/?entry=button&case=default',
    )
    expect(
      host.querySelector('.frame-panel[data-path="baseline"] [role="note"]')?.textContent,
    ).toContain('Not applicable')
  })

  it('shows a failing frame as an alert and re-creates it on retry', () => {
    const host = mountShell('?entry=switch&path=registry')
    const [key] = Object.keys(handle!.getState().frames)
    const before = host.querySelector('iframe')
    send({
      type: 'frameStatus',
      key: key!,
      status: 'error',
      code: 'renderer-failed',
      message: 'boom',
    })
    const panel = host.querySelector('.frame-panel[data-rendered="true"]')!
    expect(panel.getAttribute('data-status')).toBe('error')
    expect(panel.getAttribute('aria-busy')).toBe('false')
    expect(host.querySelector('.frame-error[role="alert"]')?.textContent).toContain('boom')
    host.querySelector<HTMLButtonElement>('.frame-error button')!.click()
    handle!.flush()
    const after = host.querySelector('iframe')
    expect(after).not.toBe(before)
    expect(host.querySelector('.frame-error')).toBeNull()
  })

  it('reflects the declared axes as enabled controls and the rest as disabled', () => {
    const host = mountShell('?entry=accordion&case=closed')
    const fieldset = (legend: string) =>
      [...host.querySelectorAll<HTMLFieldSetElement>('fieldset.segmented')].find(
        (element) => element.querySelector('legend')?.textContent === legend,
      )!
    expect(fieldset('Direction').disabled).toBe(false)
    expect(fieldset('Theme').disabled).toBe(true)
    send({ type: 'setCase', caseId: 'open' })
    // accordion/open declares motion only.
    expect(fieldset('Direction').disabled).toBe(true)
    expect(fieldset('Motion').disabled).toBe(false)
  })

  it('shows link corrections and a not-found page with suggestions', () => {
    const host = mountShell('?entry=date-pickr')
    expect(host.querySelector('.not-found h1')?.textContent).toBe('No component named “date-pickr”')
    expect([...host.querySelectorAll('.suggestions a')].map((a) => a.textContent)).toContain(
      'Date Picker',
    )
    send({ type: 'popState', search: '?entry=accordion&case=nope' })
    expect(host.querySelector('.not-found')).toBeNull()
    expect(host.querySelector('.notices')?.textContent).toContain('has no “nope” scenario')
  })
})
