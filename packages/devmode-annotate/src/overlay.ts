// Drawing overlay for rect annotations. Mounts a full-viewport
// transparent layer that intercepts pointer events and draws the
// in-progress rectangle. On mouseup, the overlay STAYS VISIBLE so the
// user can see the selection while the modal asks for confirmation;
// the caller invokes `dismiss()` from the resolved result when the
// user clicks Send/Cancel.
//
// Layer is z-indexed above everything except the HUD modal; pointer-
// events: auto so we capture clicks during the drag, but the layer is
// transparent so the user still sees the page underneath while drawing.
// After mouseup, pointer-events disable so the modal can take focus.

import type { NoteRect } from '@llui/vite-plugin'

export interface DrawRectOptions {
  /** Stroke color for the in-progress rect. Default '#ff5252'. */
  strokeColor?: string
  /** Optional element to mount into. Defaults to document.body. */
  container?: HTMLElement
  /** Hint message auto-fade duration (ms). Default 2500. Set 0 to keep
   *  the hint visible until the user starts drawing. */
  hintFadeMs?: number
}

export interface DrawRectResult {
  rect: NoteRect | null
  reason: 'submit' | 'cancel'
  /** Remove the overlay from the DOM. Call this when the user has
   *  responded to the captured rect (Send / Cancel in the modal). For
   *  the 'cancel' reason the overlay is already dismissed when the
   *  promise resolves; calling dismiss() then is a no-op. */
  dismiss(): void
}

/**
 * Activate the drawing overlay. Returns a promise that resolves when
 * the user releases the mouse (with the rect + dismiss callback) or
 * hits Escape (with null + an already-dismissed overlay).
 */
export function drawRect(opts: DrawRectOptions = {}): Promise<DrawRectResult> {
  const strokeColor = opts.strokeColor ?? '#ff5252'
  const container = opts.container ?? document.body
  const hintFadeMs = opts.hintFadeMs ?? 2500

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
      'transition: opacity 400ms ease',
    ].join('; ')
    // Set opacity as a property so jsdom + the browser both reflect
    // it via hint.style.opacity reliably.
    hint.style.opacity = '1'

    overlay.append(svg, hint)
    container.appendChild(overlay)

    // Auto-fade the hint after a few seconds — the user has read it by
    // then and the bright pill is distracting once they're focused.
    let hintFadeTimer: ReturnType<typeof setTimeout> | null =
      hintFadeMs > 0
        ? setTimeout(() => {
            hint.style.opacity = '0'
          }, hintFadeMs)
        : null
    const fadeHintNow = (): void => {
      if (hintFadeTimer) {
        clearTimeout(hintFadeTimer)
        hintFadeTimer = null
      }
      hint.style.opacity = '0'
    }

    let startX = 0
    let startY = 0
    let drawing = false
    let dismissed = false
    let lastRect: NoteRect | null = null

    const cleanup = (): void => {
      if (hintFadeTimer) clearTimeout(hintFadeTimer)
      overlay.removeEventListener('mousedown', onDown)
      overlay.removeEventListener('mousemove', onMove)
      overlay.removeEventListener('mouseup', onUp)
      document.removeEventListener('keydown', onKey)
    }
    const dismiss = (): void => {
      if (dismissed) return
      dismissed = true
      cleanup()
      overlay.remove()
    }

    const onDown = (e: MouseEvent): void => {
      startX = e.clientX
      startY = e.clientY
      drawing = true
      fadeHintNow()
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

      // Tiny drags are accidental clicks — dismiss and treat as cancel.
      if (!lastRect || lastRect.w < 4 || lastRect.h < 4) {
        dismiss()
        resolve({ rect: null, reason: 'cancel', dismiss })
        return
      }

      // Keep the overlay alive so the user can see the highlighted
      // region while the HUD modal asks for confirmation. Disable
      // pointer events so clicks pass through to the modal.
      overlay.style.pointerEvents = 'none'
      overlay.style.cursor = 'default'
      cleanup()
      resolve({ rect: lastRect, reason: 'submit', dismiss })
    }

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        dismiss()
        resolve({ rect: null, reason: 'cancel', dismiss })
      }
    }

    overlay.addEventListener('mousedown', onDown)
    overlay.addEventListener('mousemove', onMove)
    overlay.addEventListener('mouseup', onUp)
    document.addEventListener('keydown', onKey)
  })
}
