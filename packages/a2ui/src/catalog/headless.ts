/**
 * Basic-catalog builders that reuse `@llui/components` headless primitives.
 *
 * These state machines are pure (`init`/`update`/`connect`) with no scope of
 * their own, so we drive them directly from an A2UI-derived `Signal` and route
 * their messages back through our reducer — no child-component boundary needed.
 */

import {
  derived,
  div,
  each,
  input,
  label as labelEl,
  onMount,
  show,
  span,
  text,
  type Send,
  type Signal,
} from '@llui/dom'
import { lockBodyScroll, pushFocusTrap } from '@llui/components/utils'
import * as checkbox from '@llui/components/checkbox'
import * as tabs from '@llui/components/tabs'
import * as dialog from '@llui/components/dialog'
import * as slider from '@llui/components/slider'
import * as combobox from '@llui/components/combobox'
import * as datePicker from '@llui/components/date-picker'
import type { BuildArgs, ComponentBuilder, RenderContext, RenderScope } from '../catalog.js'
import { bindString, firstCheckError } from '../binding.js'
import { resolvePointer } from '../pointer.js'
import {
  isPathBinding,
  type ComponentId,
  type DynamicBoolean,
  type DynamicString,
  type JsonObject,
  type JsonValue,
} from '../protocol.js'
import { checksOf, elx, labelledField } from './basic.js'

function toBool(value: unknown): boolean {
  return value === true || value === 'true'
}
function toNum(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * Read a stateful component's own state blob out of the surface UI-state store,
 * or the fallback if it has not been written yet. The stored value is that
 * component's JSON-serializable state, so the cast is sound at this boundary.
 */
function readUi<T>(ui: JsonObject, id: ComponentId, fallback: T): T {
  const value = ui[id]
  return value === undefined ? fallback : (value as unknown as T)
}

/**
 * Drive a `@llui/components` state machine from the surface UI-state store:
 * derive its reactive state and a `send` that runs the component's OWN reducer
 * and persists the next state via `setUi`. Full behaviour (keyboard nav, focus)
 * is preserved because the real reducer runs.
 */
function driveUi<S, M>(
  ctx: RenderContext,
  scope: RenderScope,
  key: string,
  initial: S,
  reducer: (state: S, msg: M) => [S, unknown[]],
): { state: Signal<S>; send: Send<M> } {
  // Read from the (depth-scoped) scope.uiState; write via ctx.setUi (a plain
  // send, safe at any depth).
  const state = scope.uiState.map((ui) => readUi(ui, key, initial))
  const send: Send<M> = (msg) => {
    const current = readUi(scope.uiState.peek(), key, initial)
    const [next] = reducer(current, msg)
    ctx.setUi(key, next as unknown as JsonValue)
  }
  return { state, send }
}

/** A per-instance key so a stateful component repeated in a template rows apart. */
function instanceKey(scope: { keyPrefix: string }, id: ComponentId): string {
  return `${scope.keyPrefix}:${id}`
}

function domId(key: string): string {
  return `a2ui-${key}`.replace(/[^\w-]/g, '-')
}

/** CheckBox → `@llui/components` checkbox, two-way bound to a boolean data path. */
const CheckBox: ComponentBuilder = ({ node, ctx, scope }: BuildArgs) => {
  const binding = node.value as DynamicBoolean | undefined
  const path = isPathBinding(binding) ? binding.path : undefined
  const abs = path ? scope.absPath(path) : undefined

  const state = scope.data.map(
    (d): checkbox.CheckboxState => ({
      checked: path ? toBool(resolvePointer(d, path)) : toBool(binding),
      disabled: false,
      required: false,
    }),
  )

  const send: Send<checkbox.CheckboxMsg> = (msg) => {
    if (!abs) return
    if (msg.type === 'toggle') {
      const current = path ? toBool(resolvePointer(scope.data.peek(), path)) : false
      ctx.send({ type: 'setData', surfaceId: ctx.surfaceId, path: abs, value: !current })
    } else if (msg.type === 'setChecked') {
      ctx.send({
        type: 'setData',
        surfaceId: ctx.surfaceId,
        path: abs,
        value: msg.checked === true,
      })
    }
  }

  const parts = checkbox.connect(state, send)
  const labelText = bindString(ctx, scope, node.label as DynamicString | undefined)

  return [
    labelEl({ class: 'a2ui-checkbox' }, [
      elx('span', { ...parts.root, class: 'a2ui-checkbox-box' }, [
        elx('span', { ...parts.indicator, class: 'a2ui-checkbox-indicator' }),
      ]),
      elx('input', { ...parts.hiddenInput }),
      span({ class: 'a2ui-checkbox-label' }, [text(labelText)]),
    ]),
  ]
}

interface TabDef {
  readonly title: DynamicString
  readonly child: ComponentId
}

/** Tabs → `@llui/components` tabs, with active-tab state in the surface UI store. */
const Tabs: ComponentBuilder = ({ node, ctx, scope }: BuildArgs) => {
  const defs = (Array.isArray(node.tabs) ? node.tabs : []) as TabDef[]
  const values = defs.map((_, i) => String(i))
  const initial = tabs.init({ items: values, value: values[0] ?? '' })
  const key = instanceKey(scope, node.id)
  const { state, send } = driveUi<tabs.TabsState, tabs.TabsMsg>(
    ctx,
    scope,
    key,
    initial,
    tabs.update,
  )
  const parts = tabs.connect(state, send, { id: domId(`tabs-${key}`) })

  const triggers = defs.map((tab, i) => {
    const item = parts.item(String(i))
    return elx('button', { ...item.trigger, class: 'a2ui-tab' }, [
      text(bindString(ctx, scope, tab.title)),
    ])
  })
  const panels = defs.map((tab, i) => {
    const item = parts.item(String(i))
    return elx('div', { ...item.panel, class: 'a2ui-tab-panel' }, ctx.renderById(tab.child, scope))
  })

  return [
    elx('div', { ...parts.root, class: 'a2ui-tabs' }, [
      elx('div', { ...parts.list, class: 'a2ui-tabs-list' }, triggers),
      ...panels,
    ]),
  ]
}

/** Modal → `@llui/components` dialog, with open state in the surface UI store. */
const Modal: ComponentBuilder = ({ node, ctx, scope }: BuildArgs) => {
  const triggerId = typeof node.trigger === 'string' ? node.trigger : undefined
  const contentId = typeof node.content === 'string' ? node.content : undefined
  const key = instanceKey(scope, node.id)
  const { state, send } = driveUi<dialog.DialogState, dialog.DialogMsg>(
    ctx,
    scope,
    key,
    dialog.init(),
    dialog.update,
  )
  const parts = dialog.connect(state, send, { id: domId(`modal-${key}`) })
  const open = state.map((s) => s.open)

  return [
    div({ class: 'a2ui-modal' }, [
      elx(
        'div',
        { ...parts.trigger, class: 'a2ui-modal-trigger', onClick: () => send({ type: 'open' }) },
        triggerId ? ctx.renderById(triggerId, scope) : [],
      ),
      show(open, () => [
        elx('div', {
          ...parts.backdrop,
          class: 'a2ui-modal-backdrop',
          onClick: () => send({ type: 'close' }),
        }),
        elx('div', { ...parts.positioner, class: 'a2ui-modal-positioner' }, [
          elx('div', { ...parts.content, class: 'a2ui-modal-content' }, [
            // Trap focus + lock body scroll while open; both release on close
            // (this subtree unmounts when `open` goes false).
            onMount(() => {
              const el = document.getElementById(parts.content.id)
              if (!el) return
              const releaseTrap = pushFocusTrap({ container: el })
              const unlock = lockBodyScroll()
              return () => {
                releaseTrap()
                unlock()
              }
            }),
            elx(
              'button',
              {
                ...parts.closeTrigger,
                class: 'a2ui-modal-close',
                onClick: () => send({ type: 'close' }),
              },
              [text('✕')],
            ),
            ...(contentId ? ctx.renderById(contentId, scope) : []),
          ]),
        ]),
      ]),
    ]),
  ]
}

/** Slider → `@llui/components` slider, two-way bound to a number data path, with
 * keyboard + pointer-drag driven through the real slider reducer. */
const Slider: ComponentBuilder = ({ node, ctx, scope }: BuildArgs) => {
  const min = typeof node.min === 'number' ? node.min : 0
  const max = typeof node.max === 'number' ? node.max : 100
  const path = isPathBinding(node.value) ? (node.value as { path: string }).path : undefined
  const abs = path ? scope.absPath(path) : undefined

  const state = scope.data.map((d) =>
    slider.init({
      value: [path ? toNum(resolvePointer(d, path)) : toNum(node.value)],
      min,
      max,
      step: 1,
    }),
  )
  const send: Send<slider.SliderMsg> = (msg) => {
    if (!abs) return
    const [next] = slider.update(state.peek(), msg)
    ctx.send({ type: 'setData', surfaceId: ctx.surfaceId, path: abs, value: next.value[0] ?? min })
  }
  const parts = slider.connect(state, send)

  const control = elx(
    'div',
    {
      ...parts.control,
      class: 'a2ui-slider-control',
      onPointerDown: (e: PointerEvent) => {
        e.preventDefault()
        const el = e.currentTarget as HTMLElement
        const at = (ev: PointerEvent) =>
          send({
            type: 'setThumb',
            index: 0,
            value: slider.valueFromPoint(
              state.peek(),
              el.getBoundingClientRect(),
              ev.clientX,
              ev.clientY,
            ),
          })
        at(e)
        el.setPointerCapture(e.pointerId)
        const move = (ev: PointerEvent) => at(ev)
        const up = (): void => {
          el.releasePointerCapture(e.pointerId)
          el.removeEventListener('pointermove', move)
          el.removeEventListener('pointerup', up)
        }
        el.addEventListener('pointermove', move)
        el.addEventListener('pointerup', up)
      },
    },
    [
      elx('div', { ...parts.track, class: 'a2ui-slider-track' }, [
        elx('div', { ...parts.range, class: 'a2ui-slider-range' }),
      ]),
      elx('div', { ...parts.thumb(0).thumb, class: 'a2ui-slider-thumb' }),
    ],
  )

  return labelledField(
    [text(bindString(ctx, scope, node.label as DynamicString | undefined))],
    [elx('div', { ...parts.root, class: 'a2ui-slider' }, [control])],
    firstCheckError(ctx, scope, checksOf(node)),
  )
}

interface Choice {
  readonly label: DynamicString
  readonly value: string
}
function toStrList(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : []
}

/** ChoicePicker → `@llui/components` combobox: filterable/typeahead select with
 * chips for multi-select. Selection lives in the data model (source of truth);
 * the combobox's UI state (open/input/highlight) lives in the surface UI store. */
const ChoicePicker: ComponentBuilder = ({ node, ctx, scope }: BuildArgs) => {
  const options = (Array.isArray(node.options) ? node.options : []) as Choice[]
  // Combobox items are the LABELS (so typeahead matches visible text); we map
  // label ↔ A2UI value at the data-model boundary.
  const labels = options.map((o) => (typeof o.label === 'string' ? o.label : String(o.value)))
  const valueByLabel = new Map(options.map((o, i) => [labels[i] as string, String(o.value)]))
  const labelByValue = new Map(options.map((o, i) => [String(o.value), labels[i] as string]))
  const toLabels = (values: string[]): string[] => values.map((v) => labelByValue.get(v) ?? v)
  const toValues = (ls: string[]): string[] => ls.map((l) => valueByLabel.get(l) ?? l)

  const multiple = node.variant === 'multipleSelection'
  const path = isPathBinding(node.value) ? (node.value as { path: string }).path : undefined
  const abs = path ? scope.absPath(path) : undefined
  const key = instanceKey(scope, node.id)
  const initial = combobox.init({ items: labels, selectionMode: multiple ? 'multiple' : 'single' })
  const dataValues = (d: JsonValue): string[] => (path ? toStrList(resolvePointer(d, path)) : [])

  // Merge: the combobox's `value` (label list) is projected from the data model;
  // its UI state comes from the store. `derived` reacts to both.
  const state = derived(scope.uiState, scope.data, (ui, d) => {
    const stored = readUi(ui, key, initial)
    return { ...stored, value: toLabels(dataValues(d)) }
  })
  const send: Send<combobox.ComboboxMsg> = (msg) => {
    const current = {
      ...readUi(scope.uiState.peek(), key, initial),
      value: toLabels(dataValues(scope.data.peek())),
    }
    const [next] = combobox.update(current, msg)
    const nextValues = toValues(next.value)
    if (abs && JSON.stringify(nextValues) !== JSON.stringify(dataValues(scope.data.peek()))) {
      ctx.send({ type: 'setData', surfaceId: ctx.surfaceId, path: abs, value: nextValues })
    }
    ctx.setUi(key, next as unknown as JsonValue)
  }
  const parts = combobox.connect(state, send, { id: domId(`cb-${key}`) })

  // Hand-roll item attrs from the each's OWN row signal (correctly scoped).
  // parts.item() signals read the combobox `state` and would re-scope to the row
  // item inside this `each` — so we derive selected/highlighted from the unit and
  // route clicks straight to `send`.
  const itemUnits = state.map((s) =>
    s.filteredItems.map((label, i) => ({
      label,
      index: i,
      selected: s.value.includes(label),
      highlighted: s.highlightedIndex === i,
    })),
  )
  const items = each(itemUnits, {
    key: (u) => u.label,
    render: (uSig) => {
      const label = uSig.peek().label
      return [
        elx(
          'li',
          {
            role: 'option',
            class: 'a2ui-cb-item',
            'data-value': label,
            'data-state': uSig.map((u) => (u.selected ? 'selected' : undefined)),
            'data-highlighted': uSig.map((u) => (u.highlighted ? '' : undefined)),
            onClick: () => send({ type: 'selectOption', value: label }),
            onPointerMove: () => send({ type: 'highlight', index: uSig.peek().index }),
          },
          [text(label)],
        ),
      ]
    },
  })

  const chips = each(
    state.map((s) => (multiple ? s.value : [])),
    {
      key: (label) => label,
      render: (labelSig) => {
        const label = labelSig.peek()
        return [
          elx('span', { class: 'a2ui-cb-chip' }, [
            text(label),
            elx(
              'button',
              {
                type: 'button',
                class: 'a2ui-cb-chip-remove',
                'aria-label': 'Remove',
                onClick: () => send({ type: 'selectOption', value: label }),
              },
              [text('✕')],
            ),
          ]),
        ]
      },
    },
  )

  return labelledField(
    [text(bindString(ctx, scope, node.label as DynamicString | undefined))],
    [
      elx('div', { ...parts.root, class: 'a2ui-cb' }, [
        ...(multiple ? [elx('div', { class: 'a2ui-cb-chips' }, [chips])] : []),
        elx('input', { ...parts.input, class: 'a2ui-cb-input' }),
        elx('button', { ...parts.trigger, class: 'a2ui-cb-trigger' }, [text('▾')]),
        show(
          state.map((s) => s.open),
          () => [
            elx('div', { ...parts.positioner, class: 'a2ui-cb-positioner' }, [
              elx('ul', { ...parts.content, class: 'a2ui-cb-list' }, [items]),
            ]),
          ],
        ),
      ]),
    ],
    firstCheckError(ctx, scope, checksOf(node)),
  )
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** DateTimeInput → `@llui/components` date-picker (inline calendar) for the
 * date-only case; native input when time is involved (native time pickers are
 * platform-optimal). Selected date lives in the data model. */
const DateTimeInput: ComponentBuilder = ({ node, ctx, scope }: BuildArgs) => {
  const enableDate = node.enableDate !== false
  const enableTime = node.enableTime === true
  const path = isPathBinding(node.value) ? (node.value as { path: string }).path : undefined
  const abs = path ? scope.absPath(path) : undefined
  const label = [text(bindString(ctx, scope, node.label as DynamicString | undefined))]
  const error = firstCheckError(ctx, scope, checksOf(node))

  // Time / datetime → native input (best-in-class platform picker).
  if (enableTime || !enableDate) {
    const type = enableDate && enableTime ? 'datetime-local' : enableTime ? 'time' : 'date'
    const value = bindString(ctx, scope, node.value as DynamicString | undefined)
    const onInput = abs
      ? (e: Event) =>
          ctx.send({
            type: 'setData',
            surfaceId: ctx.surfaceId,
            path: abs,
            value: (e.target as HTMLInputElement).value,
          })
      : undefined
    return labelledField(
      label,
      [input({ class: 'a2ui-textfield-input', type, value, onInput })],
      error,
    )
  }

  // Date-only → inline calendar.
  const key = instanceKey(scope, node.id)
  const dateValue = (d: JsonValue): string | null => {
    const v = path ? resolvePointer(d, path) : undefined
    return typeof v === 'string' && v !== '' ? v.slice(0, 10) : null
  }
  const initial = datePicker.init({ value: dateValue(scope.data.peek()) })
  const state = derived(scope.uiState, scope.data, (ui, d) => ({
    ...readUi(ui, key, initial),
    value: dateValue(d),
  }))
  const send: Send<datePicker.DatePickerMsg> = (msg) => {
    const current = {
      ...readUi(scope.uiState.peek(), key, initial),
      value: dateValue(scope.data.peek()),
    }
    const [next] = datePicker.update(current, msg)
    if (abs && next.value !== current.value) {
      ctx.send({ type: 'setData', surfaceId: ctx.surfaceId, path: abs, value: next.value ?? '' })
    }
    ctx.setUi(key, next as unknown as JsonValue)
  }
  const parts = datePicker.connect(state, send)

  const header = elx('div', { class: 'a2ui-dp-header' }, [
    elx('button', { ...parts.prevMonthTrigger, class: 'a2ui-dp-nav' }, [text('‹')]),
    elx('span', { class: 'a2ui-dp-title' }, [text(parts.grid(0)['aria-label'])]),
    elx('button', { ...parts.nextMonthTrigger, class: 'a2ui-dp-nav' }, [text('›')]),
  ])
  const weekdayRow = elx(
    'div',
    { class: 'a2ui-dp-weekdays' },
    WEEKDAYS.map((w) => elx('span', { class: 'a2ui-dp-weekday' }, [text(w)])),
  )

  // dayCell parts are static values (not signals), so the whole grid rebuilds
  // wholesale when the calendar state changes — keyed by the visible window.
  const gridUnits = state.map((s) => [
    {
      key: `${s.visibleYear}-${s.visibleMonth}-${s.value}-${s.focused}`,
      cells: datePicker.monthGrid(s),
    },
  ])
  const grid = each(gridUnits, {
    key: (u) => u.key,
    render: (uSig) => {
      const cells = uSig.peek().cells
      const rows = []
      for (let w = 0; w < cells.length / 7; w++) {
        rows.push(
          elx(
            'div',
            { ...parts.row, class: 'a2ui-dp-row' },
            cells
              .slice(w * 7, w * 7 + 7)
              .map((cell) =>
                elx(
                  'button',
                  { ...parts.dayCell(cell).cell, class: 'a2ui-dp-cell', type: 'button' },
                  [text(String(cell.day))],
                ),
              ),
          ),
        )
      }
      return rows
    },
  })

  return labelledField(
    label,
    [elx('div', { ...parts.root, class: 'a2ui-dp' }, [header, weekdayRow, grid])],
    error,
  )
}

/** Builders backed by `@llui/components` headless state machines. */
export const headlessComponents: Readonly<Record<string, ComponentBuilder>> = {
  CheckBox,
  Tabs,
  Modal,
  Slider,
  ChoicePicker,
  DateTimeInput,
}
