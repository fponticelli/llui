/// <reference lib="dom" />
import { describe, expect, it } from 'vitest'
import { bakeAnnotations } from '../src/bake.js'
import type { Annotation } from '@llui/vite-plugin'

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

  it('draws a polyline for a lasso annotation', async () => {
    const canvas = makeMockCanvas()
    const ann: Annotation[] = [
      {
        type: 'lasso',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
        ],
      },
    ]
    await bakeAnnotations('AAA', ann, {
      createCanvas: () => canvas,
      loadImage: async () => fakeImage(800, 600),
    })
    const moves = canvas.__calls.filter((c) => c.op === 'moveTo')
    const lines = canvas.__calls.filter((c) => c.op === 'lineTo')
    expect(moves[0]!.args).toEqual([0, 0])
    expect(lines).toHaveLength(2)
  })

  it('draws an arc + index text for a pin annotation', async () => {
    const canvas = makeMockCanvas()
    const ann: Annotation[] = [{ type: 'pin', at: { x: 50, y: 50 }, index: 3, label: 'note' }]
    await bakeAnnotations('AAA', ann, {
      createCanvas: () => canvas,
      loadImage: async () => fakeImage(200, 200),
    })
    const arcs = canvas.__calls.filter((c) => c.op === 'arc')
    expect(arcs).toHaveLength(1)
    expect(arcs[0]!.args[0]).toBe(50)
    expect(arcs[0]!.args[1]).toBe(50)
    const texts = canvas.__calls.filter((c) => c.op === 'fillText')
    expect(texts.some((t) => t.args[0] === '3')).toBe(true)
  })

  it('skips highlight annotations (semantic; resolved before baking)', async () => {
    const canvas = makeMockCanvas()
    const ann: Annotation[] = [{ type: 'highlight', selector: '#x' }]
    await bakeAnnotations('AAA', ann, {
      createCanvas: () => canvas,
      loadImage: async () => fakeImage(100, 100),
    })
    const strokes = canvas.__calls.filter((c) => c.op === 'strokeRect')
    expect(strokes).toHaveLength(0)
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
