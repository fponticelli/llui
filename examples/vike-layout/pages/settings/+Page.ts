import { component, div, h1, p, label, input, button, useContext } from '@llui/dom'
import { ToastContext } from '../../src/contexts'

type SettingsState = {
  notifications: boolean
  autoSave: boolean
  displayName: string
}
type SettingsMsg =
  | { type: 'toggleNotifications' }
  | { type: 'toggleAutoSave' }
  | { type: 'setDisplayName'; value: string }
  | { type: 'save' }

/**
 * Settings page — mounted into the AppLayout slot directly (no
 * DashboardLayout). Nav from /dashboard/overview to /settings disposes
 * the dashboard layer and its page, keeping only the root layout alive.
 */
export const Page = component<SettingsState, SettingsMsg, never>({
  name: 'SettingsPage',
  init: () => [{ notifications: true, autoSave: false, displayName: 'Anonymous' }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'toggleNotifications':
        return [{ ...state, notifications: !state.notifications }, []]
      case 'toggleAutoSave':
        return [{ ...state, autoSave: !state.autoSave }, []]
      case 'setDisplayName':
        return [{ ...state, displayName: msg.value }, []]
      case 'save':
        return [state, []]
    }
  },
  view: ({ send, text }) => {
    const toast = useContext(ToastContext)
    return [
      div({ class: 'page page-settings' }, [
        h1([text('Settings')]),
        p([
          text(
            'This page uses only the root layout — no dashboard sidebar. Navigating here from /dashboard/overview disposes DashboardLayout while AppLayout stays alive.',
          ),
        ]),

        div({ class: 'setting-row' }, [
          label([
            input({
              type: 'checkbox',
              checked: (s) => s.notifications,
              onChange: () => send({ type: 'toggleNotifications' }),
            }),
            text(' Enable notifications'),
          ]),
        ]),
        div({ class: 'setting-row' }, [
          label([
            input({
              type: 'checkbox',
              checked: (s) => s.autoSave,
              onChange: () => send({ type: 'toggleAutoSave' }),
            }),
            text(' Auto-save'),
          ]),
        ]),
        div({ class: 'setting-row' }, [
          label([
            text('Display name: '),
            input({
              type: 'text',
              value: (s) => s.displayName,
              onInput: (e) =>
                send({
                  type: 'setDisplayName',
                  value: (e.target as HTMLInputElement).value,
                }),
            }),
          ]),
        ]),
        button(
          {
            class: 'primary',
            onClick: () => {
              send({ type: 'save' })
              toast({} as never).show('Settings saved')
            },
          },
          [text('Save')],
        ),
      ]),
    ]
  },
})
