// The floating-button drag boundary — the one imperative layout seam in the
// HUD. Owns the pointer drag wiring on the FAB and the saved-position
// localStorage I/O (read/write/apply), plus the `justDragged` latch the FAB
// uses to swallow the click the browser synthesizes at the end of a drag.

import {
  clampOffset,
  deriveSavedPosition,
  DRAG_THRESHOLD_PX,
  parseSavedPosition,
  type SavedPosition,
} from './hud-core.js'
import { STYLES } from './styles.js'

const POSITION_STORAGE_KEY = 'llui-devmode-annotate.position'

// ── Saved-position DOM helpers (the imperative layout boundary) ───────────

export function readSavedPosition(): SavedPosition | null {
  try {
    return parseSavedPosition(localStorage.getItem(POSITION_STORAGE_KEY))
  } catch {
    return null
  }
}

export function writeSavedPosition(pos: SavedPosition): void {
  try {
    localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(pos))
  } catch {
    // unavailable (private mode/quota) — fine for this session.
  }
}

export function applySavedPosition(root: HTMLElement, pos: SavedPosition): void {
  const offsetX = clampOffset(pos.offsetX, window.innerWidth)
  const offsetY = clampOffset(pos.offsetY, window.innerHeight)
  if (pos.anchorX === 'left') {
    root.style.left = `${offsetX}px`
    root.style.right = 'auto'
  } else {
    root.style.right = `${offsetX}px`
    root.style.left = 'auto'
  }
  if (pos.anchorY === 'top') {
    root.style.top = `${offsetY}px`
    root.style.bottom = 'auto'
  } else {
    root.style.bottom = `${offsetY}px`
    root.style.top = 'auto'
  }
}

function clampViewportXY(x: number, y: number): { x: number; y: number } {
  return { x: clampOffset(x, window.innerWidth), y: clampOffset(y, window.innerHeight) }
}

export interface DragController {
  /** Wire pointer drag onto the FAB button. */
  wire(btn: HTMLButtonElement): void
  /** True for exactly one microtask after a real drag end — the FAB reads this
   *  to ignore the click the browser synthesizes after pointerup. */
  justDragged(): boolean
}

export interface DragControllerDeps {
  /** The root host whose position the drag mutates. */
  root: HTMLElement
  /** Whether the modal is open (drag re-anchors it live while open). */
  isModalOpen: () => boolean
  /** Re-anchor the modal to the moved root. */
  reanchorModal: () => void
}

export function createDragController(deps: DragControllerDeps): DragController {
  const { root, isModalOpen, reanchorModal } = deps

  // Set true for exactly one microtask at the end of a real drag so the click
  // synthesized by the browser after pointerup is ignored by the button's own
  // onClick. A plain flag cleared via queueMicrotask is robust to a drag that
  // produces NO trailing click — unlike a one-shot capture listener, which
  // would linger and eat the next legitimate click.
  let justDragged = false

  const finishDrag = (wasDrag: boolean): void => {
    if (!wasDrag) return
    const pos = deriveSavedPosition(
      root.getBoundingClientRect(),
      window.innerWidth,
      window.innerHeight,
    )
    writeSavedPosition(pos)
    applySavedPosition(root, pos)
    reanchorModal()
    justDragged = true
    queueMicrotask(() => {
      justDragged = false
    })
  }

  const wire = (btn: HTMLButtonElement): void => {
    let dragState: {
      startX: number
      startY: number
      pointerStartX: number
      pointerStartY: number
      moved: boolean
    } | null = null
    btn.addEventListener('pointerdown', (e: PointerEvent) => {
      const rect = root.getBoundingClientRect()
      dragState = {
        startX: rect.left,
        startY: rect.top,
        pointerStartX: e.clientX,
        pointerStartY: e.clientY,
        moved: false,
      }
      try {
        btn.setPointerCapture(e.pointerId)
      } catch {
        /* jsdom */
      }
    })
    btn.addEventListener('pointermove', (e: PointerEvent) => {
      if (!dragState) return
      const dx = e.clientX - dragState.pointerStartX
      const dy = e.clientY - dragState.pointerStartY
      if (!dragState.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
      if (!dragState.moved) {
        dragState.moved = true
        btn.style.cssText = STYLES.button + ';' + STYLES.buttonDragging
        root.style.right = 'auto'
        root.style.bottom = 'auto'
      }
      const { x, y } = clampViewportXY(dragState.startX + dx, dragState.startY + dy)
      root.style.left = `${x}px`
      root.style.top = `${y}px`
      if (isModalOpen()) reanchorModal()
    })
    btn.addEventListener('pointerup', (e: PointerEvent) => {
      if (!dragState) return
      const wasDrag = dragState.moved
      try {
        btn.releasePointerCapture(e.pointerId)
      } catch {
        /* jsdom */
      }
      dragState = null
      btn.style.cssText = STYLES.button
      finishDrag(wasDrag)
    })
    btn.addEventListener('pointercancel', () => {
      // A cancelled drag still moved the button — persist + reanchor through
      // the same path (and swallow any trailing click) as a normal drag end.
      const wasDrag = dragState?.moved ?? false
      dragState = null
      btn.style.cssText = STYLES.button
      finishDrag(wasDrag)
    })
  }

  return { wire, justDragged: () => justDragged }
}
