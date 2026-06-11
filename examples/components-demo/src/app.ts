/**
 * Root component for the LLui components demo (signal surface).
 *
 * The signal surface has a single update loop per mounted component — there is
 * no `subApp()`/`child()` boundary. Each demo section is therefore a module
 * (init + update + view) operating on its own slice of the root state, composed
 * here exactly like the dashboard example: the root reducer routes
 * `{ type: <section>, msg }` into each section's slice reducer, and each
 * section's view receives its slice as a `state.at(<section>)` signal handle.
 *
 * Sections stay isolated because their state and lifecycles are genuinely
 * independent; the root simply owns the combined state tree.
 *
 * Overlays' view runs first so its bus handlers (registerToastHandler /
 * registerConfirmHandler) are registered before any other section's view runs
 * and potentially calls showToast / askConfirm.
 */
import { component, div, main } from '@llui/dom'
import * as overlays from './sections/overlays'
import * as inputs from './sections/inputs'
import * as data from './sections/data'
import * as pickersEditing from './sections/pickers-editing'
import * as timeInputs from './sections/time-inputs'
import * as content from './sections/content'
import * as surfaces from './sections/surfaces'
import * as canvas from './sections/canvas'

type State = {
  overlays: overlays.State
  inputs: inputs.State
  data: data.State
  pickersEditing: pickersEditing.State
  timeInputs: timeInputs.State
  content: content.State
  surfaces: surfaces.State
  canvas: canvas.State
}

type Msg =
  | { type: 'overlays'; msg: overlays.Msg }
  | { type: 'inputs'; msg: inputs.Msg }
  | { type: 'data'; msg: data.Msg }
  | { type: 'pickersEditing'; msg: pickersEditing.Msg }
  | { type: 'timeInputs'; msg: timeInputs.Msg }
  | { type: 'content'; msg: content.Msg }
  | { type: 'surfaces'; msg: surfaces.Msg }
  | { type: 'canvas'; msg: canvas.Msg }

// Only the sections whose components emit effects participate here. Each section
// owns its own effect handler (`onEffect`); the root wraps the raw effect with
// the section tag, forwards it from update/init, and routes it back to the
// section handler with a section-scoped `send`. Effect-free sections return `[]`.
type Effect =
  | { type: 'inputs'; effect: inputs.Effect }
  | { type: 'data'; effect: data.Effect }
  | { type: 'overlays'; effect: overlays.Effect }

export const App = component<State, Msg, Effect>({
  name: 'ComponentsDemo',
  init: () => {
    const [overlaysState, overlaysFx] = overlays.init()
    const [inputsState, inputsFx] = inputs.init()
    const [dataState, dataFx] = data.init()
    return [
      {
        overlays: overlaysState,
        inputs: inputsState,
        data: dataState,
        pickersEditing: pickersEditing.init()[0],
        timeInputs: timeInputs.init()[0],
        content: content.init()[0],
        surfaces: surfaces.init()[0],
        canvas: canvas.init()[0],
      },
      [
        ...overlaysFx.map((effect) => ({ type: 'overlays' as const, effect })),
        ...inputsFx.map((effect) => ({ type: 'inputs' as const, effect })),
        ...dataFx.map((effect) => ({ type: 'data' as const, effect })),
      ],
    ]
  },
  update: (state, msg) => {
    switch (msg.type) {
      case 'overlays': {
        const [s, fx] = overlays.update(state.overlays, msg.msg)
        return [
          { ...state, overlays: s },
          fx.map((effect) => ({ type: 'overlays' as const, effect })),
        ]
      }
      case 'inputs': {
        const [s, fx] = inputs.update(state.inputs, msg.msg)
        return [{ ...state, inputs: s }, fx.map((effect) => ({ type: 'inputs' as const, effect }))]
      }
      case 'data': {
        const [s, fx] = data.update(state.data, msg.msg)
        return [{ ...state, data: s }, fx.map((effect) => ({ type: 'data' as const, effect }))]
      }
      case 'pickersEditing': {
        const [s] = pickersEditing.update(state.pickersEditing, msg.msg)
        return [{ ...state, pickersEditing: s }, []]
      }
      case 'timeInputs': {
        const [s] = timeInputs.update(state.timeInputs, msg.msg)
        return [{ ...state, timeInputs: s }, []]
      }
      case 'content': {
        const [s] = content.update(state.content, msg.msg)
        return [{ ...state, content: s }, []]
      }
      case 'surfaces': {
        const [s] = surfaces.update(state.surfaces, msg.msg)
        return [{ ...state, surfaces: s }, []]
      }
      case 'canvas': {
        const [s] = canvas.update(state.canvas, msg.msg)
        return [{ ...state, canvas: s }, []]
      }
    }
  },
  onEffect: (effect, { send }) => {
    switch (effect.type) {
      case 'inputs':
        return inputs.onEffect(effect.effect, (m) => send({ type: 'inputs', msg: m }))
      case 'data':
        return data.onEffect(effect.effect, (m) => send({ type: 'data', msg: m }))
      case 'overlays':
        return overlays.onEffect(effect.effect, (m) => send({ type: 'overlays', msg: m }))
    }
  },
  view: ({ state, send }) => [
    main([
      // Overlays first — its view registers the cross-section bus handlers.
      div(overlays.view(state.at('overlays'), (m) => send({ type: 'overlays', msg: m }))),
      div(inputs.view(state.at('inputs'), (m) => send({ type: 'inputs', msg: m }))),
      div(data.view(state.at('data'), (m) => send({ type: 'data', msg: m }))),
      div(
        pickersEditing.view(state.at('pickersEditing'), (m) =>
          send({ type: 'pickersEditing', msg: m }),
        ),
      ),
      div(timeInputs.view(state.at('timeInputs'), (m) => send({ type: 'timeInputs', msg: m }))),
      div(content.view(state.at('content'), (m) => send({ type: 'content', msg: m }))),
      div(surfaces.view(state.at('surfaces'), (m) => send({ type: 'surfaces', msg: m }))),
      div(canvas.view(state.at('canvas'), (m) => send({ type: 'canvas', msg: m }))),
    ]),
  ],
})
