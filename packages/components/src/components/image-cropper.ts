import type { Send, Signal } from '@llui/dom'
import { tagSend } from '@llui/dom'
import { imageCropperLocale } from '../locale/image-cropper.js'
import { allFiniteNumbers, clamp, finiteBound, positiveFinite } from '../utils/number.js'

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
  /** @humanOnly */
  | { type: 'setImage'; width: number; height: number }
  /** @intent("Set the crop rectangle (x/y/width/height in image-native pixels)") */
  | { type: 'setCrop'; crop: CropRect }
  /** @intent("Lock the crop to a specific aspect ratio (width/height), or null for free-form") */
  | { type: 'setAspectRatio'; ratio: number | null }
  /** @humanOnly */
  | { type: 'dragStart' }
  /** @humanOnly */
  | { type: 'dragMove'; dx: number; dy: number }
  /** @humanOnly */
  | { type: 'dragEnd' }
  /** @humanOnly */
  | { type: 'resizeStart'; handle: ResizeHandle }
  /** @humanOnly */
  | { type: 'resizeMove'; dx: number; dy: number }
  /** @humanOnly */
  | { type: 'resizeEnd' }
  /** @intent("Reset the crop to a default selection (full image or aspect-fit)") */
  | { type: 'reset' }
  /** @intent("Set the crop to a maximum-area centered selection") */
  | { type: 'centerFill' }

export interface ImageCropperInit {
  image?: { width: number; height: number }
  crop?: CropRect
  aspectRatio?: number | null
  minSize?: number
  disabled?: boolean
}

/**
 * Largest on-ratio rectangle that fits the image.
 *
 * Choosing the driving image axis before multiplying/dividing is essential:
 * `height * ratio` may overflow for a very wide ratio, while `width / ratio`
 * may overflow for a very narrow one. The comparison itself is safe at those
 * extremes, and the selected operation can only move toward zero.
 */
function largestLockedSize(
  image: { width: number; height: number },
  ratio: number,
): { width: number; height: number } {
  if (ratio > image.width / image.height) {
    return { width: image.width, height: image.width / ratio }
  }
  return { width: image.height * ratio, height: image.height }
}

/**
 * Fit a crop inside the image while HONOURING the aspect-ratio lock.
 *
 * With a ratio set the rectangle may only be scaled UNIFORMLY: clamping each
 * axis on its own is what broke the lock — deriving the height from the ratio
 * and then squashing it back to the image's bounds returned the image's own
 * ratio, not the requested one (#128). Free-form crops (`ratio === null`) keep
 * the per-axis clamp, since there is no shape to preserve.
 *
 * When the image is too small to hold `minSize` on a locked ratio, fitting
 * inside the image wins: an on-ratio crop that overflows the image would be
 * unusable, a sub-minimum one is merely small.
 */
function fitCrop(
  crop: CropRect,
  image: { width: number; height: number },
  ratio: number | null,
  minSize: number,
): CropRect {
  if (ratio === null) {
    // The floor can never push a crop outside the image, hence the Math.min.
    const width = clamp(crop.width, Math.min(minSize, image.width), image.width)
    const height = clamp(crop.height, Math.min(minSize, image.height), image.height)
    return {
      x: clamp(crop.x, 0, image.width - width),
      y: clamp(crop.y, 0, image.height - height),
      width,
      height,
    }
  }
  const maximum = largestLockedSize(image, ratio)

  // Algebraically this is the former grow-then-shrink sequence, but it chooses
  // the final width directly. That avoids both an overflowing grow factor and
  // the `Infinity * 0 => NaN` shrink that followed it for valid extreme ratios.
  // If the shorter side cannot reach minSize inside the image, the maximum
  // fitting rectangle wins as before.
  let minimumWidth = 0
  if (minSize > 0) {
    if (ratio >= 1) {
      minimumWidth = minSize >= maximum.height ? maximum.width : minSize * ratio
    } else {
      minimumWidth = Math.min(minSize, maximum.width)
    }
  }
  // Route the requested width through the same crop-value clamp as the free
  // branch: NaN takes zero, infinities take the bound they point at. Apply the
  // locked minimum afterwards, so a normalized zero still becomes the
  // smallest usable on-ratio crop rather than poisoning both dimensions.
  const width = Math.max(clamp(crop.width, 0, maximum.width), minimumWidth)
  const height = width / ratio
  return {
    x: clamp(crop.x, 0, image.width - width),
    y: clamp(crop.y, 0, image.height - height),
    width,
    height,
  }
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
  const { width, height } = largestLockedSize(image, aspectRatio)
  return {
    x: (image.width - width) / 2,
    y: (image.height - height) / 2,
    width,
    height,
  }
}

/** Natural image dimensions with a non-finite axis replaced by the 0 default. */
function finiteImage(raw: { width?: number; height?: number } | undefined): {
  width: number
  height: number
} {
  return { width: finiteBound(raw?.width) ?? 0, height: finiteBound(raw?.height) ?? 0 }
}

export function init(opts: ImageCropperInit = {}): ImageCropperState {
  // Everything the crop is fitted AGAINST is a bound and is normalised here
  // (#177): `image` and `minSize` are required, so an unusable value takes the
  // default, while `aspectRatio` is nullable and `null` already means "no
  // constraint", so an unusable ratio takes that. A non-finite bound is not
  // merely unserializable — it divides straight into `fitCrop` and hands the
  // whole `crop` rectangle to `NaN`.
  const image = finiteImage(opts.image)
  const aspectRatio = positiveFinite(opts.aspectRatio) ?? null
  const crop = opts.crop ?? centerFill(image, aspectRatio)
  const minSize = finiteBound(opts.minSize) ?? 20
  return {
    image,
    crop: fitCrop(crop, image, aspectRatio, minSize),
    aspectRatio,
    minSize,
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
  if (!allFiniteNumbers(x, y, width, height)) return state
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
  if (!allFiniteNumbers(x, y, width, height)) return state
  // Min size + fit to image, both ratio-aware: two independent minSize clamps
  // squashed a locked crop back to 1:1 the moment either axis hit the floor.
  return {
    ...state,
    crop: fitCrop({ x, y, width, height }, state.image, state.aspectRatio, state.minSize),
  }
}

export function update(
  state: ImageCropperState,
  msg: ImageCropperMsg,
): [ImageCropperState, never[]] {
  if (state.disabled && msg.type !== 'setImage' && msg.type !== 'reset') {
    return [state, []]
  }
  switch (msg.type) {
    // A message that carries a non-finite BOUND is dropped: the image
    // dimensions are the outer limit every crop is fitted into, and there is no
    // "unbounded image" to fall back to (#177).
    case 'setImage': {
      const width = finiteBound(msg.width)
      const height = finiteBound(msg.height)
      if (width === undefined || height === undefined) return [state, []]
      const image = { width, height }
      const crop = centerFill(image, state.aspectRatio)
      return [{ ...state, image, crop }, []]
    }
    case 'setCrop':
      return [
        { ...state, crop: fitCrop(msg.crop, state.image, state.aspectRatio, state.minSize) },
        [],
      ]
    case 'setAspectRatio': {
      // A ratio is a divisor, so numeric values must be positive as well as
      // finite. Invalid numeric updates are refused atomically; only the
      // explicit `null` spelling removes an existing constraint (#214).
      if (msg.ratio !== null && positiveFinite(msg.ratio) === undefined) {
        return [state, []]
      }
      const ratio = msg.ratio
      return [
        {
          ...state,
          aspectRatio: ratio,
          crop: fitCrop(state.crop, state.image, ratio, state.minSize),
        },
        [],
      ]
    }
    case 'dragStart':
      return [{ ...state, dragging: true }, []]
    case 'dragMove': {
      if (!state.dragging) return [state, []]
      if (!allFiniteNumbers(msg.dx, msg.dy)) return [state, []]
      const crop = {
        ...state.crop,
        x: state.crop.x + msg.dx,
        y: state.crop.y + msg.dy,
      }
      if (!allFiniteNumbers(crop)) return [state, []]
      return [{ ...state, crop: fitCrop(crop, state.image, state.aspectRatio, state.minSize) }, []]
    }
    case 'dragEnd':
      return [{ ...state, dragging: false }, []]
    case 'resizeStart':
      return [{ ...state, resizing: msg.handle }, []]
    case 'resizeMove':
      if (state.resizing === null) return [state, []]
      if (!allFiniteNumbers(msg.dx, msg.dy)) return [state, []]
      return [applyResize(state, msg.dx, msg.dy, state.resizing), []]
    case 'resizeEnd':
      return [{ ...state, resizing: null }, []]
    case 'reset':
    case 'centerFill':
      return [{ ...state, crop: centerFill(state.image, state.aspectRatio) }, []]
  }
}

export interface ImageCropperParts {
  root: {
    'data-scope': 'image-cropper'
    'data-part': 'root'
    'data-dragging': Signal<'' | undefined>
    'data-resizing': Signal<'' | undefined>
    'data-disabled': Signal<'' | undefined>
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
    style: Signal<string>
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
    'aria-label': string
    'data-scope': 'image-cropper'
    'data-part': 'reset-trigger'
    onClick: (e: MouseEvent) => void
  }
}

export interface ConnectOptions {
  resetLabel?: string
}

export function connect(
  state: Signal<ImageCropperState>,
  send: Send<ImageCropperMsg>,
  opts: ConnectOptions = {},
): ImageCropperParts {
  const locale = imageCropperLocale()
  return {
    root: {
      'data-scope': 'image-cropper',
      'data-part': 'root',
      'data-dragging': state.map((st) => (st.dragging ? '' : undefined)),
      'data-resizing': state.map((st) => (st.resizing !== null ? '' : undefined)),
      'data-disabled': state.map((st) => (st.disabled ? '' : undefined)),
    },
    image: {
      'data-scope': 'image-cropper',
      'data-part': 'image',
      onLoad: tagSend(send, ['setImage'], (e) => {
        const img = e.target as HTMLImageElement
        send({ type: 'setImage', width: img.naturalWidth, height: img.naturalHeight })
      }),
      draggable: false,
    },
    cropBox: {
      'data-scope': 'image-cropper',
      'data-part': 'crop-box',
      style: state.map((st) => {
        if (st.image.width === 0 || st.image.height === 0) return 'display:none;'
        // Express as percentages so the crop box scales with the rendered image.
        const xp = (st.crop.x / st.image.width) * 100
        const yp = (st.crop.y / st.image.height) * 100
        const wp = (st.crop.width / st.image.width) * 100
        const hp = (st.crop.height / st.image.height) * 100
        return `left:${xp}%;top:${yp}%;width:${wp}%;height:${hp}%;`
      }),
      onPointerDown: tagSend(send, ['dragStart'], () => send({ type: 'dragStart' })),
    },
    resizeHandle: (handle: ResizeHandle) => ({
      'data-scope': 'image-cropper',
      'data-part': 'resize-handle',
      'data-handle': handle,
      onPointerDown: tagSend(send, ['resizeStart'], () => send({ type: 'resizeStart', handle })),
    }),
    resetTrigger: {
      type: 'button',
      'aria-label': opts.resetLabel ?? locale.reset,
      'data-scope': 'image-cropper',
      'data-part': 'reset-trigger',
      onClick: tagSend(send, ['reset'], () => send({ type: 'reset' })),
    },
  }
}

export const imageCropper = { init, update, connect, centerFill }
