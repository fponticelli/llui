import { describe, it, expect, afterEach } from 'vitest'
import { lockBodyScroll, _scrollLockCount } from '../../src/utils/remove-scroll'

describe('lockBodyScroll()', () => {
  afterEach(() => {
    document.body.style.overflow = ''
    document.body.style.paddingRight = ''
  })

  it('sets body overflow hidden while locked', () => {
    const cleanup = lockBodyScroll()
    expect(document.body.style.overflow).toBe('hidden')
    cleanup()
  })

  it('restores overflow on cleanup', () => {
    document.body.style.overflow = 'scroll'
    const cleanup = lockBodyScroll()
    expect(document.body.style.overflow).toBe('hidden')
    cleanup()
    expect(document.body.style.overflow).toBe('scroll')
  })

  it('reference-counts nested locks', () => {
    const a = lockBodyScroll()
    const b = lockBodyScroll()
    expect(_scrollLockCount()).toBe(2)
    a()
    expect(document.body.style.overflow).toBe('hidden')
    expect(_scrollLockCount()).toBe(1)
    b()
    expect(_scrollLockCount()).toBe(0)
    expect(document.body.style.overflow).toBe('')
  })

  it('cleanup is idempotent safe', () => {
    const cleanup = lockBodyScroll()
    cleanup()
    cleanup()
    expect(_scrollLockCount()).toBe(0)
  })
})
