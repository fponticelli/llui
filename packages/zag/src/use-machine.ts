import { onMount } from '@llui/core'

/**
 * Bridge a Zag.js v1 machine into LLui's reactivity model.
 *
 * Returns a `render` function that creates DOM elements bound to
 * Zag prop getters. When the machine transitions, all elements
 * created via `render()` are updated with fresh props.
 */
export function useMachine<A extends object>(
  MachineClass: ZagMachineConstructor,
  machineConfig: unknown,
  connect: ZagConnectFn<A>,
  props?: Record<string, unknown>,
): ZagInstance<A> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const machine: ZagMachineInstance = new (MachineClass as new (...args: any[]) => ZagMachineInstance)(machineConfig, props)
  machine.start()

  // `connect` is typed with `never` params to accept any Zag connect fn; cast to call it.
  const call = connect as (service: unknown, normalize: unknown) => A
  let api = call(machine.service, lluiNormalize)
  const trackedElements: TrackedElement[] = []

  machine.subscribe(() => {
    api = call(machine.service, lluiNormalize)
    // Re-apply all tracked props
    for (const tracked of trackedElements) {
      const newProps = tracked.getProps()
      applyProps(tracked.el, newProps, tracked.lastProps)
      tracked.lastProps = newProps
    }
  })

  onMount(() => () => machine.stop())

  return {
    get api() { return api },
    send: (event) => machine.send(event),
    render(tag: string, getProps: (api: A) => Record<string, unknown>, children?: Node[]): HTMLElement {
      const el = document.createElement(tag)
      const resolvedProps = getProps(api)
      applyProps(el, resolvedProps, undefined)
      if (children) for (const child of children) el.appendChild(child)
      trackedElements.push({ el, getProps: () => getProps(api), lastProps: resolvedProps })
      return el
    },
  }
}

// ── Types ────────────────────────────────────────────

interface ZagMachineInstance {
  start(): void
  stop(): void
  send(event: Record<string, unknown>): void
  subscribe(cb: () => void): () => void
  service: unknown
}

/** Opaque constructor type — structural match sufficient, no generic leakage. */
export type ZagMachineConstructor = abstract new (...args: never[]) => object

/**
 * Connect function shape. Using `never` params makes this a supertype of any
 * function returning A, so Zag's generic `connect` functions satisfy it without
 * requiring callers to cast.
 */
export type ZagConnectFn<A extends object = object> = (service: never, normalize: never) => A

interface TrackedElement {
  el: HTMLElement
  getProps: () => Record<string, unknown>
  lastProps: Record<string, unknown>
}

export interface ZagInstance<A extends object = object> {
  readonly api: A
  send: (event: Record<string, unknown>) => void
  render: (tag: string, getProps: (api: A) => Record<string, unknown>, children?: Node[]) => HTMLElement
}

// ── LLui normalize (keeps camelCase events) ──────────
// Zag v1 calls normalize.button(props), normalize.element(props), etc.
// This Proxy routes all element types to the same normalize function.

function normalize(props: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue
    if (key === 'className') { result.class = value; continue }
    if (key === 'htmlFor') { result.for = value; continue }
    if ((key === 'readOnly' || key === 'disabled' || key === 'hidden') && value === false) continue
    if (key === 'style' && typeof value === 'object' && value !== null) {
      result.style = Object.entries(value as Record<string, string | number>)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${k.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)}: ${v}`)
        .join('; ')
      continue
    }
    result[key] = value
  }
  return result
}

const lluiNormalize = new Proxy({}, { get: () => normalize })

// ── Prop application ─────────────────────────────────

function applyProps(
  el: HTMLElement,
  props: Record<string, unknown>,
  prev: Record<string, unknown> | undefined,
): void {
  // Remove old attributes not in new props
  if (prev) {
    for (const key of Object.keys(prev)) {
      if (!(key in props)) {
        if (/^on[A-Z]/.test(key)) {
          el.removeEventListener(key.slice(2).toLowerCase(), prev[key] as EventListener)
        } else if (key === 'class') {
          el.className = ''
        } else if (key === 'style') {
          el.removeAttribute('style')
        } else {
          el.removeAttribute(key)
        }
      }
    }
  }

  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue

    // Skip if unchanged
    if (prev && Object.is(prev[key], value)) continue

    // Event handlers
    if (/^on[A-Z]/.test(key)) {
      const event = key.slice(2).toLowerCase()
      if (prev?.[key]) el.removeEventListener(event, prev[key] as EventListener)
      el.addEventListener(event, value as EventListener)
      continue
    }

    // Boolean attributes
    if (value === true) { el.setAttribute(key, ''); continue }
    if (value === false) { el.removeAttribute(key); continue }

    // Class
    if (key === 'class') { el.className = String(value); continue }

    // Style
    if (key === 'style') { el.setAttribute('style', String(value)); continue }

    // Hidden
    if (key === 'hidden') {
      if (value) el.setAttribute('hidden', '')
      else el.removeAttribute('hidden')
      continue
    }

    // DOM properties
    if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'readOnly') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(el as any)[key] = value
      continue
    }

    // Attributes
    if (value == null) el.removeAttribute(key)
    else el.setAttribute(key, String(value))
  }
}
