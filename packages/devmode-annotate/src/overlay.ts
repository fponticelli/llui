// Drawing overlay for rect annotations. Mounts a full-viewport
// transparent layer that intercepts pointer events and draws the
// in-progress rectangle. Resolves with the final rect (viewport pixel
// coords) on mouseup, or null on Esc.
//
// Layer is z-indexed above everything; pointer-events: auto so we
// capture clicks, but the layer is transparent so the user still sees
// the page underneath while drawing.

import type { NoteRect } from '@llui/vite-plugin'

export interface DrawRectOptions {
  /** Stroke color for the in-progress rect. Default '#ff5252'. */
  strokeColor?: string
  /** Optional element to mount into. Defaults to document.body. */
  container?: HTMLElement
}

export interface DrawRectResult {
  rect: NoteRect | null
  reason: 'submit' | 'cancel'
}

/**
 * Activate the drawing overlay. Returns a promise that resolves when
 * the user releases the mouse (with the rect) or hits Escape (with null).
 * Cleans up its DOM and listeners regardless of outcome.
 */
export function drawRect(opts: DrawRectOptions = {}): Promise<DrawRectResult> {
  const strokeColor = opts.strokeColor ?? '#ff5252'
  const container = opts.container ?? document.body

  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.setAttribute('data-llui-overlay', 'rect')
    overlay.style.cssText = [
      'position: fixed',
      'inset: 0',
      'z-index: 2147483645',
      'cursor: crosshair',
      'background: rgba(0,0,0,0.04)',
    ].join('; ')

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('width', '100%')
    svg.setAttribute('height', '100%')
    svg.style.cssText = 'position: absolute; inset: 0; pointer-events: none;'

    const rectEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rectEl.setAttribute('fill', 'rgba(255,82,82,0.12)')
    rectEl.setAttribute('stroke', strokeColor)
    rectEl.setAttribute('stroke-width', '2')
    rectEl.setAttribute('width', '0')
    rectEl.setAttribute('height', '0')
    svg.appendChild(rectEl)

    const hint = document.createElement('div')
    hint.textContent = 'Click and drag to mark a region — Esc to cancel'
    hint.style.cssText = [
      'position: absolute',
      'top: 12px',
      'left: 50%',
      'transform: translateX(-50%)',
      'background: rgba(0,0,0,0.78)',
      'color: white',
      'padding: 6px 12px',
      'border-radius: 999px',
      'font: 13px -apple-system, BlinkMacSystemFont, sans-serif',
      'pointer-events: none',
    ].join('; ')

    overlay.append(svg, hint)
    container.appendChild(overlay)

    let startX = 0
    let startY = 0
    let drawing = false
    let lastRect: NoteRect | null = null

    const finish = (reason: 'submit' | 'cancel'): void => {
      overlay.removeEventListener('mousedown', onDown)
      overlay.removeEventListener('mousemove', onMove)
      overlay.removeEventListener('mouseup', onUp)
      document.removeEventListener('keydown', onKey)
      overlay.remove()
      resolve({ rect: reason === 'submit' ? lastRect : null, reason })
    }

    const onDown = (e: MouseEvent): void => {
      startX = e.clientX
      startY = e.clientY
      drawing = true
      rectEl.setAttribute('x', String(startX))
      rectEl.setAttribute('y', String(startY))
      rectEl.setAttribute('width', '0')
      rectEl.setAttribute('height', '0')
    }

    const onMove = (e: MouseEvent): void => {
      if (!drawing) return
      const x = Math.min(startX, e.clientX)
      const y = Math.min(startY, e.clientY)
      const w = Math.abs(e.clientX - startX)
      const h = Math.abs(e.clientY - startY)
      rectEl.setAttribute('x', String(x))
      rectEl.setAttribute('y', String(y))
      rectEl.setAttribute('width', String(w))
      rectEl.setAttribute('height', String(h))
      lastRect = { x, y, w, h }
    }

    const onUp = (): void => {
      if (!drawing) return
      drawing = false
      // Treat tiny drags as cancel — likely an accidental click.
      if (!lastRect || lastRect.w < 4 || lastRect.h < 4) {
        finish('cancel')
      } else {
        finish('submit')
      }
    }

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        finish('cancel')
      }
    }

    overlay.addEventListener('mousedown', onDown)
    overlay.addEventListener('mousemove', onMove)
    overlay.addEventListener('mouseup', onUp)
    document.addEventListener('keydown', onKey)
  })
}
