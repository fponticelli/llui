import { button, canvas, div, each, input, span, text } from '@llui/dom'
import type { Mountable, Send, Signal } from '@llui/dom'
import * as colorPickerC from '@llui/components/color-picker'
import * as gradientPickerC from '@llui/components/gradient-picker'
import {
  ColorPicker,
  ColorPickerArea,
  ColorPickerAreaCanvas,
  ColorPickerAreaThumb,
  ColorPickerEyeDropperTrigger,
  ColorPickerHexInput,
  ColorPickerHueSlider,
  ColorPickerModelToggle,
  ColorPickerPreview,
} from '../components/ui/color-picker'
import {
  GradientPicker,
  GradientPickerAddStopButton,
  GradientPickerAngleInput,
  GradientPickerCssError,
  GradientPickerCssInput,
  GradientPickerKindToggle,
  GradientPickerPreview,
  GradientPickerRemoveStopButton,
  GradientPickerRepeatingToggle,
  GradientPickerStop,
  GradientPickerTrack,
} from '../components/ui/gradient-picker'
import { section, row } from './shared'

const OKLCH_CANVAS_ID = 'registry-demo-color-picker-oklch-canvas'

export interface State {
  colorPicker: colorPickerC.ColorPickerState
  gradientPicker: gradientPickerC.GradientPickerState
}

export type Msg =
  | { type: 'colorPicker'; msg: colorPickerC.ColorPickerMsg }
  | { type: 'gradientPicker'; msg: gradientPickerC.GradientPickerMsg }

export const init = (): [State, never[]] => [
  {
    colorPicker: colorPickerC.init({ model: 'oklch', oklch: { l: 0.7, c: 0.15, h: 250 } }),
    gradientPicker: gradientPickerC.init({
      css: 'linear-gradient(90deg in oklch, oklch(0.7 0.2 25) 0%, oklch(0.7 0.2 260) 100%)',
    }),
  },
  [],
]

export function update(state: State, msg: Msg): [State, never[]] {
  switch (msg.type) {
    case 'colorPicker':
      return [{ ...state, colorPicker: colorPickerC.update(state.colorPicker, msg.msg)[0] }, []]
    case 'gradientPicker':
      return [
        { ...state, gradientPicker: gradientPickerC.update(state.gradientPicker, msg.msg)[0] },
        [],
      ]
  }
}

export function view(state: Signal<State>, send: Send<Msg>): readonly Mountable[] {
  const cp = colorPickerC.connect(state.at('colorPicker'), (m) =>
    send({ type: 'colorPicker', msg: m }),
  )
  const gp = gradientPickerC.connect(
    state.at('gradientPicker'),
    (m) => send({ type: 'gradientPicker', msg: m }),
    { id: 'registry-demo-gp' },
  )

  return [
    section(
      'Color Picker',
      'HSV/OKLCH color selection with a live 2D area, hex input, preset swatches, and the browser EyeDropper API.',
      [
        // Component-owned seams (finding E, Lane A): no registerBinding/
        // isSignalHandle/currentDoc here — just place both Mountables.
        colorPickerC.eyeDropperSupportMount((m) => send({ type: 'colorPicker', msg: m })),
        ...colorPickerC.areaCanvasBinding(state.at('colorPicker'), OKLCH_CANVAS_ID),
        row('Model + drag area + hex', [
          div({ ...ColorPicker }, [
            div({ class: 'flex items-center gap-2' }, [
              div({ ...cp.preview, ...ColorPickerPreview }, []),
              input({ ...cp.hexInput, ...ColorPickerHexInput }),
              button({ ...cp.eyeDropperTrigger, ...ColorPickerEyeDropperTrigger }, [text('◎')]),
              button({ ...cp.modelToggle, ...ColorPickerModelToggle }, [
                text(
                  state.at('colorPicker').map((s) => (s.color.model === 'hsv' ? 'OKLCH' : 'HSV')),
                ),
              ]),
            ]),
            div({ ...cp.area, ...ColorPickerArea }, [
              canvas({
                ...cp.areaCanvas,
                ...ColorPickerAreaCanvas,
                id: OKLCH_CANVAS_ID,
                width: 240,
                height: 128,
              }),
              div({ ...cp.areaThumb, ...ColorPickerAreaThumb }, []),
            ]),
            input({ ...cp.hueSlider, ...ColorPickerHueSlider }),
          ]),
        ]),
        row('CSS', [
          span({ class: 'text-xs text-muted-foreground font-mono' }, [
            text(state.at('colorPicker').map((s) => colorPickerC.toCss(s))),
          ]),
        ]),
      ],
    ),
    section(
      'Gradient Picker',
      'Linear/radial/conic gradient authoring — a stop ramp with drag/keyboard editing, per-kind controls, and an embedded color-picker for the selected stop.',
      [
        row('Preview + track', [
          div({ ...GradientPicker, class: 'w-full max-w-md flex flex-col gap-3' }, [
            div({ ...gp.preview, ...GradientPickerPreview }, []),
            div({ ...gp.track, ...GradientPickerTrack }, [
              each(state.at('gradientPicker.stops'), {
                key: (stop) => stop.id,
                render: (item) => {
                  const stopId = item.peek().id
                  return [div({ ...gp.stop(stopId), ...GradientPickerStop }, [])]
                },
              }),
            ]),
            div({ class: 'flex items-center gap-2' }, [
              button({ ...gp.addStopButton, ...GradientPickerAddStopButton }, [text('+')]),
              button({ ...gp.removeStopButton, ...GradientPickerRemoveStopButton }, [text('−')]),
              button({ ...gp.kindToggle('linear'), ...GradientPickerKindToggle }, [text('Linear')]),
              button({ ...gp.kindToggle('radial'), ...GradientPickerKindToggle }, [text('Radial')]),
              button({ ...gp.kindToggle('conic'), ...GradientPickerKindToggle }, [text('Conic')]),
              button({ ...gp.repeatingToggle, ...GradientPickerRepeatingToggle }, [text('Repeat')]),
            ]),
            input({ ...gp.angleInput, ...GradientPickerAngleInput }),
          ]),
        ]),
        row('CSS (Enter/blur to apply)', [
          div({ class: 'flex w-full max-w-md flex-col gap-1' }, [
            input({ ...gp.cssInput, ...GradientPickerCssInput }),
            div({ ...gp.cssError, ...GradientPickerCssError }, [text(gp.cssError.message)]),
          ]),
        ]),
      ],
    ),
  ]
}
