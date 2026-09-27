import { resolveLocaleSlice, type Locale } from './context.js'

export const enFloatingPanel: Locale['floatingPanel'] = {
  label: 'Floating panel',
  minimize: 'Minimize',
  maximize: 'Maximize',
  close: 'Close',
  move: 'Move panel',
  resize: 'Resize panel',
}
export const floatingPanelLocale = (): Locale['floatingPanel'] =>
  resolveLocaleSlice('floatingPanel', enFloatingPanel)
