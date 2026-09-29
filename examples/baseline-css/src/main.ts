/**
 * The minimal Baseline-theme consumer (#262, strengthened in #268): an app
 * with NO Tailwind anywhere — no dependency, no config, no directive — that
 * imports the published `theme.css` once and spreads a real machine's part
 * bags. `scripts/test/baseline-css-consumer.test.ts` builds exactly this app
 * against the PACKED `@llui/components` / `@llui/dom` tarballs (what npm
 * would install), in a directory where `tailwindcss` cannot resolve, and
 * checks the rendered styles in Chromium.
 */
import '@llui/components/styles/theme.css'
import { button, component, div, h1, img, mountApp, section, span, text } from '@llui/dom'
import * as switchMachine from '@llui/components/switch'
import { avatar } from '@llui/components/avatar'

interface State {
  switch: switchMachine.SwitchState
  avatar: ReturnType<typeof avatar.init>
}

type Msg =
  | { type: 'switch'; msg: switchMachine.SwitchMsg }
  | { type: 'avatar'; msg: Parameters<typeof avatar.update>[1] }

const app = document.querySelector<HTMLElement>('#app')
if (app === null) throw new Error('Missing #app')

mountApp(
  app,
  component<State, Msg, never>({
    name: 'BaselineCssConsumer',
    init: () => [{ switch: switchMachine.init({ checked: true }), avatar: avatar.init() }, []],
    update: (state, msg) =>
      msg.type === 'switch'
        ? [{ ...state, switch: switchMachine.update(state.switch, msg.msg)[0] }, []]
        : [{ ...state, avatar: avatar.update(state.avatar, msg.msg)[0] }, []],
    view: ({ state, send }) => {
      const parts = switchMachine.connect(state.at('switch'), (msg) =>
        send({ type: 'switch', msg }),
      )
      const av = avatar.connect(state.at('avatar'), (msg) => send({ type: 'avatar', msg }), {
        alt: 'User avatar',
      })
      return [
        section([
          h1([text('Baseline CSS, no Tailwind')]),
          div([
            button({ class: 'btn btn-primary', type: 'button', id: 'primary' }, [text('Continue')]),
            button({ class: 'btn btn-secondary', type: 'button', disabled: true }, [
              text('Unavailable'),
            ]),
          ]),
          button({ ...parts.root, id: 'theme-switch', 'aria-label': 'Theme' }, [
            span({ ...parts.track }, [span({ ...parts.thumb })]),
          ]),
          // An image that can never load (`.invalid` is reserved, RFC 6761):
          // the machine must reach `error` and the fallback must be the
          // visible half. `pnpm smoke:examples` asserts both, through the
          // hermetic network policy's declared-failure branch.
          div({ ...av.root }, [
            img({ ...av.image, src: 'https://example.invalid/not-an-avatar.png', alt: '' }),
            span({ ...av.fallback }, [text('FP')]),
          ]),
        ]),
      ]
    },
  }),
)
