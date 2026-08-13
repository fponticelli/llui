import { describe, it, expect, vi } from 'vitest'
import {
  init,
  update,
  connect,
  displayHours,
  hoursFromDisplay,
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

  it('setHours preserves the meridiem in 12-hour format (#125 defect 5)', () => {
    // The hours FIELD of a 12-hour picker reads 1..12, so a typed "3" at 15:00
    // means 3 PM. Reading it as a 24-hour value silently flipped PM to AM.
    const pm = init({ format: '12', value: { hours: 15, minutes: 0, seconds: 0 } })
    expect(update(pm, { type: 'setHours', hours: 3 })[0].value.hours).toBe(15)
    expect(update(pm, { type: 'setHours', hours: 12 })[0].value.hours).toBe(12)
    const am = init({ format: '12', value: { hours: 3, minutes: 0, seconds: 0 } })
    expect(update(am, { type: 'setHours', hours: 9 })[0].value.hours).toBe(9)
    expect(update(am, { type: 'setHours', hours: 12 })[0].value.hours).toBe(0)
  })

  it('hoursFromDisplay is the inverse of displayHours', () => {
    for (const hours of [0, 1, 11, 12, 13, 23]) {
      for (const format of ['12', '24'] as const) {
        const s = init({ format, value: { hours, minutes: 0, seconds: 0 } })
        expect(hoursFromDisplay(displayHours(s), s)).toBe(hours)
      }
    }
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

  it('typing an hour into a 12-hour picker keeps the meridiem (#125 defect 5)', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send)
    const target = document.createElement('input')
    target.value = '3'
    const ev = new Event('input')
    Object.defineProperty(ev, 'target', { value: target })
    pc.hoursInput.onInput(ev)
    expect(send).toHaveBeenCalledWith({ type: 'setHours', hours: 3 })
    const pm = init({ format: '12', value: { hours: 15, minutes: 0, seconds: 0 } })
    expect(update(pm, send.mock.calls[0]![0])[0].value.hours).toBe(15)
  })

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
