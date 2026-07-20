import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountApp } from '@llui/dom'
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  UNDO_COMMAND,
  type LexicalEditor,
} from 'lexical'
import { markdownEditor } from '../src/editor.js'
import { corePlugin } from '../src/plugins/core.js'
import {
  blockDragPlugin,
  blockAtPoint,
  findDropTarget,
  indicatorRect,
  type BlockRect,
} from '../src/plugins/block-drag.js'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

let container: HTMLElement
let app: ReturnType<typeof mountApp> | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(() => {
  app?.dispose()
  app = null
  document.body.innerHTML = ''
})

/** Three stacked 20px-tall blocks: [0,20] [20,40] [40,60]. */
const BLOCKS: readonly BlockRect[] = [
  { key: 'a', top: 0, bottom: 20, left: 10, width: 100 },
  { key: 'b', top: 20, bottom: 40, left: 10, width: 100 },
  { key: 'c', top: 40, bottom: 60, left: 10, width: 100 },
]

// ── Pure geometry ───────────────────────────────────────────────────────────

describe('blockAtPoint', () => {
  it('finds the block under the pointer', () => {
    expect(blockAtPoint(BLOCKS, 5)?.key).toBe('a')
    expect(blockAtPoint(BLOCKS, 30)?.key).toBe('b')
    expect(blockAtPoint(BLOCKS, 55)?.key).toBe('c')
  })

  it('tolerates a few pixels of gap above and below', () => {
    expect(blockAtPoint(BLOCKS, -3)?.key).toBe('a')
    expect(blockAtPoint(BLOCKS, 62)?.key).toBe('c')
  })

  it('returns null well outside the stack', () => {
    expect(blockAtPoint(BLOCKS, -100)).toBeNull()
    expect(blockAtPoint(BLOCKS, 500)).toBeNull()
    expect(blockAtPoint([], 5)).toBeNull()
  })
})

describe('findDropTarget', () => {
  it('drops before the first block when above its midpoint', () => {
    expect(findDropTarget(BLOCKS, 2, 'c')).toEqual({ key: 'a', place: 'before' })
  })

  it('drops after the last block when below its midpoint', () => {
    expect(findDropTarget(BLOCKS, 58, 'a')).toEqual({ key: 'c', place: 'after' })
  })

  it('drops into an interior boundary', () => {
    // y=32 is past b's midpoint (30) but before c's (50) → slot between b and c.
    expect(findDropTarget(BLOCKS, 32, 'a')).toEqual({ key: 'b', place: 'after' })
  })

  it('returns null for the two no-op slots around the source', () => {
    // Source `b` already occupies the slot between a and c; both boundaries of
    // that slot are no-ops and must not produce an indicator or a move.
    expect(findDropTarget(BLOCKS, 25, 'b')).toBeNull()
    expect(findDropTarget(BLOCKS, 35, 'b')).toBeNull()
  })

  it('returns null for an unknown source key', () => {
    expect(findDropTarget(BLOCKS, 30, 'zz')).toBeNull()
  })
})

describe('indicatorRect', () => {
  it('sits on the top edge for a before-target and the bottom edge for after', () => {
    expect(indicatorRect(BLOCKS, { key: 'b', place: 'before' })).toEqual({
      x: 10,
      y: 20,
      width: 100,
    })
    expect(indicatorRect(BLOCKS, { key: 'b', place: 'after' })).toEqual({
      x: 10,
      y: 40,
      width: 100,
    })
  })

  it('returns null for an unknown key', () => {
    expect(indicatorRect(BLOCKS, { key: 'zz', place: 'before' })).toBeNull()
  })
})

// ── Plugin integration ──────────────────────────────────────────────────────

const DOC = 'alpha\n\nbravo\n\ncharlie'

interface Mounted {
  editor: LexicalEditor
  keys: () => string[]
  texts: () => string[]
}

async function mountEditor(): Promise<Mounted> {
  let editor!: LexicalEditor
  app = mountApp(
    container,
    markdownEditor({
      plugins: [corePlugin(), blockDragPlugin()],
      defaultValue: DOC,
      onReady: (e) => {
        editor = e
      },
    }),
  )
  await wait(0)
  const keys = (): string[] =>
    editor.getEditorState().read(() =>
      $getRoot()
        .getChildren()
        .map((n) => n.getKey()),
    )
  const texts = (): string[] =>
    editor.getEditorState().read(() =>
      $getRoot()
        .getChildren()
        .map((n) => n.getTextContent()),
    )
  return { editor, keys, texts }
}

const send = (msg: unknown): void => {
  app?.send({ type: 'plugin', name: 'blockDrag', msg })
}

const handleEl = (): HTMLElement | null =>
  document.querySelector('[data-scope="md-block-drag"][data-part="grip"]')
const indicatorEl = (): HTMLElement | null =>
  document.querySelector('[data-scope="md-block-drag"][data-part="indicator"]')

describe('block drag handle overlay', () => {
  it('shows the gutter handle on hover and hides it on hover-out', async () => {
    const { keys } = await mountEditor()
    expect(handleEl()).toBeNull()

    send({ type: 'hover', key: keys()[0], x: 12, y: 40 })
    await wait(0)
    const grip = handleEl()
    expect(grip).not.toBeNull()
    const root = document.querySelector(
      '[data-scope="md-block-drag"][data-part="handle"]',
    ) as HTMLElement
    expect(root.getAttribute('style')).toContain('left:12px')
    expect(root.getAttribute('style')).toContain('top:40px')

    send({ type: 'hoverOut' })
    await wait(0)
    expect(handleEl()).toBeNull()
  })

  it('gives the grip correct ARIA', async () => {
    const { keys } = await mountEditor()
    send({ type: 'hover', key: keys()[0], x: 12, y: 40 })
    await wait(0)
    const grip = handleEl()!
    expect(grip.tagName).toBe('BUTTON')
    expect(grip.getAttribute('type')).toBe('button')
    expect(grip.getAttribute('aria-roledescription')).toBe('draggable block handle')
    expect(grip.getAttribute('aria-pressed')).toBe('false')
    expect(grip.getAttribute('aria-label')).toBeTruthy()
    // A description explaining the keyboard protocol must be referenced.
    const describedBy = grip.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)).not.toBeNull()
  })

  it('renders a polite live region for move announcements', async () => {
    const { keys } = await mountEditor()
    send({ type: 'hover', key: keys()[0], x: 12, y: 40 })
    await wait(0)
    const live = document.querySelector('[data-scope="md-block-drag"][data-part="announcer"]')
    expect(live).not.toBeNull()
    expect(live!.getAttribute('aria-live')).toBe('polite')
    expect(live!.getAttribute('role')).toBe('status')
  })
})

describe('drop indicator', () => {
  it('appears while dragging and disappears when the drag ends', async () => {
    const { keys } = await mountEditor()
    send({ type: 'hover', key: keys()[0], x: 12, y: 0 })
    send({ type: 'dragStart' })
    await wait(0)
    // While dragging the gutter handle is hidden — it would sit under the cursor.
    expect(handleEl()).toBeNull()

    send({ type: 'dragOver', x: 10, y: 40, width: 100 })
    await wait(0)
    const bar = indicatorEl()
    expect(bar).not.toBeNull()
    const root = bar!.parentElement as HTMLElement
    expect(root.getAttribute('style')).toContain('top:40px')
    expect(bar!.getAttribute('style')).toContain('width:100px')

    send({ type: 'dragEnd' })
    await wait(0)
    expect(indicatorEl()).toBeNull()
  })

  it('hides the indicator when the pointer is over a no-op slot', async () => {
    const { keys } = await mountEditor()
    send({ type: 'hover', key: keys()[0], x: 12, y: 0 })
    send({ type: 'dragStart' })
    send({ type: 'dragOver', x: 10, y: 40, width: 100 })
    await wait(0)
    expect(indicatorEl()).not.toBeNull()
    send({ type: 'dragOverNone' })
    await wait(0)
    expect(indicatorEl()).toBeNull()
  })
})

describe('reordering through Lexical', () => {
  it('moves a block after a target and updates the document', async () => {
    const { keys, texts } = await mountEditor()
    expect(texts()).toEqual(['alpha', 'bravo', 'charlie'])
    const [a, , c] = keys()

    send({ type: 'drop', sourceKey: a, targetKey: c, place: 'after' })
    await wait(0)
    expect(texts()).toEqual(['bravo', 'charlie', 'alpha'])
  })

  it('moves a block before a target', async () => {
    const { keys, texts } = await mountEditor()
    const [a, , c] = keys()
    send({ type: 'drop', sourceKey: c, targetKey: a, place: 'before' })
    await wait(0)
    expect(texts()).toEqual(['charlie', 'alpha', 'bravo'])
  })

  it('preserves node identity (a real move, not a re-create)', async () => {
    const { keys, texts } = await mountEditor()
    const [a, , c] = keys()
    send({ type: 'drop', sourceKey: a, targetKey: c, place: 'after' })
    await wait(0)
    expect(texts()).toEqual(['bravo', 'charlie', 'alpha'])
    // Same Lexical key survives the move — proof it went through insertAfter and
    // not a delete+recreate (which would break collab and selection).
    expect(keys()[2]).toBe(a)
  })

  it('is undoable in a single step', async () => {
    const { editor, keys, texts } = await mountEditor()
    const [a, , c] = keys()
    send({ type: 'drop', sourceKey: a, targetKey: c, place: 'after' })
    await wait(0)
    expect(texts()).toEqual(['bravo', 'charlie', 'alpha'])

    editor.dispatchCommand(UNDO_COMMAND, undefined)
    await wait(0)
    expect(texts()).toEqual(['alpha', 'bravo', 'charlie'])
  })

  it('ignores a drop onto itself and stale keys', async () => {
    const { keys, texts } = await mountEditor()
    const [a, b] = keys()
    send({ type: 'drop', sourceKey: a, targetKey: a, place: 'after' })
    await wait(0)
    expect(texts()).toEqual(['alpha', 'bravo', 'charlie'])
    send({ type: 'drop', sourceKey: 'nope', targetKey: b, place: 'after' })
    await wait(0)
    expect(texts()).toEqual(['alpha', 'bravo', 'charlie'])
  })

  it('keeps the caret where it was when another block moves', async () => {
    const { editor, keys, texts } = await mountEditor()
    const [a, b, c] = keys()
    // Caret at the end of `bravo`.
    editor.update(
      () => {
        $getRoot().getChildren()[1]?.selectEnd()
      },
      { discrete: true },
    )
    await wait(0)
    send({ type: 'drop', sourceKey: a, targetKey: c, place: 'after' })
    await wait(0)
    expect(texts()).toEqual(['bravo', 'charlie', 'alpha'])
    const anchorTop = editor.getEditorState().read(() => {
      const sel = $getSelection()
      return $isRangeSelection(sel) ? sel.anchor.getNode().getTopLevelElement()?.getKey() : null
    })
    expect(anchorTop).toBe(b)
  })
})

describe('keyboard reordering', () => {
  it('grabs, moves down, and releases — with announcements', async () => {
    const { keys, texts } = await mountEditor()
    const a = keys()[0]
    send({ type: 'hover', key: a, x: 12, y: 0 })
    await wait(0)

    send({ type: 'toggleGrab' })
    await wait(0)
    expect(handleEl()!.getAttribute('aria-pressed')).toBe('true')
    const live = document.querySelector('[data-scope="md-block-drag"][data-part="announcer"]')!
    expect(live.textContent).toMatch(/grabbed/i)

    send({ type: 'moveGrabbed', direction: 1 })
    await wait(0)
    expect(texts()).toEqual(['bravo', 'alpha', 'charlie'])
    expect(live.textContent).toMatch(/2 of 3/)
    // The grabbed block stays grabbed so it can be moved repeatedly.
    expect(handleEl()!.getAttribute('aria-pressed')).toBe('true')

    send({ type: 'moveGrabbed', direction: 1 })
    await wait(0)
    expect(texts()).toEqual(['bravo', 'charlie', 'alpha'])

    send({ type: 'toggleGrab' })
    await wait(0)
    expect(handleEl()!.getAttribute('aria-pressed')).toBe('false')
    expect(live.textContent).toMatch(/dropped/i)
  })

  it('moves up and clamps at the ends', async () => {
    const { keys, texts } = await mountEditor()
    const c = keys()[2]
    send({ type: 'hover', key: c, x: 12, y: 0 })
    send({ type: 'toggleGrab' })
    await wait(0)

    send({ type: 'moveGrabbed', direction: -1 })
    await wait(0)
    expect(texts()).toEqual(['alpha', 'charlie', 'bravo'])
    send({ type: 'moveGrabbed', direction: -1 })
    await wait(0)
    expect(texts()).toEqual(['charlie', 'alpha', 'bravo'])
    // Already first — a further move up is a no-op and says so.
    send({ type: 'moveGrabbed', direction: -1 })
    await wait(0)
    expect(texts()).toEqual(['charlie', 'alpha', 'bravo'])
  })

  it('escape cancels the grab without moving anything', async () => {
    const { keys, texts } = await mountEditor()
    send({ type: 'hover', key: keys()[0], x: 12, y: 0 })
    send({ type: 'toggleGrab' })
    await wait(0)
    send({ type: 'releaseGrab' })
    await wait(0)
    expect(handleEl()!.getAttribute('aria-pressed')).toBe('false')
    expect(texts()).toEqual(['alpha', 'bravo', 'charlie'])
  })

  it('ignores a move with nothing grabbed', async () => {
    const { keys, texts } = await mountEditor()
    send({ type: 'hover', key: keys()[0], x: 12, y: 0 })
    await wait(0)
    send({ type: 'moveGrabbed', direction: 1 })
    await wait(0)
    expect(texts()).toEqual(['alpha', 'bravo', 'charlie'])
  })

  it('keeps the handle pinned to the grabbed block while hover events arrive', async () => {
    const { keys, texts } = await mountEditor()
    const [a, b] = keys()
    send({ type: 'hover', key: a, x: 12, y: 0 })
    send({ type: 'toggleGrab' })
    await wait(0)
    const root = (): HTMLElement =>
      document.querySelector('[data-scope="md-block-drag"][data-part="handle"]') as HTMLElement
    expect(root().getAttribute('style')).toContain('top:0px')

    // A stray pointer move over another block must NOT drag the grip away from
    // the block the user has grabbed — the mode would then be pointing at one
    // block while the badge sits on another.
    send({ type: 'hover', key: b, x: 12, y: 30 })
    await wait(0)
    expect(root().getAttribute('style')).toContain('top:0px')
    expect(root().getAttribute('style')).not.toContain('top:30px')

    // ...and the grab still targets the originally grabbed block.
    send({ type: 'moveGrabbed', direction: 1 })
    await wait(0)
    expect(texts()).toEqual(['bravo', 'alpha', 'charlie'])
  })
})

describe('keyboard event wiring on the grip', () => {
  it('responds to Enter, arrows, and Escape', async () => {
    const { keys, texts } = await mountEditor()
    send({ type: 'hover', key: keys()[0], x: 12, y: 0 })
    await wait(0)
    const grip = handleEl()!

    const key = (k: string): void => {
      grip.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
    }
    key('Enter')
    await wait(0)
    expect(handleEl()!.getAttribute('aria-pressed')).toBe('true')

    key('ArrowDown')
    await wait(0)
    expect(texts()).toEqual(['bravo', 'alpha', 'charlie'])

    key('Escape')
    await wait(0)
    expect(handleEl()!.getAttribute('aria-pressed')).toBe('false')
  })
})

// ── Review findings (adversarial pass) ───────────────────────────────────────

describe('a grab followed by a pointer drag does not wedge the gutter (CRITICAL)', () => {
  it('restores the handle on hover after grab → dragStart → dragEnd', async () => {
    const { keys } = await mountEditor()
    const a = keys()[0]
    send({ type: 'hover', key: a, x: 12, y: 0 })
    await wait(0)
    // Exactly what a sub-threshold click on the grip produces.
    send({ type: 'toggleGrab' })
    await wait(0)
    send({ type: 'dragStart', key: a })
    await wait(0)
    send({ type: 'dragEnd' })
    await wait(0)

    send({ type: 'hover', key: a, x: 12, y: 0 })
    await wait(0)
    expect(handleEl()).not.toBeNull()
  })

  it('restores the handle on hover after grab → dragStart → drop', async () => {
    const { keys } = await mountEditor()
    const [a, , c] = keys()
    send({ type: 'hover', key: a, x: 12, y: 0 })
    await wait(0)
    send({ type: 'toggleGrab' })
    await wait(0)
    send({ type: 'dragStart', key: a })
    await wait(0)
    send({ type: 'drop', sourceKey: a, targetKey: c, place: 'after' })
    await wait(0)

    send({ type: 'hover', key: c, x: 12, y: 40 })
    await wait(0)
    expect(handleEl()).not.toBeNull()
  })
})

describe('blockAtPoint honours exact bands before widening (MAJOR)', () => {
  it('does not let a block steal the top of the block below it', () => {
    // BLOCKS touch: [0,20] [20,40] [40,60]. y=23 is 3px INSIDE b's own rect,
    // but a's band widened by the 6px tolerance also covers it.
    expect(blockAtPoint(BLOCKS, 23)?.key).toBe('b')
    expect(blockAtPoint(BLOCKS, 43)?.key).toBe('c')
  })

  it('resolves every exact boundary to the block that owns it', () => {
    expect(blockAtPoint(BLOCKS, 20)?.key).toBe('a')
    expect(blockAtPoint(BLOCKS, 21)?.key).toBe('b')
    expect(blockAtPoint(BLOCKS, 39)?.key).toBe('b')
    expect(blockAtPoint(BLOCKS, 40)?.key).toBe('b')
  })

  it('still uses the tolerance for a point in a real gap', () => {
    const gapped: readonly BlockRect[] = [
      { key: 'a', top: 0, bottom: 20, left: 10, width: 100 },
      { key: 'b', top: 30, bottom: 50, left: 10, width: 100 },
    ]
    expect(blockAtPoint(gapped, 24)?.key).toBe('a')
    expect(blockAtPoint(gapped, 26)?.key).toBe('b')
    expect(blockAtPoint(gapped, 25)).not.toBeNull()
  })
})

describe('the reorder protocol is reachable from the keyboard (MAJOR)', () => {
  it('reveals and focuses the grip from the command item, with no pointer', async () => {
    const plugin = blockDragPlugin()
    let editor!: LexicalEditor
    app = mountApp(
      container,
      markdownEditor({
        plugins: [corePlugin(), plugin],
        defaultValue: DOC,
        onReady: (e) => {
          editor = e
        },
      }),
    )
    await wait(0)
    // Put the caret in the first block — the only thing a keyboard user can do.
    editor.update(
      () => {
        const first = $getRoot().getFirstChild()
        if (first && 'select' in first) (first as unknown as { select(): void }).select()
      },
      { discrete: true },
    )
    expect(handleEl()).toBeNull()

    plugin.items?.[0]?.run(editor, { send: () => {} })
    await wait(0)

    const grip = handleEl()
    expect(grip).not.toBeNull()
    expect(document.activeElement).toBe(grip)
  })

  it('does not steal focus when the grip is revealed by hover', async () => {
    const { keys } = await mountEditor()
    send({ type: 'hover', key: keys()[0]!, x: 12, y: 0 })
    await wait(0)
    expect(handleEl()).not.toBeNull()
    expect(document.activeElement).not.toBe(handleEl())
  })
})

describe('live-region announcements (MINOR)', () => {
  const live = () => document.querySelector('[data-scope="md-block-drag"][data-part="announcer"]')!

  it('re-announces a repeated boundary bump', async () => {
    const { keys } = await mountEditor()
    send({ type: 'hover', key: keys()[0]!, x: 12, y: 0 })
    await wait(0)
    send({ type: 'toggleGrab' })
    await wait(0)

    send({ type: 'moveGrabbed', direction: -1 })
    await wait(0)
    const first = live().textContent
    expect(first).toMatch(/first position/i)

    send({ type: 'moveGrabbed', direction: -1 })
    await wait(0)
    // Same words — but a DIFFERENT string, which is what makes aria-live speak.
    expect(live().textContent).toMatch(/first position/i)
    expect(live().textContent).not.toBe(first)
  })

  it('announces cancellation instead of blanking the region on Escape', async () => {
    const { keys } = await mountEditor()
    send({ type: 'hover', key: keys()[0]!, x: 12, y: 0 })
    await wait(0)
    send({ type: 'toggleGrab' })
    await wait(0)
    send({ type: 'releaseGrab' })
    await wait(0)
    expect(live().textContent).toMatch(/cancelled/i)
  })
})

describe('the grab/handle invariant', () => {
  // `handleVisible === false` implies `grabbedKey === ''`. See `normalize` in
  // block-drag.ts: violating it wedges the gutter permanently and unrecoverably.
  it('never leaves a grab armed once the handle is hidden', async () => {
    const { keys } = await mountEditor()
    const [a, , c] = keys()
    // Every path that hides the handle while a grab could be pending.
    // Each path ends SETTLED (not mid-drag): while `dragging` is true the handle
    // is hidden by design, so the wedge only shows once the drag is over.
    const paths: ReadonlyArray<readonly [string, () => void]> = [
      [
        'dragStart then dragEnd',
        () => {
          send({ type: 'dragStart', key: a })
          send({ type: 'dragEnd' })
        },
      ],
      ['dragEnd alone (no matching dragStart)', () => send({ type: 'dragEnd' })],
      ['drop', () => send({ type: 'drop', sourceKey: a, targetKey: c, place: 'after' })],
    ]
    for (const [label, hide] of paths) {
      send({ type: 'hover', key: a, x: 12, y: 0 })
      await wait(0)
      send({ type: 'toggleGrab' })
      await wait(0)
      hide()
      await wait(0)
      // The observable consequence: hover works again.
      send({ type: 'hover', key: a, x: 12, y: 0 })
      await wait(0)
      expect(handleEl(), `wedged after ${label}`).not.toBeNull()
    }
  })
})
