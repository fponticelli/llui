/**
 * Root component for the LLui components demo.
 *
 * Hosts each section as a `child()` boundary so every section keeps its own
 * bitmask (each has 12+ top-level state paths — merging into a single flat
 * component would overflow the 31-path tier and fall back to FULL_MASK).
 *
 * Overlays renders first so its view() registers the bus handlers
 * (registerToastHandler / registerConfirmHandler) before any other section's
 * view() runs and potentially calls showToast/askConfirm.
 */
import { component, div, child, type ComponentDef } from '@llui/dom'
import { App as OverlaysApp } from './sections/overlays'
import { App as InputsApp } from './sections/inputs'
import { App as DataApp } from './sections/data'
import { App as PickersEditingApp } from './sections/pickers-editing'

type State = Record<string, never>
type Msg = never

// `ChildOptions.def` declares `ComponentDef<unknown, M, unknown>` but
// `ComponentDef` is invariant in S (state appears in both contra- and
// covariant positions), so a concrete section def can't flow in directly.
// The parent never reads the child's state, so erasing S at the boundary is
// safe — the runtime also casts internally (packages/dom/src/primitives/child.ts:25).
const erase = <S, M, E>(def: ComponentDef<S, M, E>): ComponentDef<unknown, M, unknown> =>
  def as unknown as ComponentDef<unknown, M, unknown>

export const App = component<State, Msg, never>({
  name: 'ComponentsDemo',
  init: () => [{}, []],
  update: (state) => [state, []],
  view: () => [
    div({}, child({ def: erase(OverlaysApp), key: 'overlays', props: () => ({}) })),
    div({}, child({ def: erase(InputsApp), key: 'inputs', props: () => ({}) })),
    div({}, child({ def: erase(DataApp), key: 'data', props: () => ({}) })),
    div({}, child({ def: erase(PickersEditingApp), key: 'pickers-editing', props: () => ({}) })),
  ],
})
