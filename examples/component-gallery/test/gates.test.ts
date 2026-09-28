/**
 * The #268 gate INSTRUMENTS, checked against known-good and known-bad
 * inputs before their verdicts are trusted (a probe that reports nothing on
 * a broken document is the failure mode this repository keeps meeting —
 * docs/agents/styling.md). The browser suites use exactly these functions.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { PRESENTATION_SCENARIO_PATHS } from '@llui/cli/presentation-scenarios'
import { applyExemptions, measuredContrast, type A11yExemption } from './gates/a11y-exemptions'
import type { AxeFinding } from './gates/axe'
import { probeMarkup } from './gates/markup-probe'
import {
  auditCases,
  caseKey,
  caseTitle,
  documentHref,
  notRenderedPaths,
  renderedCases,
  visualCases,
  withOverrides,
} from './gates/matrix'
import { GALLERY_CONTRACT } from '../src/shared/contract'
import { GALLERY_CATALOGS, isVisuallyAvailable } from '../src/shared/catalogs'

afterEach(() => document.body.replaceChildren())

const markup = (html: string) => {
  document.body.innerHTML = html
  return probeMarkup().findings
}

describe('probeMarkup', () => {
  it('is quiet on sound markup and judges what it sees', () => {
    expect(
      markup(
        '<label for="a">A</label><input id="a" aria-describedby="h"><p id="h">help</p>' +
          '<ul><li>one</li></ul><table><tbody><tr><td>x</td></tr></tbody></table>',
      ),
    ).toEqual([])
    const report = probeMarkup()
    expect(report.elements).toBeGreaterThan(5)
    expect(report.idrefs).toBe(2)
  })

  it('reports duplicate ids', () => {
    expect(markup('<div id="x"></div><span id="x"></span>')).toEqual([
      'duplicate-id: "x" is carried by 2 elements',
    ])
  })

  it('reports broken and empty idrefs, per token', () => {
    expect(markup('<div id="a" aria-labelledby="a missing"></div>')).toEqual([
      'broken-idref: div#a aria-labelledby="a missing" names no element with id "missing"',
    ])
    expect(markup('<input aria-describedby=" ">')).toEqual([
      'empty-idref: input has an empty aria-describedby',
    ])
    expect(markup('<label for="nope">x</label>')).toEqual([
      'broken-idref: label for="nope" names no element with id "nope"',
    ])
  })

  it('lets a COLLAPSED control name an unmounted popup, and nothing else', () => {
    expect(markup('<button aria-expanded="false" aria-controls="menu">m</button>')).toEqual([])
    expect(markup('<button aria-expanded="true" aria-controls="menu">m</button>')).toEqual([
      'broken-idref: button aria-controls="menu" names no element with id "menu"',
    ])
    expect(markup('<button aria-expanded="false" aria-labelledby="gone">m</button>')).toEqual([
      'broken-idref: button aria-labelledby="gone" names no element with id "gone"',
    ])
  })

  it('reports content-model violations the parser would have repaired', () => {
    expect(markup('<button><a href="#">x</a></button>')).toEqual([
      'invalid-nesting: a is interactive content inside button',
    ])
    expect(markup('<ul><div>x</div></ul>')).toEqual([
      'invalid-nesting: div is a direct child of ul',
    ])
    expect(markup('<div><li>x</li></div>')).toEqual([
      'invalid-nesting: li is a child of div, not ul/ol/menu',
    ])
    const p = document.createElement('p')
    p.append(document.createElement('div'))
    document.body.replaceChildren(p)
    expect(probeMarkup().findings).toEqual(['invalid-nesting: div is flow content inside p'])
    const detached = document.createElement('div')
    detached.append(document.createElement('tbody'))
    document.body.replaceChildren(detached)
    expect(probeMarkup().findings).toEqual(['invalid-nesting: tbody is outside a table'])
  })
})

const finding = (rule: string, target: string, summary = ''): AxeFinding => ({
  rule,
  impact: 'serious',
  help: '',
  target,
  summary,
})

describe('applyExemptions', () => {
  const galleryCase = renderedCases().find(
    ({ entry, path }) => entry === 'avatar' && path === 'baseline',
  )!
  const key = caseKey(galleryCase)
  const entry = (overrides: Partial<A11yExemption> = {}): Record<string, A11yExemption[]> => ({
    [key]: [{ rule: 'color-contrast', target: 'span', atLeast: 4.3, reason: 'r', ...overrides }],
  })
  const contrast = (ratio: number) =>
    finding('color-contrast', 'span', `Element has insufficient color contrast of ${ratio} (…)`)

  it('reads axe’s measured ratio', () => {
    expect(measuredContrast(contrast(4.34))).toBe(4.34)
    expect(measuredContrast(finding('label', 'x'))).toBeUndefined()
  })

  it('excuses exactly the keyed rule, target and floor', () => {
    expect(applyExemptions(galleryCase, [contrast(4.34)], entry())).toEqual({
      remaining: [],
      obsolete: [],
    })
    // Below the measured floor: reported, and the entry is obsolete.
    expect(applyExemptions(galleryCase, [contrast(3.1)], entry()).remaining).toHaveLength(1)
    // Another rule on the same node is not excused.
    expect(
      applyExemptions(galleryCase, [contrast(4.34), finding('label', 'span')], entry()).remaining,
    ).toEqual([finding('label', 'span')])
    // Another node is not excused.
    expect(
      applyExemptions(
        galleryCase,
        [finding('color-contrast', 'div', contrast(4.4).summary)],
        entry(),
      ).remaining,
    ).toHaveLength(1)
  })

  it('never applies to another case', () => {
    const other = renderedCases().find(
      ({ entry: name, path }) => name === 'avatar' && path === 'registryTailwind',
    )!
    expect(applyExemptions(other, [contrast(4.34)], entry()).remaining).toHaveLength(1)
  })

  it('reports an exemption whose finding no longer occurs as obsolete', () => {
    expect(applyExemptions(galleryCase, [], entry()).obsolete).toEqual([
      `color-contrast @ ${key} (span)`,
    ])
  })
})

describe('the gate matrix', () => {
  const visual = isVisuallyAvailable

  it('is the contract’s rendered set, exactly', () => {
    const expected = GALLERY_CONTRACT.entries.flatMap((entry) =>
      PRESENTATION_SCENARIO_PATHS.filter((path) => visual(entry.presentation[path].mode)).flatMap(
        (path) =>
          GALLERY_CATALOGS.flatMap(({ scenarios }) => scenarios)
            .find(({ productId }) => productId === entry.name)!
            .cases.map(({ id }) => `${entry.name}/${path}/${id}`),
      ),
    )
    const rendered = renderedCases().map(({ entry, path, caseId }) => `${entry}/${path}/${caseId}`)
    expect(rendered.sort()).toEqual(expected.sort())
    expect(new Set(rendered).size).toBe(rendered.length)
  })

  it('names every case by entry › path › case › environment', () => {
    const first = renderedCases().find(({ entry }) => entry === 'accordion')!
    expect(caseTitle(first)).toBe(
      `accordion › ${first.path === 'baseline' ? 'baseline' : 'registry'} › ${first.caseId} › light ltr motion-full wide`,
    )
    const dark = withOverrides(renderedCases().find(({ axes }) => axes.includes('theme'))!, {
      theme: 'dark',
    })
    expect(caseTitle(dark)).toContain('› dark ltr')
    expect(caseKey(dark).endsWith('/theme-dark')).toBe(true)
    expect(documentHref(dark)).toMatch(/theme=dark/)
  })

  it('refuses to vary an axis a case does not declare', () => {
    const fixed = renderedCases().find(({ axes }) => !axes.includes('viewport'))!
    expect(() => withOverrides(fixed, { viewport: 'narrow' })).toThrow(/does not declare/)
  })

  it('audits every case, plus dark where declared', () => {
    const rendered = renderedCases()
    expect(auditCases()).toHaveLength(
      rendered.length + rendered.filter(({ axes }) => axes.includes('theme')).length,
    )
  })

  it('pins every case at the default and each declared axis on one representative', () => {
    const cases = visualCases()
    const keys = cases.map(caseKey)
    expect(new Set(keys).size).toBe(keys.length)
    const variants = cases.filter(({ overrides }) => Object.keys(overrides).length > 0)
    for (const variant of variants) expect(Object.keys(variant.overrides)).toHaveLength(1)
    // Every (entry, path) that declares an axis anywhere gets exactly one variant of it.
    const owners = new Set(renderedCases().map(({ entry, path }) => `${entry}/${path}`))
    for (const owner of owners) {
      for (const axis of ['theme', 'direction', 'motion', 'viewport'] as const) {
        const declares = renderedCases().some(
          ({ entry, path, axes }) => `${entry}/${path}` === owner && axes.includes(axis),
        )
        const pinned = variants.filter(
          ({ entry, path, overrides }) => `${entry}/${path}` === owner && axis in overrides,
        )
        expect(pinned.length, `${owner} ${axis}`).toBe(declares ? 1 : 0)
      }
    }
  })

  it('states a reason for every path that draws nothing', () => {
    const none = notRenderedPaths()
    expect(none.length).toBeGreaterThan(20)
    for (const { entry, path, coverage } of none) {
      expect(coverage.rationale.trim(), `${entry} on ${path}`).not.toBe('')
    }
  })
})
