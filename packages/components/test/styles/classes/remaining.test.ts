import { describe, it, expect } from 'vitest'
import { navigationMenuClasses } from '../../../src/styles/classes/navigation-menu'
import { colorPickerClasses } from '../../../src/styles/classes/color-picker'
import { signaturePadClasses } from '../../../src/styles/classes/signature-pad'
import { imageCropperClasses } from '../../../src/styles/classes/image-cropper'
import { qrCodeClasses } from '../../../src/styles/classes/qr-code'
import { clipboardClasses } from '../../../src/styles/classes/clipboard'
import { tourClasses } from '../../../src/styles/classes/tour'
import { marqueeClasses } from '../../../src/styles/classes/marquee'
import { asyncListClasses } from '../../../src/styles/classes/async-list'
import { presenceClasses } from '../../../src/styles/classes/presence'

describe('navigationMenuClasses', () => {
  it('returns all part keys', () => {
    const cls = navigationMenuClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('trigger')
    expect(cls).toHaveProperty('content')
  })
})

describe('colorPickerClasses', () => {
  it('returns all part keys', () => {
    const cls = colorPickerClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('hueSlider')
    expect(cls).toHaveProperty('saturationSlider')
    expect(cls).toHaveProperty('lightnessSlider')
    expect(cls).toHaveProperty('hexInput')
    expect(cls).toHaveProperty('swatch')
  })
})

describe('signaturePadClasses', () => {
  it('returns all part keys', () => {
    const cls = signaturePadClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('control')
    expect(cls).toHaveProperty('clearTrigger')
    expect(cls).toHaveProperty('undoTrigger')
    expect(cls).toHaveProperty('guide')
    expect(cls).toHaveProperty('hiddenInput')
  })
})

describe('imageCropperClasses', () => {
  it('returns all part keys', () => {
    const cls = imageCropperClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('image')
    expect(cls).toHaveProperty('cropBox')
    expect(cls).toHaveProperty('resizeHandle')
    expect(cls).toHaveProperty('resetTrigger')
  })
})

describe('qrCodeClasses', () => {
  it('returns all part keys', () => {
    const cls = qrCodeClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('svg')
    expect(cls).toHaveProperty('downloadTrigger')
  })
})

describe('clipboardClasses', () => {
  it('returns all part keys', () => {
    const cls = clipboardClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('trigger')
    expect(cls).toHaveProperty('input')
    expect(cls).toHaveProperty('indicator')
  })
})

describe('tourClasses', () => {
  it('returns all part keys', () => {
    const cls = tourClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('backdrop')
    expect(cls).toHaveProperty('spotlight')
    expect(cls).toHaveProperty('title')
    expect(cls).toHaveProperty('description')
    expect(cls).toHaveProperty('progressText')
    expect(cls).toHaveProperty('prevTrigger')
    expect(cls).toHaveProperty('nextTrigger')
    expect(cls).toHaveProperty('closeTrigger')
  })
})

describe('marqueeClasses', () => {
  it('returns all part keys', () => {
    const cls = marqueeClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('content')
  })
})

describe('asyncListClasses', () => {
  it('returns all part keys', () => {
    const cls = asyncListClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('sentinel')
    expect(cls).toHaveProperty('loadMoreTrigger')
    expect(cls).toHaveProperty('retryTrigger')
    expect(cls).toHaveProperty('errorText')
  })
})

describe('presenceClasses', () => {
  it('returns root', () => {
    const cls = presenceClasses()
    expect(cls).toHaveProperty('root')
  })
})
