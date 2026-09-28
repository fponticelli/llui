import { resolveLocaleSlice, type Locale } from './context.js'

export const enSortable: Locale['sortable'] = {
  handle: (item) => (item === undefined ? 'Drag handle' : `Drag handle for ${item}`),
  instructions:
    'To pick up an item, press space or enter. While it is picked up, use the arrow keys to move it, ' +
    'press space or enter again to drop it in its new position, or press escape to cancel.',
  grabbed: (item, position, count) =>
    `Picked up ${item === undefined ? '' : `${item}, `}item ${position} of ${count}.`,
  moved: (item, position, count) =>
    `${item === undefined ? 'Moved' : `${item} moved`} to position ${position} of ${count}.`,
  dropped: (item, from, to, count) => {
    const dropped = item === undefined ? 'Dropped' : `Dropped ${item}`
    return from === to
      ? `${dropped} at its original position, ${to} of ${count}.`
      : `${dropped}. Moved from position ${from} to position ${to} of ${count}.`
  },
  cancelled: (item, position, count) =>
    `Reorder cancelled. ${item ?? 'The item'} returned to position ${position} of ${count}.`,
}
export const sortableLocale = (): Locale['sortable'] => resolveLocaleSlice('sortable', enSortable)
