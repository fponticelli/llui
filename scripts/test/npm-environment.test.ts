import { describe, expect, it } from 'vitest'

import { environmentForNpm } from '../lib/npm-environment'

describe('environmentForNpm', () => {
  it('removes pnpm-only npm_config values that npm warns about', () => {
    expect(
      environmentForNpm({
        PATH: '/bin',
        npm_config_registry: 'https://registry.example.test',
        npm_config_save_workspace_protocol: 'rolling',
        npm_config_verify_deps_before_run: 'false',
        npm_config_npm_globalconfig: '/tmp/pnpm-global',
        npm_config__jsr_registry: 'https://npm.jsr.io',
        npm_config__llui_registry: 'https://registry.npmjs.org',
        npm_config_frozen_lockfile: 'true',
        npm_config_link_workspace_packages: 'false',
      }),
    ).toEqual({
      BROWSERSLIST_IGNORE_OLD_DATA: '1',
      PATH: '/bin',
      npm_config_registry: 'https://registry.example.test',
      npm_config_userconfig: '/dev/null',
    })
  })

  it('accepts deliberately stale browser data in pinned benchmark dependencies', () => {
    expect(environmentForNpm({}).BROWSERSLIST_IGNORE_OLD_DATA).toBe('1')
  })
})
