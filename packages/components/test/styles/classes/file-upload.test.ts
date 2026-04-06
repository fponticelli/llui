import { describe, it, expect } from 'vitest'
import { fileUploadClasses } from '../../../src/styles/classes/file-upload'

describe('fileUploadClasses', () => {
  it('returns all part keys', () => {
    const cls = fileUploadClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('dropzone')
    expect(cls).toHaveProperty('trigger')
    expect(cls).toHaveProperty('hiddenInput')
    expect(cls).toHaveProperty('label')
    expect(cls).toHaveProperty('clearTrigger')
    expect(cls).toHaveProperty('itemGroup')
    expect(cls).toHaveProperty('item')
    expect(cls).toHaveProperty('itemName')
    expect(cls).toHaveProperty('itemSizeText')
    expect(cls).toHaveProperty('itemPreview')
    expect(cls).toHaveProperty('itemRemove')
    expect(cls).toHaveProperty('itemDeleteTrigger')
  })

  it('dropzone has dashed border', () => {
    const cls = fileUploadClasses()
    expect(cls.dropzone).toContain('border-dashed')
  })

  it('hidden input is screen-reader only', () => {
    const cls = fileUploadClasses()
    expect(cls.hiddenInput).toBe('sr-only')
  })
})
