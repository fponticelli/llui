import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../..')
const COMPONENTS = resolve(ROOT, 'packages/components')
const SOURCE = resolve(COMPONENTS, 'src/styles')
const PUBLISHED = resolve(COMPONENTS, 'dist/styles')
const OBSOLETE = resolve(PUBLISHED, 'obsolete-theme-module.css')
const COMPILED_ENTRY = resolve(PUBLISHED, 'compiled-entry.js')

const manifest = JSON.parse(readFileSync(resolve(COMPONENTS, 'package.json'), 'utf8')) as {
  exports: Record<string, unknown>
}

const declaredStyles = Object.entries(manifest.exports)
  .filter(
    ([key, target]) =>
      key.startsWith('./styles/') && typeof target === 'string' && target.endsWith('.css'),
  )
  .map(([key, target]) => {
    const file = key.slice('./styles/'.length)
    expect(target).toBe(`./dist/styles/${file}`)
    return file
  })
  .sort()

describe('component stylesheet publication', () => {
  it('replaces a stale dist/styles directory with exactly the declared CSS artifacts', () => {
    mkdirSync(PUBLISHED, { recursive: true })
    writeFileSync(OBSOLETE, 'obsolete')
    writeFileSync(COMPILED_ENTRY, 'compiled')

    try {
      execFileSync('pnpm', ['--filter', '@llui/components', 'run', 'publish:styles'], {
        cwd: ROOT,
        env: process.env,
        stdio: 'pipe',
      })

      const published = readdirSync(PUBLISHED)
        .filter((file) => file.endsWith('.css'))
        .sort()
      expect(published).toEqual(declaredStyles)
      expect(readFileSync(COMPILED_ENTRY, 'utf8')).toBe('compiled')
      for (const file of declaredStyles) {
        expect(readFileSync(resolve(PUBLISHED, file), 'utf8'), file).toBe(
          readFileSync(resolve(SOURCE, file), 'utf8'),
        )
      }
    } finally {
      rmSync(OBSOLETE, { force: true })
      rmSync(COMPILED_ENTRY, { force: true })
    }
  })

  it('scopes publisher cache invalidation to the components build', () => {
    const output = execFileSync(
      'pnpm',
      [
        'exec',
        'turbo',
        'run',
        'build',
        '--filter=@llui/components',
        '--filter=@llui/dom',
        '--dry=json',
      ],
      { cwd: ROOT, env: process.env, encoding: 'utf8' },
    )
    const jsonStart = output.indexOf('{')
    expect(jsonStart).toBeGreaterThanOrEqual(0)
    const dryRun = JSON.parse(output.slice(jsonStart)) as {
      tasks: Array<{
        taskId: string
        inputs: Record<string, string>
        resolvedTaskDefinition: { inputs: string[] }
      }>
    }
    const publisherInput = '../../scripts/publish-component-styles.mjs'
    const components = dryRun.tasks.find((task) => task.taskId === '@llui/components#build')
    expect(components, 'components build must be present in the Turbo dry run').toBeDefined()
    expect(components?.resolvedTaskDefinition.inputs).toContain(publisherInput)
    expect(Object.keys(components?.inputs ?? {})).toContain(publisherInput)

    const polluted = dryRun.tasks
      .filter((task) => task.taskId !== '@llui/components#build')
      .filter(
        (task) =>
          task.resolvedTaskDefinition.inputs.includes(publisherInput) ||
          Object.hasOwn(task.inputs, publisherInput),
      )
      .map((task) => task.taskId)
      .sort()
    expect(polluted, 'component publisher must not invalidate unrelated builds').toEqual([])
  })
})
