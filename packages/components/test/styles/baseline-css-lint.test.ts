import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { lintSignalSource, parseModule } from '@llui/compiler'

/**
 * `examples/baseline-css` is the Tailwind-free Baseline consumer, and its build
 * runs NO Vite plugin — deliberately, so it stays a plain `theme.css` consumer.
 * That also means nothing compiles its view code through `@llui/compiler`, so
 * the framework's lint rules (build ERRORS everywhere the plugin runs) never
 * see it. Its app and every live-render fixture under `src/test-fixtures/` —
 * including the consumer compositions the Baseline live suites drive, moved
 * here from the retired components demo, whose plugin build used to lint them —
 * are view code, so they are linted here directly, the way
 * `specialized-tools-baseline-renderer.test.ts` lints the renderers.
 */

const repoRoot = resolve(import.meta.dirname, '../../../..')

/** Every tracked (or new, unignored) `.ts` source under the app's `src/`. */
function sources(): string[] {
  return execFileSync(
    'git',
    [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      'examples/baseline-css/src',
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  )
    .split('\0')
    .filter((file) => file.endsWith('.ts'))
    .sort()
}

describe('examples/baseline-css view code passes the framework lint rules', () => {
  const files = sources()

  it('enumerates exactly the app and its fixtures', () => {
    // EXACT set: a floor could not tell a fixture that escaped the sweep from
    // one that was never there.
    expect(files).toEqual(
      [
        'examples/baseline-css/src/main.ts',
        'examples/baseline-css/src/test-fixtures/compositions.ts',
        'examples/baseline-css/src/test-fixtures/compositions/menus.ts',
        'examples/baseline-css/src/test-fixtures/compositions/navigation-data.ts',
        'examples/baseline-css/src/test-fixtures/compositions/toast.ts',
        'examples/baseline-css/src/test-fixtures/forced-colors-chart.ts',
        'examples/baseline-css/src/test-fixtures/menus-overlays-live-render.ts',
        'examples/baseline-css/src/test-fixtures/navigation-data-live-render.ts',
        'examples/baseline-css/src/test-fixtures/specialized-tools-live-render.ts',
      ].sort(),
    )
  })

  it.each(files)('%s reports no signal lint diagnostics', (file) => {
    const parsed = parseModule(file, readFileSync(resolve(repoRoot, file), 'utf8'))
    const messages = lintSignalSource(parsed).map(
      (message) => `${message.rule} ${message.line}:${message.column} ${message.message}`,
    )
    expect(messages).toEqual([])
  })
})
