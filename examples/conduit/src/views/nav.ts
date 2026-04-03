import { nav, div, a, ul, li, text, img } from '@llui/dom'
import type { State, Msg } from '../types'
import type { Send } from '@llui/dom'

export function navbar(s: State, send: Send<Msg>): HTMLElement {
  return nav({ class: 'navbar navbar-light' }, [
    div({ class: 'container' }, [
      a({ class: 'navbar-brand', href: '#/' }, [text('conduit')]),
      ul({ class: 'nav navbar-nav pull-xs-right' }, [
        navItem('#/', 'Home', 'ion-compose', s),
        ...(s.user
          ? [
              navItem('#/editor', 'New Article', 'ion-compose', s),
              navItem('#/settings', 'Settings', 'ion-gear-a', s),
              li({ class: 'nav-item' }, [
                a({
                  class: 'nav-link',
                  href: `#/profile/${s.user.username}`,
                }, [
                  ...(s.user.image
                    ? [img({ alt: '', class: 'user-pic', src: s.user.image })]
                    : []),
                  text(s.user.username),
                ]),
              ]),
            ]
          : [
              navItem('#/login', 'Sign in', '', s),
              navItem('#/register', 'Sign up', '', s),
            ]),
      ]),
    ]),
  ])
}

function navItem(href: string, label: string, _icon: string, _s: State): HTMLElement {
  return li({ class: 'nav-item' }, [
    a({ class: 'nav-link', href }, [text(label)]),
  ])
}
