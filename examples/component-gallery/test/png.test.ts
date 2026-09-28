/**
 * The fingerprint's PNG decoder (`gates/png.ts`) on hand-encoded images: all
 * five row filters, both truecolour layouts, and the formats it must refuse.
 * The browser suite cross-checks it against Chromium's decoder on real
 * captures.
 */
import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { decodePng } from './gates/png'

function chunk(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(body.length)
  // The decoder does not verify CRCs (its input is Chromium's own output).
  return Buffer.concat([length, Buffer.from(type, 'latin1'), body, Buffer.alloc(4)])
}

function png(
  width: number,
  height: number,
  colour: 2 | 6,
  rows: readonly (readonly number[])[],
  interlace = 0,
): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, colour, 0, 0, interlace], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from(rows.flat()))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

describe('decodePng', () => {
  it('reverses every row filter of an RGB image into opaque RGBA', () => {
    // Pixels (RGB):  row 0 (10,20,30) (15,25,35)   — Sub
    //                row 1 (11,22,33) (16,27,38)   — Up
    //                row 2 (20,20,20) (30,30,30)   — Average
    //                row 3 (0,0,0)    (255,255,255) — Paeth
    const image = decodePng(
      png(2, 4, 2, [
        [1, 10, 20, 30, 5, 5, 5],
        [2, 1, 2, 3, 1, 2, 3],
        [3, 15, 9, 4, 12, 7, 1],
        [4, 236, 236, 236, 255, 255, 255],
      ]),
    )
    expect(image.width).toBe(2)
    expect(image.height).toBe(4)
    expect([...image.rgba]).toEqual([
      ...[10, 20, 30, 255, 15, 25, 35, 255],
      ...[11, 22, 33, 255, 16, 27, 38, 255],
      ...[20, 20, 20, 255, 30, 30, 30, 255],
      ...[0, 0, 0, 255, 255, 255, 255, 255],
    ])
  })

  it('keeps the alpha of an RGBA image', () => {
    expect([...decodePng(png(1, 1, 6, [[0, 1, 2, 3, 4]])).rgba]).toEqual([1, 2, 3, 4])
  })

  it('refuses what it does not decode instead of guessing', () => {
    expect(() => decodePng(Buffer.from('GIF89a'))).toThrow(/not a PNG/)
    expect(() => decodePng(png(1, 1, 6, [[0, 1, 2, 3, 4]], 1))).toThrow(/unsupported format/)
    expect(() => decodePng(png(1, 1, 6, [[5, 1, 2, 3, 4]]))).toThrow(/unknown filter 5/)
    expect(() => decodePng(png(2, 1, 6, [[0, 1, 2, 3, 4]]))).toThrow(/bytes of image data/)
  })
})
