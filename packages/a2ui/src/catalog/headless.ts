/**
 * Basic-catalog builders that reuse `@llui/components` headless primitives.
 *
 * These state machines are pure (`init`/`update`/`connect`) with no scope of
 * their own, so we drive them directly from an A2UI-derived `Signal` and route
 * their messages back through our reducer — no child-component boundary needed.
 */

import { div, label as labelEl, show, span, text, type Send, type Signal } from '@llui/dom'
import * as checkbox from '@llui/components/checkbox'
import * as tabs from '@llui/components/tabs'
import * as dialog from '@llui/components/dialog'
import type { BuildArgs, ComponentBuilder, RenderContext } from '../catalog.js'
import { bindString } from '../binding.js'
import { resolvePointer } from '../pointer.js'
import {
  isPathBinding,
  type ComponentId,
  type DynamicBoolean,
  type DynamicString,
  type JsonObject,
  type JsonValue,
} from '../protocol.js'
import { elx } from './basic.js'

function toBool(value: unknown): boolean {
  return value === true || value === 'true'
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
  id: ComponentId,
  initial: S,
  reducer: (state: S, msg: M) => [S, unknown[]],
): { state: Signal<S>; send: Send<M> } {
  const state = ctx.uiState.map((ui) => readUi(ui, id, initial))
  const send: Send<M> = (msg) => {
    const current = readUi(ctx.uiState.peek(), id, initial)
    const [next] = reducer(current, msg)
    ctx.setUi(id, next as unknown as JsonValue)
  }
  return { state, send }
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
  const { state, send } = driveUi<tabs.TabsState, tabs.TabsMsg>(ctx, node.id, initial, tabs.update)
  const parts = tabs.connect(state, send, { id: `a2ui-tabs-${node.id}` })

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
  const { state, send } = driveUi<dialog.DialogState, dialog.DialogMsg>(
    ctx,
    node.id,
    dialog.init(),
    dialog.update,
  )
  const parts = dialog.connect(state, send, { id: `a2ui-modal-${node.id}` })
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

/** Builders backed by `@llui/components` headless state machines. */
export const headlessComponents: Readonly<Record<string, ComponentBuilder>> = {
  CheckBox,
  Tabs,
  Modal,
}
