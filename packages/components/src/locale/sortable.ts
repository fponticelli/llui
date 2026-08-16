import { resolveLocaleSlice, type Locale } from './context.js'

export const enSortable: Locale['sortable'] = {
  handle:
    'Drag handle. Press space to pick up, arrow keys to move, space again to drop, escape to cancel.',
}
export const sortableLocale = (): Locale['sortable'] => resolveLocaleSlice('sortable', enSortable)
