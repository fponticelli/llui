/**
 * Renderer-side fixtures shared by the baseline and registry specialized-tools
 * renderers (#266). Kept out of `specialized-tools-scenarios.ts` so the
 * protocol data stays free of anything URL-shaped: the SVG namespace below is
 * an identifier, not a network location, but the scenario module's
 * determinism guard rightly refuses every `//` in case data.
 *
 * Everything here is a pure function of its arguments — no clock, no random
 * value, no request — so both renderers draw byte-identical pictures.
 */
import { FILE_FIXTURES } from './specialized-tools-scenarios'

/** A deterministic, local picture to crop: a two-tone gradient with a grid. */
export function croppableImageSrc(width: number, height: number): string {
  const lines: string[] = []
  for (let x = 0; x <= width; x += 50) {
    lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}"/>`)
  }
  for (let y = 0; y <= height; y += 50) {
    lines.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}"/>`)
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#1e3a8a"/><stop offset="1" stop-color="#0f766e"/>' +
    '</linearGradient></defs>' +
    `<rect width="${width}" height="${height}" fill="url(#g)"/>` +
    `<g stroke="rgba(255,255,255,0.25)" stroke-width="1">${lines.join('')}</g>` +
    `<circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 5}" fill="#fbbf24"/>` +
    '</svg>'
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/** The `FileMeta` of a fixture file. `lastModified` is pinned to 0. */
export function fileMeta(id: string): {
  id: string
  name: string
  size: number
  type: string
  lastModified: number
} {
  const fixture = FILE_FIXTURES.find((candidate) => candidate.id === id)
  if (fixture === undefined) throw new Error(`Unknown file fixture ${id}`)
  return { ...fixture, lastModified: 0 }
}

/** Human-readable size, deterministic (no locale-dependent separators). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** SVG path data for one recorded signature stroke. */
export function strokePath(stroke: readonly { x: number; y: number }[]): string {
  return stroke.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ')
}

/** `mm:ss` for the timer, without the machine's own template helper. */
export function mmss(ms: number): string {
  const total = Math.floor(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/** Fixed tour geometry inside the renderer's contained frame (px). */
export const TOUR_TARGET_BOX = { left: 24, top: 24, width: 160, height: 40 } as const
export const TOUR_CARD_POSITION = { left: 24, top: 84 } as const
