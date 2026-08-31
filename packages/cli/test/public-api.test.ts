import { describe, expect, it } from 'vitest'
import * as publicApi from '../src/index'

describe('@llui/cli public API', () => {
  it('publishes the product contract without exposing its test-only inventory assertion', () => {
    expect(publicApi).toHaveProperty('CopiedArtifactSchema')
    expect(publicApi).not.toHaveProperty('assertProductInventory')
  })
})
