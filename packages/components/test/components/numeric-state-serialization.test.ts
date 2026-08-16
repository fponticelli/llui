import { describe, it, expect } from 'vitest'
import * as angleSlider from '../../src/components/angle-slider'
import * as asyncList from '../../src/components/async-list'
import * as carousel from '../../src/components/carousel'
import * as cascadeSelect from '../../src/components/cascade-select'
import * as colorPicker from '../../src/components/color-picker'
import * as combobox from '../../src/components/combobox'
import * as contextMenu from '../../src/components/context-menu'
import * as datePicker from '../../src/components/date-picker'
import * as floatingPanel from '../../src/components/floating-panel'
import * as fileUpload from '../../src/components/file-upload'
import * as imageCropper from '../../src/components/image-cropper'
import * as listbox from '../../src/components/listbox'
import * as menu from '../../src/components/menu'
import * as meter from '../../src/components/meter'
import * as numberInput from '../../src/components/number-input'
import * as pagination from '../../src/components/pagination'
import * as pinInput from '../../src/components/pin-input'
import * as progress from '../../src/components/progress'
import * as ratingGroup from '../../src/components/rating-group'
import * as scrollArea from '../../src/components/scroll-area'
import * as select from '../../src/components/select'
import * as signaturePad from '../../src/components/signature-pad'
import * as slider from '../../src/components/slider'
import * as splitter from '../../src/components/splitter'
import * as steps from '../../src/components/steps'
import * as sortable from '../../src/components/sortable'
import * as table from '../../src/components/table'
import * as tagsInput from '../../src/components/tags-input'
import * as timePicker from '../../src/components/time-picker'
import * as timer from '../../src/components/timer'
import * as toast from '../../src/components/toast'
import * as tour from '../../src/components/tour'
import * as treeView from '../../src/components/tree-view'
import * as commandMenu from '../../src/patterns/command-menu'
import * as dataTable from '../../src/patterns/data-table'
import * as formField from '../../src/patterns/form-field'
import * as wizard from '../../src/patterns/wizard'

const NON_FINITE = [NaN, Infinity, -Infinity]

function expectRoundTrip(state: unknown, label: string): void {
  expect(JSON.parse(JSON.stringify(state)), label).toStrictEqual(state)
}

function expectAllFinite(state: unknown, label: string, path = ''): void {
  if (typeof state === 'number') {
    expect(Number.isFinite(state), `${label}${path}`).toBe(true)
    return
  }
  if (Array.isArray(state)) {
    state.forEach((v, i) => expectAllFinite(v, label, `${path}[${i}]`))
    return
  }
  if (state !== null && typeof state === 'object') {
    for (const [k, v] of Object.entries(state)) expectAllFinite(v, label, `${path}.${k}`)
  }
}

function expectSerializableState(state: unknown, label: string): void {
  expectAllFinite(state, label)
  expectRoundTrip(state, label)
}

function expectIgnored<S, E>(before: S, result: readonly [S, E], label: string): void {
  expect(result[0], label).toBe(before)
  expectSerializableState(result[0], label)
}

/**
 * A NON-BOUND number in state is finite too (#214). Unlike a value on a grid,
 * these positions, counters, measurements, and timestamps have no legal range
 * that can supply a replacement during an update. Initialization therefore
 * uses the field's ordinary default; a runtime message is refused atomically.
 */
describe('non-bound numeric initialization uses documented defaults (#214)', () => {
  for (const bad of NON_FINITE) {
    it(`defaults every poisoned field (${bad}) without throwing`, () => {
      const states: Array<[string, unknown]> = [
        ['async-list.page', asyncList.init({ page: bad })],
        ['carousel.current', carousel.init({ current: bad })],
        ['meter.value', meter.init({ value: bad })],
        ['pagination.page', pagination.init({ page: bad })],
        ['progress.value', progress.init({ value: bad })],
        ['rating-group.value', ratingGroup.init({ value: bad })],
        ['splitter.position', splitter.init({ position: bad })],
        [
          'steps.current/completed',
          steps.init({ current: bad, completed: [0, bad, 2], steps: ['a', 'b', 'c'] }),
        ],
        ['timer.elapsedMs', timer.init({ elapsedMs: bad })],
        [
          'tour.index',
          tour.init({
            index: bad,
            steps: [{ id: 'a', title: 'A', description: '', target: '#a' }],
          }),
        ],
        [
          'date-picker.visibleMonth/visibleYear',
          datePicker.init({ value: '2024-06-15', visibleMonth: bad, visibleYear: bad }),
        ],
        [
          'floating-panel.position/size',
          floatingPanel.init({
            position: { x: bad, y: 44 },
            size: { width: 320, height: bad },
          }),
        ],
        [
          'floating-panel.position/size inverse axes',
          floatingPanel.init({
            position: { x: 11, y: bad },
            size: { width: bad, height: 250 },
          }),
        ],
        [
          'color-picker.hsv/alpha',
          colorPicker.init({ hsv: { h: bad, s: bad, v: bad }, alpha: bad }),
        ],
        ['color-picker.hsl', colorPicker.init({ hsl: { h: bad, s: bad, l: bad } })],
        [
          'time-picker.value',
          timePicker.init({ value: { hours: bad, minutes: bad, seconds: bad } }),
        ],
        ['signature-pad.strokes', signaturePad.init({ strokes: [[{ x: bad, y: 1 }]] })],
        ['table.focusedCell', table.init({ focusedCell: { rowIndex: bad, colIndex: bad } })],
        [
          'file-upload.files size',
          fileUpload.init({
            files: [{ id: 'bad', name: 'bad', size: bad, type: '', lastModified: 0 }],
          }),
        ],
        [
          'file-upload.files lastModified',
          fileUpload.init({
            files: [{ id: 'bad', name: 'bad', size: 1, type: '', lastModified: bad }],
          }),
        ],
        ['date-picker.weekStartsOn', datePicker.init({ weekStartsOn: bad as 0 | 1 })],
        ['command-menu.maxRecents', commandMenu.init({ maxRecents: bad })],
      ]
      for (const [label, state] of states) expectSerializableState(state, label)

      expect(asyncList.init({ page: bad }).page).toBe(0)
      expect(carousel.init({ current: bad }).current).toBe(0)
      expect(meter.init({ value: bad }).value).toBe(0)
      expect(pagination.init({ page: bad }).page).toBe(1)
      expect(progress.init({ value: bad }).value).toBe(0)
      expect(ratingGroup.init({ value: bad }).value).toBe(0)
      expect(splitter.init({ position: bad }).position).toBe(50)
      expect(steps.init({ current: bad, completed: [0, bad] })).toMatchObject({
        current: 0,
        completed: [],
      })
      expect(timer.init({ elapsedMs: bad }).elapsedMs).toBe(0)
      expect(
        timePicker.init({ value: { hours: bad, minutes: bad, seconds: bad } }).value,
      ).toStrictEqual({ hours: 0, minutes: 0, seconds: 0 })
      expect(signaturePad.init({ strokes: [[{ x: bad, y: 1 }]] }).strokes).toStrictEqual([])
      expect(table.init({ focusedCell: { rowIndex: bad, colIndex: bad } }).focusedCell).toBeNull()
      expect(
        fileUpload.init({
          files: [{ id: 'bad', name: 'bad', size: bad, type: '', lastModified: 0 }],
        }).files,
      ).toStrictEqual([])
      expect(
        fileUpload.init({
          files: [{ id: 'bad', name: 'bad', size: 1, type: '', lastModified: bad }],
        }).files,
      ).toStrictEqual([])
      const calendarDefault = datePicker.init().weekStartsOn
      expect(datePicker.init({ weekStartsOn: bad as 0 | 1 }).weekStartsOn).toBe(calendarDefault)
      expect(commandMenu.init({ maxRecents: bad }).maxRecents).toBe(50)
      expect(
        tour.init({
          index: bad,
          steps: [{ id: 'a', title: 'A', description: '', target: '#a' }],
        }).index,
      ).toBe(0)
      expect(
        datePicker.init({ value: '2024-06-15', visibleMonth: bad, visibleYear: bad }),
      ).toMatchObject({ visibleMonth: 6, visibleYear: 2024 })
      expect(
        floatingPanel.init({
          position: { x: bad, y: 44 },
          size: { width: 320, height: bad },
        }),
      ).toMatchObject({ position: { x: 100, y: 44 }, size: { width: 320, height: 300 } })
      expect(
        floatingPanel.init({
          position: { x: 11, y: bad },
          size: { width: bad, height: 250 },
        }),
      ).toMatchObject({ position: { x: 11, y: 100 }, size: { width: 400, height: 250 } })
      expect(colorPicker.init({ hsv: { h: bad, s: bad, v: bad }, alpha: bad })).toMatchObject({
        hsv: { h: 0, s: 100, v: 100 },
        alpha: 1,
      })
    })
  }

  it('keeps explicit null as progress indeterminate state', () => {
    expect(progress.init({ value: null }).value).toBeNull()
  })
})

describe('non-bound numeric runtime messages are atomic no-ops (#214)', () => {
  for (const bad of NON_FINITE) {
    it(`refuses single-number position/value writes (${bad})`, () => {
      const carouselState = carousel.init({ current: 1, count: 3 })
      expectIgnored(
        carouselState,
        carousel.update(carouselState, { type: 'goTo', index: bad }),
        'carousel goTo',
      )

      const paginationState = pagination.init({ page: 2, total: 100 })
      expectIgnored(
        paginationState,
        pagination.update(paginationState, { type: 'goTo', page: bad }),
        'pagination goTo',
      )

      const meterState = meter.init({ value: 30 })
      expectIgnored(
        meterState,
        meter.update(meterState, { type: 'setValue', value: bad }),
        'meter setValue',
      )

      const progressState = progress.init({ value: 30 })
      expectIgnored(
        progressState,
        progress.update(progressState, { type: 'setValue', value: bad }),
        'progress setValue',
      )

      const ratingState = ratingGroup.init({ value: 3 })
      expectIgnored(
        ratingState,
        ratingGroup.update(ratingState, { type: 'hover', value: bad }),
        'rating hover',
      )
    })

    it(`refuses every poisoned member of multi-number measurements (${bad})`, () => {
      const panel = floatingPanel.init({
        position: { x: 10, y: 20 },
        size: { width: 300, height: 250 },
      })
      for (const msg of [
        { type: 'setPosition' as const, x: bad, y: 40 },
        { type: 'setPosition' as const, x: 30, y: bad },
        { type: 'setSize' as const, width: bad, height: 260 },
        { type: 'setSize' as const, width: 320, height: bad },
      ]) {
        expectIgnored(panel, floatingPanel.update(panel, msg), `floating-panel ${msg.type}`)
      }

      const dragging = floatingPanel.update(panel, { type: 'dragStart' })[0]
      for (const msg of [
        { type: 'dragMove' as const, dx: bad, dy: 1 },
        { type: 'dragMove' as const, dx: 1, dy: bad },
      ]) {
        expectIgnored(dragging, floatingPanel.update(dragging, msg), 'floating-panel dragMove')
      }

      const resizing = floatingPanel.update(panel, { type: 'resizeStart', handle: 'se' })[0]
      for (const msg of [
        { type: 'resizeMove' as const, dx: bad, dy: 1 },
        { type: 'resizeMove' as const, dx: 1, dy: bad },
      ]) {
        expectIgnored(resizing, floatingPanel.update(resizing, msg), 'floating-panel resizeMove')
      }

      const dims = {
        type: 'setScroll' as const,
        scrollTop: 10,
        scrollLeft: 20,
        scrollWidth: 1000,
        scrollHeight: 800,
        clientWidth: 300,
        clientHeight: 200,
      }
      for (const field of [
        'scrollTop',
        'scrollLeft',
        'scrollWidth',
        'scrollHeight',
        'clientWidth',
        'clientHeight',
      ] as const) {
        const state = scrollArea.init()
        const msg = { ...dims, [field]: bad }
        expectIgnored(state, scrollArea.update(state, msg), `scroll-area ${field}`)
      }
    })

    it(`refuses invalid gesture coordinates before arithmetic (${bad})`, () => {
      const carouselState = carousel.init({ count: 3 })
      expectIgnored(
        carouselState,
        carousel.update(carouselState, { type: 'dragStart', x: bad }),
        'carousel dragStart',
      )
      const carouselDrag = carousel.update(carouselState, { type: 'dragStart', x: 10 })[0]
      expectIgnored(
        carouselDrag,
        carousel.update(carouselDrag, { type: 'dragMove', x: bad }),
        'carousel dragMove',
      )

      const cropper = imageCropper.init({ image: { width: 400, height: 300 } })
      const cropDrag = imageCropper.update(cropper, { type: 'dragStart' })[0]
      for (const msg of [
        { type: 'dragMove' as const, dx: bad, dy: 1 },
        { type: 'dragMove' as const, dx: 1, dy: bad },
      ]) {
        expectIgnored(cropDrag, imageCropper.update(cropDrag, msg), 'image-cropper dragMove')
      }
      const cropResize = imageCropper.update(cropper, { type: 'resizeStart', handle: 'se' })[0]
      for (const msg of [
        { type: 'resizeMove' as const, dx: bad, dy: 1 },
        { type: 'resizeMove' as const, dx: 1, dy: bad },
      ]) {
        expectIgnored(cropResize, imageCropper.update(cropResize, msg), 'image-cropper resizeMove')
      }
    })

    it(`refuses invalid external time/date inputs before arithmetic (${bad})`, () => {
      const idle = timer.init({ elapsedMs: 250 })
      expectIgnored(idle, timer.update(idle, { type: 'start', now: bad }), 'timer start')
      const running = timer.update(idle, { type: 'start', now: 1000 })[0]
      expectIgnored(running, timer.update(running, { type: 'pause', now: bad }), 'timer pause')
      expectIgnored(running, timer.update(running, { type: 'tick', now: bad }), 'timer tick')

      const calendar = datePicker.init({ value: '2024-06-15' })
      expectIgnored(
        calendar,
        datePicker.update(calendar, { type: 'moveFocus', days: bad }),
        'date-picker moveFocus',
      )
    })

    it(`refuses invalid step identifiers atomically (${bad})`, () => {
      const stepsState = steps.init({
        current: 0,
        completed: [0],
        steps: ['a', 'b', 'c'],
        linear: false,
      })
      for (const msg of [
        { type: 'goTo' as const, step: bad },
        { type: 'complete' as const, step: bad },
        { type: 'markError' as const, step: bad },
        { type: 'clearError' as const, step: bad },
      ]) {
        expectIgnored(stepsState, steps.update(stepsState, msg), `steps ${msg.type}`)
      }

      const tourState = tour.init({
        steps: [{ id: 'a', title: 'A', description: '', target: '#a' }],
      })
      expectIgnored(tourState, tour.update(tourState, { type: 'goto', index: bad }), 'tour goto')
    })
  }

  it('preserves valid finite position, measurement, time, and date behavior', () => {
    expect(
      carousel.update(carousel.init({ count: 3 }), { type: 'goTo', index: 2 })[0].current,
    ).toBe(2)
    expect(
      pagination.update(pagination.init({ total: 100 }), { type: 'goTo', page: 5 })[0].page,
    ).toBe(5)
    expect(
      floatingPanel.update(floatingPanel.init(), { type: 'setPosition', x: -25, y: 40 })[0]
        .position,
    ).toStrictEqual({ x: -25, y: 40 })
    expect(
      scrollArea.update(scrollArea.init(), {
        type: 'setScroll',
        scrollTop: 10,
        scrollLeft: 20,
        scrollWidth: 1000,
        scrollHeight: 800,
        clientWidth: 300,
        clientHeight: 200,
      })[0],
    ).toMatchObject({ scrollTop: 10, overflowX: true, overflowY: true })
    const running = timer.update(timer.init({ elapsedMs: 50 }), { type: 'start', now: 1000 })[0]
    expect(timer.update(running, { type: 'tick', now: 1100 })[0]).toMatchObject({
      elapsedMs: 150,
      startedAt: 1100,
    })
    expect(
      datePicker.update(datePicker.init({ value: '2024-06-15' }), { type: 'moveFocus', days: 1 })[0]
        .focused,
    ).toBe('2024-06-16')
  })
})

describe('package-wide component-owned numeric message inventory (#214)', () => {
  for (const bad of NON_FINITE) {
    it(`rejects colors, ratings, menu coordinates, and list positions (${bad})`, () => {
      const color = colorPicker.init({ hsv: { h: 30, s: 40, v: 50 } })
      for (const msg of [
        { type: 'setHsl' as const, hsl: { h: bad, s: 40, l: 50 } },
        { type: 'setHsl' as const, hsl: { h: 30, s: bad, l: 50 } },
        { type: 'setHsl' as const, hsl: { h: 30, s: 40, l: bad } },
        { type: 'setHue' as const, h: bad },
        { type: 'nudgeSv' as const, ds: bad, dv: 1 },
        { type: 'nudgeSv' as const, ds: 1, dv: bad },
      ]) {
        expectIgnored(color, colorPicker.update(color, msg), `color-picker ${msg.type}`)
      }

      for (const rating of [
        ratingGroup.init({ value: 2 }),
        ratingGroup.init({ value: 2, disabled: true }),
        ratingGroup.init({ value: 2, readonly: true }),
      ]) {
        expectIgnored(
          rating,
          ratingGroup.update(rating, { type: 'hover', value: bad }),
          'rating-group hover',
        )
        expectIgnored(
          rating,
          ratingGroup.update(rating, { type: 'hoverItem', index: bad, isLeftHalf: false }),
          'rating-group hoverItem',
        )
      }

      const context = contextMenu.update(contextMenu.init(), { type: 'openAt', x: 0, y: 0 })[0]
      for (const msg of [
        { type: 'openAt' as const, x: bad, y: 20 },
        { type: 'openAt' as const, x: 10, y: bad },
        { type: 'typeahead' as const, level: '', char: 'a', now: bad },
      ]) {
        expectIgnored(context, contextMenu.update(context, msg), `context-menu ${msg.type}`)
      }

      const list = listbox.init({ items: ['a', 'b'] })
      expectIgnored(
        list,
        listbox.update(list, { type: 'highlight', index: bad }),
        'listbox highlight',
      )
      expectIgnored(
        list,
        listbox.update(list, { type: 'typeahead', char: 'a', now: bad }),
        'listbox typeahead',
      )
    })

    it(`rejects sortable pointer/index payloads atomically (${bad})`, () => {
      const idle = sortable.init()
      for (const msg of [
        { type: 'start' as const, id: 'a', index: bad, container: 'c', x: 10, y: 20 },
        { type: 'start' as const, id: 'a', index: 0, container: 'c', x: bad, y: 20 },
        { type: 'start' as const, id: 'a', index: 0, container: 'c', x: 10, y: bad },
        { type: 'toggleGrab' as const, id: 'a', index: bad, container: 'c' },
      ]) {
        expectIgnored(idle, sortable.update(idle, msg), `sortable ${msg.type}`)
      }
      const active = sortable.update(idle, {
        type: 'start',
        id: 'a',
        index: 0,
        container: 'c',
        x: 10,
        y: 20,
      })[0]
      for (const msg of [
        { type: 'move' as const, index: bad, container: 'c', x: 11, y: 21 },
        { type: 'move' as const, index: 1, container: 'c', x: bad, y: 21 },
        { type: 'move' as const, index: 1, container: 'c', x: 11, y: bad },
        { type: 'moveBy' as const, delta: bad },
      ]) {
        expectIgnored(active, sortable.update(active, msg), `sortable ${msg.type}`)
      }
    })

    it(`rejects sibling typeahead clocks and async request ids (${bad})`, () => {
      const menuState = menu.init({ open: true })
      expectIgnored(
        menuState,
        menu.update(menuState, { type: 'typeahead', level: '', char: 'a', now: bad }),
        'menu typeahead',
      )
      const tree = treeView.init({ visibleItems: ['a'] })
      expectIgnored(
        tree,
        treeView.update(tree, { type: 'typeahead', char: 'a', now: bad }),
        'tree-view typeahead',
      )
      const selectState = select.init({ items: ['a'] })
      expectIgnored(
        selectState,
        select.update(selectState, { type: 'typeahead', char: 'a', now: bad }),
        'select typeahead',
      )
      const combo = combobox.init()
      expectIgnored(
        combo,
        combobox.update(combo, { type: 'loadStart', requestId: bad }),
        'combobox loadStart',
      )
      const fields = formField.init({ id: 'f', fields: ['name'] })
      expectIgnored(
        fields,
        formField.update(fields, {
          type: 'validateAsync',
          schema: { '~standard': { version: 1, vendor: 'test', validate: () => ({ value: {} }) } },
          values: {},
          requestId: bad,
        }),
        'form-field validateAsync',
      )

      const invalidIssue = { message: 'bad path', path: [bad] }
      const syncSchema = {
        '~standard': {
          version: 1 as const,
          vendor: 'test',
          validate: () => ({ issues: [invalidIssue] }),
        },
      }
      expectIgnored(
        fields,
        formField.update(fields, { type: 'validate', schema: syncSchema, values: { n: bad } }),
        'form-field validate issues',
      )
      const pending = formField.update(fields, {
        type: 'validateAsync',
        schema: syncSchema,
        values: { n: bad },
        requestId: 1,
      })[0]
      expect(pending).not.toBe(fields)
      expect(pending).toMatchObject({ validationId: 1, fields: { name: { pending: true } } })
      expectIgnored(
        pending,
        formField.update(pending, {
          type: 'validateResult',
          requestId: 1,
          issues: [invalidIssue],
        }),
        'form-field validateResult issues',
      )
    })

    it(`rejects array and roving-index payloads (${bad})`, () => {
      const cascade = cascadeSelect.init({
        levels: [{ id: 'a', label: 'A', options: [{ value: 'x', label: 'X' }] }],
      })
      expectIgnored(
        cascade,
        cascadeSelect.update(cascade, { type: 'setValue', levelIndex: bad, value: 'x' }),
        'cascade-select setValue',
      )

      const upload = fileUpload.init()
      expectIgnored(
        upload,
        fileUpload.update(upload, { type: 'removeFile', index: bad }),
        'file-upload removeFile',
      )
      expectIgnored(
        upload,
        fileUpload.update(upload, { type: 'removeRejected', index: bad }),
        'file-upload removeRejected',
      )

      const pin = pinInput.init({ values: ['1', '2', '', ''] })
      for (const msg of [
        { type: 'setValue' as const, index: bad, value: '3' },
        { type: 'focus' as const, index: bad },
        { type: 'backspace' as const, index: bad },
      ]) {
        expectIgnored(pin, pinInput.update(pin, msg), `pin-input ${msg.type}`)
      }

      const tags = tagsInput.init({ value: ['a', 'b'] })
      expectIgnored(
        tags,
        tagsInput.update(tags, { type: 'removeTag', index: bad }),
        'tags removeTag',
      )
      expectIgnored(tags, tagsInput.update(tags, { type: 'focusTag', index: bad }), 'tags focusTag')

      const angle = angleSlider.init()
      expectIgnored(
        angle,
        angleSlider.update(angle, { type: 'increment', steps: bad }),
        'angle-slider increment steps',
      )
      const number = numberInput.init()
      expectIgnored(
        number,
        numberInput.update(number, { type: 'increment', multiplier: bad }),
        'number-input increment multiplier',
      )
      const split = splitter.init()
      expectIgnored(
        split,
        splitter.update(split, { type: 'increment', multiplier: bad }),
        'splitter increment multiplier',
      )

      const thumbs = slider.init({ value: [25, 75] })
      for (const msg of [
        { type: 'setThumb' as const, index: bad, value: 50 },
        { type: 'increment' as const, index: 0, multiplier: bad },
        { type: 'decrement' as const, index: bad, multiplier: 1 },
        { type: 'toMin' as const, index: bad },
        { type: 'toMax' as const, index: bad },
      ]) {
        expectIgnored(thumbs, slider.update(thumbs, msg), `slider ${msg.type}`)
      }
    })

    it(`rejects table and composed data-table coordinates (${bad})`, () => {
      const grid = table.init({ rows: ['a', 'b'], selectionMode: 'multiple' })
      for (const msg of [
        { type: 'toggleRow' as const, id: 'a', index: bad },
        { type: 'selectRange' as const, index: bad },
        { type: 'activateRow' as const, id: 'a', index: bad },
        { type: 'focusCell' as const, rowIndex: bad, colIndex: 0 },
        { type: 'focusCell' as const, rowIndex: 0, colIndex: bad },
        { type: 'moveCell' as const, dRow: bad, dCol: 0 },
        { type: 'moveCell' as const, dRow: 0, dCol: bad },
      ]) {
        expectIgnored(grid, table.update(grid, msg), `table ${msg.type}`)
      }

      const composed = dataTable.init({ selectionMode: 'multiple', total: 20 })
      for (const msg of [
        { type: 'setPage' as const, page: bad },
        { type: 'setPageSize' as const, pageSize: bad },
        { type: 'toggleRow' as const, id: 'a', index: bad },
        { type: 'selectRange' as const, index: bad },
        { type: 'activateRow' as const, id: 'a', index: bad },
        { type: 'focusCell' as const, rowIndex: bad, colIndex: 0 },
        { type: 'focusCell' as const, rowIndex: 0, colIndex: bad },
      ]) {
        expectIgnored(composed, dataTable.update(composed, msg), `data-table ${msg.type}`)
      }
      const loading = dataTable.update(composed, { type: 'reload' })[0]
      expectIgnored(
        loading,
        dataTable.update(loading, {
          type: 'pageLoaded',
          queryId: loading.queryId,
          rows: ['a'],
          total: bad,
        }),
        'data-table pageLoaded total',
      )
    })

    it(`rejects time, drawing, toast, and wizard numbers (${bad})`, () => {
      const clock = timePicker.init({ value: { hours: 1, minutes: 2, seconds: 3 } })
      for (const msg of [
        { type: 'setValue' as const, value: { hours: bad, minutes: 2, seconds: 3 } },
        { type: 'setValue' as const, value: { hours: 1, minutes: bad, seconds: 3 } },
        { type: 'setValue' as const, value: { hours: 1, minutes: 2, seconds: bad } },
        { type: 'setHours' as const, hours: bad },
        { type: 'setMinutes' as const, minutes: bad },
        { type: 'setSeconds' as const, seconds: bad },
      ]) {
        expectIgnored(clock, timePicker.update(clock, msg), `time-picker ${msg.type}`)
      }

      const pad = signaturePad.init()
      for (const msg of [
        { type: 'strokeStart' as const, x: bad, y: 2 },
        { type: 'strokeStart' as const, x: 1, y: bad },
        { type: 'strokeStart' as const, x: 1, y: 2, pressure: bad },
        { type: 'redo' as const, stroke: [{ x: bad, y: 2 }] },
        { type: 'setStrokes' as const, strokes: [[{ x: 1, y: bad }]] },
      ]) {
        expectIgnored(pad, signaturePad.update(pad, msg), `signature-pad ${msg.type}`)
      }

      const toaster = toast.init()
      const badToast = {
        id: 'a',
        type: 'info' as const,
        duration: bad,
        dismissable: true,
      }
      expectIgnored(
        toaster,
        toast.update(toaster, { type: 'create', toast: badToast }),
        'toast create',
      )

      const flow = wizard.init({ steps: ['a', 'b'], linear: false })
      for (const msg of [
        { type: 'goTo' as const, step: bad },
        { type: 'stepValid' as const, step: bad },
        { type: 'stepInvalid' as const, step: bad },
      ]) {
        expectIgnored(flow, wizard.update(flow, msg), `wizard ${msg.type}`)
      }
    })
  }
})

describe('finite operands cannot overflow component-owned state (#214)', () => {
  it('keeps pagination arithmetic finite at IEEE-754 extremes', () => {
    const before = pagination.init({
      page: Number.MAX_VALUE,
      pageSize: 1,
      total: Number.MAX_VALUE,
    })
    const next = pagination.update(before, {
      type: 'setPageSize',
      pageSize: Number.MIN_VALUE,
    })[0]
    expect(next.pageSize).toBe(Number.MIN_VALUE)
    expect(next.page).toBe(Number.MAX_VALUE)
    expect(pagination.totalPages(next)).toBe(Number.MAX_VALUE)
    expectSerializableState(next, 'pagination extreme finite operands')
  })

  it('rejects overflowing carousel and floating-panel gesture results atomically', () => {
    const carouselStart = carousel.update(carousel.init(), {
      type: 'dragStart',
      x: -Number.MAX_VALUE,
    })
    const carouselBefore = carouselStart[0]
    expect(carousel.update(carouselBefore, { type: 'dragMove', x: Number.MAX_VALUE })[0]).toBe(
      carouselBefore,
    )

    const floatingBefore = floatingPanel.update(
      floatingPanel.init({ position: { x: Number.MAX_VALUE, y: 0 } }),
      { type: 'dragStart' },
    )[0]
    expect(
      floatingPanel.update(floatingBefore, { type: 'dragMove', dx: Number.MAX_VALUE, dy: 0 })[0],
    ).toBe(floatingBefore)

    const resizing = floatingPanel.update(
      floatingPanel.init({ size: { width: Number.MAX_VALUE, height: 300 } }),
      { type: 'resizeStart', handle: 'e' },
    )[0]
    expect(
      floatingPanel.update(resizing, { type: 'resizeMove', dx: Number.MAX_VALUE, dy: 0 })[0],
    ).toBe(resizing)
  })

  it('rejects overflowing elapsed-time arithmetic atomically', () => {
    const running = timer.update(timer.init({ elapsedMs: Number.MAX_VALUE }), {
      type: 'start',
      now: -Number.MAX_VALUE,
    })[0]
    expect(timer.update(running, { type: 'tick', now: Number.MAX_VALUE })[0]).toBe(running)
    expect(timer.update(running, { type: 'pause', now: Number.MAX_VALUE })[0]).toBe(running)
  })

  it('rejects overflowing date and crop gesture arithmetic atomically', () => {
    const calendar = datePicker.init({ value: '2024-06-15' })
    expect(datePicker.update(calendar, { type: 'moveFocus', days: Number.MAX_VALUE })[0]).toBe(
      calendar,
    )

    const crop = imageCropper.update(
      imageCropper.init({
        image: { width: Number.MAX_VALUE, height: Number.MAX_VALUE },
        crop: { x: Number.MAX_VALUE, y: 0, width: 1, height: 1 },
      }),
      { type: 'dragStart' },
    )[0]
    expect(imageCropper.update(crop, { type: 'dragMove', dx: Number.MAX_VALUE, dy: 0 })[0]).toBe(
      crop,
    )
  })
})

describe('zero-divisor numeric state requires a positive finite number (#214)', () => {
  for (const bad of [...NON_FINITE, 0, -1]) {
    it(`defaults invalid initialization and refuses runtime updates (${bad})`, () => {
      expect(pagination.init({ pageSize: bad }).pageSize).toBe(10)
      expect(imageCropper.init({ aspectRatio: bad }).aspectRatio).toBeNull()

      const pages = pagination.init({ page: 2, pageSize: 10, total: 95 })
      expect(pagination.update(pages, { type: 'setPageSize', pageSize: bad })[0]).toBe(pages)

      const cropper = imageCropper.init({
        image: { width: 400, height: 300 },
        aspectRatio: 16 / 9,
      })
      expect(imageCropper.update(cropper, { type: 'setAspectRatio', ratio: bad })[0]).toBe(cropper)
      expectSerializableState(cropper, `cropper ratio ${bad}`)
    })
  }

  it('keeps null unconstrained and positive finite values functional', () => {
    const cropper = imageCropper.init({ image: { width: 400, height: 300 }, aspectRatio: 1 })
    const [free] = imageCropper.update(cropper, { type: 'setAspectRatio', ratio: null })
    expect(free.aspectRatio).toBeNull()
    expect(imageCropper.init({ aspectRatio: 2 }).aspectRatio).toBe(2)

    const pages = pagination.init({ page: 2, pageSize: 10, total: 95 })
    expect(pagination.update(pages, { type: 'setPageSize', pageSize: 20 })[0]).toMatchObject({
      page: 1,
      pageSize: 20,
    })
  })

  for (const ratio of [Number.MIN_VALUE, Number.MAX_VALUE]) {
    it(`fits the full positive finite aspect-ratio domain without corrupting state (${ratio})`, () => {
      const image = { width: 100, height: 100 }
      const expectedSize =
        ratio < 1
          ? { width: image.height * ratio, height: image.height }
          : { width: image.width, height: image.width / ratio }
      const expectedInitialCrop = {
        x: ratio < 1 ? 50 : 0,
        y: ratio < 1 ? 0 : 50,
        ...expectedSize,
      }

      const initialized = imageCropper.init({ image, aspectRatio: ratio })
      expect(initialized).toMatchObject({ aspectRatio: ratio, crop: expectedInitialCrop })
      expectSerializableState(initialized, `cropper init extreme ratio ${ratio}`)

      const unconstrained = imageCropper.init({ image })
      const [updated] = imageCropper.update(unconstrained, { type: 'setAspectRatio', ratio })
      expect(updated).toMatchObject({ aspectRatio: ratio, crop: { x: 0, y: 0, ...expectedSize } })
      expectSerializableState(updated, `cropper update extreme ratio ${ratio}`)
    })
  }
})
