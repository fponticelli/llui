import { describe, it, expect, vi } from 'vitest'
import {
  init,
  update,
  connect,
  displayHours,
  period,
  formatTime,
} from '../../src/components/time-picker'
import { rootSignal, read } from '../_signal'

describe('time-picker reducer', () => {
  it('initializes at 00:00:00', () => {
    expect(init().value).toEqual({ hours: 0, minutes: 0, seconds: 0 })
  })

  it('setHours wraps 0-23', () => {
    expect(update(init(), { type: 'setHours', hours: 25 })[0].value.hours).toBe(1)
    expect(update(init(), { type: 'setHours', hours: -1 })[0].value.hours).toBe(23)
  })

  it('setMinutes wraps 0-59', () => {
    expect(update(init(), { type: 'setMinutes', minutes: 75 })[0].value.minutes).toBe(15)
  })

  it('increment/decrement minutes respects step', () => {
    const s0 = init({ value: { hours: 0, minutes: 10, seconds: 0 }, minuteStep: 5 })
    expect(update(s0, { type: 'incrementMinutes' })[0].value.minutes).toBe(15)
    expect(update(s0, { type: 'decrementMinutes' })[0].value.minutes).toBe(5)
  })

  it('toggleAmPm flips AM/PM', () => {
    const s0 = init({ value: { hours: 9, minutes: 0, seconds: 0 } })
    const [s] = update(s0, { type: 'toggleAmPm' })
    expect(s.value.hours).toBe(21)
    const [s2] = update(s, { type: 'toggleAmPm' })
    expect(s2.value.hours).toBe(9)
  })
})

// The gate used to swallow EVERY message and there was no `setDisabled`, so a
// disabled instance could never be written to or re-enabled by anything (#120).
describe('time-picker disabled gate', () => {
  const disabled = () => init({ value: { hours: 1, minutes: 2, seconds: 3 }, disabled: true })

  it('blocks interactive stepping', () => {
    const [s] = update(disabled(), { type: 'incrementHours' })
    expect(s.value.hours).toBe(1)
    const [s2] = update(disabled(), { type: 'toggleAmPm' })
    expect(s2.value.hours).toBe(1)
  })

  it('accepts programmatic field writes', () => {
    const [s] = update(disabled(), {
      type: 'setValue',
      value: { hours: 9, minutes: 30, seconds: 0 },
    })
    expect(s.value).toEqual({ hours: 9, minutes: 30, seconds: 0 })
    const [s2] = update(disabled(), { type: 'setHours', hours: 7 })
    expect(s2.value.hours).toBe(7)
    const [s3] = update(disabled(), { type: 'setMinutes', minutes: 45 })
    expect(s3.value.minutes).toBe(45)
    const [s4] = update(disabled(), { type: 'setSeconds', seconds: 15 })
    expect(s4.value.seconds).toBe(15)
  })

  it('can be re-enabled through setDisabled', () => {
    const [s] = update(disabled(), { type: 'setDisabled', disabled: false })
    expect(s.disabled).toBe(false)
    const [s2] = update(s, { type: 'incrementHours' })
    expect(s2.value.hours).toBe(2)
  })
})

describe('helpers', () => {
  it('displayHours in 12-hr format', () => {
    expect(displayHours(init({ value: { hours: 0, minutes: 0, seconds: 0 }, format: '12' }))).toBe(
      12,
    )
    expect(displayHours(init({ value: { hours: 13, minutes: 0, seconds: 0 }, format: '12' }))).toBe(
      1,
    )
    expect(displayHours(init({ value: { hours: 12, minutes: 0, seconds: 0 }, format: '12' }))).toBe(
      12,
    )
  })

  it('displayHours in 24-hr format is passthrough', () => {
    expect(displayHours(init({ value: { hours: 17, minutes: 0, seconds: 0 }, format: '24' }))).toBe(
      17,
    )
  })

  it('period returns AM or PM', () => {
    expect(period(init({ value: { hours: 9, minutes: 0, seconds: 0 } }))).toBe('AM')
    expect(period(init({ value: { hours: 13, minutes: 0, seconds: 0 } }))).toBe('PM')
  })

  it('formatTime pads to HH:MM', () => {
    expect(formatTime(init({ value: { hours: 9, minutes: 5, seconds: 0 } }))).toBe('09:05')
    expect(
      formatTime(init({ value: { hours: 9, minutes: 5, seconds: 12 }, showSeconds: true })),
    ).toBe('09:05:12')
  })
})

describe('time-picker.connect', () => {
  const p = connect(rootSignal(), vi.fn())

  it('hoursInput ArrowUp sends incrementHours', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send)
    pc.hoursInput.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'incrementHours' })
  })

  it('periodTrigger hidden for 24-hr format', () => {
    expect(read(p.periodTrigger.hidden, init({ format: '24' }))).toBe(true)
    expect(read(p.periodTrigger.hidden, init({ format: '12' }))).toBe(false)
  })

  it('periodTrigger data-period', () => {
    expect(
      read(
        p.periodTrigger['data-period'],
        init({ format: '12', value: { hours: 13, minutes: 0, seconds: 0 } }),
      ),
    ).toBe('PM')
  })
})
