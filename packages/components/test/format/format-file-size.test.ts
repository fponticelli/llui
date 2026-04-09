import { describe, it, expect } from 'vitest'
import { formatFileSize } from '../../src/format/format-file-size'

describe('formatFileSize', () => {
  it('formats bytes', () => {
    expect(formatFileSize(500, { locale: 'en-US' })).toBe('500 B')
  })

  it('formats kilobytes', () => {
    expect(formatFileSize(1536, { locale: 'en-US' })).toBe('1.5 KB')
  })

  it('formats megabytes', () => {
    expect(formatFileSize(2.5 * 1024 * 1024, { locale: 'en-US' })).toBe('2.5 MB')
  })

  it('formats gigabytes', () => {
    expect(formatFileSize(1.5 * 1024 ** 3, { locale: 'en-US' })).toBe('1.5 GB')
  })

  it('formats terabytes', () => {
    expect(formatFileSize(2 * 1024 ** 4, { locale: 'en-US' })).toBe('2 TB')
  })

  it('formats zero bytes', () => {
    expect(formatFileSize(0, { locale: 'en-US' })).toBe('0 B')
  })

  it('respects custom decimal places', () => {
    expect(formatFileSize(1536, { locale: 'en-US', decimalPlaces: 2 })).toBe('1.50 KB')
  })

  it('respects custom units', () => {
    expect(formatFileSize(1024, { locale: 'en-US', units: ['o', 'Ko', 'Mo', 'Go', 'To'] })).toBe(
      '1 Ko',
    )
  })

  it('formats bigint values', () => {
    expect(formatFileSize(BigInt(1024), { locale: 'en-US' })).toBe('1 KB')
  })

  it('formats large bigint values', () => {
    expect(formatFileSize(BigInt(1024) * BigInt(1024) * BigInt(1024), { locale: 'en-US' })).toBe(
      '1 GB',
    )
  })

  it('uses locale-aware number formatting', () => {
    expect(formatFileSize(1536, { locale: 'de-DE' })).toBe('1,5 KB')
  })
})
