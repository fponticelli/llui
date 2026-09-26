import { branch, div, each, label, onMount, option, show, span, text } from '@llui/dom'
import type { Mountable, Send, Signal } from '@llui/dom'
import * as colorPickerC from '@llui/components/color-picker'
import * as gradientPickerC from '@llui/components/gradient-picker'
import {
  ColorPicker,
  ColorPickerAlphaSlider,
  ColorPickerArea,
  ColorPickerAreaCanvas,
  ColorPickerAreaThumb,
  ColorPickerChromaSlider,
  ColorPickerEyeDropperTrigger,
  ColorPickerHexInput,
  ColorPickerHueSlider,
  ColorPickerLightnessSlider,
  ColorPickerModelToggle,
  ColorPickerOklchLightnessSlider,
  ColorPickerPreview,
  ColorPickerSaturationSlider,
  ColorPickerSwatch,
  ColorPickerSwatchGroup,
} from '../components/ui/color-picker'
import {
  GradientPicker,
  GradientPickerAddStopButton,
  GradientPickerAngleInput,
  GradientPickerCenterArea,
  GradientPickerCenterThumb,
  GradientPickerCssError,
  GradientPickerCssInput,
  GradientPickerDistributeButton,
  GradientPickerInterpolationHueSelect,
  GradientPickerInterpolationSpaceSelect,
  GradientPickerKindToggle,
  GradientPickerPreview,
  GradientPickerRemoveStopButton,
  GradientPickerRepeatingToggle,
  GradientPickerReverseButton,
  GradientPickerShapeOption,
  GradientPickerSizeOption,
  GradientPickerStop,
  GradientPickerTrack,
} from '../components/ui/gradient-picker'
import { section, row } from './shared'

const OKLCH_CANVAS_ID = 'registry-demo-color-picker-oklch-canvas'
const GP_PICKER_OKLCH_CANVAS_ID = 'registry-demo-gradient-picker-stop-oklch-canvas'

const SWATCHES = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899']

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

const sliderLabel = (letter: string, control: Mountable): Mountable =>
  label({ class: 'flex items-center gap-2 text-xs text-muted-foreground font-semibold' }, [
    span({ class: 'w-4' }, [text(letter)]),
    control,
  ])

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
          ColorPicker({ ...cp.root }, [
            div({ class: 'flex items-center gap-2' }, [
              ColorPickerPreview({ ...cp.preview }, []),
              ColorPickerHexInput({ ...cp.hexInput }),
              ColorPickerEyeDropperTrigger({ ...cp.eyeDropperTrigger }, [text('◎')]),
              ColorPickerModelToggle({ ...cp.modelToggle }, [
                text(
                  state.at('colorPicker').map((s) => (s.color.model === 'hsv' ? 'OKLCH' : 'HSV')),
                ),
              ]),
            ]),
            ColorPickerArea({ ...cp.area }, [
              ColorPickerAreaCanvas({
                ...cp.areaCanvas,
                id: OKLCH_CANVAS_ID,
                width: 240,
                height: 128,
              }),
              ColorPickerAreaThumb({ ...cp.areaThumb }, []),
            ]),
            ColorPickerHueSlider({ ...cp.hueSlider }),
          ]),
        ]),
        row('Lightness / chroma', [
          div({ class: 'flex w-full max-w-xs flex-col gap-1.5' }, [
            branch(state.at('colorPicker.color.model'), {
              hsv: () => [
                sliderLabel('S', ColorPickerSaturationSlider({ ...cp.saturationSlider })),
                sliderLabel('L', ColorPickerLightnessSlider({ ...cp.lightnessSlider })),
              ],
              oklch: () => [
                sliderLabel('C', ColorPickerChromaSlider({ ...cp.chromaSlider })),
                sliderLabel('L', ColorPickerOklchLightnessSlider({ ...cp.oklchLightnessSlider })),
              ],
            }),
            sliderLabel('A', ColorPickerAlphaSlider({ ...cp.alphaSlider })),
          ]),
        ]),
        row('Swatches', [
          ColorPickerSwatchGroup(
            { ...cp.swatchGroup },
            SWATCHES.map((color) => ColorPickerSwatch({ ...cp.swatch(color) })),
          ),
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
        ...colorPickerC.areaCanvasBinding(
          state.at('gradientPicker').map(gradientPickerC.pickerStateOf),
          GP_PICKER_OKLCH_CANVAS_ID,
        ),
        // The embedded stop picker has no dedicated eyedropper-support mount
        // of its own (that lives on `color-picker`'s `eyeDropperSupportMount`,
        // wired to the TOP-LEVEL color picker above) — wrap the same
        // client-side feature check through gradient-picker's own `picker`
        // message so `gp.picker.eyeDropperTrigger` (hidden by default) shows.
        onMount(() => {
          send({
            type: 'gradientPicker',
            msg: {
              type: 'picker',
              msg: {
                type: 'setEyeDropperSupported',
                supported: colorPickerC.supportsEyeDropper(),
              },
            },
          })
        }),
        row('Preview + track', [
          GradientPicker({ ...gp.root, class: 'w-full max-w-md flex flex-col gap-3' }, [
            GradientPickerPreview({ ...gp.preview }, []),
            GradientPickerTrack({ ...gp.track }, [
              each(state.at('gradientPicker.stops'), {
                key: (stop) => stop.id,
                render: (item) => {
                  const stopId = item.peek().id
                  return [GradientPickerStop({ ...gp.stop(stopId) }, [])]
                },
              }),
            ]),
            div({ class: 'flex items-center gap-2' }, [
              GradientPickerAddStopButton({ ...gp.addStopButton }, [text('+')]),
              GradientPickerRemoveStopButton({ ...gp.removeStopButton }, [text('−')]),
              GradientPickerKindToggle({ ...gp.kindToggle('linear') }, [text('Linear')]),
              GradientPickerKindToggle({ ...gp.kindToggle('radial') }, [text('Radial')]),
              GradientPickerKindToggle({ ...gp.kindToggle('conic') }, [text('Conic')]),
              GradientPickerRepeatingToggle({ ...gp.repeatingToggle }, [text('Repeat')]),
            ]),
          ]),
        ]),
        row('Kind-specific controls', [
          div({ class: 'flex w-full max-w-md flex-col gap-3' }, [
            branch(state.at('gradientPicker.kind'), {
              linear: () => [
                label({ class: 'flex items-center gap-2 text-xs text-muted-foreground' }, [
                  span({ class: 'w-16 shrink-0' }, [text('Angle')]),
                  GradientPickerAngleInput({ ...gp.angleInput }),
                  span({ class: 'w-10 shrink-0 text-right font-mono' }, [
                    text(gp.angleInput.value.map((v) => `${v}°`)),
                  ]),
                ]),
              ],
              conic: () => [
                label({ class: 'flex items-center gap-2 text-xs text-muted-foreground' }, [
                  span({ class: 'w-16 shrink-0' }, [text('Angle')]),
                  GradientPickerAngleInput({ ...gp.angleInput }),
                  span({ class: 'w-10 shrink-0 text-right font-mono' }, [
                    text(gp.angleInput.value.map((v) => `${v}°`)),
                  ]),
                ]),
                div({ class: 'flex items-center gap-3' }, [
                  span({ class: 'w-16 shrink-0 text-xs text-muted-foreground' }, [text('Center')]),
                  GradientPickerCenterArea({ ...gp.centerArea }, [
                    GradientPickerCenterThumb({ ...gp.centerThumb }, []),
                  ]),
                ]),
              ],
              radial: () => [
                div({ class: 'flex items-center gap-3' }, [
                  span({ class: 'w-16 shrink-0 text-xs text-muted-foreground' }, [text('Shape')]),
                  GradientPickerShapeOption({ ...gp.shapeOption('circle') }, [text('Circle')]),
                  GradientPickerShapeOption({ ...gp.shapeOption('ellipse') }, [text('Ellipse')]),
                ]),
                div({ class: 'flex items-center gap-3' }, [
                  span({ class: 'w-16 shrink-0 text-xs text-muted-foreground' }, [text('Size')]),
                  GradientPickerSizeOption({ ...gp.sizeOption('closest-side') }, [
                    text('Closest side'),
                  ]),
                  GradientPickerSizeOption({ ...gp.sizeOption('closest-corner') }, [
                    text('Closest corner'),
                  ]),
                  GradientPickerSizeOption({ ...gp.sizeOption('farthest-side') }, [
                    text('Farthest side'),
                  ]),
                  GradientPickerSizeOption({ ...gp.sizeOption('farthest-corner') }, [
                    text('Farthest corner'),
                  ]),
                ]),
                div({ class: 'flex items-center gap-3' }, [
                  span({ class: 'w-16 shrink-0 text-xs text-muted-foreground' }, [text('Center')]),
                  GradientPickerCenterArea({ ...gp.centerArea }, [
                    GradientPickerCenterThumb({ ...gp.centerThumb }, []),
                  ]),
                ]),
              ],
            }),
          ]),
        ]),
        row('Interpolation', [
          GradientPickerInterpolationSpaceSelect(
            { ...gp.interpolationSpaceSelect },
            [
              ['srgb', 'sRGB'],
              ['srgb-linear', 'sRGB (linear)'],
              ['hsl', 'HSL'],
              ['oklab', 'OKLab'],
              ['oklch', 'OKLCH'],
            ].map(([value, label_]) => option({ value }, [text(label_ as string)])),
          ),
          GradientPickerInterpolationHueSelect(
            { ...gp.interpolationHueSelect },
            [
              ['shorter', 'shorter hue'],
              ['longer', 'longer hue'],
              ['increasing', 'increasing hue'],
              ['decreasing', 'decreasing hue'],
            ].map(([value, label_]) => option({ value }, [text(label_ as string)])),
          ),
        ]),
        row('Stop order', [
          GradientPickerReverseButton({ ...gp.reverseButton }, [text('Reverse')]),
          GradientPickerDistributeButton({ ...gp.distributeButton }, [text('Distribute')]),
        ]),
        row('Selected stop color', [
          div({ class: 'flex w-full max-w-md flex-col gap-1.5' }, [
            div({ class: 'flex items-center gap-2' }, [
              ColorPickerPreview({ ...gp.picker.preview }, []),
              ColorPickerHexInput({ ...gp.picker.hexInput }),
              ColorPickerEyeDropperTrigger({ ...gp.picker.eyeDropperTrigger }, [text('◎')]),
              ColorPickerModelToggle({ ...gp.picker.modelToggle }, [
                text(
                  state
                    .at('gradientPicker')
                    .map((s) =>
                      gradientPickerC.pickerStateOf(s).color.model === 'hsv' ? 'OKLCH' : 'HSV',
                    ),
                ),
              ]),
            ]),
            ColorPickerArea({ ...gp.picker.area }, [
              ColorPickerAreaCanvas({
                ...gp.picker.areaCanvas,
                id: GP_PICKER_OKLCH_CANVAS_ID,
                width: 240,
                height: 128,
              }),
              ColorPickerAreaThumb({ ...gp.picker.areaThumb }, []),
            ]),
            ColorPickerHueSlider({ ...gp.picker.hueSlider }),
            sliderLabel('A', ColorPickerAlphaSlider({ ...gp.picker.alphaSlider })),
          ]),
        ]),
        row('CSS (Enter/blur to apply)', [
          div({ class: 'flex w-full max-w-md flex-col gap-1' }, [
            GradientPickerCssInput({ ...gp.cssInput }),
            show(gp.cssError.visible, () => [
              GradientPickerCssError(
                {
                  id: gp.cssError.id,
                  role: gp.cssError.role,
                  'data-scope': gp.cssError['data-scope'],
                  'data-part': gp.cssError['data-part'],
                },
                [text(gp.cssError.message)],
              ),
            ]),
          ]),
        ]),
      ],
    ),
  ]
}
