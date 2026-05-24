import { describe, expect, it } from 'vitest'
import { deriveSlug, deriveFilename } from '../src/notes/slug.js'

describe('deriveSlug', () => {
  it('returns "capture" when prose is empty or whitespace-only', () => {
    expect(deriveSlug('')).toBe('capture')
    expect(deriveSlug('   \n  ')).toBe('capture')
  })

  it('kebab-cases the first 3-4 words of prose', () => {
    expect(deriveSlug('Edit button copy is wrong')).toBe('edit-button-copy-wrong')
  })

  it('strips stopwords (a, the, is, of, to, in, on, for, and, or, but)', () => {
    expect(deriveSlug('The button is broken on hover')).toBe('button-broken-hover')
    expect(deriveSlug('A modal for the user')).toBe('modal-user')
  })

  it('sanitizes punctuation and non-ASCII to hyphens', () => {
    expect(deriveSlug('User.Card — edit button!')).toBe('user-card-edit-button')
  })

  it('collapses runs of hyphens and trims leading/trailing hyphens', () => {
    expect(deriveSlug('--hello---world--')).toBe('hello-world')
  })

  it('caps total length at 32 characters', () => {
    const slug = deriveSlug('extraordinarily verbose enormous description with many words')
    expect(slug.length).toBeLessThanOrEqual(32)
    // First content word should still be present
    expect(slug.startsWith('extraordinarily')).toBe(true)
  })

  it('does not break a word mid-character when capping', () => {
    // Cap should fall on a hyphen boundary, never mid-word
    const slug = deriveSlug('abcdefghijklmnop qrstuvwxyz andmore content here')
    expect(slug.endsWith('-')).toBe(false)
    expect(slug).not.toMatch(/-$/)
  })

  it('lowercases everything', () => {
    expect(deriveSlug('UPPERCASE SHOUTING TEXT')).toBe('uppercase-shouting-text')
  })

  it('handles prose with only stopwords by falling back to capture', () => {
    expect(deriveSlug('the a of in')).toBe('capture')
  })

  it('handles single-word prose', () => {
    expect(deriveSlug('broken')).toBe('broken')
  })

  it('strips digits-only "words" of leading/trailing punctuation but keeps them', () => {
    expect(deriveSlug('Issue 42 happens twice')).toBe('issue-42-happens-twice')
  })
})

describe('deriveFilename', () => {
  it('combines id, author, kind, slug with .md', () => {
    expect(deriveFilename('001', 'human', 'rect', 'edit-button')).toBe(
      '001-human-rect-edit-button.md',
    )
  })

  it('preserves the caller-supplied id (assumed already padded)', () => {
    expect(deriveFilename('042', 'llm', 'capture', 'user-card')).toBe(
      '042-llm-capture-user-card.md',
    )
  })

  it('handles "capture" slug for prose-less notes', () => {
    expect(deriveFilename('003', 'human', 'text', 'capture')).toBe('003-human-text-capture.md')
  })
})

describe('padId', () => {
  it('pads single digit to 3', async () => {
    const { padId } = await import('../src/notes/slug.js')
    expect(padId(1)).toBe('001')
    expect(padId(42)).toBe('042')
    expect(padId(999)).toBe('999')
  })

  it('preserves >=3 digit ids without truncation', async () => {
    const { padId } = await import('../src/notes/slug.js')
    expect(padId(1000)).toBe('1000')
  })
})
