/**
 * Conformance smoke tests over the real A2UI v0.9 sample payloads shipped in
 * the google/A2UI repo (test/fixtures/*.json). Each is applied end-to-end and
 * checked for a graceful, correct render.
 *
 * Basic-catalog payloads must render their content; the two custom-catalog
 * payloads (inline `OrgChart`) must render gracefully — unknown components are
 * skipped, not fatal — and document the inline-catalog gap.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { el, text } from '@llui/dom'
import type { JsonValue, ServerToClientEnvelope } from '../src/index.js'
import {
  basicCatalog,
  defineCatalog,
  mountA2ui,
  resolvePointer,
  type A2uiHandle,
} from '../src/index.js'

import bookingForm from './fixtures/booking_form.json'
import singleColumnList from './fixtures/single_column_list.json'
import twoColumnList from './fixtures/two_column_list.json'
import confirmation from './fixtures/confirmation.json'
import contactCard from './fixtures/contact_card.json'
import contactList from './fixtures/contact_list.json'
import actionConfirmation from './fixtures/action_confirmation.json'
import orgChart from './fixtures/org_chart.json'
import multiSurface from './fixtures/multi_surface.json'

const asStream = (json: unknown): ServerToClientEnvelope[] => json as ServerToClientEnvelope[]

let container: HTMLElement
let handle: A2uiHandle
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  handle?.dispose()
  container.remove()
  errorSpy.mockRestore()
})

function surfaceCount(stream: ServerToClientEnvelope[]): number {
  return stream.filter((e) => e.createSurface).length
}
function renderedElements(): number {
  return container.querySelectorAll('.a2ui-surface *').length
}

// Fully-supported Basic-catalog payloads: fixture → [stream, static anchor text].
const BASIC: Array<[string, ServerToClientEnvelope[], string]> = [
  ['booking_form', asStream(bookingForm), 'Submit Reservation'],
  ['single_column_list', asStream(singleColumnList), 'Book Now'],
  ['two_column_list', asStream(twoColumnList), 'Book Now'],
  ['confirmation', asStream(confirmation), 'We look forward to seeing you!'],
  ['contact_card', asStream(contactCard), 'Calendar'],
  ['contact_list', asStream(contactList), 'Alice Wonderland'], // object template iteration
]

describe('A2UI sample payloads (Basic catalog)', () => {
  it.each(BASIC)('renders %s with its content', (_name, stream, anchor) => {
    handle = mountA2ui(container)
    expect(() => handle.apply(stream)).not.toThrow()

    expect(container.querySelectorAll('.a2ui-surface')).toHaveLength(surfaceCount(stream))
    expect(renderedElements()).toBeGreaterThan(3)
    expect(container.textContent).toContain(anchor)
    expect(errorSpy).not.toHaveBeenCalled()
  })
})

// Payloads that render gracefully but do not yet show their full content —
// each documents a real Phase-1 gap discovered from the shipped samples.
const DOCUMENTED_GAPS: Array<[string, ServerToClientEnvelope[], string]> = [
  // A confirmation Modal whose trigger is an empty Text. Our Modal is
  // spec-faithful (the Basic catalog Modal has no open field — it is
  // trigger-driven), so the content is hidden until the (empty) trigger is
  // clicked. Not a renderer gap; a quirk of this sample.
  ['action_confirmation', asStream(actionConfirmation), 'trigger-driven modal (sample quirk)'],
  // Reference an inline `OrgChart` catalog we do not register — needs inline /
  // in-band catalog support.
  ['org_chart', asStream(orgChart), 'inline catalog support'],
  ['multi_surface', asStream(multiSurface), 'inline catalog support'],
]

describe('A2UI sample payloads (documented Phase-1 gaps)', () => {
  it.each(DOCUMENTED_GAPS)('renders %s gracefully (gap: %s)', (_name, stream) => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    handle = mountA2ui(container)
    expect(() => handle.apply(stream)).not.toThrow()
    expect(container.querySelectorAll('.a2ui-surface')).toHaveLength(surfaceCount(stream))
    expect(errorSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

describe('custom-catalog sample renders when the consumer provides the catalog', () => {
  it('renders org_chart via a consumer OrgChart catalog (inline-catalog scenario)', () => {
    // The "inline_catalog" samples need a consumer-supplied builder for their
    // custom component — which defineCatalog already provides. This proves the
    // OrgChart sample renders end-to-end once that catalog is registered.
    const orgCatalog = defineCatalog({
      extends: basicCatalog,
      components: {
        OrgChart: ({ node, scope }) => {
          const path = (node.chain as { path?: string } | undefined)?.path ?? '/hierarchy'
          const names = scope.root.map((d: JsonValue) => {
            const h = resolvePointer(d, path)
            return h && typeof h === 'object'
              ? Object.values(h)
                  .map((v) => (v && typeof v === 'object' ? (v as { name?: string }).name : ''))
                  .filter(Boolean)
                  .join(', ')
              : ''
          })
          return [el('div', { class: 'org-chart' }, [text(names)])]
        },
      },
    })
    handle = mountA2ui(container, { catalogs: { inline_catalog: orgCatalog } })
    handle.apply(asStream(orgChart))
    expect(container.querySelector('.a2ui-surface')).not.toBeNull()
    expect(container.textContent).toContain('Organizational Chart')
    expect(container.querySelector('.org-chart')?.textContent).toContain('Jane Doe')
  })
})
