import type { Send } from '@llui/dom'

/**
 * Stepper — progress indicator for multi-step flows (wizards, checkouts).
 * Tracks current step and completed steps; supports linear and non-linear
 * navigation.
 */

export type StepStatus = 'pending' | 'current' | 'completed' | 'error'

export interface StepperState {
  current: number
  completed: number[]
  errors: number[]
  steps: string[]
  /** If linear, users cannot skip steps. */
  linear: boolean
  disabled: boolean
}

export type StepperMsg =
  | { type: 'goTo'; step: number }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'complete'; step: number }
  | { type: 'markError'; step: number }
  | { type: 'clearError'; step: number }
  | { type: 'reset' }

export interface StepperInit {
  current?: number
  completed?: number[]
  steps?: string[]
  linear?: boolean
  disabled?: boolean
}

export function init(opts: StepperInit = {}): StepperState {
  return {
    current: opts.current ?? 0,
    completed: opts.completed ?? [],
    errors: [],
    steps: opts.steps ?? [],
    linear: opts.linear ?? true,
    disabled: opts.disabled ?? false,
  }
}

function canGoTo(state: StepperState, step: number): boolean {
  if (step < 0 || step >= state.steps.length) return false
  if (!state.linear) return true
  // Linear: only previous, current, or next-if-current-completed
  if (step <= state.current) return true
  if (step === state.current + 1 && state.completed.includes(state.current)) return true
  return false
}

export function update(state: StepperState, msg: StepperMsg): [StepperState, never[]] {
  if (state.disabled) return [state, []]
  switch (msg.type) {
    case 'goTo':
      if (!canGoTo(state, msg.step)) return [state, []]
      return [{ ...state, current: msg.step }, []]
    case 'next': {
      const next = state.current + 1
      if (next >= state.steps.length) return [state, []]
      // Completing current step moves forward
      const completed = state.completed.includes(state.current)
        ? state.completed
        : [...state.completed, state.current]
      return [{ ...state, current: next, completed }, []]
    }
    case 'prev': {
      if (state.current === 0) return [state, []]
      return [{ ...state, current: state.current - 1 }, []]
    }
    case 'complete': {
      if (state.completed.includes(msg.step)) return [state, []]
      return [
        {
          ...state,
          completed: [...state.completed, msg.step],
          errors: state.errors.filter((e) => e !== msg.step),
        },
        [],
      ]
    }
    case 'markError':
      if (state.errors.includes(msg.step)) return [state, []]
      return [{ ...state, errors: [...state.errors, msg.step] }, []]
    case 'clearError':
      return [{ ...state, errors: state.errors.filter((e) => e !== msg.step) }, []]
    case 'reset':
      return [{ ...state, current: 0, completed: [], errors: [] }, []]
  }
}

export function stepStatus(state: StepperState, step: number): StepStatus {
  if (state.errors.includes(step)) return 'error'
  if (step === state.current) return 'current'
  if (state.completed.includes(step)) return 'completed'
  return 'pending'
}

export interface StepperItemParts<S> {
  item: {
    'data-scope': 'stepper'
    'data-part': 'item'
    'data-status': (s: S) => StepStatus
    'data-index': string
    'aria-current': (s: S) => 'step' | undefined
  }
  trigger: {
    type: 'button'
    'aria-label': string
    disabled: (s: S) => boolean
    'data-scope': 'stepper'
    'data-part': 'trigger'
    'data-status': (s: S) => StepStatus
    onClick: (e: MouseEvent) => void
  }
  separator: {
    'data-scope': 'stepper'
    'data-part': 'separator'
    'data-status': (s: S) => StepStatus
    'aria-hidden': 'true'
  }
}

export interface StepperParts<S> {
  root: {
    role: 'group'
    'aria-label': string
    'data-scope': 'stepper'
    'data-part': 'root'
    'data-disabled': (s: S) => '' | undefined
  }
  nextTrigger: {
    type: 'button'
    disabled: (s: S) => boolean
    'data-scope': 'stepper'
    'data-part': 'next-trigger'
    onClick: (e: MouseEvent) => void
  }
  prevTrigger: {
    type: 'button'
    disabled: (s: S) => boolean
    'data-scope': 'stepper'
    'data-part': 'prev-trigger'
    onClick: (e: MouseEvent) => void
  }
  item: (index: number) => StepperItemParts<S>
}

export interface ConnectOptions {
  label?: string
}

export function connect<S>(
  get: (s: S) => StepperState,
  send: Send<StepperMsg>,
  opts: ConnectOptions = {},
): StepperParts<S> {
  const label = opts.label ?? 'Progress'
  return {
    root: {
      role: 'group',
      'aria-label': label,
      'data-scope': 'stepper',
      'data-part': 'root',
      'data-disabled': (s) => (get(s).disabled ? '' : undefined),
    },
    nextTrigger: {
      type: 'button',
      disabled: (s) => {
        const st = get(s)
        return st.disabled || st.current >= st.steps.length - 1
      },
      'data-scope': 'stepper',
      'data-part': 'next-trigger',
      onClick: () => send({ type: 'next' }),
    },
    prevTrigger: {
      type: 'button',
      disabled: (s) => {
        const st = get(s)
        return st.disabled || st.current === 0
      },
      'data-scope': 'stepper',
      'data-part': 'prev-trigger',
      onClick: () => send({ type: 'prev' }),
    },
    item: (index: number): StepperItemParts<S> => ({
      item: {
        'data-scope': 'stepper',
        'data-part': 'item',
        'data-status': (s) => stepStatus(get(s), index),
        'data-index': String(index),
        'aria-current': (s) => (get(s).current === index ? 'step' : undefined),
      },
      trigger: {
        type: 'button',
        'aria-label': `Step ${index + 1}`,
        disabled: (s) => !canGoTo(get(s), index),
        'data-scope': 'stepper',
        'data-part': 'trigger',
        'data-status': (s) => stepStatus(get(s), index),
        onClick: () => send({ type: 'goTo', step: index }),
      },
      separator: {
        'data-scope': 'stepper',
        'data-part': 'separator',
        'data-status': (s) => stepStatus(get(s), index),
        'aria-hidden': 'true',
      },
    }),
  }
}

export const stepper = { init, update, connect, stepStatus }
