/**
 * Decode the PNGs Chromium's screenshots produce — 8-bit truecolour (RGB or
 * RGBA), non-interlaced — to RGBA pixels, in Node. The rendering fingerprint
 * hashes PIXELS, not the encoded file, and decoding in Node keeps megabytes
 * of base64 off the CDP channel (an in-page canvas decode made one
 * fingerprint cost ~3 s). Anything else is refused, never guessed at;
 * `rendering-fingerprint.browser.test.ts` checks this decoder against the
 * browser's own on real captures.
 */
import { inflateSync } from 'node:zlib'

export interface DecodedPng {
  readonly width: number
  readonly height: number
  /** Row-major RGBA, 4 bytes per pixel. */
  readonly rgba: Uint8Array
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function decodePng(png: Buffer): DecodedPng {
  if (png.length < 8 || !png.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('decodePng: not a PNG')
  }
  let width = 0
  let height = 0
  let channels = 0
  const data: Buffer[] = []
  for (let offset = 8; offset + 8 <= png.length; ) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('latin1', offset + 4, offset + 8)
    const body = png.subarray(offset + 8, offset + 8 + length)
    offset += 12 + length
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      const [depth, colour, compression, filter, interlace] = body.subarray(8, 13)
      channels = colour === 6 ? 4 : colour === 2 ? 3 : 0
      if (depth !== 8 || channels === 0 || compression !== 0 || filter !== 0 || interlace !== 0) {
        throw new Error(
          `decodePng: unsupported format (depth ${depth}, colour type ${colour}, interlace ${interlace})`,
        )
      }
    } else if (type === 'IDAT') {
      data.push(body)
    } else if (type === 'IEND') {
      break
    }
  }
  if (channels === 0) throw new Error('decodePng: no IHDR chunk')
  const raw = inflateSync(Buffer.concat(data))
  const stride = width * channels
  if (raw.length !== height * (stride + 1)) {
    throw new Error(`decodePng: ${raw.length} bytes of image data for ${width}x${height}`)
  }
  const pixels = new Uint8Array(height * stride)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const source = y * (stride + 1) + 1
    const row = y * stride
    for (let x = 0; x < stride; x += 1) {
      const value = raw[source + x]!
      const left = x >= channels ? pixels[row + x - channels]! : 0
      const up = y > 0 ? pixels[row - stride + x]! : 0
      const upLeft = y > 0 && x >= channels ? pixels[row - stride + x - channels]! : 0
      let predicted: number
      switch (filter) {
        case 0:
          predicted = 0
          break
        case 1:
          predicted = left
          break
        case 2:
          predicted = up
          break
        case 3:
          predicted = (left + up) >> 1
          break
        case 4: {
          const estimate = left + up - upLeft
          const toLeft = Math.abs(estimate - left)
          const toUp = Math.abs(estimate - up)
          const toUpLeft = Math.abs(estimate - upLeft)
          predicted = toLeft <= toUp && toLeft <= toUpLeft ? left : toUp <= toUpLeft ? up : upLeft
          break
        }
        default:
          throw new Error(`decodePng: unknown filter ${String(filter)} on row ${y}`)
      }
      pixels[row + x] = (value + predicted) & 0xff
    }
  }
  if (channels === 4) return { width, height, rgba: pixels }
  const rgba = new Uint8Array(width * height * 4)
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    rgba[pixel * 4] = pixels[pixel * 3]!
    rgba[pixel * 4 + 1] = pixels[pixel * 3 + 1]!
    rgba[pixel * 4 + 2] = pixels[pixel * 3 + 2]!
    rgba[pixel * 4 + 3] = 255
  }
  return { width, height, rgba }
}
