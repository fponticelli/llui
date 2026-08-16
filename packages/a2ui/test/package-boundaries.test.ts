import { describe, expect, it } from 'vitest'
import packageJson from '../package.json'

describe('@llui/a2ui package boundaries', () => {
  it('shares the interactions singleton with the host application', () => {
    expect(packageJson.peerDependencies).toMatchObject({
      '@llui/interactions': 'workspace:^',
    })
    expect(packageJson.devDependencies).toMatchObject({
      '@llui/interactions': 'workspace:*',
    })
    expect(packageJson.dependencies).not.toHaveProperty('@llui/interactions')
  })
})
