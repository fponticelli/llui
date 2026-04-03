import { nav, div, a, ul, li, text, img, show, branch } from '@llui/dom'
import type { State, Msg } from '../types'
import type { Send } from '@llui/dom'
import { routing } from '../router'

export function navbar(_s: State, send: Send<Msg>): HTMLElement {
  return nav({ class: 'navbar navbar-light' }, [
    div({ class: 'container' }, [
      routing.link(send, { page: 'home', tab: 'global' }, { class: 'navbar-brand' }, [text('conduit')]),
      ul({ class: 'nav navbar-nav pull-xs-right' }, [
        li({ class: 'nav-item' }, [
          routing.link(send, { page: 'home', tab: 'global' }, { class: 'nav-link' }, [text('Home')]),
        ]),
        // Logged-in nav items
        ...show<State, Msg>({
          when: (s) => s.user !== null,
          render: (_s, send) => [
            li({ class: 'nav-item' }, [
              routing.link(send, { page: 'editor' }, { class: 'nav-link' }, [text('New Article')]),
            ]),
            li({ class: 'nav-item' }, [
              routing.link(send, { page: 'settings' }, { class: 'nav-link' }, [text('Settings')]),
            ]),
            li({ class: 'nav-item' }, [
              a({
                class: 'nav-link',
                href: (s: State) => `#/profile/${s.user?.username ?? ''}`,
                onClick: (e: Event) => {
                  e.preventDefault()
                  const username = _s.user?.username
                  if (username) send({ type: 'navigate', route: { page: 'profile', username, tab: 'authored' } })
                },
              }, [
                text((s: State) => s.user?.username ?? ''),
              ]),
            ]),
          ],
        }),
        // Logged-out nav items
        ...show<State, Msg>({
          when: (s) => s.user === null,
          render: (_s, send) => [
            li({ class: 'nav-item' }, [
              routing.link(send, { page: 'login' }, { class: 'nav-link' }, [text('Sign in')]),
            ]),
            li({ class: 'nav-item' }, [
              routing.link(send, { page: 'register' }, { class: 'nav-link' }, [text('Sign up')]),
            ]),
          ],
        }),
      ]),
    ]),
  ])
}
