import { resolveLocaleSlice, type Locale } from './context.js'

export const enGradientPicker: Locale['gradientPicker'] = {
  track: 'Gradient stops',
  stop: (index, count, color, position) =>
    `Stop ${index} of ${count}, ${color}, ${Math.round(position)}%`,
  addStop: 'Add stop',
  removeStop: 'Remove stop',
  linear: 'Linear',
  radial: 'Radial',
  conic: 'Conic',
  repeating: 'Repeating',
  angle: 'Angle',
  center: 'Center',
  shapeCircle: 'Circle',
  shapeEllipse: 'Ellipse',
  sizeClosestSide: 'Closest side',
  sizeClosestCorner: 'Closest corner',
  sizeFarthestSide: 'Farthest side',
  sizeFarthestCorner: 'Farthest corner',
  interpolationSpace: 'Color space',
  interpolationHue: 'Hue method',
  reverse: 'Reverse stops',
  distribute: 'Distribute evenly',
  css: 'Gradient CSS',
  cssError: (reason: string) => `Invalid gradient: ${reason}`,
}

export const gradientPickerLocale = (): Locale['gradientPicker'] =>
  resolveLocaleSlice('gradientPicker', enGradientPicker)
