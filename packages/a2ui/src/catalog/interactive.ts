/**
 * Interactive Basic-catalog builders.
 *
 * Text-entry controls (`TextField`, `DateTimeInput`) render native accessible
 * inputs. The richer controls (`CheckBox`, `Slider`, `ChoicePicker`, `Tabs`,
 * `Modal`) are layered onto `@llui/components` headless primitives in
 * `./headless.js` and override these where present.
 */

import {
  input,
  label as labelEl,
  option,
  select,
  show,
  span,
  text,
  textarea,
  type ChildNode,
  type Reactive,
  type Renderable,
  type Signal,
} from '@llui/dom'
import type { BuildArgs, ComponentBuilder, RenderContext, RenderScope } from '../catalog.js'
import { bindNumber, bindString, bindStringList, firstCheckError, type Check } from '../binding.js'
import {
  isPathBinding,
  type ComponentNode,
  type DynamicNumber,
  type DynamicString,
  type DynamicStringList,
} from '../protocol.js'

/** Absolute write-back path for a control whose `value` is a data binding. */
function writeBackPath(
  node: ComponentNode,
  scope: RenderScope,
  prop = 'value',
): string | undefined {
  const binding = node[prop]
  return isPathBinding(binding) ? scope.absPath(binding.path) : undefined
}

function labelled(
  text_: Renderable,
  control: Renderable,
  error: Signal<string | null> | null = null,
): Renderable {
  const children: ChildNode[] = [span({ class: 'a2ui-field-label' }, text_), ...control]
  if (error) {
    children.push(show(error, (e) => [span({ class: 'a2ui-field-error' }, [text(e)])]))
  }
  return [labelEl({ class: 'a2ui-field' }, children)]
}

function checksOf(node: ComponentNode): Check[] | undefined {
  return Array.isArray(node.checks) ? (node.checks as Check[]) : undefined
}

const TextField: ComponentBuilder = ({ node, ctx, scope }: BuildArgs) => {
  const variant = typeof node.variant === 'string' ? node.variant : 'shortText'
  const value = bindString(ctx, scope, node.value as DynamicString | undefined)
  const abs = writeBackPath(node, scope)
  const onInput = abs
    ? (e: Event) => write(ctx, abs, (e.target as HTMLInputElement | HTMLTextAreaElement).value)
    : undefined

  const control: Renderable =
    variant === 'longText'
      ? [textarea({ class: 'a2ui-textfield-input', value, onInput })]
      : [
          input({
            class: 'a2ui-textfield-input',
            type: variant === 'number' ? 'number' : variant === 'obscured' ? 'password' : 'text',
            value,
            onInput,
          }),
        ]
  return labelled(
    [text(bindString(ctx, scope, node.label as DynamicString | undefined))],
    control,
    firstCheckError(ctx, scope, checksOf(node)),
  )
}

const DateTimeInput: ComponentBuilder = ({ node, ctx, scope }: BuildArgs) => {
  const enableDate = node.enableDate !== false
  const enableTime = node.enableTime === true
  const type = enableDate && enableTime ? 'datetime-local' : enableTime ? 'time' : 'date'
  const value = bindString(ctx, scope, node.value as DynamicString | undefined)
  const abs = writeBackPath(node, scope)
  const onInput = abs
    ? (e: Event) => write(ctx, abs, (e.target as HTMLInputElement).value)
    : undefined
  return labelled(
    [text(bindString(ctx, scope, node.label as DynamicString | undefined))],
    [
      input({
        class: 'a2ui-textfield-input',
        type,
        value,
        min: bindString(ctx, scope, node.min as DynamicString | undefined),
        max: bindString(ctx, scope, node.max as DynamicString | undefined),
        onInput,
      }),
    ],
    firstCheckError(ctx, scope, checksOf(node)),
  )
}

function write(ctx: RenderContext, path: string, value: string): void {
  ctx.send({ type: 'setData', surfaceId: ctx.surfaceId, path, value })
}

const Slider: ComponentBuilder = ({ node, ctx, scope }: BuildArgs) => {
  const min = typeof node.min === 'number' ? node.min : 0
  const max = typeof node.max === 'number' ? node.max : 100
  const value = bindNumber(ctx, scope, node.value as DynamicNumber | undefined)
  const abs = writeBackPath(node, scope)
  const onInput = abs
    ? (e: Event) =>
        ctx.send({
          type: 'setData',
          surfaceId: ctx.surfaceId,
          path: abs,
          value: Number((e.target as HTMLInputElement).value),
        })
    : undefined
  return labelled(
    [text(bindString(ctx, scope, node.label as DynamicString | undefined))],
    [
      input({
        class: 'a2ui-slider',
        type: 'range',
        min: String(min),
        max: String(max),
        value,
        onInput,
      }),
    ],
    firstCheckError(ctx, scope, checksOf(node)),
  )
}

interface Choice {
  readonly label: DynamicString
  readonly value: string
}

function isSelected(selected: Reactive<readonly string[]>, value: string): Reactive<boolean> {
  if (Array.isArray(selected)) return selected.includes(value)
  return (selected as Signal<readonly string[]>).map((v) => v.includes(value))
}

const ChoicePicker: ComponentBuilder = ({ node, ctx, scope }: BuildArgs) => {
  const multiple = node.variant === 'multipleSelection'
  const options = (Array.isArray(node.options) ? node.options : []) as Choice[]
  const selected = bindStringList(ctx, scope, node.value as DynamicStringList | undefined)
  const abs = writeBackPath(node, scope)
  const onChange = abs
    ? (e: Event) => {
        const el = e.target as HTMLSelectElement
        const values = multiple ? Array.from(el.selectedOptions).map((o) => o.value) : [el.value]
        ctx.send({ type: 'setData', surfaceId: ctx.surfaceId, path: abs, value: values })
      }
    : undefined

  const optionEls = options.map((opt) =>
    option({ value: String(opt.value), selected: isSelected(selected, String(opt.value)) }, [
      text(bindString(ctx, scope, opt.label)),
    ]),
  )

  return labelled(
    [text(bindString(ctx, scope, node.label as DynamicString | undefined))],
    [select({ class: 'a2ui-choicepicker', multiple, onChange }, optionEls)],
    firstCheckError(ctx, scope, checksOf(node)),
  )
}

/** Native form-control builders (baseline; headless variants override these). */
export const formControls: Readonly<Record<string, ComponentBuilder>> = {
  TextField,
  DateTimeInput,
  Slider,
  ChoicePicker,
}
