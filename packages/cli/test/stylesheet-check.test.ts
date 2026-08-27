import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { baselineWarning, findBaselineImports, hasTokensImport } from '../src/stylesheet-check'

/**
 * The collision this guards is silent by construction — both stylesheets are
 * valid and present, and layer precedence (which ignores specificity) hands the
 * win to the unlayered one. A consumer cannot out-write it; they have to know.
 * So the check exists to say so at the two moments a project's styling is being
 * set up, `llui init` and `llui add`.
 */
async function project(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'llui-css-'))
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel)
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, body)
  }
  return dir
}

describe('baseline stylesheet detection', () => {
  it('finds the baseline import', async () => {
    const dir = await project({
      'src/main.css': "@import 'tailwindcss';\n@import '@llui/components/styles/theme.css';\n",
    })
    try {
      expect(await findBaselineImports(dir)).toEqual(['src/main.css'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('says nothing about a project on the registry path', async () => {
    const dir = await project({
      'src/main.css':
        "@import 'tailwindcss';\n@import '@llui/components/styles/tokens.css';\n" +
        "@import '@llui/components/styles/tokens-dark.css';\n",
    })
    try {
      expect(await findBaselineImports(dir)).toEqual([])
      expect(await hasTokensImport(dir)).toBe(true)
      expect(baselineWarning([])).toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('does not mistake tokens-dark for the baseline', async () => {
    // `tokens-dark.css` and `theme-dark.css` differ by four characters, and
    // matching the wrong one would warn every correctly-configured project —
    // a check that cries wolf gets ignored, which is worse than no check.
    const dir = await project({
      'src/a.css': "@import '@llui/components/styles/tokens-dark.css';\n",
    })
    try {
      expect(await findBaselineImports(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('finds theme-dark.css too', async () => {
    const dir = await project({ 'app.css': "@import '@llui/components/styles/theme-dark.css';\n" })
    try {
      expect(await findBaselineImports(dir)).toEqual(['app.css'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('skips node_modules', async () => {
    // The baseline is imported by other packages' own CSS; walking into
    // node_modules would warn about a dependency's choice, not the app's.
    const dir = await project({
      'node_modules/x/y.css': "@import '@llui/components/styles/theme.css';\n",
      'src/main.css': "@import '@llui/components/styles/tokens.css';\n",
    })
    try {
      expect(await findBaselineImports(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('the warning names the file and both escape routes', async () => {
    const w = baselineWarning(['src/main.css'])
    expect(w).toContain('src/main.css')
    expect(w).toContain('tokens.css')
    expect(w).toContain('llui add')
  })
})
