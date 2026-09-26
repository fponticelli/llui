import { describe, expect, it } from 'vitest'
import { component, mountApp, text, type Mountable } from '@llui/dom'
import * as pagination from '../../packages/components/src/components/pagination'
import { buttonVariants } from '@/ui/button'
import { PaginationItem, PaginationLink } from '@/ui/pagination'

interface FixtureState {
  pagination: pagination.PaginationState
}

function mount(): {
  host: HTMLElement
  app: ReturnType<typeof mountApp<FixtureState, pagination.PaginationMsg>>
} {
  const host = document.createElement('div')
  document.body.append(host)
  const definition = component<FixtureState, pagination.PaginationMsg>({
    name: 'PaginationLinkFixture',
    init: () => [{ pagination: pagination.init({ total: 30, pageSize: 10, page: 1 }) }, []],
    update: (state, msg) => [{ pagination: pagination.update(state.pagination, msg)[0] }, []],
    view: ({ state, send }): readonly Mountable[] => {
      const parts = pagination.connect(state.at('pagination'), send, { id: 'p' })
      return [
        PaginationItem([PaginationLink({ ...parts.item(1) }, [text('1')])]),
        PaginationItem([PaginationLink({ ...parts.item(2) }, [text('2')])]),
      ]
    },
  })
  const app = mountApp(host, definition)
  return { host, app }
}

const linkFor = (host: HTMLElement, page: number): HTMLButtonElement =>
  host.querySelector(`[data-part="item"][data-value="${page}"]`) as HTMLButtonElement

const classTokens = (el: HTMLElement): string[] => el.className.split(/\s+/).filter(Boolean)

describe('PaginationLink reuses buttonVariants directly (no hand-copied recipe)', () => {
  it('renders the exact outline/ghost buttonVariants classes and reacts live to selection changes', () => {
    const { host, app } = mount()
    const ghost = buttonVariants({ variant: 'ghost', size: 'icon' }).split(/\s+/).filter(Boolean)
    const outline = buttonVariants({ variant: 'outline', size: 'icon' })
      .split(/\s+/)
      .filter(Boolean)

    // Page 1 is current: every `outline` token must be present, and no
    // `ghost`-only token may leak in — this is the byte-identical reuse the
    // hand-copied `data-selected:`-prefixed recipe could silently drift from.
    expect(classTokens(linkFor(host, 1))).toEqual(expect.arrayContaining(outline))
    expect(classTokens(linkFor(host, 2))).toEqual(expect.arrayContaining(ghost))

    // `outline`-only utilities (never part of `ghost`) must not leak onto the
    // non-current page item.
    const outlineOnly = outline.filter((token) => !ghost.includes(token))
    expect(outlineOnly.length).toBeGreaterThan(0)
    for (const token of outlineOnly) {
      expect(classTokens(linkFor(host, 2))).not.toContain(token)
    }

    // Selection is reactive, not baked in at mount: moving to page 2 swaps
    // which item carries the outline classes.
    app.send({ type: 'goTo', page: 2 })

    expect(classTokens(linkFor(host, 2))).toEqual(expect.arrayContaining(outline))
    expect(classTokens(linkFor(host, 1))).toEqual(expect.arrayContaining(ghost))
    for (const token of outlineOnly) {
      expect(classTokens(linkFor(host, 1))).not.toContain(token)
    }

    app.dispose()
    host.remove()
  })
})
