import { describe, it, expect } from 'vitest'
import { transformSignalComponentSource } from '../../src/signals/transform-component.js'
import type { Diagnostic } from '../../src/diagnostic.js'
import type { LowerBail } from '../../src/signals/transform-view.js'

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

function diagsOf(source: string, fileName = 'src/app.ts'): { out: string; diags: Diagnostic[] } {
  const diags: Diagnostic[] = []
  const out = transformSignalComponentSource(source, {
    fileName,
    onPerfDiagnostic: (d) => diags.push(d),
  })
  return { out, diags }
}

describe('onPerfDiagnostic — verbatim each sites', () => {
  it('emits llui/each-verbatim for an each whose row cannot compile', () => {
    // an IMPERATIVE render body — neither the factory nor the render arm lowers
    const src = app(`each(state.at('todos'), {
      key: (t) => t.id,
      render: (item) => {
        const el = buildRow(item)
        attachThings(el)
        return [el]
      },
    })`)
    const { out, diags } = diagsOf(src)
    expect(out).toContain('each(') // stayed verbatim
    expect(diags.length).toBe(1)
    const d = diags[0]!
    expect(d.id).toBe('llui/each-verbatim')
    expect(d.category).toBe('perf')
    expect(d.severity).toBe('warning')
    expect(d.location.file).toBe('src/app.ts')
    expect(d.message).toContain('row-body-not-array')
    // position points at the each call site
    const line = src.split('\n')[d.location.range.start.line]!
    expect(line).toContain('each(')
  })

  it('emits NO diagnostic when a helper-call row lowers via the rowHandle prelude', () => {
    const { out, diags } = diagsOf(
      app(`each(state.at('todos'), {
      key: (t) => t.id,
      render: (item) => [li({}, [unknownHelper(item)])],
    })`),
    )
    expect(out).toContain("rowHandle(getCtx, 'item')")
    expect(diags).toEqual([])
  })

  it('emits NO diagnostic when the each lowers to the direct path', () => {
    const { out, diags } = diagsOf(
      app(`each(state.at('todos'), {
      key: (t) => t.id,
      render: (item) => [li({ class: 'row' }, [text(item.at('label'))])],
    })`),
    )
    expect(out).toContain('signalEachDirect(')
    expect(diags).toEqual([])
  })

  it('emits NO diagnostic when the each lowers via the render-callback path (signalEach)', () => {
    // spread prop bails the factory but the render arm still lowers
    const { out, diags } = diagsOf(
      app(`each(state.at('todos'), {
      key: (t) => t.id,
      render: (item) => [li({ ...parts.row }, [text(item.at('label'))])],
    })`),
    )
    expect(out).toContain('signalEach(')
    expect(diags).toEqual([])
  })

  it('covers a HELPER-scoped each (pass 2) that stays verbatim', () => {
    const src = [
      "import { ul, li, text, each } from '@llui/dom'",
      'export function rows(items, send) {',
      '  return [ul({}, [each(items, {',
      '    key: (r) => r.id,',
      '    render: (item) => { const el = buildRow(item); attach(el); return [el] },',
      '  })])]',
      '}',
    ].join('\n')
    const { diags } = diagsOf(src)
    expect(diags.length).toBe(1)
    expect(diags[0]!.id).toBe('llui/each-verbatim')
    expect(diags[0]!.message).toContain('row-body-not-array')
  })

  it('one diagnostic per site with deduped reasons (pass 1 + pass 2 both attempt)', () => {
    const src = app(`each(state.at('todos'), {
      key: (t) => t.id,
      render: (item) => {
        const x = somethingImperative()
        doSideEffect(x)
        return [li({}, [text('x')])]
      },
    })`)
    const { diags } = diagsOf(src)
    expect(diags.length).toBe(1)
    // both passes hit row-body-not-array; the message mentions it once
    const occurrences = diags[0]!.message.split('row-body-not-array').length - 1
    expect(occurrences).toBe(1)
  })

  it('forwards raw events to onLowerBail when both options are set', () => {
    const bails: LowerBail[] = []
    const diags: Diagnostic[] = []
    transformSignalComponentSource(
      app(`each(state.at('todos'), {
      key: (t) => t.id,
      render: (item) => { const el = buildRow(item); attach(el); return [el] },
    })`),
      { onLowerBail: (b) => bails.push(b), onPerfDiagnostic: (d) => diags.push(d) },
    )
    expect(bails.length).toBeGreaterThan(0)
    expect(diags.length).toBe(1)
  })

  it('ignores show/branch bails (verbatim show is cheap; only each pays per-row)', () => {
    const { diags } = diagsOf(app(`show(someCond, () => [div({}, [])])`))
    expect(diags).toEqual([])
  })
})
