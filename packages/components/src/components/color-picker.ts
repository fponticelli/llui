import type { Send } from '@llui/dom'

/**
 * Color picker — HSL/HSV color selection. Tracks hue (0-360), saturation
 * (0-100), and lightness (0-100). Emits hex strings for convenience.
 */

export interface Hsl {
  h: number
  s: number
  l: number
}

export interface ColorPickerState {
  hsl: Hsl
  /** Alpha channel 0..1. */
  alpha: number
  disabled: boolean
}

export type ColorPickerMsg =
  | { type: 'setHsl'; hsl: Hsl }
  | { type: 'setHue'; h: number }
  | { type: 'setSaturation'; s: number }
  | { type: 'setLightness'; l: number }
  | { type: 'setAlpha'; alpha: number }
  | { type: 'setHex'; hex: string }

export interface ColorPickerInit {
  hsl?: Hsl
  alpha?: number
  disabled?: boolean
}

export function init(opts: ColorPickerInit = {}): ColorPickerState {
  return {
    hsl: opts.hsl ?? { h: 0, s: 100, l: 50 },
    alpha: opts.alpha ?? 1,
    disabled: opts.disabled ?? false,
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export function update(state: ColorPickerState, msg: ColorPickerMsg): [ColorPickerState, never[]] {
  if (state.disabled) return [state, []]
  switch (msg.type) {
    case 'setHsl':
      return [{ ...state, hsl: msg.hsl }, []]
    case 'setHue':
      return [{ ...state, hsl: { ...state.hsl, h: ((msg.h % 360) + 360) % 360 } }, []]
    case 'setSaturation':
      return [{ ...state, hsl: { ...state.hsl, s: clamp(msg.s, 0, 100) } }, []]
    case 'setLightness':
      return [{ ...state, hsl: { ...state.hsl, l: clamp(msg.l, 0, 100) } }, []]
    case 'setAlpha':
      return [{ ...state, alpha: clamp(msg.alpha, 0, 1) }, []]
    case 'setHex': {
      const hsl = hexToHsl(msg.hex)
      return hsl ? [{ ...state, hsl }, []] : [state, []]
    }
  }
}

/** Convert HSL (h 0-360, s/l 0-100) to RGB (0-255 each). */
export function hslToRgb(hsl: Hsl): { r: number; g: number; b: number } {
  const s = hsl.s / 100
  const l = hsl.l / 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hsl.h / 60) % 2) - 1))
  const m = l - c / 2
  let r: number
  let g: number
  let b: number
  const h = hsl.h
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  }
}

export function toHex(hsl: Hsl): string {
  const { r, g, b } = hslToRgb(hsl)
  const hex = (n: number): string => n.toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

export function hexToHsl(hex: string): Hsl | null {
  const normalized = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(normalized)) return null
  let r: number
  let g: number
  let b: number
  if (normalized.length === 3) {
    r = parseInt(normalized[0]! + normalized[0]!, 16)
    g = parseInt(normalized[1]! + normalized[1]!, 16)
    b = parseInt(normalized[2]! + normalized[2]!, 16)
  } else {
    r = parseInt(normalized.slice(0, 2), 16)
    g = parseInt(normalized.slice(2, 4), 16)
    b = parseInt(normalized.slice(4, 6), 16)
  }
  const rf = r / 255
  const gf = g / 255
  const bf = b / 255
  const max = Math.max(rf, gf, bf)
  const min = Math.min(rf, gf, bf)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rf) h = ((gf - bf) / d) % 6
    else if (max === gf) h = (bf - rf) / d + 2
    else h = (rf - gf) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const l = (max + min) / 2
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  return {
    h: Math.round(h),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  }
}

export interface ColorPickerParts<S> {
  root: {
    'data-scope': 'color-picker'
    'data-part': 'root'
    'data-disabled': (s: S) => '' | undefined
  }
  hueSlider: {
    type: 'range'
    min: 0
    max: 360
    step: 1
    'aria-label': string
    disabled: (s: S) => boolean
    value: (s: S) => string
    'data-scope': 'color-picker'
    'data-part': 'hue-slider'
    onInput: (e: Event) => void
  }
  saturationSlider: {
    type: 'range'
    min: 0
    max: 100
    step: 1
    'aria-label': string
    disabled: (s: S) => boolean
    value: (s: S) => string
    style: (s: S) => string
    'data-scope': 'color-picker'
    'data-part': 'saturation-slider'
    onInput: (e: Event) => void
  }
  lightnessSlider: {
    type: 'range'
    min: 0
    max: 100
    step: 1
    'aria-label': string
    disabled: (s: S) => boolean
    value: (s: S) => string
    style: (s: S) => string
    'data-scope': 'color-picker'
    'data-part': 'lightness-slider'
    onInput: (e: Event) => void
  }
  hexInput: {
    type: 'text'
    autoComplete: 'off'
    'aria-label': string
    disabled: (s: S) => boolean
    value: (s: S) => string
    'data-scope': 'color-picker'
    'data-part': 'hex-input'
    onInput: (e: Event) => void
  }
  swatch: {
    'data-scope': 'color-picker'
    'data-part': 'swatch'
    'aria-hidden': 'true'
    style: (s: S) => string
  }
}

export interface ConnectOptions {
  hueLabel?: string
  saturationLabel?: string
  lightnessLabel?: string
  hexLabel?: string
}

export function connect<S>(
  get: (s: S) => ColorPickerState,
  send: Send<ColorPickerMsg>,
  opts: ConnectOptions = {},
): ColorPickerParts<S> {
  return {
    root: {
      'data-scope': 'color-picker',
      'data-part': 'root',
      'data-disabled': (s) => (get(s).disabled ? '' : undefined),
    },
    hueSlider: {
      type: 'range',
      min: 0,
      max: 360,
      step: 1,
      'aria-label': opts.hueLabel ?? 'Hue',
      disabled: (s) => get(s).disabled,
      value: (s) => String(get(s).hsl.h),
      'data-scope': 'color-picker',
      'data-part': 'hue-slider',
      onInput: (e) => send({ type: 'setHue', h: Number((e.target as HTMLInputElement).value) }),
    },
    saturationSlider: {
      type: 'range',
      min: 0,
      max: 100,
      step: 1,
      'aria-label': opts.saturationLabel ?? 'Saturation',
      disabled: (s) => get(s).disabled,
      value: (s) => String(get(s).hsl.s),
      style: (s) => {
        const { h, l } = get(s).hsl
        return `background: linear-gradient(to right, hsl(${h} 0% ${l}%), hsl(${h} 100% ${l}%))`
      },
      'data-scope': 'color-picker',
      'data-part': 'saturation-slider',
      onInput: (e) =>
        send({ type: 'setSaturation', s: Number((e.target as HTMLInputElement).value) }),
    },
    lightnessSlider: {
      type: 'range',
      min: 0,
      max: 100,
      step: 1,
      'aria-label': opts.lightnessLabel ?? 'Lightness',
      disabled: (s) => get(s).disabled,
      value: (s) => String(get(s).hsl.l),
      style: (s) => {
        const { h, s: sat } = get(s).hsl
        return `background: linear-gradient(to right, hsl(${h} ${sat}% 0%), hsl(${h} ${sat}% 50%), hsl(${h} ${sat}% 100%))`
      },
      'data-scope': 'color-picker',
      'data-part': 'lightness-slider',
      onInput: (e) =>
        send({ type: 'setLightness', l: Number((e.target as HTMLInputElement).value) }),
    },
    hexInput: {
      type: 'text',
      autoComplete: 'off',
      'aria-label': opts.hexLabel ?? 'Hex color',
      disabled: (s) => get(s).disabled,
      value: (s) => toHex(get(s).hsl),
      'data-scope': 'color-picker',
      'data-part': 'hex-input',
      onInput: (e) => send({ type: 'setHex', hex: (e.target as HTMLInputElement).value }),
    },
    swatch: {
      'data-scope': 'color-picker',
      'data-part': 'swatch',
      'aria-hidden': 'true',
      style: (s) => `background-color:${toHex(get(s).hsl)};`,
    },
  }
}

export const colorPicker = { init, update, connect, toHex, hexToHsl, hslToRgb }
