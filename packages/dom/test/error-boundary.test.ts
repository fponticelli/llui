import { describe, it, expect, vi } from 'vitest'
import { mountApp } from '../src/mount'
import { errorBoundary } from '../src/primitives/error-boundary'
import { text } from '../src/primitives/text'
import { div } from '../src/elements'
import type { ComponentDef } from '../src/types'

describe('errorBoundary()', () => {
  it('renders content when no error occurs', () => {
    const def: ComponentDef<object, never, never> = {
      name: 'NoError',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () =>
        errorBoundary({
          render: (_s, _send) => [div({ class: 'ok' }, [text('working')])],
          fallback: () => [text('error')],
        }),
    }
    const container = document.createElement('div')
    mountApp(container, def)
    expect(container.querySelector('.ok')).not.toBeNull()
    expect(container.textContent).toBe('working')
  })

  it('renders fallback when render throws', () => {
    const def: ComponentDef<object, never, never> = {
      name: 'RenderError',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () =>
        errorBoundary({
          render: (_s, _send) => {
            throw new Error('boom')
          },
          fallback: (err) => [text(`caught: ${err.message}`)],
        }),
    }
    const container = document.createElement('div')
    mountApp(container, def)
    expect(container.textContent).toBe('caught: boom')
  })

  it('calls onError callback when error occurs', () => {
    const onError = vi.fn()
    const def: ComponentDef<object, never, never> = {
      name: 'OnError',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () =>
        errorBoundary({
          render: (_s, _send) => {
            throw new Error('oops')
          },
          fallback: () => [text('fallback')],
          onError,
        }),
    }
    const container = document.createElement('div')
    mountApp(container, def)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'oops' }))
  })

  it('wraps non-Error throws in Error', () => {
    const onError = vi.fn()
    const def: ComponentDef<object, never, never> = {
      name: 'StringThrow',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () =>
        errorBoundary({
          render: (_s, _send) => {
            throw 'string error'
          },
          fallback: (err) => [text(err.message)],
          onError,
        }),
    }
    const container = document.createElement('div')
    mountApp(container, def)
    expect(container.textContent).toBe('string error')
  })
})
