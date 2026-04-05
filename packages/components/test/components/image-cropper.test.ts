import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, centerFill } from '../../src/components/image-cropper'
import type { ImageCropperState } from '../../src/components/image-cropper'

type Ctx = { c: ImageCropperState }
const wrap = (c: ImageCropperState): Ctx => ({ c })

describe('centerFill', () => {
  it('with no aspect returns full image', () => {
    expect(centerFill({ width: 100, height: 80 }, null)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 80,
    })
  })

  it('narrower aspect crops width', () => {
    // 2:1 ratio, image is wider than 2:1 → letterbox horizontally
    const r = centerFill({ width: 400, height: 100 }, 2)
    expect(r.width).toBe(200)
    expect(r.height).toBe(100)
    expect(r.x).toBe(100) // centered
  })

  it('taller aspect crops height', () => {
    // 2:1 ratio, image is 1:1 → letterbox vertically
    const r = centerFill({ width: 200, height: 200 }, 2)
    expect(r.width).toBe(200)
    expect(r.height).toBe(100)
    expect(r.y).toBe(50)
  })
})

describe('image-cropper reducer', () => {
  it('initializes with crop = centerFill', () => {
    const s = init({ image: { width: 100, height: 80 } })
    expect(s.crop).toEqual({ x: 0, y: 0, width: 100, height: 80 })
  })

  it('setImage recomputes crop as centerFill', () => {
    const s0 = init({ aspectRatio: 1 })
    const [s] = update(s0, { type: 'setImage', width: 400, height: 200 })
    expect(s.image.width).toBe(400)
    expect(s.crop.width).toBe(200)
    expect(s.crop.height).toBe(200)
  })

  it('setCrop clamps to image bounds', () => {
    const s0 = init({ image: { width: 100, height: 100 } })
    const [s] = update(s0, { type: 'setCrop', crop: { x: 50, y: 50, width: 200, height: 200 } })
    expect(s.crop.width).toBeLessThanOrEqual(100)
    expect(s.crop.x + s.crop.width).toBeLessThanOrEqual(100)
  })

  it('dragMove adds deltas + clamps', () => {
    const s0 = {
      ...init({ image: { width: 200, height: 200 }, crop: { x: 0, y: 0, width: 100, height: 100 } }),
      dragging: true,
    } as ImageCropperState
    const [s] = update(s0, { type: 'dragMove', dx: 50, dy: 50 })
    expect(s.crop.x).toBe(50)
    // Cannot go past image bounds
    const [s2] = update(s, { type: 'dragMove', dx: 1000, dy: 1000 })
    expect(s2.crop.x).toBe(100) // clamped: 200 - 100
    expect(s2.crop.y).toBe(100)
  })

  it('resize east grows width', () => {
    const s0 = {
      ...init({ image: { width: 200, height: 200 }, crop: { x: 0, y: 0, width: 100, height: 100 } }),
      resizing: 'e' as const,
    } as ImageCropperState
    const [s] = update(s0, { type: 'resizeMove', dx: 50, dy: 0 })
    expect(s.crop.width).toBe(150)
  })

  it('resize enforces minSize', () => {
    const s0 = {
      ...init({
        image: { width: 200, height: 200 },
        crop: { x: 0, y: 0, width: 100, height: 100 },
        minSize: 50,
      }),
      resizing: 'e' as const,
    } as ImageCropperState
    const [s] = update(s0, { type: 'resizeMove', dx: -200, dy: 0 })
    expect(s.crop.width).toBe(50)
  })

  it('setAspectRatio updates ratio + adjusts crop height', () => {
    const s0 = init({
      image: { width: 400, height: 400 },
      crop: { x: 0, y: 0, width: 200, height: 200 },
    })
    const [s] = update(s0, { type: 'setAspectRatio', ratio: 2 })
    expect(s.aspectRatio).toBe(2)
    expect(s.crop.height).toBe(100) // 200 / 2
  })

  it('reset restores centerFill', () => {
    const s0 = {
      ...init({ image: { width: 400, height: 400 } }),
      crop: { x: 50, y: 50, width: 100, height: 100 },
    } as ImageCropperState
    const [s] = update(s0, { type: 'reset' })
    expect(s.crop).toEqual({ x: 0, y: 0, width: 400, height: 400 })
  })

  it('disabled blocks drag/resize', () => {
    const s0 = { ...init({ disabled: true }), dragging: true } as ImageCropperState
    const [s] = update(s0, { type: 'dragMove', dx: 50, dy: 0 })
    // disabled is checked at the top; reducer returns unchanged
    expect(s.crop).toEqual(s0.crop)
  })
})

describe('image-cropper.connect', () => {
  it('cropBox style expresses crop as percentages', () => {
    const p = connect<Ctx>((s) => s.c, vi.fn())
    const s = init({
      image: { width: 400, height: 200 },
      crop: { x: 100, y: 50, width: 200, height: 100 },
    })
    const style = p.cropBox.style(wrap(s))
    expect(style).toContain('left:25%')
    expect(style).toContain('top:25%')
    expect(style).toContain('width:50%')
    expect(style).toContain('height:50%')
  })

  it('cropBox hidden (display:none) when no image', () => {
    const p = connect<Ctx>((s) => s.c, vi.fn())
    expect(p.cropBox.style(wrap(init()))).toContain('display:none')
  })

  it('image onLoad dispatches setImage with natural dims', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.c, send)
    const img = document.createElement('img')
    Object.defineProperties(img, {
      naturalWidth: { value: 800 },
      naturalHeight: { value: 600 },
    })
    p.image.onLoad({ target: img } as unknown as Event)
    expect(send).toHaveBeenCalledWith({ type: 'setImage', width: 800, height: 600 })
  })

  it('resetTrigger dispatches reset', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.c, send)
    p.resetTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'reset' })
  })
})
