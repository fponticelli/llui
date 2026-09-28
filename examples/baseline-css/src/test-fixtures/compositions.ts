// TEST-ONLY fixture. Mounts the consumer-authored Baseline compositions the
// live browser suites in `registry/test/` drive — NavigationMenu, Menubar and
// a dropdown Menu; a Toast with a real countdown driver; and the
// navigation-data machines — in the one example app with NO Tailwind, so
// what Chromium measures is the plain-CSS Baseline path: `theme.css` plus the
// brand override below, no preflight, no utilities.
//
// Each composition is its own mounted app: they share no state, and a
// failure in one names its own container.
import './brand-override.css'
import { mountApp } from '@llui/dom'
import { MenusComposition } from './compositions/menus'
import { ToastComposition } from './compositions/toast'
import { NavigationDataComposition } from './compositions/navigation-data'

function host(id: string): HTMLElement {
  const element = document.getElementById(id)
  if (element === null) throw new Error(`Missing #${id} container`)
  return element
}

mountApp(host('menus'), MenusComposition)
mountApp(host('toast'), ToastComposition)
mountApp(host('navigation-data'), NavigationDataComposition)
