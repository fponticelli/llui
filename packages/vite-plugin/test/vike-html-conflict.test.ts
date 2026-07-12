// Regression: the dev HUD must NOT inject into `transformIndexHtml` when Vike is
// present. Vike probes the hook with a fixed fake document and asserts the result
// still starts with `<html> <head>` and ends with `</head><body></body></html>`
// (see vike getViteDevScript); a body-injected HUD <script> breaks that and throws
// "[Wrong Usage] You are using a Vite Plugin that transforms the HTML ...".
// (The vike-layout example crashed on every request.)

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import llui from '../src/index'

// Vike's exact probe document (getViteDevScript.js).
const FAKE_BEGIN = '<html> <head>'
const FAKE_END = '</head><body></body></html>'
const FAKE_HTML = FAKE_BEGIN + FAKE_END

interface FakeConfig {
  root: string
  command: string
  plugins: { name: string }[]
}

// A Vite plugin hook is either a bare function or `{ handler, order }`. Extract
// the callable in either form, typed loosely for the test harness.
function asHandler(hook: unknown): ((...args: unknown[]) => unknown) | undefined {
  if (typeof hook === 'function') return hook as (...args: unknown[]) => unknown
  if (hook && typeof (hook as { handler?: unknown }).handler === 'function') {
    return (hook as { handler: (...args: unknown[]) => unknown }).handler
  }
  return undefined
}

function invokeConfigResolved(plugin: Plugin, config: FakeConfig): void {
  asHandler(plugin.configResolved)?.(config)
}

// Apply the plugin's transformIndexHtml hook to `html` the way Vike's probe does
// (no other plugins / Vite client injection involved — we only assert OUR hook
// doesn't mutate the document).
function applyTransform(plugin: Plugin, html: string): string {
  const out = asHandler(plugin.transformIndexHtml)?.(html, { path: '/', filename: 'index.html' })
  if (out == null) return html
  if (typeof out === 'string') return out
  // tag-descriptor array — Vite would inject these; for the test, presence of any
  // tag means the document WOULD be mutated, which is exactly the conflict.
  if (Array.isArray(out) && out.length > 0) return html + '<!--INJECTED-->'
  return html
}

let tmpRoot: string

// The HUD is a consumer-provided package now (`@llui/vite-plugin` no longer
// depends on it), resolved from the consumer's own `node_modules`. Provision
// a minimal fake so HUD injection is reachable — that way each test isolates
// its intended variable (Vike presence), not whether the HUD is installed.
function provisionDevmodeAnnotate(root: string): void {
  const pkgDir = resolve(root, 'node_modules', '@llui', 'devmode-annotate')
  mkdirSync(resolve(pkgDir, 'dist'), { recursive: true })
  writeFileSync(
    resolve(pkgDir, 'package.json'),
    JSON.stringify({
      name: '@llui/devmode-annotate',
      exports: { '.': { import: './dist/index.js' } },
    }),
  )
  writeFileSync(resolve(pkgDir, 'dist', 'index.js'), 'export function mountAnnotateHud() {}\n')
}

beforeEach(() => {
  tmpRoot = mkdtempSync(resolve(tmpdir(), 'llui-vike-html-'))
  writeFileSync(resolve(tmpRoot, 'package.json'), JSON.stringify({ name: 'test' }))
  mkdirSync(resolve(tmpRoot, 'node_modules'), { recursive: true })
  provisionDevmodeAnnotate(tmpRoot)
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('dev HUD vs Vike HTML pipeline', () => {
  it('does NOT transform the HTML when a Vike plugin is present', () => {
    const plugin = llui()
    invokeConfigResolved(plugin, {
      root: tmpRoot,
      command: 'serve',
      plugins: [{ name: 'vike:devConfig' }, { name: 'vike:commonConfig' }],
    })
    const out = applyTransform(plugin, FAKE_HTML)
    // Vike's exact round-trip assertion must hold.
    expect(out.startsWith(FAKE_BEGIN)).toBe(true)
    expect(out.endsWith(FAKE_END)).toBe(true)
    expect(out).toBe(FAKE_HTML)
  })

  it('DOES inject the HUD when Vike is absent (default index.html flow)', () => {
    const plugin = llui()
    invokeConfigResolved(plugin, { root: tmpRoot, command: 'serve', plugins: [] })
    const out = applyTransform(plugin, FAKE_HTML)
    // Standard apps get the HUD script injected — the document changes.
    expect(out).not.toBe(FAKE_HTML)
  })
})
