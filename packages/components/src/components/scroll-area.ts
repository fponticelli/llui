import type { Send } from '@llui/dom'

/**
 * Scroll area — custom-styled scroll container with scrollbars that
 * can be hidden/shown based on scroll activity or hover. The state
 * machine tracks scroll position + overflow flags (whether content
 * actually overflows each axis); the view layer installs listeners
 * that populate these via `setScroll` / `setOverflow`.
 *
 * This component is primarily a structural shell — the real scrolling
 * is done by the browser (overflow: auto) on the viewport element.
 * The machine just tracks position so the view can render custom
 * thumbs positioned proportionally.
 *
 * Typical onMount wiring:
 *
 *   const viewport = root.querySelector('[data-part="viewport"]')
 *   const sync = () => send({type:'setScroll', ...dimsOf(viewport)})
 *   viewport.addEventListener('scroll', sync)
 *   const ro = new ResizeObserver(sync); ro.observe(viewport); ro.observe(content)
 *   sync()  // initial
 */

export type ScrollbarVisibility = 'auto' | 'always' | 'hover' | 'scroll'

export interface ScrollDims {
  scrollTop: number
  scrollLeft: number
  scrollWidth: number
  scrollHeight: number
  clientWidth: number
  clientHeight: number
}

export interface ScrollAreaState extends ScrollDims {
  overflowX: boolean
  overflowY: boolean
  /** Whether the user is currently scrolling (set/cleared by the consumer
   *  via a debounced scroll handler). */
  scrolling: boolean
  /** Whether the pointer is over the scroll area. */
  hovered: boolean
  visibility: ScrollbarVisibility
}

export type ScrollAreaMsg =
  | {
      type: 'setScroll'
      scrollTop: number
      scrollLeft: number
      scrollWidth: number
      scrollHeight: number
      clientWidth: number
      clientHeight: number
    }
  | { type: 'setScrolling'; scrolling: boolean }
  | { type: 'setHovered'; hovered: boolean }

export interface ScrollAreaInit {
  visibility?: ScrollbarVisibility
}

export function init(opts: ScrollAreaInit = {}): ScrollAreaState {
  return {
    scrollTop: 0,
    scrollLeft: 0,
    scrollWidth: 0,
    scrollHeight: 0,
    clientWidth: 0,
    clientHeight: 0,
    overflowX: false,
    overflowY: false,
    scrolling: false,
    hovered: false,
    visibility: opts.visibility ?? 'hover',
  }
}

export function update(state: ScrollAreaState, msg: ScrollAreaMsg): [ScrollAreaState, never[]] {
  switch (msg.type) {
    case 'setScroll':
      return [
        {
          ...state,
          scrollTop: msg.scrollTop,
          scrollLeft: msg.scrollLeft,
          scrollWidth: msg.scrollWidth,
          scrollHeight: msg.scrollHeight,
          clientWidth: msg.clientWidth,
          clientHeight: msg.clientHeight,
          overflowX: msg.scrollWidth > msg.clientWidth,
          overflowY: msg.scrollHeight > msg.clientHeight,
        },
        [],
      ]
    case 'setScrolling':
      return [{ ...state, scrolling: msg.scrolling }, []]
    case 'setHovered':
      return [{ ...state, hovered: msg.hovered }, []]
  }
}

/** Whether the scrollbars should be visible given the state. */
export function showScrollbars(state: ScrollAreaState, axis: 'x' | 'y'): boolean {
  const overflow = axis === 'x' ? state.overflowX : state.overflowY
  if (!overflow) return false
  switch (state.visibility) {
    case 'always':
      return true
    case 'auto':
      return overflow
    case 'hover':
      return state.hovered
    case 'scroll':
      return state.scrolling
  }
}

/** Thumb position as a proportion (0..1) along the track. */
export function thumbPosition(state: ScrollAreaState, axis: 'x' | 'y'): number {
  if (axis === 'x') {
    const max = state.scrollWidth - state.clientWidth
    return max > 0 ? state.scrollLeft / max : 0
  }
  const max = state.scrollHeight - state.clientHeight
  return max > 0 ? state.scrollTop / max : 0
}

/** Thumb size as a proportion (0..1) of the track. */
export function thumbSize(state: ScrollAreaState, axis: 'x' | 'y'): number {
  if (axis === 'x') {
    return state.scrollWidth > 0 ? Math.max(0.05, state.clientWidth / state.scrollWidth) : 0
  }
  return state.scrollHeight > 0 ? Math.max(0.05, state.clientHeight / state.scrollHeight) : 0
}

export interface ScrollAreaParts<S> {
  root: {
    'data-scope': 'scroll-area'
    'data-part': 'root'
    'data-scrolling': (s: S) => '' | undefined
    'data-hovered': (s: S) => '' | undefined
    onMouseEnter: (e: MouseEvent) => void
    onMouseLeave: (e: MouseEvent) => void
  }
  viewport: {
    tabIndex: 0
    'data-scope': 'scroll-area'
    'data-part': 'viewport'
    onScroll: (e: Event) => void
  }
  content: {
    'data-scope': 'scroll-area'
    'data-part': 'content'
  }
  scrollbarX: {
    'data-scope': 'scroll-area'
    'data-part': 'scrollbar'
    'data-axis': 'x'
    'data-visible': (s: S) => '' | undefined
  }
  scrollbarY: {
    'data-scope': 'scroll-area'
    'data-part': 'scrollbar'
    'data-axis': 'y'
    'data-visible': (s: S) => '' | undefined
  }
  thumbX: {
    'data-scope': 'scroll-area'
    'data-part': 'thumb'
    'data-axis': 'x'
    style: (s: S) => string
  }
  thumbY: {
    'data-scope': 'scroll-area'
    'data-part': 'thumb'
    'data-axis': 'y'
    style: (s: S) => string
  }
  corner: {
    'data-scope': 'scroll-area'
    'data-part': 'corner'
    'data-visible': (s: S) => '' | undefined
  }
}

export function connect<S>(
  get: (s: S) => ScrollAreaState,
  send: Send<ScrollAreaMsg>,
): ScrollAreaParts<S> {
  return {
    root: {
      'data-scope': 'scroll-area',
      'data-part': 'root',
      'data-scrolling': (s) => (get(s).scrolling ? '' : undefined),
      'data-hovered': (s) => (get(s).hovered ? '' : undefined),
      onMouseEnter: () => send({ type: 'setHovered', hovered: true }),
      onMouseLeave: () => send({ type: 'setHovered', hovered: false }),
    },
    viewport: {
      tabIndex: 0,
      'data-scope': 'scroll-area',
      'data-part': 'viewport',
      onScroll: (e) => {
        const el = e.target as HTMLElement
        send({
          type: 'setScroll',
          scrollTop: el.scrollTop,
          scrollLeft: el.scrollLeft,
          scrollWidth: el.scrollWidth,
          scrollHeight: el.scrollHeight,
          clientWidth: el.clientWidth,
          clientHeight: el.clientHeight,
        })
      },
    },
    content: {
      'data-scope': 'scroll-area',
      'data-part': 'content',
    },
    scrollbarX: {
      'data-scope': 'scroll-area',
      'data-part': 'scrollbar',
      'data-axis': 'x',
      'data-visible': (s) => (showScrollbars(get(s), 'x') ? '' : undefined),
    },
    scrollbarY: {
      'data-scope': 'scroll-area',
      'data-part': 'scrollbar',
      'data-axis': 'y',
      'data-visible': (s) => (showScrollbars(get(s), 'y') ? '' : undefined),
    },
    thumbX: {
      'data-scope': 'scroll-area',
      'data-part': 'thumb',
      'data-axis': 'x',
      style: (s) => {
        const st = get(s)
        const pos = thumbPosition(st, 'x')
        const size = thumbSize(st, 'x')
        return `left:${(pos * (1 - size) * 100).toFixed(2)}%;width:${(size * 100).toFixed(2)}%;`
      },
    },
    thumbY: {
      'data-scope': 'scroll-area',
      'data-part': 'thumb',
      'data-axis': 'y',
      style: (s) => {
        const st = get(s)
        const pos = thumbPosition(st, 'y')
        const size = thumbSize(st, 'y')
        return `top:${(pos * (1 - size) * 100).toFixed(2)}%;height:${(size * 100).toFixed(2)}%;`
      },
    },
    corner: {
      'data-scope': 'scroll-area',
      'data-part': 'corner',
      'data-visible': (s) => {
        const st = get(s)
        return showScrollbars(st, 'x') && showScrollbars(st, 'y') ? '' : undefined
      },
    },
  }
}

export const scrollArea = {
  init,
  update,
  connect,
  showScrollbars,
  thumbPosition,
  thumbSize,
}
