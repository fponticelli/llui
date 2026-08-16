import { resolveLocaleSlice, type Locale } from './context.js'

export const enTagsInput: Locale['tagsInput'] = {
  input: 'Add tag',
  remove: 'Remove tag',
  clear: 'Clear all tags',
}
export const tagsInputLocale = (): Locale['tagsInput'] =>
  resolveLocaleSlice('tagsInput', enTagsInput)
