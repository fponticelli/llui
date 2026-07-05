import { describe, it, expect } from 'vitest'
import type { ServerToClientEnvelope } from '../src/protocol.js'
import { initialA2uiState, applyEnvelope, a2uiUpdate } from '../src/state.js'

const createBooking: ServerToClientEnvelope = {
  version: 'v0.9',
  createSurface: {
    surfaceId: 'booking-form',
    catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
    theme: { primaryColor: '#FF0000', font: 'Roboto' },
  },
}

const componentsBooking: ServerToClientEnvelope = {
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'booking-form',
    components: [
      { id: 'root', component: 'Column', children: ['booking-title'] },
      { id: 'booking-title', component: 'Text', variant: 'h2', text: { path: '/title' } },
    ],
  },
}

describe('createSurface', () => {
  it('creates an empty surface carrying catalog + theme', () => {
    const s = applyEnvelope(initialA2uiState(), createBooking)
    const surface = s.surfaces['booking-form']
    expect(surface).toBeDefined()
    expect(surface?.catalogId).toBe(
      'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
    )
    expect(surface?.theme.primaryColor).toBe('#FF0000')
    expect(surface?.components).toEqual({})
    expect(surface?.rootId).toBeNull()
    expect(surface?.dataModel).toEqual({})
    expect(s.order).toEqual(['booking-form'])
  })

  it('recreating a surface resets it', () => {
    let s = applyEnvelope(initialA2uiState(), createBooking)
    s = applyEnvelope(s, componentsBooking)
    s = applyEnvelope(s, createBooking)
    expect(s.surfaces['booking-form']?.components).toEqual({})
    expect(s.order).toEqual(['booking-form']) // not duplicated
  })
})

describe('updateComponents', () => {
  it('populates the component map and detects the root', () => {
    let s = applyEnvelope(initialA2uiState(), createBooking)
    s = applyEnvelope(s, componentsBooking)
    const surface = s.surfaces['booking-form']
    expect(surface?.rootId).toBe('root')
    expect(Object.keys(surface?.components ?? {})).toEqual(['root', 'booking-title'])
    expect(surface?.components['booking-title']?.component).toBe('Text')
  })

  it('upserts components across multiple messages', () => {
    let s = applyEnvelope(initialA2uiState(), createBooking)
    s = applyEnvelope(s, componentsBooking)
    s = applyEnvelope(s, {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'booking-form',
        components: [{ id: 'booking-title', component: 'Text', text: 'changed' }],
      },
    })
    expect(s.surfaces['booking-form']?.components['booking-title']?.text).toBe('changed')
    expect(s.surfaces['booking-form']?.components['root']).toBeDefined() // preserved
  })

  it('ignores updates to an unknown surface', () => {
    const s = applyEnvelope(initialA2uiState(), {
      version: 'v0.9',
      updateComponents: { surfaceId: 'ghost', components: [] },
    })
    expect(s.surfaces['ghost']).toBeUndefined()
  })
})

describe('updateDataModel', () => {
  it('sets the whole model at root and then patches a leaf', () => {
    let s = applyEnvelope(initialA2uiState(), createBooking)
    s = applyEnvelope(s, {
      version: 'v0.9',
      updateDataModel: {
        surfaceId: 'booking-form',
        path: '/',
        value: { title: 'Book', partySize: '2' },
      },
    })
    expect(s.surfaces['booking-form']?.dataModel).toEqual({ title: 'Book', partySize: '2' })
    s = applyEnvelope(s, {
      version: 'v0.9',
      updateDataModel: { surfaceId: 'booking-form', path: '/title', value: 'Reserve' },
    })
    expect(s.surfaces['booking-form']?.dataModel).toEqual({ title: 'Reserve', partySize: '2' })
  })

  it('defaults a missing path to root', () => {
    let s = applyEnvelope(initialA2uiState(), createBooking)
    s = applyEnvelope(s, {
      version: 'v0.9',
      updateDataModel: { surfaceId: 'booking-form', value: { a: 1 } },
    })
    expect(s.surfaces['booking-form']?.dataModel).toEqual({ a: 1 })
  })
})

describe('deleteSurface', () => {
  it('removes the surface and its order entry', () => {
    let s = applyEnvelope(initialA2uiState(), createBooking)
    s = applyEnvelope(s, { version: 'v0.9', deleteSurface: { surfaceId: 'booking-form' } })
    expect(s.surfaces['booking-form']).toBeUndefined()
    expect(s.order).toEqual([])
  })
})

describe('a2uiUpdate (component reducer)', () => {
  it('applies an envelope with no effects', () => {
    const [next, effects] = a2uiUpdate(initialA2uiState(), {
      type: 'apply',
      envelope: createBooking,
    })
    expect(next.surfaces['booking-form']).toBeDefined()
    expect(effects).toEqual([])
  })

  it('setUi writes client-local UI state without touching the data model', () => {
    let s = applyEnvelope(initialA2uiState(), createBooking)
    const [next] = a2uiUpdate(s, {
      type: 'setUi',
      surfaceId: 'booking-form',
      componentId: 'tabs-1',
      value: { value: '1' },
    })
    expect(next.surfaces['booking-form']?.uiState).toEqual({ 'tabs-1': { value: '1' } })
    expect(next.surfaces['booking-form']?.dataModel).toEqual({})
  })

  it('setData writes back into the surface data model (two-way binding)', () => {
    let s = applyEnvelope(initialA2uiState(), createBooking)
    const [next] = a2uiUpdate(s, {
      type: 'setData',
      surfaceId: 'booking-form',
      path: '/partySize',
      value: '4',
    })
    expect(next.surfaces['booking-form']?.dataModel).toEqual({ partySize: '4' })
  })

  it('action emits a resolved action effect and leaves state unchanged', () => {
    const s = applyEnvelope(initialA2uiState(), createBooking)
    const [next, effects] = a2uiUpdate(s, {
      type: 'action',
      surfaceId: 'booking-form',
      sourceComponentId: 'submit-button',
      name: 'submit_booking',
      context: { partySize: '4' },
    })
    expect(next).toBe(s) // pure no-op on state
    expect(effects).toEqual([
      {
        type: 'a2ui/action',
        surfaceId: 'booking-form',
        sourceComponentId: 'submit-button',
        name: 'submit_booking',
        context: { partySize: '4' },
      },
    ])
  })
})
