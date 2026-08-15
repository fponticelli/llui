/**
 * Lock body scroll while an overlay is open, preserving scrollbar width to
 * avoid layout shift. Reference-counted so nested locks compose cleanly.
 */

interface LockSnapshot {
  bodyOverflow: string
  bodyPaddingRight: string
}

let lockCount = 0
let snapshot: LockSnapshot | null = null

export function lockBodyScroll(): () => void {
  if (typeof document === 'undefined') return () => {}
  lockCount++
  if (lockCount === 1) {
    const body = document.body
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    snapshot = {
      bodyOverflow: body.style.overflow,
      bodyPaddingRight: body.style.paddingRight,
    }
    body.style.overflow = 'hidden'
    if (scrollbarWidth > 0) {
      const current = parseInt(getComputedStyle(body).paddingRight || '0', 10) || 0
      body.style.paddingRight = `${current + scrollbarWidth}px`
    }
  }
  return () => {
    lockCount = Math.max(0, lockCount - 1)
    if (lockCount === 0 && snapshot) {
      const body = document.body
      body.style.overflow = snapshot.bodyOverflow
      body.style.paddingRight = snapshot.bodyPaddingRight
      snapshot = null
    }
  }
}

/** @internal — tests only */
export function _scrollLockCount(): number {
  return lockCount
}
