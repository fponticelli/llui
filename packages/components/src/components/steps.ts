import type { Send, Signal } from '@llui/dom/signals'
import { useContext, tagSend } from '@llui/dom/signals'
import { LocaleContext } from '../locale.js'

/**
 * Steps — progress indicator for multi-step flows (wizards, checkouts).
 * Tracks current step and completed steps; supports linear and non-linear
 * navigation.
 */

export type StepStatus = 'pending' | 'current' | 'completed' | 'error'

export interface StepsState {
  current: number
  completed: number[]
  errors: number[]
  steps: string[]
  /** If linear, users cannot skip steps. */
  linear: boolean
  disabled: boolean
}

export type StepsMsg =
  /** @intent("Jump to a specific step by zero-based index") */
  | { type: 'goTo'; step: number }
  /** @intent("Advance to the next step") */
  | { type: 'next' }
  /** @intent("Go back to the previous step") */
  | { type: 'prev' }
  /** @intent("Mark the given step as completed") */
  | { type: 'complete'; step: number }
  /** @intent("Mark the given step as having an error") */
  | { type: 'markError'; step: number }
  /** @intent("Clear the error flag on the given step") */
  | { type: 'clearError'; step: number }
  /** @intent("Reset progress back to the first step (clears completed and errors)") */
  | { type: 'reset' }

export interface StepsInit {
  current?: number
  completed?: number[]
  steps?: string[]
  linear?: boolean
  disabled?: boolean
}

export function init(opts: StepsInit = {}): StepsState {
  return {
    current: opts.current ?? 0,
    completed: opts.completed ?? [],
    errors: [],
    steps: opts.steps ?? [],
    linear: opts.linear ?? true,
    disabled: opts.disabled ?? false,
  }
}

function canGoTo(state: StepsState, step: number): boolean {
  if (step < 0 || step >= state.steps.length) return false
  if (!state.linear) return true
  // Linear: only previous, current, or next-if-current-completed
  if (step <= state.current) return true
  if (step === state.current + 1 && state.completed.includes(state.current)) return true
  return false
}

export function update(state: StepsState, msg: StepsMsg): [StepsState, never[]] {
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

export function stepStatus(state: StepsState, step: number): StepStatus {
  if (state.errors.includes(step)) return 'error'
  if (step === state.current) return 'current'
  if (state.completed.includes(step)) return 'completed'
  return 'pending'
}

export interface StepsItemParts {
  item: {
    'data-scope': 'steps'
    'data-part': 'item'
    'data-status': Signal<StepStatus>
    'data-index': string
    'aria-current': Signal<'step' | undefined>
  }
  trigger: {
    type: 'button'
    'aria-label': string
    disabled: Signal<boolean>
    'data-scope': 'steps'
    'data-part': 'trigger'
    'data-status': Signal<StepStatus>
    onClick: (e: MouseEvent) => void
  }
  separator: {
    'data-scope': 'steps'
    'data-part': 'separator'
    'data-status': Signal<StepStatus>
    'aria-hidden': 'true'
  }
}

export interface StepsParts {
  root: {
    role: 'group'
    'aria-label': string
    'data-scope': 'steps'
    'data-part': 'root'
    'data-disabled': Signal<'' | undefined>
  }
  nextTrigger: {
    type: 'button'
    disabled: Signal<boolean>
    'data-scope': 'steps'
    'data-part': 'next-trigger'
    onClick: (e: MouseEvent) => void
  }
  prevTrigger: {
    type: 'button'
    disabled: Signal<boolean>
    'data-scope': 'steps'
    'data-part': 'prev-trigger'
    onClick: (e: MouseEvent) => void
  }
  item: (index: number) => StepsItemParts
}

export interface ConnectOptions {
  label?: string
}

export function connect(
  state: Signal<StepsState>,
  send: Send<StepsMsg>,
  opts: ConnectOptions = {},
): StepsParts {
  const locale = useContext(LocaleContext)
  const label = opts.label ?? locale.steps.label
  return {
    root: {
      role: 'group',
      'aria-label': label,
      'data-scope': 'steps',
      'data-part': 'root',
      'data-disabled': state.map((s) => (s.disabled ? '' : undefined)),
    },
    nextTrigger: {
      type: 'button',
      disabled: state.map((st) => st.disabled || st.current >= st.steps.length - 1),
      'data-scope': 'steps',
      'data-part': 'next-trigger',
      onClick: tagSend(send, ['next'], () => send({ type: 'next' })),
    },
    prevTrigger: {
      type: 'button',
      disabled: state.map((st) => st.disabled || st.current === 0),
      'data-scope': 'steps',
      'data-part': 'prev-trigger',
      onClick: tagSend(send, ['prev'], () => send({ type: 'prev' })),
    },
    item: (index: number): StepsItemParts => ({
      item: {
        'data-scope': 'steps',
        'data-part': 'item',
        'data-status': state.map((s) => stepStatus(s, index)),
        'data-index': String(index),
        'aria-current': state.map((s) => (s.current === index ? 'step' : undefined)),
      },
      trigger: {
        type: 'button',
        'aria-label': `Step ${index + 1}`,
        disabled: state.map((s) => !canGoTo(s, index)),
        'data-scope': 'steps',
        'data-part': 'trigger',
        'data-status': state.map((s) => stepStatus(s, index)),
        onClick: tagSend(send, ['goTo'], () => send({ type: 'goTo', step: index })),
      },
      separator: {
        'data-scope': 'steps',
        'data-part': 'separator',
        'data-status': state.map((s) => stepStatus(s, index)),
        'aria-hidden': 'true',
      },
    }),
  }
}

export const steps = { init, update, connect, stepStatus }
