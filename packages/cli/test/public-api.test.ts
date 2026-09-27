import { describe, expect, it } from 'vitest'
import * as publicApi from '../src/index'

describe('@llui/cli public API', () => {
  it('publishes the product contract without exposing its test-only inventory assertion', () => {
    expect(publicApi).toHaveProperty('CopiedArtifactSchema')
    expect(publicApi).not.toHaveProperty('assertProductInventory')
  })

  it('publishes the @llui/* minimum-version check (#273)', () => {
    for (const name of [
      'VersionMismatchError',
      'assertDependencySpecs',
      'checkVersions',
      'compareVersions',
      'minimumOfRange',
      'parseDependencySpec',
    ]) {
      expect(publicApi).toHaveProperty(name)
    }
  })

  it('keeps the browser-only presentation protocol off the Node-backed root entry', () => {
    expect(publicApi).not.toHaveProperty('compileScenarioFamily')
    expect(publicApi).not.toHaveProperty('resolveScenarioSelection')
  })
})
