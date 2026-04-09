import type { Send } from '@llui/dom'
import { useContext } from '@llui/dom'
import { LocaleContext } from '../locale'
import type { Locale } from '../locale'

/**
 * Cascade select — a series of dependent selects where each level's
 * choice filters the options of the next. Classic example: country
 * → state → city. The machine stores a flat list of selections
 * (one per level, or null) and the options at each level; filtering
 * logic is left to the view/consumer.
 *
 * Level shape: the consumer passes an array of Level descriptors on
 * setLevels, each with its own options. Selecting at level N clears
 * selections at levels > N.
 */

export interface CascadeLevel {
  id: string
  label: string
  options: Array<{ value: string; label: string; disabled?: boolean }>
}

export interface CascadeSelectState {
  levels: CascadeLevel[]
  /** Parallel to levels: one value per level, or null. */
  values: (string | null)[]
  disabled: boolean
}

export type CascadeSelectMsg =
  | { type: 'setLevels'; levels: CascadeLevel[] }
  | { type: 'setValue'; levelIndex: number; value: string | null }
  | { type: 'clear' }

export interface CascadeSelectInit {
  levels?: CascadeLevel[]
  values?: (string | null)[]
  disabled?: boolean
}

export function init(opts: CascadeSelectInit = {}): CascadeSelectState {
  const levels = opts.levels ?? []
  const values = opts.values ?? new Array<string | null>(levels.length).fill(null)
  // Normalize: pad or trim values array to match levels length
  const normalized: (string | null)[] = []
  for (let i = 0; i < levels.length; i++) {
    normalized.push(values[i] ?? null)
  }
  return {
    levels,
    values: normalized,
    disabled: opts.disabled ?? false,
  }
}

export function update(
  state: CascadeSelectState,
  msg: CascadeSelectMsg,
): [CascadeSelectState, never[]] {
  if (state.disabled && msg.type !== 'clear') return [state, []]
  switch (msg.type) {
    case 'setLevels': {
      const values = new Array<string | null>(msg.levels.length).fill(null)
      return [{ ...state, levels: msg.levels, values }, []]
    }
    case 'setValue': {
      if (msg.levelIndex < 0 || msg.levelIndex >= state.levels.length) return [state, []]
      // Setting a level clears all levels below it.
      const next = state.values.slice()
      next[msg.levelIndex] = msg.value
      for (let i = msg.levelIndex + 1; i < next.length; i++) {
        next[i] = null
      }
      return [{ ...state, values: next }, []]
    }
    case 'clear':
      return [{ ...state, values: new Array<string | null>(state.levels.length).fill(null) }, []]
  }
}

export function isLevelReady(state: CascadeSelectState, levelIndex: number): boolean {
  // A level is ready to accept input if all prior levels have values.
  for (let i = 0; i < levelIndex; i++) {
    if (state.values[i] === null) return false
  }
  return true
}

export function isComplete(state: CascadeSelectState): boolean {
  return state.values.every((v) => v !== null)
}

export function completeValues(state: CascadeSelectState): string[] | null {
  if (!isComplete(state)) return null
  return state.values as string[]
}

export interface CascadeLevelParts<S> {
  label: {
    for: string
    'data-scope': 'cascade-select'
    'data-part': 'level-label'
  }
  select: {
    id: string
    disabled: (s: S) => boolean
    value: (s: S) => string
    'data-scope': 'cascade-select'
    'data-part': 'level-select'
    'data-level': string
    'data-ready': (s: S) => '' | undefined
    onChange: (e: Event) => void
  }
}

export interface CascadeSelectParts<S> {
  root: {
    'data-scope': 'cascade-select'
    'data-part': 'root'
    'data-disabled': (s: S) => '' | undefined
    'data-complete': (s: S) => '' | undefined
  }
  clearTrigger: {
    type: 'button'
    'aria-label': string | ((s: S) => string)
    disabled: (s: S) => boolean
    'data-scope': 'cascade-select'
    'data-part': 'clear-trigger'
    onClick: (e: MouseEvent) => void
  }
  level: (index: number) => CascadeLevelParts<S>
}

export interface ConnectOptions {
  id: string
  clearLabel?: string
}

export function connect<S>(
  get: (s: S) => CascadeSelectState,
  send: Send<CascadeSelectMsg>,
  opts: ConnectOptions,
): CascadeSelectParts<S> {
  const locale = useContext<S, Locale>(LocaleContext)
  const levelId = (i: number): string => `${opts.id}:level:${i}`

  return {
    root: {
      'data-scope': 'cascade-select',
      'data-part': 'root',
      'data-disabled': (s) => (get(s).disabled ? '' : undefined),
      'data-complete': (s) => (isComplete(get(s)) ? '' : undefined),
    },
    clearTrigger: {
      type: 'button',
      'aria-label': opts.clearLabel ?? ((s: S) => locale(s).cascadeSelect.clear),
      disabled: (s) => get(s).values.every((v) => v === null),
      'data-scope': 'cascade-select',
      'data-part': 'clear-trigger',
      onClick: () => send({ type: 'clear' }),
    },
    level: (index: number): CascadeLevelParts<S> => ({
      label: {
        for: levelId(index),
        'data-scope': 'cascade-select',
        'data-part': 'level-label',
      },
      select: {
        id: levelId(index),
        disabled: (s) => get(s).disabled || !isLevelReady(get(s), index),
        value: (s) => get(s).values[index] ?? '',
        'data-scope': 'cascade-select',
        'data-part': 'level-select',
        'data-level': String(index),
        'data-ready': (s) => (isLevelReady(get(s), index) ? '' : undefined),
        onChange: (e) => {
          const el = e.target as HTMLSelectElement
          send({ type: 'setValue', levelIndex: index, value: el.value || null })
        },
      },
    }),
  }
}

export const cascadeSelect = {
  init,
  update,
  connect,
  isLevelReady,
  isComplete,
  completeValues,
}
