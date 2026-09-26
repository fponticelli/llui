import { describe, it, expect } from 'vitest'
import { init, update, connect } from '../../src/patterns/searchable-select'
import type {
  SearchableSelectState,
  SearchableSelectMsg,
  OverlayOptions,
} from '../../src/patterns/searchable-select'
import { rootSignal, read } from '../_signal'

const apply = (s: SearchableSelectState, msg: SearchableSelectMsg): SearchableSelectState =>
  update(s, msg)[0]

describe('searchableSelect reducer', () => {
  it('initializes closed with an empty filter and no selection', () => {
    const s = init({ items: ['Apple', 'Banana', 'Cherry'] })
    expect(s.open).toBe(false)
    expect(s.combobox.value).toEqual([])
    expect(s.combobox.inputValue).toBe('')
    expect(s.combobox.items).toEqual(['Apple', 'Banana', 'Cherry'])
  })

  it('open focuses with an empty filter by default', () => {
    let s = init({ items: ['Apple', 'Banana', 'Cherry'], value: ['Banana'] })
    s = apply(s, { type: 'open' })
    expect(s.open).toBe(true)
    // filter starts empty even with a selection
    expect(s.combobox.inputValue).toBe('')
    expect(s.combobox.filteredItems).toEqual(['Apple', 'Banana', 'Cherry'])
  })

  it('open with prefillFilter seeds the filter from the selected label', () => {
    let s = init({ items: ['Apple', 'Banana'], value: ['Banana'], prefillFilter: true })
    s = apply(s, { type: 'open' })
    expect(s.combobox.inputValue).toBe('Banana')
  })

  it('typing filters the list', () => {
    let s = init({ items: ['Apple', 'Banana', 'Avocado'] })
    s = apply(s, { type: 'open' })
    s = apply(s, { type: 'setFilter', value: 'av' })
    expect(s.combobox.inputValue).toBe('av')
    expect(s.combobox.filteredItems).toEqual(['Avocado'])
  })

  it('Enter selects the highlighted item, closes, and RESETS the filter', () => {
    let s = init({ items: ['Apple', 'Banana', 'Avocado'] })
    s = apply(s, { type: 'open' })
    s = apply(s, { type: 'setFilter', value: 'av' })
    // first enabled in filtered set is Avocado
    s = apply(s, { type: 'selectHighlighted' })
    expect(s.combobox.value).toEqual(['Avocado'])
    expect(s.open).toBe(false)
    // committed value never leaks into the filter
    expect(s.combobox.inputValue).toBe('')
  })

  it('clicking an option selects it and resets the filter', () => {
    let s = init({ items: ['Apple', 'Banana'] })
    s = apply(s, { type: 'open' })
    s = apply(s, { type: 'setFilter', value: 'ban' })
    s = apply(s, { type: 'selectValue', value: 'Banana' })
    expect(s.combobox.value).toEqual(['Banana'])
    expect(s.combobox.inputValue).toBe('')
    expect(s.open).toBe(false)
  })

  it('committed value can never be free text — selecting a non-item is a no-op', () => {
    let s = init({ items: ['Apple', 'Banana'] })
    s = apply(s, { type: 'open' })
    s = apply(s, { type: 'setFilter', value: 'zzz not an item' })
    // no highlighted item in an empty filtered set → selectHighlighted is inert
    expect(s.combobox.filteredItems).toEqual([])
    s = apply(s, { type: 'selectHighlighted' })
    expect(s.combobox.value).toEqual([])
    // even a direct selectValue with an unknown value commits nothing
    s = apply(s, { type: 'selectValue', value: 'zzz not an item' })
    expect(s.combobox.value).toEqual([])
  })

  it('closing resets the filter back to empty', () => {
    let s = init({ items: ['Apple', 'Banana'] })
    s = apply(s, { type: 'open' })
    s = apply(s, { type: 'setFilter', value: 'app' })
    s = apply(s, { type: 'close' })
    expect(s.open).toBe(false)
    expect(s.combobox.inputValue).toBe('')
    expect(s.combobox.filteredItems).toEqual(['Apple', 'Banana'])
  })

  it('clear empties the selection', () => {
    let s = init({ items: ['Apple', 'Banana'], value: ['Apple'] })
    s = apply(s, { type: 'clear' })
    expect(s.combobox.value).toEqual([])
  })

  it('forwards async loading, success, error, and stale-request semantics to combobox', () => {
    let s = init({ items: ['Existing'] })
    s = apply(s, { type: 'loadStart', requestId: 1 })
    expect(s.combobox).toMatchObject({ status: 'loading', requestId: 1, error: null })

    s = apply(s, { type: 'loadStart', requestId: 2 })
    const stale = apply(s, { type: 'loadSuccess', requestId: 1, items: ['Stale'] })
    expect(stale).toBe(s)

    s = apply(s, { type: 'loadSuccess', requestId: 2, items: ['Fresh'] })
    expect(s.combobox).toMatchObject({
      status: 'loaded',
      requestId: 2,
      items: ['Fresh'],
      filteredItems: ['Fresh'],
    })

    s = apply(s, { type: 'loadStart', requestId: 3 })
    s = apply(s, { type: 'loadError', requestId: 3, error: 'Network unavailable' })
    expect(s.combobox).toMatchObject({
      status: 'error',
      requestId: 3,
      error: 'Network unavailable',
    })
  })

  /**
   * #265 finding 10 (pattern-level): a fresh success must atomically replace
   * items/groups/disabled/selected/filtering/highlight through the wrapper too
   * — not just in the nested combobox machine directly.
   */
  it('loadSuccess atomically replaces items, groups, disabled, and drops a stale selection', () => {
    let s = init({
      items: ['old-a', 'old-b'],
      value: ['old-a'],
      groups: [{ id: 'g1', label: 'G1', items: ['old-a', 'old-b'] }],
    })
    s = apply(s, { type: 'loadStart', requestId: 1 })
    s = apply(s, {
      type: 'loadSuccess',
      requestId: 1,
      items: ['new-a', 'new-b'],
      groups: [{ id: 'g2', label: 'G2', items: ['new-a', 'new-b'] }],
      disabled: ['new-b'],
    })
    expect(s.combobox.items).toEqual(['new-a', 'new-b'])
    expect(s.combobox.groups).toEqual([{ id: 'g2', label: 'G2', items: ['new-a', 'new-b'] }])
    expect(s.combobox.disabledItems).toEqual(['new-b'])
    // 'old-a' no longer exists in the fresh items — the stale selection is gone.
    expect(s.combobox.value).toEqual([])
  })

  describe('multiple mode', () => {
    it('toggles values and stays open', () => {
      let s = init({ items: ['Apple', 'Banana', 'Cherry'], selectionMode: 'multiple' })
      s = apply(s, { type: 'open' })
      s = apply(s, { type: 'selectValue', value: 'Apple' })
      expect(s.combobox.value).toEqual(['Apple'])
      expect(s.open).toBe(true)
      s = apply(s, { type: 'selectValue', value: 'Banana' })
      expect(s.combobox.value).toEqual(['Apple', 'Banana'])
      // selecting again removes it
      s = apply(s, { type: 'selectValue', value: 'Apple' })
      expect(s.combobox.value).toEqual(['Banana'])
    })

    it('resets the filter after each pick even though it stays open', () => {
      let s = init({ items: ['Apple', 'Avocado'], selectionMode: 'multiple' })
      s = apply(s, { type: 'open' })
      s = apply(s, { type: 'setFilter', value: 'av' })
      s = apply(s, { type: 'selectValue', value: 'Avocado' })
      expect(s.combobox.value).toEqual(['Avocado'])
      expect(s.combobox.inputValue).toBe('')
    })
  })

  describe('keyboard navigation parity (open list)', () => {
    it('arrows move the highlight, Home/End jump to ends', () => {
      let s = init({ items: ['Apple', 'Banana', 'Cherry'] })
      s = apply(s, { type: 'open' })
      expect(s.combobox.highlightedValue).toBe('Apple')
      s = apply(s, { type: 'highlightNext' })
      expect(s.combobox.highlightedValue).toBe('Banana')
      s = apply(s, { type: 'highlightLast' })
      expect(s.combobox.highlightedValue).toBe('Cherry')
      s = apply(s, { type: 'highlightPrev' })
      expect(s.combobox.highlightedValue).toBe('Banana')
      s = apply(s, { type: 'highlightFirst' })
      expect(s.combobox.highlightedValue).toBe('Apple')
    })
  })

  describe('closed-trigger typeahead', () => {
    it('a printable key while closed opens, seeds the filter, and highlights the match', () => {
      let s = init({ items: ['Apple', 'Banana', 'Cherry'] })
      s = apply(s, { type: 'triggerType', char: 'b' })
      expect(s.open).toBe(true)
      expect(s.combobox.inputValue).toBe('b')
      expect(s.combobox.filteredItems).toEqual(['Banana'])
      expect(s.combobox.highlightedValue).toBe('Banana')
    })
  })
})

describe('searchableSelect connect parts', () => {
  const state = rootSignal<SearchableSelectState>()
  const parts = connect(state, () => {}, { id: 'ss' })

  it('exposes a trigger button + filter input + listbox content', () => {
    expect(parts.trigger['data-part']).toBe('trigger')
    expect(parts.input['data-part']).toBe('input')
    expect(parts.content.role).toBe('listbox')
  })

  it('trigger label shows the placeholder when empty, the selected label when set', () => {
    const empty = init({ items: ['Apple', 'Banana'], placeholder: 'Pick a fruit' })
    expect(read(parts.triggerLabel, empty)).toBe('Pick a fruit')
    const picked = init({ items: ['Apple', 'Banana'], value: ['Banana'] })
    expect(read(parts.triggerLabel, picked)).toBe('Banana')
  })

  it('multiple mode trigger label shows a joined / counted summary', () => {
    const multi = init({
      items: ['Apple', 'Banana', 'Cherry'],
      selectionMode: 'multiple',
      value: ['Apple', 'Cherry'],
    })
    const label = read(parts.triggerLabel, multi)
    expect(label).toContain('Apple')
    expect(label).toContain('Cherry')
  })

  it('input value reflects the live filter, not the committed value', () => {
    const filtering = apply(apply(init({ items: ['Apple'], value: ['Apple'] }), { type: 'open' }), {
      type: 'setFilter',
      value: 'ap',
    })
    expect(read(parts.input.value, filtering)).toBe('ap')
  })

  it('exposes a clear trigger and an empty-state live region', () => {
    expect(parts.clear['data-part']).toBe('clear')
    expect(parts.empty['data-part']).toBe('empty')
    expect(parts.liveRegion['aria-live']).toBe('polite')
  })

  it('projects the real async machine state into listbox ARIA and live output', () => {
    const loading = apply(init({ items: ['Apple'] }), { type: 'loadStart', requestId: 1 })
    expect(read(parts.content['data-status'], loading)).toBe('loading')
    expect(read(parts.content['aria-busy'], loading)).toBe('true')

    const failed = apply(loading, {
      type: 'loadError',
      requestId: 1,
      error: 'Could not load fruit',
    })
    expect(read(parts.content['data-status'], failed)).toBe('error')
    expect(read(parts.content['aria-busy'], failed)).toBeUndefined()
    expect(read(parts.liveRegion.text, failed)).toBe('Could not load fruit')
  })

  /**
   * #265 finding 11 — the pattern's load projection must stay truthful and
   * mutually exclusive through the whole documented stale-while-revalidate
   * lifecycle: initial-empty -> loading -> success -> (revalidate) ->
   * stale-results -> success, and a failed revalidation reports 'error' even
   * though the previous items are still mounted underneath it.
   */
  it('loadState walks initial-empty -> loading -> success -> stale-results -> error truthfully', () => {
    let s = init({ items: [] })
    expect(read(parts.loadState, s)).toBe('initial-empty')

    s = apply(s, { type: 'loadStart', requestId: 1 })
    expect(read(parts.loadState, s)).toBe('loading')

    s = apply(s, { type: 'loadSuccess', requestId: 1, items: ['Apple', 'Banana'] })
    expect(read(parts.loadState, s)).toBe('success')

    // Revalidating: a fresh request starts while 'Apple'/'Banana' stay mounted.
    s = apply(s, { type: 'loadStart', requestId: 2 })
    expect(read(parts.loadState, s)).toBe('stale-results')
    expect(s.combobox.items).toEqual(['Apple', 'Banana'])

    s = apply(s, { type: 'loadError', requestId: 2, error: 'Network unavailable' })
    expect(read(parts.loadState, s)).toBe('error')
    // stale-while-revalidate: the previous items are untouched by the failure.
    expect(s.combobox.items).toEqual(['Apple', 'Banana'])
  })

  it('item parts carry aria-selected wiring', () => {
    const item = parts.item('Apple', 0)
    expect(item.item.role).toBe('option')
    const picked = init({ items: ['Apple', 'Banana'], value: ['Apple'] })
    expect(read(item.item['aria-selected'], picked)).toBe(true)
  })

  /**
   * The positioner is the one node in an overlay's tree the CONSUMER does not
   * build — `createOverlay` emits it — so `positionerClass` is the only way to
   * put the floating layer's `z-index` on it.
   *
   * Every `overlay()` under `components/` takes one. This pattern was missed
   * when they were added, which left a utility-styled consumer no way to give
   * this popup a stacking context at all; it is invisible while the opt-in
   * baseline stylesheet is doing the work, because that targets
   * `[data-part='positioner']` directly.
   */
  it('overlay accepts a positionerClass', () => {
    expect(overlayAcceptsPositionerClass()).toBe(true)
  })
})

/** Type-level assertion: `OverlayOptions` must admit `positionerClass`. A
 * runtime check cannot see an optional property that is never set, so the
 * compiler is the oracle — this fails to BUILD if the option is removed. */
function overlayAcceptsPositionerClass(): boolean {
  const opts: Pick<OverlayOptions, 'positionerClass'> = { positionerClass: 'z-popover' }
  return opts.positionerClass === 'z-popover'
}
