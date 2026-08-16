import { resolveLocaleSlice, type Locale } from './context.js'

export const enPagination: Locale['pagination'] = {
  label: 'Pagination',
  prev: 'Previous page',
  next: 'Next page',
  page: (n) => `Page ${n}`,
}
export const paginationLocale = (): Locale['pagination'] =>
  resolveLocaleSlice('pagination', enPagination)
