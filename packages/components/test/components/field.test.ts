import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/field'
import type { FieldState } from '../../src/components/field'
import { rootSignal, read } from '../_signal'

describe('field reducer', () => {
  it('initializes with all flags false', () => {
    expect(init({ id: 'email' })).toEqual({
      id: 'email',
      invalid: false,
      required: false,
      disabled: false,
      readonly: false,
      touched: false,
    })
  })

  it('honors init overrides', () => {
    expect(init({ id: 'email', required: true, disabled: true })).toMatchObject({
      required: true,
      disabled: true,
    })
  })

  it('setInvalid toggles invalid', () => {
    const [s] = update(init({ id: 'x' }), { type: 'setInvalid', invalid: true })
    expect(s.invalid).toBe(true)
  })

  it('setRequired toggles required', () => {
    const [s] = update(init({ id: 'x' }), { type: 'setRequired', required: true })
    expect(s.required).toBe(true)
  })

  it('setDisabled toggles disabled', () => {
    const [s] = update(init({ id: 'x' }), { type: 'setDisabled', disabled: true })
    expect(s.disabled).toBe(true)
  })

  it('setReadonly toggles readonly', () => {
    const [s] = update(init({ id: 'x' }), { type: 'setReadonly', readonly: true })
    expect(s.readonly).toBe(true)
  })

  it('setTouched toggles touched', () => {
    const [s] = update(init({ id: 'x' }), { type: 'setTouched', touched: true })
    expect(s.touched).toBe(true)
  })

  it('returns no effects', () => {
    const [, fx] = update(init({ id: 'x' }), { type: 'setInvalid', invalid: true })
    expect(fx).toEqual([])
  })
})

describe('field.connect — id wiring with zero manual ids', () => {
  it('label htmlFor points at the control id', () => {
    const p = connect(rootSignal<FieldState>(), vi.fn(), { id: 'email' })
    expect(p.label.htmlFor).toBe('email:control')
    expect(p.control.id).toBe('email:control')
  })

  it('label has a stable id usable for aria-labelledby on custom controls', () => {
    const p = connect(rootSignal<FieldState>(), vi.fn(), { id: 'email' })
    expect(p.label.id).toBe('email:label')
    expect(p.control['aria-labelledby']).toBe('email:label')
  })

  it('description and errorText have stable derived ids', () => {
    const p = connect(rootSignal<FieldState>(), vi.fn(), { id: 'email' })
    expect(p.description.id).toBe('email:description')
    expect(p.errorText.id).toBe('email:error')
  })

  it('errorText is a polite live region with role', () => {
    const p = connect(rootSignal<FieldState>(), vi.fn(), { id: 'email' })
    expect(p.errorText['aria-live']).toBe('polite')
    expect(p.errorText.role).toBe('alert')
  })
})

const stateOf = (over: Partial<FieldState> = {}): FieldState => ({
  ...init({ id: 'email' }),
  ...over,
})

describe('field.connect — reactive aria-describedby', () => {
  it('includes only the description id when valid and a description exists', () => {
    const p = connect(rootSignal<FieldState>(), vi.fn(), { id: 'email', hasDescription: true })
    expect(read(p.control['aria-describedby'], stateOf({ invalid: false }))).toBe(
      'email:description',
    )
  })

  it('adds the error id when invalid, alongside the description', () => {
    const p = connect(rootSignal<FieldState>(), vi.fn(), { id: 'email', hasDescription: true })
    expect(read(p.control['aria-describedby'], stateOf({ invalid: true }))).toBe(
      'email:description email:error',
    )
  })

  it('drops the error id again when invalid clears (reactive)', () => {
    const p = connect(rootSignal<FieldState>(), vi.fn(), { id: 'email', hasDescription: true })
    expect(read(p.control['aria-describedby'], stateOf({ invalid: true }))).toBe(
      'email:description email:error',
    )
    expect(read(p.control['aria-describedby'], stateOf({ invalid: false }))).toBe(
      'email:description',
    )
  })

  it('omits the description id entirely when there is no description', () => {
    const p = connect(rootSignal<FieldState>(), vi.fn(), { id: 'email' })
    expect(read(p.control['aria-describedby'], stateOf({ invalid: false }))).toBeUndefined()
    expect(read(p.control['aria-describedby'], stateOf({ invalid: true }))).toBe('email:error')
  })
})

describe('field.connect — control reactive attributes', () => {
  it('aria-invalid reflects invalid', () => {
    const p = connect(rootSignal<FieldState>(), vi.fn(), { id: 'email' })
    expect(read(p.control['aria-invalid'], stateOf({ invalid: true }))).toBe('true')
    expect(read(p.control['aria-invalid'], stateOf({ invalid: false }))).toBeUndefined()
  })

  it('aria-required reflects required', () => {
    const p = connect(rootSignal<FieldState>(), vi.fn(), { id: 'email' })
    expect(read(p.control['aria-required'], stateOf({ required: true }))).toBe('true')
    expect(read(p.control['aria-required'], stateOf({ required: false }))).toBeUndefined()
  })

  it('disabled and readOnly reflect state', () => {
    const p = connect(rootSignal<FieldState>(), vi.fn(), { id: 'email' })
    expect(read(p.control.disabled, stateOf({ disabled: true }))).toBe(true)
    expect(read(p.control.readOnly, stateOf({ readonly: true }))).toBe(true)
  })

  it('root exposes reactive data-invalid / data-disabled', () => {
    const p = connect(rootSignal<FieldState>(), vi.fn(), { id: 'email' })
    expect(read(p.root['data-invalid'], stateOf({ invalid: true }))).toBe('')
    expect(read(p.root['data-invalid'], stateOf({ invalid: false }))).toBeUndefined()
    expect(read(p.root['data-disabled'], stateOf({ disabled: true }))).toBe('')
    expect(p.root['data-scope']).toBe('field')
  })
})
