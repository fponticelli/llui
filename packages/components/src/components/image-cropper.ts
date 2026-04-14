import type { Send } from '@llui/dom'
import { useContext } from '@llui/dom'
import { LocaleContext } from '../locale.js'
import type { Locale } from '../locale.js'

/**
 * Image cropper — select a rectangular crop region over an image,
 * optionally constrained to an aspect ratio. The machine tracks the
 * image's natural dimensions, the crop rectangle, and in-progress
 * drag/resize state. The view layer wires pointer events on the crop
 * box and its resize handles.
 *
 * Coordinates are in image-native pixels (0..naturalWidth, 0..naturalHeight).
 * The consumer converts to display pixels using the image's rendered size.
 */

export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ImageCropperState {
  /** Natural dimensions of the source image. */
  image: { width: number; height: number }
  crop: CropRect
  /** Constrain the crop to this aspect ratio (width / height), or null to free-form. */
  aspectRatio: number | null
  minSize: number
  dragging: boolean
  resizing: ResizeHandle | null
  disabled: boolean
}

export type ImageCropperMsg =
  | { type: 'setImage'; width: number; height: number }
  | { type: 'setCrop'; crop: CropRect }
  | { type: 'setAspectRatio'; ratio: number | null }
  | { type: 'dragStart' }
  | { type: 'dragMove'; dx: number; dy: number }
  | { type: 'dragEnd' }
  | { type: 'resizeStart'; handle: ResizeHandle }
  | { type: 'resizeMove'; dx: number; dy: number }
  | { type: 'resizeEnd' }
  | { type: 'reset' }
  | { type: 'centerFill' }

export interface ImageCropperInit {
  image?: { width: number; height: number }
  crop?: CropRect
  aspectRatio?: number | null
  minSize?: number
  disabled?: boolean
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function clampCrop(crop: CropRect, image: { width: number; height: number }): CropRect {
  const width = clamp(crop.width, 0, image.width)
  const height = clamp(crop.height, 0, image.height)
  const x = clamp(crop.x, 0, image.width - width)
  const y = clamp(crop.y, 0, image.height - height)
  return { x, y, width, height }
}

function enforceAspectRatio(crop: CropRect, ratio: number | null): CropRect {
  if (ratio === null) return crop
  // Keep width; compute height from ratio.
  const height = crop.width / ratio
  return { ...crop, height }
}

/**
 * Compute the largest centered crop that fits `image` while respecting the
 * aspect ratio (if any).
 */
export function centerFill(
  image: { width: number; height: number },
  aspectRatio: number | null,
): CropRect {
  if (aspectRatio === null) {
    return { x: 0, y: 0, width: image.width, height: image.height }
  }
  const imgRatio = image.width / image.height
  let width: number, height: number
  if (aspectRatio > imgRatio) {
    width = image.width
    height = width / aspectRatio
  } else {
    height = image.height
    width = height * aspectRatio
  }
  return {
    x: (image.width - width) / 2,
    y: (image.height - height) / 2,
    width,
    height,
  }
}

export function init(opts: ImageCropperInit = {}): ImageCropperState {
  const image = opts.image ?? { width: 0, height: 0 }
  const aspectRatio = opts.aspectRatio ?? null
  const crop = opts.crop ?? centerFill(image, aspectRatio)
  return {
    image,
    crop: clampCrop(crop, image),
    aspectRatio,
    minSize: opts.minSize ?? 20,
    dragging: false,
    resizing: null,
    disabled: opts.disabled ?? false,
  }
}

function applyResize(
  state: ImageCropperState,
  dx: number,
  dy: number,
  handle: ResizeHandle,
): ImageCropperState {
  let { x, y, width, height } = state.crop
  if (handle.includes('e')) width += dx
  if (handle.includes('w')) {
    width -= dx
    x += dx
  }
  if (handle.includes('s')) height += dy
  if (handle.includes('n')) {
    height -= dy
    y += dy
  }
  // Aspect ratio: if set, let the axis with the bigger delta drive the
  // other, keeping the handle's corner anchored.
  if (state.aspectRatio !== null) {
    const isHoriz = handle === 'e' || handle === 'w'
    const isVert = handle === 'n' || handle === 's'
    if (isHoriz) {
      const newHeight = width / state.aspectRatio
      // Keep vertical center.
      y = state.crop.y + (state.crop.height - newHeight) / 2
      height = newHeight
    } else if (isVert) {
      const newWidth = height * state.aspectRatio
      x = state.crop.x + (state.crop.width - newWidth) / 2
      width = newWidth
    } else {
      // Corner: use the axis with the larger pointer delta (expressed in
      // width-equivalent units) to drive the other. This keeps the thumb
      // tracking the pointer linearly instead of snapping to whichever
      // current dimension happens to match the aspect ratio closer.
      const dw = width - state.crop.width
      const dh = height - state.crop.height
      const dhAsDw = dh * state.aspectRatio
      if (Math.abs(dw) >= Math.abs(dhAsDw)) {
        // Width leads; derive height, re-anchor top if resizing from north.
        height = width / state.aspectRatio
        if (handle.includes('n')) y = state.crop.y + (state.crop.height - height)
      } else {
        // Height leads; derive width, re-anchor left if resizing from west.
        width = height * state.aspectRatio
        if (handle.includes('w')) x = state.crop.x + (state.crop.width - width)
      }
    }
  }
  // Enforce min size + clamp to image.
  if (width < state.minSize) width = state.minSize
  if (height < state.minSize) height = state.minSize
  return { ...state, crop: clampCrop({ x, y, width, height }, state.image) }
}

export function update(
  state: ImageCropperState,
  msg: ImageCropperMsg,
): [ImageCropperState, never[]] {
  if (state.disabled && msg.type !== 'setImage' && msg.type !== 'reset') {
    return [state, []]
  }
  switch (msg.type) {
    case 'setImage': {
      const image = { width: msg.width, height: msg.height }
      const crop = centerFill(image, state.aspectRatio)
      return [{ ...state, image, crop }, []]
    }
    case 'setCrop':
      return [{ ...state, crop: clampCrop(msg.crop, state.image) }, []]
    case 'setAspectRatio': {
      const next = enforceAspectRatio(state.crop, msg.ratio)
      return [{ ...state, aspectRatio: msg.ratio, crop: clampCrop(next, state.image) }, []]
    }
    case 'dragStart':
      return [{ ...state, dragging: true }, []]
    case 'dragMove': {
      if (!state.dragging) return [state, []]
      const crop = {
        ...state.crop,
        x: state.crop.x + msg.dx,
        y: state.crop.y + msg.dy,
      }
      return [{ ...state, crop: clampCrop(crop, state.image) }, []]
    }
    case 'dragEnd':
      return [{ ...state, dragging: false }, []]
    case 'resizeStart':
      return [{ ...state, resizing: msg.handle }, []]
    case 'resizeMove':
      if (state.resizing === null) return [state, []]
      return [applyResize(state, msg.dx, msg.dy, state.resizing), []]
    case 'resizeEnd':
      return [{ ...state, resizing: null }, []]
    case 'reset':
    case 'centerFill':
      return [{ ...state, crop: centerFill(state.image, state.aspectRatio) }, []]
  }
}

export interface ImageCropperParts<S> {
  root: {
    'data-scope': 'image-cropper'
    'data-part': 'root'
    'data-dragging': (s: S) => '' | undefined
    'data-resizing': (s: S) => '' | undefined
    'data-disabled': (s: S) => '' | undefined
  }
  image: {
    'data-scope': 'image-cropper'
    'data-part': 'image'
    onLoad: (e: Event) => void
    draggable: false
  }
  cropBox: {
    'data-scope': 'image-cropper'
    'data-part': 'crop-box'
    style: (s: S) => string
    onPointerDown: (e: PointerEvent) => void
  }
  resizeHandle: (handle: ResizeHandle) => {
    'data-scope': 'image-cropper'
    'data-part': 'resize-handle'
    'data-handle': ResizeHandle
    onPointerDown: (e: PointerEvent) => void
  }
  resetTrigger: {
    type: 'button'
    'aria-label': string | ((s: S) => string)
    'data-scope': 'image-cropper'
    'data-part': 'reset-trigger'
    onClick: (e: MouseEvent) => void
  }
}

export interface ConnectOptions {
  resetLabel?: string
}

export function connect<S>(
  get: (s: S) => ImageCropperState,
  send: Send<ImageCropperMsg>,
  opts: ConnectOptions = {},
): ImageCropperParts<S> {
  const locale = useContext<S, Locale>(LocaleContext)
  return {
    root: {
      'data-scope': 'image-cropper',
      'data-part': 'root',
      'data-dragging': (s) => (get(s).dragging ? '' : undefined),
      'data-resizing': (s) => (get(s).resizing !== null ? '' : undefined),
      'data-disabled': (s) => (get(s).disabled ? '' : undefined),
    },
    image: {
      'data-scope': 'image-cropper',
      'data-part': 'image',
      onLoad: (e) => {
        const img = e.target as HTMLImageElement
        send({ type: 'setImage', width: img.naturalWidth, height: img.naturalHeight })
      },
      draggable: false,
    },
    cropBox: {
      'data-scope': 'image-cropper',
      'data-part': 'crop-box',
      style: (s) => {
        const st = get(s)
        if (st.image.width === 0 || st.image.height === 0) return 'display:none;'
        // Express as percentages so the crop box scales with the rendered image.
        const xp = (st.crop.x / st.image.width) * 100
        const yp = (st.crop.y / st.image.height) * 100
        const wp = (st.crop.width / st.image.width) * 100
        const hp = (st.crop.height / st.image.height) * 100
        return `left:${xp}%;top:${yp}%;width:${wp}%;height:${hp}%;`
      },
      onPointerDown: () => send({ type: 'dragStart' }),
    },
    resizeHandle: (handle: ResizeHandle) => ({
      'data-scope': 'image-cropper',
      'data-part': 'resize-handle',
      'data-handle': handle,
      onPointerDown: () => send({ type: 'resizeStart', handle }),
    }),
    resetTrigger: {
      type: 'button',
      'aria-label': opts.resetLabel ?? ((s: S) => locale(s).imageCropper.reset),
      'data-scope': 'image-cropper',
      'data-part': 'reset-trigger',
      onClick: () => send({ type: 'reset' }),
    },
  }
}

export const imageCropper = { init, update, connect, centerFill }
