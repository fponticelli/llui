import type { Send, Signal } from '@llui/dom'
import { useContext, tagSend } from '@llui/dom'
import { LocaleContext } from '../locale.js'

/**
 * Color picker — HSL/HSV color selection. Tracks hue (0-360), saturation
 * (0-100), and lightness (0-100). Emits hex strings for convenience.
 */

export interface Hsl {
  h: number
  s: number
  l: number
}

/** HSV color (h 0-360, s/v 0-100). The 2D area picker operates in HSV space. */
export interface Hsv {
  h: number
  s: number
  v: number
}

export interface ColorPickerState {
  /**
   * Canonical color, stored in HSV so the 2D saturation/value area preserves
   * S and V independently (HSL collapses both at the black/white axis). HSL is
   * derived on demand via `stateHsl()` / `hsvToHsl()` for hex output + sliders.
   */
  hsv: Hsv
  /** Alpha channel 0..1. */
  alpha: number
  disabled: boolean
}

export type ColorPickerMsg =
  /** @intent("Set the full HSL color at once") */
  | { type: 'setHsl'; hsl: Hsl }
  /** @intent("Set the hue channel (0–360)") */
  | { type: 'setHue'; h: number }
  /** @intent("Set the saturation channel (0–100)") */
  | { type: 'setSaturation'; s: number }
  /** @intent("Set the lightness channel (0–100)") */
  | { type: 'setLightness'; l: number }
  /** @intent("Set the alpha channel (0–1)") */
  | { type: 'setAlpha'; alpha: number }
  /** @intent("Set the color from a hex string (#RRGGBB or #RGB)") */
  | { type: 'setHex'; hex: string }
  /** @intent("Set saturation and value (HSV, 0–100 each) from the 2D area") */
  | { type: 'setSv'; s: number; v: number }
  /** @intent("Nudge saturation/value (HSV) by signed deltas — used by area arrow keys") */
  | { type: 'nudgeSv'; ds: number; dv: number }
  /** @intent("Set the color from a swatch or hex string (#RGB, #RRGGBB, or #RRGGBBAA)") */
  | { type: 'setColor'; color: string }

export interface ColorPickerInit {
  /** Initial color as HSL (converted to the canonical HSV store). */
  hsl?: Hsl
  /** Initial color as HSV (takes precedence over `hsl`). */
  hsv?: Hsv
  alpha?: number
  disabled?: boolean
}

export function init(opts: ColorPickerInit = {}): ColorPickerState {
  const hsv = opts.hsv ?? (opts.hsl ? hslToHsv(opts.hsl) : { h: 0, s: 100, v: 100 })
  return {
    hsv,
    alpha: opts.alpha ?? 1,
    disabled: opts.disabled ?? false,
  }
}

/** Derive the HSL projection of the current state (for hex output + HSL sliders). */
export function stateHsl(state: ColorPickerState): Hsl {
  return hsvToHsl(state.hsv)
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export function update(state: ColorPickerState, msg: ColorPickerMsg): [ColorPickerState, never[]] {
  if (state.disabled) return [state, []]
  switch (msg.type) {
    case 'setHsl':
      return [{ ...state, hsv: hslToHsv(msg.hsl) }, []]
    case 'setHue':
      return [{ ...state, hsv: { ...state.hsv, h: ((msg.h % 360) + 360) % 360 } }, []]
    case 'setSaturation': {
      const hsl = { ...stateHsl(state), s: clamp(msg.s, 0, 100) }
      return [{ ...state, hsv: hslToHsv(hsl) }, []]
    }
    case 'setLightness': {
      const hsl = { ...stateHsl(state), l: clamp(msg.l, 0, 100) }
      return [{ ...state, hsv: hslToHsv(hsl) }, []]
    }
    case 'setAlpha':
      return [{ ...state, alpha: clamp(msg.alpha, 0, 1) }, []]
    case 'setHex': {
      const hsl = hexToHsl(msg.hex)
      return hsl ? [{ ...state, hsv: hslToHsv(hsl) }, []] : [state, []]
    }
    case 'setSv':
      return [
        { ...state, hsv: { ...state.hsv, s: clamp(msg.s, 0, 100), v: clamp(msg.v, 0, 100) } },
        [],
      ]
    case 'nudgeSv':
      return [
        {
          ...state,
          hsv: {
            ...state.hsv,
            s: clamp(state.hsv.s + msg.ds, 0, 100),
            v: clamp(state.hsv.v + msg.dv, 0, 100),
          },
        },
        [],
      ]
    case 'setColor': {
      const parsed = parseColor(msg.color)
      if (!parsed) return [state, []]
      return [
        {
          ...state,
          hsv: hslToHsv(parsed.hsl),
          ...(parsed.alpha !== undefined ? { alpha: parsed.alpha } : {}),
        },
        [],
      ]
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
  return `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`
}

/** 8-digit hex (#RRGGBBAA) including the alpha channel (0..1). */
export function toHex8(hsl: Hsl, alpha: number): string {
  const a = Math.round(clamp(alpha, 0, 1) * 255)
  return `${toHex(hsl)}${hexByte(a)}`
}

function hexByte(n: number): string {
  return n.toString(16).padStart(2, '0')
}

/** Convert HSL (h 0-360, s/l 0-100) to HSV (h 0-360, s/v 0-100). */
export function hslToHsv(hsl: Hsl): Hsv {
  const l = hsl.l / 100
  const sl = hsl.s / 100
  const v = l + sl * Math.min(l, 1 - l)
  const s = v === 0 ? 0 : 2 * (1 - l / v)
  return { h: hsl.h, s: Math.round(s * 100), v: Math.round(v * 100) }
}

/** Convert HSV (h 0-360, s/v 0-100) to HSL (h 0-360, s/l 0-100). */
export function hsvToHsl(hsv: Hsv): Hsl {
  const v = hsv.v / 100
  const sv = hsv.s / 100
  const l = v * (1 - sv / 2)
  const s = l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l)
  return { h: hsv.h, s: Math.round(s * 100), l: Math.round(l * 100) }
}

/**
 * Map a pointer position over the 2D saturation/value area to HSV S/V (0..100).
 * X axis is saturation (left 0 → right 100); Y axis is value (top 100 → bottom 0).
 * The point is clamped to the rect, so out-of-bounds drags saturate cleanly.
 */
export function colorFromPoint(rect: DOMRect, x: number, y: number): { s: number; v: number } {
  const sx = rect.width === 0 ? 0 : clamp((x - rect.left) / rect.width, 0, 1)
  const sy = rect.height === 0 ? 0 : clamp((y - rect.top) / rect.height, 0, 1)
  return { s: Math.round(sx * 100), v: Math.round((1 - sy) * 100) }
}

/** Parse #RGB, #RRGGBB, or #RRGGBBAA into HSL (+ optional alpha). */
export function parseColor(color: string): { hsl: Hsl; alpha?: number } | null {
  const normalized = color.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{8}$/.test(normalized)) {
    const hsl = hexToHsl(normalized.slice(0, 6))
    if (!hsl) return null
    return { hsl, alpha: parseInt(normalized.slice(6, 8), 16) / 255 }
  }
  const hsl = hexToHsl(normalized)
  return hsl ? { hsl } : null
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

export interface ColorPickerParts {
  root: {
    'data-scope': 'color-picker'
    'data-part': 'root'
    'data-disabled': Signal<'' | undefined>
  }
  hueSlider: {
    type: 'range'
    min: 0
    max: 360
    step: 1
    'aria-label': string
    disabled: Signal<boolean>
    value: Signal<string>
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
    disabled: Signal<boolean>
    value: Signal<string>
    style: Signal<string>
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
    disabled: Signal<boolean>
    value: Signal<string>
    style: Signal<string>
    'data-scope': 'color-picker'
    'data-part': 'lightness-slider'
    onInput: (e: Event) => void
  }
  hexInput: {
    type: 'text'
    autocomplete: 'off'
    'aria-label': string
    disabled: Signal<boolean>
    value: Signal<string>
    'data-scope': 'color-picker'
    'data-part': 'hex-input'
    onInput: (e: Event) => void
  }
  /** Static preview swatch showing the currently-selected color. */
  preview: {
    'data-scope': 'color-picker'
    'data-part': 'preview'
    'aria-hidden': 'true'
    style: Signal<string>
  }
  /** The 2D saturation/value area track. The view owns pointer events and
   * calls `colorFromPoint(track.getBoundingClientRect(), x, y)` to derive S/V. */
  area: {
    'data-scope': 'color-picker'
    'data-part': 'area'
    style: Signal<string>
  }
  /** The draggable thumb inside the 2D area. Keyboard-operable (arrows move
   * S/V; Shift = coarse) with role="slider" and a 2D aria-valuetext. */
  areaThumb: {
    role: 'slider'
    'aria-label': string
    'aria-valuetext': Signal<string>
    'aria-disabled': Signal<'true' | undefined>
    tabindex: Signal<number>
    'data-scope': 'color-picker'
    'data-part': 'area-thumb'
    style: Signal<string>
    onKeyDown: (e: KeyboardEvent) => void
  }
  /** Alpha (opacity) range input, 0..1. Wired to the existing alpha state. */
  alphaSlider: {
    type: 'range'
    min: 0
    max: 1
    step: number
    'aria-label': string
    disabled: Signal<boolean>
    value: Signal<string>
    style: Signal<string>
    'data-scope': 'color-picker'
    'data-part': 'alpha-slider'
    onInput: (e: Event) => void
  }
  /** Container for the preset swatch buttons. */
  swatchGroup: {
    role: 'group'
    'aria-label': string
    'data-scope': 'color-picker'
    'data-part': 'swatch-group'
  }
  /** Factory for a preset swatch button dispatching a single `setColor`. */
  swatch: (color: string) => SwatchParts
}

export interface SwatchParts {
  type: 'button'
  'aria-label': string
  'aria-pressed': Signal<boolean>
  'data-scope': 'color-picker'
  'data-part': 'swatch'
  'data-value': string
  'data-state': Signal<'selected' | undefined>
  style: string
  onClick: (e: MouseEvent) => void
}

export interface ConnectOptions {
  hueLabel?: string
  saturationLabel?: string
  lightnessLabel?: string
  hexLabel?: string
  /** aria-label for the 2D saturation/value area thumb. */
  areaLabel?: string
  /** aria-label for the alpha slider. */
  alphaLabel?: string
  /** aria-label for the swatch group container. */
  swatchGroupLabel?: string
  /** Fine keyboard step for the area thumb (S/V units). Default 1. */
  step?: number
  /** Coarse keyboard step for the area thumb when Shift is held. Default 10. */
  coarseStep?: number
}

export function connect(
  state: Signal<ColorPickerState>,
  send: Send<ColorPickerMsg>,
  opts: ConnectOptions = {},
): ColorPickerParts {
  const locale = useContext(LocaleContext)
  const fine = opts.step ?? 1
  const coarse = opts.coarseStep ?? 10
  return {
    root: {
      'data-scope': 'color-picker',
      'data-part': 'root',
      'data-disabled': state.map((s) => (s.disabled ? '' : undefined)),
    },
    hueSlider: {
      type: 'range',
      min: 0,
      max: 360,
      step: 1,
      'aria-label': opts.hueLabel ?? locale.colorPicker.hue,
      disabled: state.map((s) => s.disabled),
      value: state.map((s) => String(s.hsv.h)),
      'data-scope': 'color-picker',
      'data-part': 'hue-slider',
      onInput: tagSend(send, ['setHue'], (e) =>
        send({ type: 'setHue', h: Number((e.target as HTMLInputElement).value) }),
      ),
    },
    saturationSlider: {
      type: 'range',
      min: 0,
      max: 100,
      step: 1,
      'aria-label': opts.saturationLabel ?? locale.colorPicker.saturation,
      disabled: state.map((s) => s.disabled),
      value: state.map((s) => String(stateHsl(s).s)),
      style: state.map((s) => {
        const { h, l } = stateHsl(s)
        return `background: linear-gradient(to right, hsl(${h} 0% ${l}%), hsl(${h} 100% ${l}%))`
      }),
      'data-scope': 'color-picker',
      'data-part': 'saturation-slider',
      onInput: tagSend(send, ['setSaturation'], (e) =>
        send({ type: 'setSaturation', s: Number((e.target as HTMLInputElement).value) }),
      ),
    },
    lightnessSlider: {
      type: 'range',
      min: 0,
      max: 100,
      step: 1,
      'aria-label': opts.lightnessLabel ?? locale.colorPicker.lightness,
      disabled: state.map((s) => s.disabled),
      value: state.map((s) => String(stateHsl(s).l)),
      style: state.map((s) => {
        const { h, s: sat } = stateHsl(s)
        return `background: linear-gradient(to right, hsl(${h} ${sat}% 0%), hsl(${h} ${sat}% 50%), hsl(${h} ${sat}% 100%))`
      }),
      'data-scope': 'color-picker',
      'data-part': 'lightness-slider',
      onInput: tagSend(send, ['setLightness'], (e) =>
        send({ type: 'setLightness', l: Number((e.target as HTMLInputElement).value) }),
      ),
    },
    hexInput: {
      type: 'text',
      autocomplete: 'off',
      'aria-label': opts.hexLabel ?? locale.colorPicker.hex,
      disabled: state.map((s) => s.disabled),
      value: state.map((s) => toHex(stateHsl(s))),
      'data-scope': 'color-picker',
      'data-part': 'hex-input',
      onInput: tagSend(send, ['setHex'], (e) =>
        send({ type: 'setHex', hex: (e.target as HTMLInputElement).value }),
      ),
    },
    preview: {
      'data-scope': 'color-picker',
      'data-part': 'preview',
      'aria-hidden': 'true',
      style: state.map((s) => `background-color:${toHex(stateHsl(s))};`),
    },
    area: {
      'data-scope': 'color-picker',
      'data-part': 'area',
      // Hue backdrop; the white→color and transparent→black gradients that
      // produce the saturation/value field are layered in CSS over this.
      style: state.map((s) => `background-color:hsl(${s.hsv.h} 100% 50%);`),
    },
    areaThumb: {
      role: 'slider',
      'aria-label':
        opts.areaLabel ?? `${locale.colorPicker.saturation} / ${locale.colorPicker.lightness}`,
      // 2D value: report both saturation and value (HSV) axes.
      'aria-valuetext': state.map(
        (s) => `${locale.colorPicker.saturation} ${s.hsv.s}%, Value ${s.hsv.v}%`,
      ),
      'aria-disabled': state.map((s) => (s.disabled ? 'true' : undefined)),
      tabindex: state.map((s) => (s.disabled ? -1 : 0)),
      'data-scope': 'color-picker',
      'data-part': 'area-thumb',
      // Position: left = saturation%, top = (100 - value)%.
      style: state.map((s) => `left:${s.hsv.s}%;top:${100 - s.hsv.v}%;`),
      onKeyDown: tagSend(send, ['nudgeSv'], (e) => {
        const stepUnit = e.shiftKey ? coarse : fine
        switch (e.key) {
          case 'ArrowRight':
            e.preventDefault()
            send({ type: 'nudgeSv', ds: stepUnit, dv: 0 })
            return
          case 'ArrowLeft':
            e.preventDefault()
            send({ type: 'nudgeSv', ds: -stepUnit, dv: 0 })
            return
          case 'ArrowUp':
            e.preventDefault()
            send({ type: 'nudgeSv', ds: 0, dv: stepUnit })
            return
          case 'ArrowDown':
            e.preventDefault()
            send({ type: 'nudgeSv', ds: 0, dv: -stepUnit })
            return
        }
      }),
    },
    alphaSlider: {
      type: 'range',
      min: 0,
      max: 1,
      step: 0.01,
      'aria-label': opts.alphaLabel ?? 'Alpha',
      disabled: state.map((s) => s.disabled),
      value: state.map((s) => String(s.alpha)),
      style: state.map((s) => {
        const hex = toHex(stateHsl(s))
        return `background: linear-gradient(to right, transparent, ${hex})`
      }),
      'data-scope': 'color-picker',
      'data-part': 'alpha-slider',
      onInput: tagSend(send, ['setAlpha'], (e) =>
        send({ type: 'setAlpha', alpha: Number((e.target as HTMLInputElement).value) }),
      ),
    },
    swatchGroup: {
      role: 'group',
      'aria-label': opts.swatchGroupLabel ?? 'Color swatches',
      'data-scope': 'color-picker',
      'data-part': 'swatch-group',
    },
    swatch: (color: string): SwatchParts => {
      const selected = (s: ColorPickerState): boolean => {
        const parsed = parseColor(color)
        return parsed ? toHex(parsed.hsl) === toHex(stateHsl(s)) : false
      }
      return {
        type: 'button',
        'aria-label': color,
        'aria-pressed': state.map(selected),
        'data-scope': 'color-picker',
        'data-part': 'swatch',
        'data-value': color,
        'data-state': state.map((s) => (selected(s) ? 'selected' : undefined)),
        style: `background-color:${color};`,
        onClick: tagSend(send, ['setColor'], () => send({ type: 'setColor', color })),
      }
    },
  }
}

export const colorPicker = {
  init,
  update,
  connect,
  stateHsl,
  toHex,
  toHex8,
  hexToHsl,
  hslToRgb,
  hslToHsv,
  hsvToHsl,
  colorFromPoint,
  parseColor,
}
