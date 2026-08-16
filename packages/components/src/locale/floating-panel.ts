import { resolveLocaleSlice, type Locale } from './context.js'

export const enFloatingPanel: Locale['floatingPanel'] = {
  label: 'Floating panel',
  minimize: 'Minimize',
  maximize: 'Maximize',
  close: 'Close',
}
export const floatingPanelLocale = (): Locale['floatingPanel'] =>
  resolveLocaleSlice('floatingPanel', enFloatingPanel)
