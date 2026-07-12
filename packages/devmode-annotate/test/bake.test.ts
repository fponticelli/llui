/// <reference lib="dom" />
import { describe, expect, it } from 'vitest'
import { bakeAnnotations } from '../src/bake.js'
import type { Annotation } from '../src/note-types.js'

interface RecordedCall {
  op: string
  args: unknown[]
}

interface MockCanvas extends HTMLCanvasElement {
  __calls: RecordedCall[]
}

function makeMockCanvas(): MockCanvas {
  const calls: RecordedCall[] = []
  const ctx = {
    lineWidth: 0,
    strokeStyle: '',
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    strokeRect: (...args: unknown[]) => calls.push({ op: 'strokeRect', args }),
    fillRect: (...args: unknown[]) => calls.push({ op: 'fillRect', args }),
    fillText: (...args: unknown[]) => calls.push({ op: 'fillText', args }),
    arc: (...args: unknown[]) => calls.push({ op: 'arc', args }),
    moveTo: (...args: unknown[]) => calls.push({ op: 'moveTo', args }),
    lineTo: (...args: unknown[]) => calls.push({ op: 'lineTo', args }),
    beginPath: () => calls.push({ op: 'beginPath', args: [] }),
    closePath: () => calls.push({ op: 'closePath', args: [] }),
    stroke: () => calls.push({ op: 'stroke', args: [] }),
    fill: () => calls.push({ op: 'fill', args: [] }),
    drawImage: (...args: unknown[]) => calls.push({ op: 'drawImage', args }),
    measureText: (text: string) => ({ width: text.length * 7 }),
  }
  const canvas = {
    width: 0,
    height: 0,
    __calls: calls,
    getContext: () => ctx,
    toDataURL: () => 'data:image/png;base64,MOCK',
  } as unknown as MockCanvas
  return canvas
}

const fakeImage = (w: number, h: number): { width: number; height: number } => ({
  width: w,
  height: h,
})

describe('bakeAnnotations', () => {
  it('issues strokeRect for a rect annotation at the right coords', async () => {
    const canvas = makeMockCanvas()
    const ann: Annotation[] = [{ type: 'rect', x: 10, y: 20, w: 100, h: 50 }]
    const result = await bakeAnnotations('AAA', ann, {
      createCanvas: () => canvas,
      loadImage: async () => fakeImage(800, 600),
    })
    expect(result).toBe('data:image/png;base64,MOCK')
    const strokes = canvas.__calls.filter((c) => c.op === 'strokeRect')
    expect(strokes).toHaveLength(1)
    expect(strokes[0]!.args).toEqual([10, 20, 100, 50])
  })

  it('sets canvas dimensions to the image size', async () => {
    const canvas = makeMockCanvas()
    await bakeAnnotations('AAA', [], {
      createCanvas: () => canvas,
      loadImage: async () => fakeImage(1024, 768),
    })
    expect(canvas.width).toBe(1024)
    expect(canvas.height).toBe(768)
  })

  it('draws a label fillRect+fillText when annotation carries a label', async () => {
    const canvas = makeMockCanvas()
    const ann: Annotation[] = [{ type: 'rect', x: 50, y: 60, w: 80, h: 40, label: 'edit' }]
    await bakeAnnotations('AAA', ann, {
      createCanvas: () => canvas,
      loadImage: async () => fakeImage(800, 600),
    })
    const fills = canvas.__calls.filter((c) => c.op === 'fillRect')
    const texts = canvas.__calls.filter((c) => c.op === 'fillText')
    expect(fills.length).toBeGreaterThanOrEqual(1)
    expect(texts.length).toBeGreaterThanOrEqual(1)
    expect(texts[0]!.args[0]).toBe('edit')
  })

  it('accepts a base64 string without the data: prefix', async () => {
    const canvas = makeMockCanvas()
    await bakeAnnotations('plainbase64', [], {
      createCanvas: () => canvas,
      loadImage: async () => fakeImage(50, 50),
    })
    // no exception
    expect(canvas.width).toBe(50)
  })

  // Finding 2 — annotation coords must map viewport→canvas on retina + scrolled
  // pages. jsdom's documentElement.clientWidth is 0, so `scale` falls back to
  // the supplied dpr; scrollX/scrollY shift the anchor into document space.
  it('scales + offsets rect coords by dpr and scroll', async () => {
    const canvas = makeMockCanvas()
    const ann: Annotation[] = [{ type: 'rect', x: 10, y: 20, w: 100, h: 50 }]
    await bakeAnnotations('AAA', ann, {
      createCanvas: () => canvas,
      loadImage: async () => fakeImage(1600, 1200),
      dpr: 2,
      scrollX: 100,
      scrollY: 50,
    })
    const strokes = canvas.__calls.filter((c) => c.op === 'strokeRect')
    expect(strokes).toHaveLength(1)
    // (x+scrollX)*scale, (y+scrollY)*scale, w*scale, h*scale
    expect(strokes[0]!.args).toEqual([(10 + 100) * 2, (20 + 50) * 2, 100 * 2, 50 * 2])
  })

  it('leaves coords untouched at dpr 1 with no scroll (default)', async () => {
    const canvas = makeMockCanvas()
    const ann: Annotation[] = [
      { type: 'element', selector: '#x', bbox: { x: 5, y: 6, w: 7, h: 8 } },
    ]
    await bakeAnnotations('AAA', ann, {
      createCanvas: () => canvas,
      loadImage: async () => fakeImage(800, 600),
    })
    const strokes = canvas.__calls.filter((c) => c.op === 'strokeRect')
    expect(strokes[0]!.args).toEqual([5, 6, 7, 8])
  })

  it('throws when the 2d context is unavailable', async () => {
    const broken = {
      width: 0,
      height: 0,
      getContext: () => null,
      toDataURL: () => 'data:,',
    } as unknown as HTMLCanvasElement
    await expect(
      bakeAnnotations('AAA', [], {
        createCanvas: () => broken,
        loadImage: async () => fakeImage(10, 10),
      }),
    ).rejects.toThrow(/2D canvas/)
  })
})
