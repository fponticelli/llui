import { describe, it, expect } from 'vitest'
import { lintIdiomatic } from '../../src/index'

describe('agent-nonextractable-handler', () => {
  it('emits 0 diagnostics for send({type: "x"}) — extractable', () => {
    const source = `
      const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: ({ send }) => [
          button({ onClick: () => send({ type: 'increment' }) }, []),
        ],
      })
    `
    const result = lintIdiomatic(source)
    const violations = result.violations.filter((v) => v.rule === 'agent-nonextractable-handler')
    expect(violations).toHaveLength(0)
  })

  it('emits 1 diagnostic for send({type: dynamicVar}) — non-literal type', () => {
    const source = `
      const nextStep = 'next'
      const C = component({
        name: 'C',
        init: () => [{ step: 0 }, []],
        update: (s, m) => [s, []],
        view: ({ send }) => [
          button({ onClick: () => send({ type: nextStep }) }, []),
        ],
      })
    `
    const result = lintIdiomatic(source)
    const violations = result.violations.filter((v) => v.rule === 'agent-nonextractable-handler')
    expect(violations).toHaveLength(1)
    expect(violations[0]!.message).toContain("list_actions won't advertise")
  })

  it('emits 1 diagnostic for send(nonObjectArg) — non-object argument', () => {
    const source = `
      const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: ({ send }) => [
          button({ onClick: () => send(computeMsg()) }, []),
        ],
      })
    `
    const result = lintIdiomatic(source)
    const violations = result.violations.filter((v) => v.rule === 'agent-nonextractable-handler')
    expect(violations).toHaveLength(1)
  })

  it('emits 0 diagnostics when there is no component() call in the file', () => {
    const source = `
      function helper(send) {
        send({ type: dynamicVar })
      }
    `
    const result = lintIdiomatic(source)
    const violations = result.violations.filter((v) => v.rule === 'agent-nonextractable-handler')
    expect(violations).toHaveLength(0)
  })

  it('detects non-extractable send() nested inside branch callback', () => {
    const source = `
      const C = component({
        name: 'C',
        init: () => [{ show: true }, []],
        update: (s, m) => [s, []],
        view: ({ send, branch }) => [
          ...branch({
            cases: [
              {
                when: (s) => s.show,
                then: () => [
                  button({ onClick: () => send(computedMsg) }, []),
                ],
              },
            ],
          }),
        ],
      })
    `
    const result = lintIdiomatic(source)
    const violations = result.violations.filter((v) => v.rule === 'agent-nonextractable-handler')
    expect(violations).toHaveLength(1)
  })

  it('detects non-extractable send() nested inside each render callback', () => {
    const source = `
      const C = component({
        name: 'C',
        init: () => [{ items: [] }, []],
        update: (s, m) => [s, []],
        view: ({ send, each }) => [
          ...each({
            items: (s) => s.items,
            key: (i) => i.id,
            render: ({ item }) => [
              button({ onClick: () => send({ type: dynamicType }) }, []),
            ],
          }),
        ],
      })
    `
    const result = lintIdiomatic(source)
    const violations = result.violations.filter((v) => v.rule === 'agent-nonextractable-handler')
    expect(violations).toHaveLength(1)
  })

  it('emits 1 diagnostic for send({}) — object with no type field', () => {
    const source = `
      const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: ({ send }) => [
          button({ onClick: () => send({ value: 42 }) }, []),
        ],
      })
    `
    const result = lintIdiomatic(source)
    const violations = result.violations.filter((v) => v.rule === 'agent-nonextractable-handler')
    expect(violations).toHaveLength(1)
  })

  it('emits 0 diagnostics for multiple extractable send() calls', () => {
    const source = `
      const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: ({ send }) => [
          button({ onClick: () => send({ type: 'inc' }) }, []),
          button({ onClick: () => send({ type: 'dec' }) }, []),
          button({ onClick: () => send({ type: 'reset' }) }, []),
        ],
      })
    `
    const result = lintIdiomatic(source)
    const violations = result.violations.filter((v) => v.rule === 'agent-nonextractable-handler')
    expect(violations).toHaveLength(0)
  })
})
