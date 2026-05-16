/**
 * Root component for the LLui components demo.
 *
 * Hosts each section as a `subApp()` boundary — these are textbook
 * top-level section partitioning cases for the unified composition
 * model: each section has its own independent state + reducer + effect
 * pipeline + lifecycle, and the host doesn't share state with or route
 * messages between sections. That's exactly what `subApp` is for.
 *
 * Previously these were `child()` calls used as a bitmask escape valve
 * (merging all sections flat would have triggered the FULL_MASK
 * fallback). With path-keyed reactivity now in place, the bitmask
 * argument is no longer the reason — sections stay isolated because
 * their state and lifecycles are genuinely independent, which `subApp`
 * names explicitly via its required `reason` field.
 *
 * Overlays renders first so its view() registers the bus handlers
 * (registerToastHandler / registerConfirmHandler) before any other
 * section's view() runs and potentially calls showToast / askConfirm.
 *
 * See docs/proposals/unified-composition-model.md.
 */
import { component, div, main } from '@llui/dom'
import { subApp } from '@llui/dom/escape-hatch'
import { App as OverlaysApp } from './sections/overlays'
import { App as InputsApp } from './sections/inputs'
import { App as DataApp } from './sections/data'
import { App as PickersEditingApp } from './sections/pickers-editing'
import { App as TimeInputsApp } from './sections/time-inputs'
import { App as ContentApp } from './sections/content'
import { App as SurfacesApp } from './sections/surfaces'
import { App as CanvasApp } from './sections/canvas'

type State = Record<string, never>
type Msg = never

const REASON = 'Top-level demo section — own state, reducer, lifecycle; host shares nothing.'

export const App = component<State, Msg, never>({
  name: 'ComponentsDemo',
  init: () => [{}, []],
  update: (state) => [state, []],
  view: () => [
    main([
      div(subApp({ reason: REASON, def: OverlaysApp })),
      div(subApp({ reason: REASON, def: InputsApp })),
      div(subApp({ reason: REASON, def: DataApp })),
      div(subApp({ reason: REASON, def: PickersEditingApp })),
      div(subApp({ reason: REASON, def: TimeInputsApp })),
      div(subApp({ reason: REASON, def: ContentApp })),
      div(subApp({ reason: REASON, def: SurfacesApp })),
      div(subApp({ reason: REASON, def: CanvasApp })),
    ]),
  ],
})
