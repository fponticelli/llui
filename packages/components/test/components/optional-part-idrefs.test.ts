/**
 * No part bag may name an element the consumer was allowed not to render (#268's
 * `dialog` `hasDescription` rule, generalised). An idref that points at an OPTIONAL
 * part — one whose absence leaves the widget conformant: a description, an
 * instruction, a group's label, an unlabelled `role="group"` — is emitted only when
 * an explicit option says that part is rendered. The default is ON everywhere, so
 * today's wiring (and every skin that renders the part) is unchanged; opting out is
 * a deliberate, visible choice.
 *
 * A part that supplies something ARIA REQUIRES (the name of a `role="dialog"` or
 * `role="img"`, the reason for an invalid state) is not optional and has no such
 * option; see the audit in the `loose-e2` report / each module's docs.
 */
import { describe, expect, it } from 'vitest'
import * as chart from '../../src/components/chart'
import * as sparkline from '../../src/components/sparkline'
import * as pinInput from '../../src/components/pin-input'
import * as fieldset from '../../src/components/fieldset'
import * as tour from '../../src/components/tour'
import * as toolbar from '../../src/components/toolbar'
import * as select from '../../src/components/select'
import * as combobox from '../../src/components/combobox'
import * as menu from '../../src/components/menu'
import * as contextMenu from '../../src/components/context-menu'
import * as searchableSelect from '../../src/patterns/searchable-select'
import { rootSignal } from '../_signal'

const noop = (): void => {}

describe('description-like optional parts', () => {
  it('chart: the svg names its desc only when it is rendered', () => {
    const on = chart.connect(rootSignal(), noop, { id: 'c' })
    expect(on.svg['aria-labelledby']).toBe('c:title c:desc')
    const off = chart.connect(rootSignal(), noop, { id: 'c', hasDescription: false })
    expect(off.svg['aria-labelledby']).toBe('c:title')
    // The title is the image's NAME, required for role="img": always referenced.
    expect(off.title.id).toBe('c:title')
  })

  it('sparkline: the svg names its desc only when it is rendered', () => {
    const on = sparkline.connect(rootSignal(), noop, { id: 's' })
    expect(on.svg['aria-labelledby']).toBe('s:title s:desc')
    const off = sparkline.connect(rootSignal(), noop, { id: 's', hasDescription: false })
    expect(off.svg['aria-labelledby']).toBe('s:title')
  })

  it('tour: the dialog names its description only when it is rendered', () => {
    const on = tour.connect(rootSignal(), noop, { id: 't' })
    expect(on.root['aria-labelledby']).toBe('t:title')
    expect(on.root['aria-describedby']).toBe('t:description')
    const off = tour.connect(rootSignal(), noop, { id: 't', hasDescription: false })
    expect(off.root['aria-describedby']).toBeUndefined()
    // The title names the dialog: required, always referenced.
    expect(off.root['aria-labelledby']).toBe('t:title')
  })
})

describe('group labels', () => {
  it('pin-input: the group names its label part only when it is rendered', () => {
    const on = pinInput.connect(rootSignal(), noop, { id: 'p' })
    expect(on.root['aria-labelledby']).toBe('p:label')
    const off = pinInput.connect(rootSignal(), noop, { id: 'p', hasLabel: false })
    expect(off.root['aria-labelledby']).toBeUndefined()
    expect(off.root.role).toBe('group')
  })

  it('fieldset: the group names its legend only when it is rendered', () => {
    const on = fieldset.connect(rootSignal(), noop, { id: 'f' })
    expect(on.root['aria-labelledby']).toBe('f:legend')
    const off = fieldset.connect(rootSignal(), noop, { id: 'f', hasLegend: false })
    expect(off.root['aria-labelledby']).toBeUndefined()
  })

  it('toolbar: a group names its label only when it is rendered', () => {
    const parts = toolbar.connect(rootSignal(), noop, { id: 'tb' })
    const labelled = parts.group('format')
    expect(labelled.root['aria-labelledby']).toBe(labelled.label.id)
    expect(parts.group('format', { hasLabel: true }).root['aria-labelledby']).toBe(
      labelled.label.id,
    )
    expect(parts.group('format', { hasLabel: false }).root['aria-labelledby']).toBeUndefined()
  })

  it.each([
    ['select', () => select.connect(rootSignal(), noop, { id: 'x' }).group],
    ['combobox', () => combobox.connect(rootSignal(), noop, { id: 'x' }).group],
    ['searchable-select', () => searchableSelect.connect(rootSignal(), noop, { id: 'x' }).group],
  ] as const)('%s: a group names its label only when it is rendered', (_name, groupOf) => {
    const group = groupOf()
    const labelled = group('fruit')
    expect(labelled.group['aria-labelledby']).toBe(labelled.groupLabel.id)
    expect(group('fruit', { hasLabel: false }).group['aria-labelledby']).toBeUndefined()
  })

  it.each([
    ['menu', () => menu.connect(rootSignal(), noop, { id: 'm' }).group],
    ['context-menu', () => contextMenu.connect(rootSignal(), noop, { id: 'm' }).group],
  ] as const)('%s: a group names its label only when it is rendered', (_name, groupOf) => {
    const group = groupOf()
    const labelled = group('edit')
    expect(labelled.group['aria-labelledby']).toBe(labelled.label.id)
    expect(group('edit', { hasLabel: false }).group['aria-labelledby']).toBeUndefined()
  })
})
