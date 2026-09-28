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
import { button, component, div, h1, mountApp, section, span, text } from '@llui/dom'
import * as switchMachine from '@llui/components/switch'

const app = document.querySelector<HTMLElement>('#app')
if (app === null) throw new Error('Missing #app')

mountApp(
  app,
  component<switchMachine.SwitchState, switchMachine.SwitchMsg, never>({
    name: 'BaselineCssConsumer',
    init: () => [switchMachine.init({ checked: true }), []],
    update: switchMachine.update,
    view: ({ state, send }) => {
      const parts = switchMachine.connect(state, send)
      return [
        section([
          h1([text('Baseline CSS, no Tailwind')]),
          div({ class: 'actions' }, [
            button({ class: 'btn btn-primary', type: 'button', id: 'primary' }, [text('Continue')]),
            button({ class: 'btn btn-secondary', type: 'button', disabled: true }, [
              text('Unavailable'),
            ]),
          ]),
          button({ ...parts.root, id: 'theme-switch', 'aria-label': 'Theme' }, [
            span({ ...parts.track }, [span({ ...parts.thumb })]),
          ]),
        ]),
      ]
    },
  }),
)
