import type { Send, Signal } from '@llui/dom'
import { tagSend } from '@llui/dom'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import {
  init as stepsInit,
  update as stepsUpdate,
  connect as stepsConnect,
  stepStatus as stepsStepStatus,
  type StepsState,
  type StepsInit,
  type StepsItemParts,
  type StepStatus,
} from '../components/steps.js'

/**
 * Wizard — steps + per-step validation gating.
 *
 * Composes the `steps` machine with a per-step validation contract. The
 * pattern's `next` runs the CURRENT step's validator before advancing:
 *
 *  - sync predicate `(values?) => boolean` OR sync Standard Schema:
 *      pass  → mark the step completed + advance
 *      fail  → mark the step errored + STAY
 *  - async predicate `(values?) => Promise<boolean>` OR async Standard Schema:
 *      `next` emits a `validateStep` effect and sets `validating` to that step;
 *      the consumer's `onEffect` runs the validator and dispatches
 *      `stepValid`/`stepInvalid` back into `update`.
 *
 * `prev` is never gated. `goTo`/stepTrigger jumps respect linear-mode +
 * completed-ness gating (delegated to the underlying `steps` machine).
 *
 * Validators are functions/schemas, so they are NOT part of state (state must
 * be JSON-serializable). Pass them as the third arg to `update` and as an
 * option to `connect` is unnecessary — the gating runs in the reducer.
 *
 * Usage in consumer's `onEffect`:
 *
 * ```ts
 * onEffect: (eff, send) => {
 *   if (eff.type === 'validateStep') {
 *     validators[eff.step]
 *       ? Promise.resolve(runValidator(validators[eff.step], eff.step))
 *           .then(ok =>
 *             send(ok ? { type: 'stepValid', step: eff.step }
 *                     : { type: 'stepInvalid', step: eff.step }))
 *       : send({ type: 'stepValid', step: eff.step })
 *   }
 * }
 * ```
 */

/** A step validator: a predicate or a Standard Schema, sync or async. */
export type StepValidator = ((values?: unknown) => boolean | Promise<boolean>) | StandardSchemaV1

/** Map of zero-based step index → validator. Steps without an entry pass freely. */
export type WizardValidators = Record<number, StepValidator>

export interface WizardState {
  /** Underlying steps machine state. */
  steps: StepsState
  /** Index of the step whose async validation is pending, or null when idle. */
  validating: number | null
}

export type WizardEffect =
  /** Run the async validator for `step`; dispatch stepValid/stepInvalid. */
  { type: 'validateStep'; step: number }

export type WizardMsg =
  /** @intent("Validate the current step and, if it passes, advance to the next step") */
  | { type: 'next' }
  /** @intent("Go back to the previous step (never gated by validation)") */
  | { type: 'prev' }
  /** @intent("Jump to a specific step by zero-based index (respects linear + completion gating)") */
  | { type: 'goTo'; step: number }
  /** @humanOnly */
  | { type: 'stepValid'; step: number }
  /** @humanOnly */
  | { type: 'stepInvalid'; step: number }
  /** @intent("Reset the wizard back to the first step (clears completed, errors and pending validation)") */
  | { type: 'reset' }

export type WizardInit = StepsInit

export function init(opts: WizardInit = {}): WizardState {
  return {
    steps: stepsInit(opts),
    validating: null,
  }
}

/** Run a sync validator. Returns true/false, or a Promise<boolean> for async. */
function runValidator(validator: StepValidator, values?: unknown): boolean | Promise<boolean> {
  if (typeof validator === 'function') {
    return validator(values)
  }
  const result = validator['~standard'].validate(values)
  if (result instanceof Promise) {
    return result.then((r) => !r.issues)
  }
  return !result.issues
}

/** Mark the current step completed (clearing any error) and advance one step. */
function advance(steps: StepsState): StepsState {
  const completed = steps.completed.includes(steps.current)
    ? steps.completed
    : [...steps.completed, steps.current]
  return {
    ...steps,
    current: steps.current + 1,
    completed,
    errors: steps.errors.filter((e) => e !== steps.current),
  }
}

/** Mark the given step errored and stay (no current change). */
function markError(steps: StepsState, step: number): StepsState {
  if (steps.errors.includes(step)) return steps
  return { ...steps, errors: [...steps.errors, step] }
}

export function update(
  state: WizardState,
  msg: WizardMsg,
  validators: WizardValidators = {},
): [WizardState, WizardEffect[]] {
  switch (msg.type) {
    case 'next': {
      // Guard against double-advance while an async validation is pending.
      if (state.validating !== null) return [state, []]
      const cur = state.steps.current
      if (cur >= state.steps.steps.length - 1) return [state, []]
      const validator = validators[cur]
      if (validator === undefined) {
        return [{ ...state, steps: advance(state.steps) }, []]
      }
      const result = runValidator(validator)
      if (result instanceof Promise) {
        return [{ ...state, validating: cur }, [{ type: 'validateStep', step: cur }]]
      }
      if (result) {
        return [{ ...state, steps: advance(state.steps) }, []]
      }
      return [{ ...state, steps: markError(state.steps, cur) }, []]
    }
    case 'stepValid': {
      // Ignore stale results for a step we're not awaiting.
      if (state.validating !== msg.step) return [{ ...state, validating: null }, []]
      return [{ ...state, validating: null, steps: advance(state.steps) }, []]
    }
    case 'stepInvalid': {
      if (state.validating !== msg.step) return [{ ...state, validating: null }, []]
      return [{ ...state, validating: null, steps: markError(state.steps, msg.step) }, []]
    }
    case 'prev': {
      const [steps] = stepsUpdate(state.steps, { type: 'prev' })
      return [{ ...state, steps }, []]
    }
    case 'goTo': {
      const [steps] = stepsUpdate(state.steps, { type: 'goTo', step: msg.step })
      return [{ ...state, steps }, []]
    }
    case 'reset': {
      const [steps] = stepsUpdate(state.steps, { type: 'reset' })
      return [{ ...state, validating: null, steps }, []]
    }
  }
}

export function stepStatus(state: WizardState, step: number): StepStatus {
  return stepsStepStatus(state.steps, step)
}

export interface WizardParts {
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
    'aria-busy': Signal<'true' | undefined>
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
  /** Per-step trigger parts (item / trigger / separator), gated like raw steps. */
  item: (index: number) => StepsItemParts
  /** The trigger sub-part for a step index — for keyboard-complete step lists. */
  stepTrigger: (index: number) => StepsItemParts['trigger']
}

export interface WizardConnectOptions {
  label?: string
}

export function connect(
  state: Signal<WizardState>,
  send: Send<WizardMsg>,
  opts: WizardConnectOptions = {},
): WizardParts {
  // Reuse the steps connect for item gating + status, projecting onto the
  // nested steps slice. Its next/prev/goTo are re-wired to go THROUGH wizard
  // validation gating below.
  const stepsParts = stepsConnect(
    state.map((s) => s.steps),
    () => {
      /* unused — wizard triggers dispatch wizard messages directly */
    },
    { label: opts.label },
  )

  return {
    root: stepsParts.root,
    nextTrigger: {
      type: 'button',
      disabled: state.map(
        (s) =>
          s.steps.disabled || s.validating !== null || s.steps.current >= s.steps.steps.length - 1,
      ),
      'aria-busy': state.map((s) => (s.validating !== null ? 'true' : undefined)),
      'data-scope': 'steps',
      'data-part': 'next-trigger',
      onClick: tagSend(send, ['next'], () => send({ type: 'next' })),
    },
    prevTrigger: {
      type: 'button',
      disabled: state.map((s) => s.steps.disabled || s.steps.current === 0),
      'data-scope': 'steps',
      'data-part': 'prev-trigger',
      onClick: tagSend(send, ['prev'], () => send({ type: 'prev' })),
    },
    item: (index: number): StepsItemParts => {
      const parts = stepsParts.item(index)
      return {
        item: parts.item,
        trigger: {
          ...parts.trigger,
          onClick: tagSend(send, ['goTo'], () => send({ type: 'goTo', step: index })),
        },
        separator: parts.separator,
      }
    },
    stepTrigger: (index: number): StepsItemParts['trigger'] => {
      const parts = stepsParts.item(index)
      return {
        ...parts.trigger,
        onClick: tagSend(send, ['goTo'], () => send({ type: 'goTo', step: index })),
      }
    },
  }
}

export const wizard = { init, update, connect, stepStatus, runValidator }
