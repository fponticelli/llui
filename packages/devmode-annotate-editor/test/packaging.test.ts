import { describe, expect, it } from 'vitest'
import self from '../package.json'
import lexical from '../../lexical/package.json'
import markdownEditor from '../../markdown-editor/package.json'

const optionalPeers = (pkg: { peerDependenciesMeta?: Record<string, { optional?: boolean }> }) =>
  new Set(
    Object.entries(pkg.peerDependenciesMeta ?? {})
      .filter(([, meta]) => meta.optional === true)
      .map(([name]) => name),
  )

describe('packaging: the editor package owns the rich-editor dependency closure', () => {
  it('satisfies every required @llui/markdown-editor peer except shared @llui/dom', () => {
    const optional = optionalPeers(markdownEditor)
    const required = Object.keys(markdownEditor.peerDependencies)
      .filter((name) => name !== '@llui/dom' && !optional.has(name))
      .sort()

    expect(required.length).toBeGreaterThan(0)
    for (const peer of required) expect(self.dependencies).toHaveProperty(peer)
    expect(self.dependencies).not.toHaveProperty('@lexical/table')
  })

  it('also satisfies @llui/lexical peers that markdown-editor leaves to its consumer', () => {
    const required = Object.keys(lexical.peerDependencies).filter((name) => name !== '@llui/dom')
    expect(required).toContain('@lexical/history')
    for (const peer of required) expect(self.dependencies).toHaveProperty(peer)
  })

  it('shares both singleton-bearing packages with the host', () => {
    expect(self.peerDependencies).toMatchObject({
      '@llui/devmode-annotate': 'workspace:^',
      '@llui/dom': 'workspace:^',
    })
    expect(self.dependencies).not.toHaveProperty('@llui/devmode-annotate')
    expect(self.dependencies).not.toHaveProperty('@llui/dom')
    expect(self.devDependencies).toMatchObject({
      '@llui/devmode-annotate': 'workspace:*',
      '@llui/dom': 'workspace:*',
    })
  })

  it('marks the registration entry as a package side effect', () => {
    expect(self.sideEffects).toContain('./dist/index.js')
  })
})
