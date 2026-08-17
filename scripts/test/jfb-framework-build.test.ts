import { describe, expect, it } from 'vitest'

import {
  jfbFrameworkBuildPlan,
  localScriptSources,
  patchJfbElmBuildManifest,
} from '../lib/jfb-framework-build'

describe('JFB competitor build preflight', () => {
  it('builds every selected competitor from its lockfile and skips LLui', () => {
    expect(
      jfbFrameworkBuildPlan('/cache/jfb/repository', [
        'keyed/llui',
        'keyed/vanillajs',
        'keyed/solid',
      ]),
    ).toEqual([
      {
        framework: 'keyed/vanillajs',
        directory: '/cache/jfb/repository/frameworks/keyed/vanillajs',
        installArgs: ['ci', '--no-audit', '--no-fund'],
        buildArgs: ['run', 'build-prod'],
      },
      {
        framework: 'keyed/solid',
        directory: '/cache/jfb/repository/frameworks/keyed/solid',
        installArgs: ['ci', '--no-audit', '--no-fund'],
        buildArgs: ['run', 'build-prod'],
      },
    ])
  })

  it('rejects framework values that can escape the pinned checkout', () => {
    expect(() => jfbFrameworkBuildPlan('/cache/jfb/repository', ['keyed/../../outside'])).toThrow(
      'invalid keyed JFB framework',
    )
  })

  it('finds only relative script entrypoints that the production build must create', () => {
    expect(
      localScriptSources(`
        <script src="dist/main.js"></script>
        <script src='src/bootstrap.js?version=1'></script>
        <script src="/shared.js"></script>
        <script src="https://example.test/remote.js"></script>
      `),
    ).toEqual(['dist/main.js', 'src/bootstrap.js'])
  })

  it('removes the undeclared elm-tooling bootstrap from the pinned Elm build', () => {
    const source = JSON.stringify({
      scripts: {
        'build-prod':
          'elm-tooling install && elm make src/Main.elm --optimize --output=dist/main.js',
      },
      devDependencies: { elm: '0.19.1-6' },
    })

    const patched = patchJfbElmBuildManifest(source)

    expect(JSON.parse(patched)).toEqual({
      scripts: {
        'build-prod': 'elm make src/Main.elm --optimize --output=dist/main.js',
      },
      devDependencies: { elm: '0.19.1-6' },
      allowScripts: { 'elm@0.19.1-6': true },
    })
    expect(patchJfbElmBuildManifest(patched)).toBe(patched)
  })

  it('rejects an unexpected pinned Elm manifest instead of guessing', () => {
    expect(() =>
      patchJfbElmBuildManifest(
        JSON.stringify({
          scripts: { 'build-prod': 'custom-build-command' },
          devDependencies: { elm: '0.19.1-6' },
        }),
      ),
    ).toThrow('unexpected pinned JFB Elm build-prod script')
  })
})
