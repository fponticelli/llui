import type { Send } from '@llui/dom'
import { useContext } from '@llui/dom'
import { LocaleContext } from '../locale.js'
import type { Locale } from '../locale.js'

/**
 * Tour — guided walkthrough over a sequence of steps, each targeting
 * an element on the page with a pop-up explanation. The state machine
 * tracks the current step index and open/closed; positioning of the
 * pop-up relative to the target selector is done in the view layer
 * (typically via onMount + attachFloating).
 *
 * Typical shape:
 *
 *   const t = tour.connect<State>(s => s.tour, m => send({type:'tour', msg:m}))
 *   ...tour.overlay<State>({
 *     get: s => s.tour,
 *     send: m => send({type:'tour', msg:m}),
 *     parts: t,
 *     content: (step) => [
 *       h3({ ...t.title }, [text(step.title)]),
 *       p({ ...t.description }, [text(step.description)]),
 *       button({ ...t.prevTrigger }, [text('Back')]),
 *       button({ ...t.nextTrigger }, [text('Next')]),
 *     ],
 *   })
 */

export interface TourStep {
  id: string
  title: string
  description: string
  /** CSS selector or element ref for the tour target. */
  target: string
  /** Placement hint for the pop-up. */
  placement?: 'top' | 'bottom' | 'left' | 'right'
  /** Whether to show the highlight ring around the target. */
  spotlight?: boolean
}

export interface TourState {
  steps: TourStep[]
  open: boolean
  index: number
  /** Ids of steps already visited. */
  visited: string[]
}

export type TourMsg =
  /** @intent("Begin the tour at the first step (or current index if resuming)") */
  | { type: 'start' }
  /** @intent("Close the tour without finishing (does not reset progress)") */
  | { type: 'stop' }
  /** @intent("Advance to the next step (closes the tour after the last step)") */
  | { type: 'next' }
  /** @intent("Go back to the previous step") */
  | { type: 'prev' }
  /** @intent("Jump to a specific step by zero-based index") */
  | { type: 'goto'; index: number }
  /** @humanOnly */
  | { type: 'setSteps'; steps: TourStep[] }

export interface TourInit {
  steps?: TourStep[]
  open?: boolean
  index?: number
}

export function init(opts: TourInit = {}): TourState {
  const steps = opts.steps ?? []
  const index = Math.max(0, Math.min(opts.index ?? 0, Math.max(0, steps.length - 1)))
  return {
    steps,
    open: opts.open ?? false,
    index,
    visited: opts.open && steps[index] ? [steps[index].id] : [],
  }
}

export function update(state: TourState, msg: TourMsg): [TourState, never[]] {
  switch (msg.type) {
    case 'start': {
      if (state.steps.length === 0) return [state, []]
      const first = state.steps[0]!
      return [{ ...state, open: true, index: 0, visited: [first.id] }, []]
    }
    case 'stop':
      return [{ ...state, open: false }, []]
    case 'next': {
      const last = state.steps.length - 1
      if (state.index >= last) return [{ ...state, open: false }, []]
      const nextIdx = state.index + 1
      const nextStep = state.steps[nextIdx]!
      const visited = state.visited.includes(nextStep.id)
        ? state.visited
        : [...state.visited, nextStep.id]
      return [{ ...state, index: nextIdx, visited }, []]
    }
    case 'prev': {
      if (state.index <= 0) return [state, []]
      return [{ ...state, index: state.index - 1 }, []]
    }
    case 'goto': {
      if (msg.index < 0 || msg.index >= state.steps.length) return [state, []]
      const step = state.steps[msg.index]!
      const visited = state.visited.includes(step.id) ? state.visited : [...state.visited, step.id]
      return [{ ...state, open: true, index: msg.index, visited }, []]
    }
    case 'setSteps':
      return [{ ...state, steps: msg.steps, index: 0 }, []]
  }
}

export function currentStep(state: TourState): TourStep | null {
  return state.steps[state.index] ?? null
}

export function isFirst(state: TourState): boolean {
  return state.index === 0
}

export function isLast(state: TourState): boolean {
  return state.index === state.steps.length - 1
}

export function progress(state: TourState): { current: number; total: number } {
  return { current: state.index + 1, total: state.steps.length }
}

export interface TourParts<S> {
  root: {
    role: 'dialog'
    'aria-modal': 'false'
    'aria-labelledby': string
    'aria-describedby': string
    'data-scope': 'tour'
    'data-part': 'root'
    hidden: (s: S) => boolean
  }
  backdrop: {
    'data-scope': 'tour'
    'data-part': 'backdrop'
    'aria-hidden': 'true'
    onClick: (e: MouseEvent) => void
  }
  spotlight: {
    'data-scope': 'tour'
    'data-part': 'spotlight'
    'aria-hidden': 'true'
  }
  title: {
    id: string
    'data-scope': 'tour'
    'data-part': 'title'
  }
  description: {
    id: string
    'data-scope': 'tour'
    'data-part': 'description'
  }
  progressText: {
    'data-scope': 'tour'
    'data-part': 'progress-text'
  }
  prevTrigger: {
    type: 'button'
    disabled: (s: S) => boolean
    'data-scope': 'tour'
    'data-part': 'prev-trigger'
    onClick: (e: MouseEvent) => void
  }
  nextTrigger: {
    type: 'button'
    'data-scope': 'tour'
    'data-part': 'next-trigger'
    'data-last': (s: S) => '' | undefined
    onClick: (e: MouseEvent) => void
  }
  closeTrigger: {
    type: 'button'
    'aria-label': string | ((s: S) => string)
    'data-scope': 'tour'
    'data-part': 'close-trigger'
    onClick: (e: MouseEvent) => void
  }
}

export interface ConnectOptions {
  id: string
  closeLabel?: string
  /** Whether clicking the backdrop stops the tour. Default: false — tours
   *  typically require an explicit dismiss. */
  closeOnBackdropClick?: boolean
}

export function connect<S>(
  get: (s: S) => TourState,
  send: Send<TourMsg>,
  opts: ConnectOptions,
): TourParts<S> {
  const locale = useContext<S, Locale>(LocaleContext)
  const titleId = `${opts.id}:title`
  const descId = `${opts.id}:description`
  const closeOnBackdrop = opts.closeOnBackdropClick === true

  return {
    root: {
      role: 'dialog',
      'aria-modal': 'false',
      'aria-labelledby': titleId,
      'aria-describedby': descId,
      'data-scope': 'tour',
      'data-part': 'root',
      hidden: (s) => !get(s).open,
    },
    backdrop: {
      'data-scope': 'tour',
      'data-part': 'backdrop',
      'aria-hidden': 'true',
      onClick: () => {
        if (closeOnBackdrop) send({ type: 'stop' })
      },
    },
    spotlight: {
      'data-scope': 'tour',
      'data-part': 'spotlight',
      'aria-hidden': 'true',
    },
    title: {
      id: titleId,
      'data-scope': 'tour',
      'data-part': 'title',
    },
    description: {
      id: descId,
      'data-scope': 'tour',
      'data-part': 'description',
    },
    progressText: {
      'data-scope': 'tour',
      'data-part': 'progress-text',
    },
    prevTrigger: {
      type: 'button',
      disabled: (s) => isFirst(get(s)),
      'data-scope': 'tour',
      'data-part': 'prev-trigger',
      onClick: () => send({ type: 'prev' }),
    },
    nextTrigger: {
      type: 'button',
      'data-scope': 'tour',
      'data-part': 'next-trigger',
      'data-last': (s) => (isLast(get(s)) ? '' : undefined),
      onClick: () => send({ type: 'next' }),
    },
    closeTrigger: {
      type: 'button',
      'aria-label': opts.closeLabel ?? ((s: S) => locale(s).tour.close),
      'data-scope': 'tour',
      'data-part': 'close-trigger',
      onClick: () => send({ type: 'stop' }),
    },
  }
}

export const tour = {
  init,
  update,
  connect,
  currentStep,
  isFirst,
  isLast,
  progress,
}
