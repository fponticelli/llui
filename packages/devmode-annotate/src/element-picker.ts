// Element-pick overlay. Activated by the "⌖ Pick element" pill in
// the compose view. Hovers over the page following the mouse,
// drawing a thin outline + bbox label on whatever element sits
// under the cursor. Click locks the selection and returns its
// bbox + a stable CSS selector to the caller.
//
// The HUD modal is hidden by the caller while this is active so
// the user can interact with the page. We exclude `#llui-devmode-
// annotate-root` from elementFromPoint so the floating button never
// becomes a pick target.

import type { NoteRect } from './note-types.js'

export interface PickResult {
  reason: 'submit' | 'cancel'
  element?: {
    selector: string
    bbox: NoteRect
  }
  /** Dismiss the lingering outline. Caller invokes once the user
   *  Send / Cancels / re-picks. */
  dismiss?: () => void
}

const PICKER_OVERLAY_ATTR = 'data-llui-element-picker'

/**
 * Build a short, stable CSS selector for the given element. Prefers
 * `#id`, then `tag.class` (first non-Llui class), then `tag:nth-of-type`.
 * Walks up at most 4 ancestors to give the LLM enough context to
 * locate the element in source.
 */
function buildSelector(el: Element): string {
  const parts: string[] = []
  let cur: Element | null = el
  for (let depth = 0; cur && depth < 4; depth++, cur = cur.parentElement) {
    if (cur.id) {
      parts.unshift(`#${cur.id}`)
      break // id is unique; nothing above matters
    }
    const tag = cur.tagName.toLowerCase()
    const classes = Array.from(cur.classList).filter((c) => !c.startsWith('llui-'))
    if (classes.length > 0) {
      parts.unshift(`${tag}.${classes[0]}`)
    } else if (cur.parentElement) {
      const siblings = Array.from(cur.parentElement.children).filter(
        (c) => c.tagName === cur!.tagName,
      )
      const idx = siblings.indexOf(cur) + 1
      parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${idx})` : tag)
    } else {
      parts.unshift(tag)
    }
  }
  return parts.join(' > ')
}

/**
 * Show the element-picker overlay. Resolves when the user clicks
 * (submit) or presses Escape (cancel). The outline lingers after
 * submit until `dismiss()` is called so the caller can show it as
 * a preview alongside the modal.
 */
export async function pickElement(): Promise<PickResult> {
  if (typeof document === 'undefined') return { reason: 'cancel' }

  // Three pieces:
  //   - dim: full-viewport scrim active ONLY during picking. Removed
  //     once the user clicks / cancels so the modal doesn't show
  //     against a dimmed background.
  //   - outline: the highlighted bbox. Stays after pick (lingers as a
  //     preview), at a z-index BELOW the modal so the modal overlays
  //     it cleanly.
  //   - label: the selector + size readout. Same z-index as the
  //     outline so it can't fight the modal either.
  //
  // The HUD modal lives at z-index 2147483647; we use 2147483645 for
  // the lingering outline so anything in the modal (incl. the toast
  // container) renders above it.
  const dim = document.createElement('div')
  dim.setAttribute(PICKER_OVERLAY_ATTR, 'dim')
  dim.style.cssText = [
    'position: fixed',
    'inset: 0',
    'pointer-events: none',
    'background: rgba(0, 0, 0, 0.20)',
    'z-index: 2147483645',
  ].join('; ')

  const outline = document.createElement('div')
  outline.setAttribute(PICKER_OVERLAY_ATTR, 'outline')
  outline.style.cssText = [
    'position: fixed',
    'pointer-events: none',
    'border: 2px solid #6366f1',
    'background: rgba(99, 102, 241, 0.10)',
    'border-radius: 3px',
    'z-index: 2147483645',
    'transition: top 30ms linear, left 30ms linear, width 30ms linear, height 30ms linear',
    'display: none',
  ].join('; ')

  const label = document.createElement('div')
  label.setAttribute(PICKER_OVERLAY_ATTR, 'label')
  label.style.cssText = [
    'position: fixed',
    'pointer-events: none',
    'background: #6366f1',
    'color: white',
    'padding: 2px 6px',
    'border-radius: 3px',
    'font: 11px/1.4 ui-monospace, SFMono-Regular, monospace',
    'z-index: 2147483645',
    'display: none',
    'max-width: 320px',
    'overflow: hidden',
    'text-overflow: ellipsis',
    'white-space: nowrap',
  ].join('; ')

  document.body.appendChild(dim)
  document.body.appendChild(outline)
  document.body.appendChild(label)

  let currentTarget: Element | null = null
  // `dismiss` (returned to the caller) tears down the lingering
  // outline + label only. The viewport dim ALWAYS goes away as soon
  // as picking ends, so the modal can render against the real page.
  const dismiss = (): void => {
    outline.remove()
    label.remove()
  }
  const removeDim = (): void => {
    dim.remove()
  }

  return new Promise<PickResult>((resolve) => {
    const cleanupTransient = (): void => {
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKey, true)
    }
    const finish = (reason: 'submit' | 'cancel'): void => {
      cleanupTransient()
      removeDim()
      if (reason === 'cancel' || !currentTarget) {
        dismiss()
        resolve({ reason: 'cancel' })
        return
      }
      const rect = currentTarget.getBoundingClientRect()
      const bbox: NoteRect = {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      }
      const selector = buildSelector(currentTarget)
      resolve({
        reason: 'submit',
        element: { selector, bbox },
        dismiss,
      })
    }

    const onMove = (e: MouseEvent): void => {
      const el = document.elementFromPoint(e.clientX, e.clientY)
      if (!el) return
      // Skip the HUD's own DOM — we don't want to pick the floating
      // button or any of its descendants.
      if (el.closest('#llui-devmode-annotate-root')) return
      if (el === currentTarget) return
      currentTarget = el
      const rect = el.getBoundingClientRect()
      outline.style.display = 'block'
      outline.style.top = `${rect.top}px`
      outline.style.left = `${rect.left}px`
      outline.style.width = `${rect.width}px`
      outline.style.height = `${rect.height}px`
      label.style.display = 'block'
      label.style.top = `${Math.max(2, rect.top - 22)}px`
      label.style.left = `${rect.left}px`
      label.textContent = `${buildSelector(el)}  ${Math.round(rect.width)}×${Math.round(rect.height)}`
    }
    const onClick = (e: MouseEvent): void => {
      if ((e.target as Element)?.closest('#llui-devmode-annotate-root')) return
      e.preventDefault()
      e.stopPropagation()
      finish('submit')
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        finish('cancel')
      }
    }

    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKey, true)
  })
}
