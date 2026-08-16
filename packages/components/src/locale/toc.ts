import { resolveLocaleSlice, type Locale } from './context.js'

export const enToc: Locale['toc'] = { label: 'Table of contents', expand: 'Toggle section' }
export const tocLocale = (): Locale['toc'] => resolveLocaleSlice('toc', enToc)
