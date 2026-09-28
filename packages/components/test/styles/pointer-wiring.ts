/**
 * The pointer wiring the machines leave to the VIEW, shared by both styling
 * paths' scenario renderers (#268).
 *
 * `slider`, `splitter` and `floating-panel` are keyboard-complete, but a
 * pointer drag is the consumer's to wire: only the view knows which element's
 * rect a pointer position is measured against (each machine says so in its
 * own source, and `examples/registry-demo` wires it the same way). Without
 * this the gallery's scenarios moved with arrow keys and ignored the mouse —
 * and the splitter was worse than inert: its `resizeTrigger.onPointerDown`
 * sends `startDrag`, nothing ever sent `endDrag`, and one click left the
 * scenario stuck `data-dragging` for good.
 *
 * Listeners go on the WINDOW while a gesture is live: a drag routinely
 * outruns its handle and `pointerup` lands anywhere. Every listener is
 * removed on unmount.
 */
import { onMount, type Mountable, type Send, type Signal } from '@llui/dom'
import * as floatingPanel from '../../src/components/floating-panel'
import * as slider from '../../src/components/slider'
import * as splitter from '../../src/components/splitter'

/** Track one gesture from a pointerdown until the pointer is released. */
function trackGesture(
  onMove: (event: PointerEvent) => void,
  onEnd: () => void,
): { start(): void; dispose(): void } {
  const end = (): void => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    onEnd()
  }
  return {
    start() {
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', end)
    },
    dispose() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    },
  }
}

const within = (container: Element, scope: string, part: string): HTMLElement | null => {
  const found = container.querySelector(`[data-scope="${scope}"][data-part="${part}"]`)
  return found instanceof HTMLElement ? found : null
}

/** Drag the separator: position follows the pointer, release ends the drag. */
export function splitterPointerWiring(
  state: Signal<splitter.SplitterState>,
  send: Send<splitter.SplitterMsg>,
): Mountable {
  return onMount((container) => {
    const group = within(container, 'splitter', 'root')
    const trigger = within(container, 'splitter', 'resize-trigger')
    if (group === null || trigger === null) return
    const gesture = trackGesture(
      (event) => {
        const current = state.peek()
        if (current.disabled) return
        const rect = group.getBoundingClientRect()
        send({
          type: 'setPosition',
          position: splitter.positionFromPoint(current, rect, event.clientX, event.clientY),
        })
      },
      () => send({ type: 'endDrag' }),
    )
    const down = (): void => {
      if (!state.peek().disabled) gesture.start()
    }
    trigger.addEventListener('pointerdown', down)
    return () => {
      trigger.removeEventListener('pointerdown', down)
      gesture.dispose()
    }
  })
}

/** Press or drag on the control: the closest thumb jumps to, then follows, the pointer. */
export function sliderPointerWiring(
  state: Signal<slider.SliderState>,
  send: Send<slider.SliderMsg>,
): Mountable {
  return onMount((container) => {
    const control = within(container, 'slider', 'control')
    if (control === null) return
    const apply = (event: PointerEvent): void => {
      const current = state.peek()
      if (current.disabled) return
      const rect = control.getBoundingClientRect()
      const raw = slider.valueFromPoint(current, rect, event.clientX, event.clientY)
      send({ type: 'setThumb', index: slider.closestThumbIndex(current, raw), value: raw })
    }
    const gesture = trackGesture(apply, () => {})
    const down = (event: PointerEvent): void => {
      if (state.peek().disabled) return
      apply(event)
      gesture.start()
    }
    control.addEventListener('pointerdown', down)
    return () => {
      control.removeEventListener('pointerdown', down)
      gesture.dispose()
    }
  })
}

/** Drag the title bar to move the panel; drag a grip to resize it. */
export function floatingPanelPointerWiring(send: Send<floatingPanel.FloatingPanelMsg>): Mountable {
  return onMount((container) => {
    const root = within(container, 'floating-panel', 'root')
    if (root === null) return
    let last: { x: number; y: number } | null = null
    let mode: 'drag' | 'resize' | null = null
    const gesture = trackGesture(
      (event) => {
        if (last === null || mode === null) return
        const dx = event.clientX - last.x
        const dy = event.clientY - last.y
        last = { x: event.clientX, y: event.clientY }
        send({ type: mode === 'drag' ? 'dragMove' : 'resizeMove', dx, dy })
      },
      () => {
        if (mode !== null) send({ type: mode === 'drag' ? 'dragEnd' : 'resizeEnd' })
        last = null
        mode = null
      },
    )
    const down = (event: PointerEvent): void => {
      const target = event.target instanceof Element ? event.target : null
      // A title-bar BUTTON is a click, not the start of a move.
      if (target === null || target.closest('button') !== null) return
      if (target.closest('[data-part="resize-handle"]') !== null) mode = 'resize'
      else if (target.closest('[data-part="drag-handle"]') !== null) mode = 'drag'
      else return
      last = { x: event.clientX, y: event.clientY }
      gesture.start()
    }
    root.addEventListener('pointerdown', down)
    return () => {
      root.removeEventListener('pointerdown', down)
      gesture.dispose()
    }
  })
}
