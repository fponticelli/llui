import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  prebuildFixture,
  resolveServedFile,
  type PrebuiltFixture,
} from '../lib/prebuilt-fixture.mjs'

describe('prebuildFixture: build a browser-test fixture once, serve it static', () => {
  let root: string
  let fixture: PrebuiltFixture
  const options = (): Parameters<typeof prebuildFixture>[0] => ({
    root,
    inputs: ['index.html', 'pages/second.html'],
    alias: { 'aliased-dep': join(root, 'dep.js') },
    define: { __PROBE_FLAG__: 'true' },
  })

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'llui-prebuilt-test-'))
    mkdirSync(join(root, 'pages'))
    writeFileSync(
      join(root, 'index.html'),
      '<!doctype html><html><body><script type="module" src="./main.js"></script></body></html>',
    )
    writeFileSync(
      join(root, 'pages', 'second.html'),
      '<!doctype html><html><body><script type="module" src="../main.js"></script></body></html>',
    )
    writeFileSync(
      join(root, 'main.js'),
      "import { value } from 'aliased-dep'\nwindow.__probe = [value, __PROBE_FLAG__]\n",
    )
    writeFileSync(join(root, 'dep.js'), "export const value = 'from-alias'\n")
    fixture = await prebuildFixture(options())
  })

  afterAll(async () => {
    await fixture?.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('serves every input at the path it has under the root, bundled', async () => {
    for (const path of ['/', 'index.html', 'pages/second.html']) {
      const response = await fetch(fixture.url(path))
      expect(response.status, path).toBe(200)
      expect(response.headers.get('content-type'), path).toContain('text/html')
      const html = await response.text()
      const script = /<script type="module" crossorigin src="([^"]+)"/.exec(html)?.[1]
      expect(script, `${path} references a built module`).toMatch(/^\/assets\/.+\.js$/)
      const js = await (await fetch(fixture.url(script!))).text()
      // The alias resolved and the define was substituted at build time.
      expect(js).toContain('from-alias')
      expect(js).not.toContain('__PROBE_FLAG__')
      expect(js).not.toContain("from 'aliased-dep'")
    }
  })

  it('answers 404 for anything not in the build, including traversal out of it', async () => {
    expect((await fetch(fixture.url('missing.html'))).status).toBe(404)
    expect((await fetch(`${fixture.origin}/..%2f..%2fetc%2fpasswd`)).status).toBe(404)
  })

  it('resolves served paths strictly inside the build directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'llui-served-'))
    try {
      mkdirSync(join(dir, 'sub'))
      writeFileSync(join(dir, 'index.html'), '')
      writeFileSync(join(dir, 'sub', 'index.html'), '')
      expect(resolveServedFile(dir, '/')).toBe(join(dir, 'index.html'))
      expect(resolveServedFile(dir, '/sub')).toBe(join(dir, 'sub', 'index.html'))
      expect(resolveServedFile(dir, '/sub/?q=1')).toBe(join(dir, 'sub', 'index.html'))
      expect(resolveServedFile(dir, '/nope.js')).toBeNull()
      expect(resolveServedFile(dir, '/%2e%2e/secret')).toBeNull()
      expect(resolveServedFile(dir, '/%E0%A4%A')).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('builds a root reached through a symlink (macOS `/var` → `/private/var`)', async () => {
    // Vite resolves an HTML input to its REAL path and names the emitted page
    // relative to `root`. A symlinked root (the default macOS tmpdir) put the
    // page at `../../private/…`, which rolldown rejects. Pinned with an
    // explicit link so it fails on every platform, not only macOS.
    const linkDir = mkdtempSync(join(tmpdir(), 'llui-prebuilt-link-'))
    const linked = join(linkDir, 'root')
    symlinkSync(root, linked, 'dir')
    try {
      const other = await prebuildFixture({ ...options(), root: linked })
      try {
        expect((await fetch(other.url('pages/second.html'))).status).toBe(200)
      } finally {
        await other.close()
      }
    } finally {
      rmSync(linkDir, { recursive: true, force: true })
    }
  })

  it('deletes its build on close and stops serving', async () => {
    const other = await prebuildFixture(options())
    const served = await fetch(other.url('/'))
    expect(served.status).toBe(200)
    expect(existsSync(join(other.dir, 'index.html'))).toBe(true)
    // Built OUTSIDE the root, never into its `dist/` (which may be a real,
    // separately-built artifact another step serves).
    expect(other.dir.startsWith(root)).toBe(false)
    await other.close()
    await expect(fetch(other.url('/'))).rejects.toThrow()
    expect(existsSync(other.dir)).toBe(false)
  })
})
