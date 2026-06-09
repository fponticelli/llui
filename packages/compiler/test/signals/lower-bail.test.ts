import { describe, it, expect } from 'vitest'
import { transformSignalComponentSource } from '../../src/signals/transform-component.js'
import type { LowerBail } from '../../src/signals/transform-view.js'

/** Wrap a view-body fragment in a minimal signal component so pass 1 lowers it. */
function app(viewBody: string, topLevel = ''): string {
  return `
${topLevel}
const App = component({
  name: 'app',
  init: () => [{ todos: [], user: { name: 'x' } }, []],
  update: (s) => [s, []],
  view: ({ state, send }) => [
    ${viewBody}
  ],
})
`
}

function bailsOf(source: string): { out: string; bails: LowerBail[] } {
  const bails: LowerBail[] = []
  const out = transformSignalComponentSource(source, { onLowerBail: (b) => bails.push(b) })
  return { out, bails }
}

const reasons = (bails: LowerBail[], kind?: LowerBail['kind']): string[] =>
  bails.filter((b) => !kind || b.kind === kind).map((b) => b.reason)

describe('onLowerBail — row-factory bail reasons', () => {
  it('signal-handle row local bails the factory with row-local-signal-alias', () => {
    const { out, bails } = bailsOf(
      app(`each(state.at('todos'), {
        key: (t) => t.id,
        render: (item) => {
          const done = item.at('done')
          return [li({}, [text(done)])]
        },
      })`),
    )
    expect(reasons(bails, 'each-direct')).toContain('row-local-signal-alias')
    // block-body render also can't lower as a render arm
    expect(reasons(bails, 'each-render')).toContain('arm-not-concise-array')
    expect(out).toContain('each(') // stays verbatim
  })

  it('spread prop bails with row-prop-spread-or-shorthand', () => {
    const { bails } = bailsOf(
      app(`each(state.at('todos'), {
        key: (t) => t.id,
        render: (item) => [li({ ...parts.row }, [text(item.at('label'))])],
      })`),
    )
    expect(reasons(bails, 'each-direct')).toContain('row-prop-spread-or-shorthand')
  })

  it('non-inline handler (tagSend) bails with row-handler-not-inline-fn', () => {
    const { bails } = bailsOf(
      app(`each(state.at('todos'), {
        key: (t) => t.id,
        render: (item) => [li({ onClick: tagSend('toggle', item) }, [text(item.at('label'))])],
      })`),
    )
    expect(reasons(bails, 'each-direct')).toContain('row-handler-not-inline-fn')
  })

  it('unknown helper call as row child bails with row-child-unsupported', () => {
    const { bails } = bailsOf(
      app(`each(state.at('todos'), {
        key: (t) => t.id,
        render: (item) => [li({}, [pill(item)])],
      })`),
    )
    expect(reasons(bails, 'each-direct')).toContain('row-child-unsupported')
  })

  it('clean row lowers with no bail events', () => {
    const { out, bails } = bailsOf(
      app(`each(state.at('todos'), {
        key: (t) => t.id,
        render: (item) => [li({ class: 'row' }, [text(item.at('label'))])],
      })`),
    )
    expect(out).toContain('signalEachDirect(')
    expect(bails).toEqual([])
  })
})

describe('onLowerBail — helper-row inlining', () => {
  it('delegation to a same-file helper returning an ARRAY now inlines (no bail)', () => {
    const { out, bails } = bailsOf(
      app(
        `each(state.at('todos'), {
        key: (t) => t.id,
        render: (item) => [rowHelper(item)],
      })`,
        `function rowHelper(item) { return [li({}, [text(item.at('label'))]), li({}, [text('x')])] }`,
      ),
    )
    expect(out).toContain('signalEachDirect(')
    expect(bails).toEqual([])
  })

  it('delegation with leading render decls now inlines (no bail)', () => {
    const { out, bails } = bailsOf(
      app(
        `each(state.at('todos'), {
        key: (t) => t.id,
        render: (item) => {
          const label = item.at('label').peek()
          return [rowHelper(label)]
        },
      })`,
        `function rowHelper(label) { return li({}, [text(label)]) }`,
      ),
    )
    expect(out).toContain('signalEachDirect(')
    expect(bails).toEqual([])
  })

  it('a render decl whose name the helper body also uses reports decl-capture-risk', () => {
    const { out, bails } = bailsOf(
      app(
        `each(state.at('todos'), {
        key: (t) => t.id,
        render: (item) => {
          const label = item.at('label').peek()
          return [rowHelper(label)]
        },
      })`,
        // `label` inside the helper refers to ITS module scope (the const below) —
        // inlining the render's `label` decl above it would capture it. Must bail.
        `const label = 'module-scope'
function rowHelper(txt) { return li({}, [text(txt + label)]) }`,
      ),
    )
    expect(reasons(bails, 'inline-helper')).toContain('decl-capture-risk')
    expect(out).not.toContain('signalEachDirect(')
  })

  it('a BARE-call delegation `(item) => helper(item)` inlines (no array wrap needed)', () => {
    const { out, bails } = bailsOf(
      app(
        `each(state.at('todos'), {
        key: (t) => t.id,
        render: (item) => rowHelper(item),
      })`,
        `function rowHelper(item) { return [li({}, [text(item.at('label'))])] }`,
      ),
    )
    expect(out).toContain('signalEachDirect(')
    expect(bails).toEqual([])
  })
})

describe('onLowerBail — show/branch arms', () => {
  it('show arm leaking the narrowed param reports arm-param-leak', () => {
    const { bails } = bailsOf(app(`show(state.at('user'), (u) => [profileCard(u)])`))
    expect(reasons(bails, 'show')).toContain('arm-param-leak:u')
  })

  it('show with non-rooted condition reports cond-not-rooted-signal', () => {
    const { bails } = bailsOf(app(`show(someCond, () => [div({}, [])])`))
    expect(reasons(bails, 'show')).toContain('cond-not-rooted-signal')
  })
})

describe('onLowerBail — hook lifecycle', () => {
  it('events carry a position inside the source', () => {
    const src = app(`show(state.at('user'), (u) => [profileCard(u)])`)
    const { bails } = bailsOf(src)
    expect(bails.length).toBeGreaterThan(0)
    for (const b of bails) {
      expect(b.pos).toBeGreaterThanOrEqual(0)
      expect(b.pos).toBeLessThan(src.length)
    }
  })

  it('the hook does not leak into a later transform without the option', () => {
    const src = app(`show(state.at('user'), (u) => [profileCard(u)])`)
    const bails: LowerBail[] = []
    transformSignalComponentSource(src, { onLowerBail: (b) => bails.push(b) })
    const seen = bails.length
    transformSignalComponentSource(src) // no hook — must not report into `bails`
    expect(bails.length).toBe(seen)
  })
})
