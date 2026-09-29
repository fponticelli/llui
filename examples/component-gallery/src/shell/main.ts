/**
 * The Component Gallery shell (#267): one searchable, contract-driven index
 * over two ISOLATED path documents — Baseline theme and Registry skins —
 * framed side by side or one at a time. The shell loads neither styling
 * system; its own stylesheet styles only its own chrome.
 */
import './shell.css'
import { component, div, mountApp } from '@llui/dom'
import {
  FRAME_TIMEOUT_MS,
  initialEffects,
  initialState,
  update,
  type Effect,
  type Msg,
  type State,
} from './state'
import { shellChrome, shellListeners } from './view'

function createShell(search: string) {
  return component<State, Msg, Effect>({
    name: 'ComponentGallery',
    init: () => {
      const state = initialState(search)
      return [state, initialEffects(state, search)]
    },
    update,
    view: ({ state, send }) => [
      shellListeners(state, send),
      div({ class: 'gallery', 'data-theme': state.at('shellTheme') }, shellChrome(state, send)),
    ],
    onEffect: (effect, { send }) => {
      switch (effect.type) {
        case 'history': {
          const url = effect.search === '' ? window.location.pathname : effect.search
          if (effect.mode === 'push') window.history.pushState(null, '', url)
          else window.history.replaceState(null, '', url)
          return
        }
        case 'title':
          document.title = effect.title
          return
        case 'watchFrame': {
          const timer = window.setTimeout(
            () => send({ type: 'frameTimeout', key: effect.key }),
            FRAME_TIMEOUT_MS,
          )
          return () => window.clearTimeout(timer)
        }
        case 'copy': {
          const url = new URL(effect.search === '' ? './' : effect.search, window.location.href)
          void navigator.clipboard.writeText(url.href).then(
            () => send({ type: 'linkCopied' }),
            () => {
              // Clipboard access denied: the URL bar already holds the same link.
            },
          )
          return
        }
        case 'focusMain':
          queueMicrotask(() => document.getElementById('gallery-main')?.focus())
          return
      }
    },
  })
}

const root = document.getElementById('gallery')
if (root === null) throw new Error('Missing #gallery')
mountApp(root, createShell(window.location.search))
