import { component, div, each, mountApp } from '@llui/dom'
import * as gradientPicker from '../../src/components/gradient-picker.js'

declare global {
  interface Window {
    __gpReady: boolean
  }
}
window.__gpReady = false

const app = component<gradientPicker.GradientPickerState, gradientPicker.GradientPickerMsg, never>({
  name: 'GradientPickerNeighbourCrossing',
  init: () => [
    gradientPicker.init({
      stops: [
        { position: 20, color: 'red' },
        { position: 50, color: 'green' },
        { position: 80, color: 'blue' },
      ],
    }),
    [],
  ],
  update: (state, msg) => gradientPicker.update(state, msg),
  view: ({ state, send }) => {
    const p = gradientPicker.connect(state, send, { id: 'gp' })
    return [
      div({ ...p.track }, [
        each(state.at('stops'), {
          key: (stop) => stop.id,
          render: (item) => {
            const id = item.peek().id
            return [div({ ...p.stop(id) }, [])]
          },
        }),
      ]),
    ]
  },
})

mountApp(document.getElementById('app')!, app)
window.__gpReady = true
