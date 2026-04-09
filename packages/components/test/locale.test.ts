import { describe, it, expect, vi } from 'vitest'
import { en, LocaleContext } from '../src/locale'
import type { Locale } from '../src/locale'
import { connect } from '../src/components/dialog'
import type { DialogState } from '../src/components/dialog'

describe('locale', () => {
  it('en covers every Locale key', () => {
    const keys = Object.keys(en) as (keyof Locale)[]
    expect(keys.length).toBeGreaterThan(0)
    for (const k of keys) {
      expect(en[k]).toBeDefined()
    }
  })

  it('parameterized strings produce expected output', () => {
    expect(en.carousel.slide(0)).toBe('Slide 1')
    expect(en.carousel.goToSlide(2)).toBe('Go to slide 3')
    expect(en.pagination.page(5)).toBe('Page 5')
    expect(en.pinInput.input(0)).toBe('Digit 1')
    expect(en.datePicker.grid(2026, 3)).toBe('March 2026')
  })

  it('month names has 12 entries', () => {
    expect(en.datePicker.monthNames).toHaveLength(12)
    expect(en.datePicker.monthNames[0]).toBe('January')
    expect(en.datePicker.monthNames[11]).toBe('December')
  })

  it('LocaleContext has en as default', () => {
    expect(LocaleContext._default).toBe(en)
  })
})

describe('locale integration', () => {
  type S = { dlg: DialogState }

  it('connect() uses English default when no locale option given', () => {
    const parts = connect<S>((s) => s.dlg, vi.fn(), { id: 'd1' })
    const ariaLabel = parts.closeTrigger['aria-label']
    // No render context → falls back to en defaults via useContext
    expect(typeof ariaLabel).toBe('function')
    expect((ariaLabel as (s: S) => string)({ dlg: { open: false } })).toBe('Close')
  })

  it('explicit closeLabel overrides locale', () => {
    const parts = connect<S>((s) => s.dlg, vi.fn(), { id: 'd2', closeLabel: 'Cerrar' })
    expect(parts.closeTrigger['aria-label']).toBe('Cerrar')
  })
})
