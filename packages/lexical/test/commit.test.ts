// The commit hub's contract (issue #74): one listener, one read, memoized
// geometry, and — the part that is easy to get wrong — emissions that never
// escape while the read-only context is on the stack.

import { describe, it, expect, vi } from 'vitest'
import { createHeadlessEditor } from '@lexical/headless'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isTextNode,
  type LexicalEditor,
} from 'lexical'
import { $findMatchingParent } from '@lexical/utils'
import { createCommitHub, type CommitFacts } from '../src/commit.js'

function editorWith(text: string): LexicalEditor {
  const editor = createHeadlessEditor({
    namespace: 'commit-hub',
    onError: (e) => {
      throw e
    },
  })
  editor.update(
    () => {
      const node = $createTextNode(text)
      $getRoot().clear().append($createParagraphNode().append(node))
      node.select(text.length, text.length)
    },
    { discrete: true },
  )
  return editor
}

describe('createCommitHub', () => {
  it('registers no update listener until something subscribes', () => {
    const editor = editorWith('hi')
    let registrations = 0
    const original = editor.registerUpdateListener.bind(editor)
    editor.registerUpdateListener = (listener) => {
      registrations++
      return original(listener)
    }

    const hub = createCommitHub(editor, () => {})
    expect(registrations).toBe(0)

    const off = hub.onCommit(() => {})
    expect(registrations).toBe(1)

    // A second subscriber shares the one listener.
    const offSecond = hub.onCommit(() => {})
    expect(registrations).toBe(1)
    off()
    offSecond()
    hub.dispose()
  })

  it('gives the update listener back when the LAST subscriber leaves', () => {
    // "No subscriber, no listener" has to keep holding after a plugin is
    // disposed, not only before it registered — otherwise the lazy registration
    // is a one-shot property that a single disposal retires for the rest of the
    // editor's life. `dispatch` already early-returns on an empty set, so nothing
    // observably breaks without this; that is exactly why it needs a test.
    const editor = editorWith('hi')
    let live = 0
    const original = editor.registerUpdateListener.bind(editor)
    editor.registerUpdateListener = (listener) => {
      live++
      const dispose = original(listener)
      return () => {
        live--
        dispose()
      }
    }

    const hub = createCommitHub(editor, () => {})
    const off = hub.onCommit(() => {})
    const offSecond = hub.onCommit(() => {})
    expect(live).toBe(1)

    off()
    // One subscriber left: the listener stays.
    expect(live).toBe(1)
    offSecond()
    expect(live).toBe(0)

    // And re-subscribing brings it back — the hub is reusable, not spent.
    let commits = 0
    const offThird = hub.onCommit(() => commits++)
    expect(live).toBe(1)
    editor.update(
      () => {
        $getRoot().getFirstDescendant()?.selectStart()
      },
      { discrete: true },
    )
    expect(commits).toBe(1)

    offThird()
    hub.dispose()
  })

  it('hands every subscriber the SAME facts object, derived once', () => {
    const editor = editorWith('hello')
    const hub = createCommitHub(editor, () => {})
    const seen: CommitFacts[] = []
    hub.onCommit((f) => seen.push(f))
    hub.onCommit((f) => seen.push(f))

    editor.update(
      () => {
        $getRoot().getFirstDescendant()?.selectStart()
      },
      { discrete: true },
    )

    expect(seen).toHaveLength(2)
    expect(seen[0]).toBe(seen[1])
    hub.dispose()
  })

  it('walks the ancestor chain once and matches $findMatchingParent exactly', () => {
    const editor = editorWith('hello')
    const hub = createCommitHub(editor, () => {})
    let walks = 0
    const seen: Array<{ shared: string[]; viaUtil: string | null; sameArray: boolean }> = []
    hub.onCommit((f) => {
      const anchor = f.anchorNode
      if (anchor === null) return
      // Count the tree climbs the memo actually performs: `getParent` is what a
      // chain walk costs, and three plugins asking for the same anchor must
      // produce exactly one.
      const first = f.ancestorsOf(anchor)
      const second = f.ancestorsOf(anchor)
      const third = f.ancestorsOf(anchor)
      walks = new Set([first, second, third]).size
      seen.push({
        shared: first.map((n) => n.getType()),
        // `$findMatchingParent` is what the plugins used to call; the shared
        // chain must give the same answer for any predicate.
        viaUtil: $findMatchingParent(anchor, (n) => n.getType() === 'paragraph')?.getType() ?? null,
        sameArray: first === second,
      })
    })

    editor.update(
      () => {
        $getRoot().getFirstDescendant()?.selectStart()
      },
      { discrete: true },
    )

    expect(walks).toBe(1)
    expect(seen[0]?.sameArray).toBe(true)
    // Anchor node inclusive, root exclusive — `$findMatchingParent`'s contract.
    expect(seen[0]?.shared).toEqual(['text', 'paragraph'])
    expect(seen[0]?.viaUtil).toBe('paragraph')
    hub.dispose()
  })

  it('derives the typeahead trigger substring shared by slash / mention / wikilink', () => {
    const editor = editorWith('say /he')
    const hub = createCommitHub(editor, () => {})
    // Copy the values out — a facts object is scoped to its callback.
    const seen: Array<{ collapsed: boolean; before: string | null }> = []
    hub.onCommit((f) => seen.push({ collapsed: f.isCollapsed, before: f.textBeforeCaret }))
    editor.update(
      () => {
        const node = $getRoot().getFirstDescendant()
        if (node !== null && 'select' in node) node.selectEnd()
      },
      { discrete: true },
    )
    expect(seen).toEqual([{ collapsed: true, before: 'say /he' }])
    hub.dispose()
  })

  it('reports no trigger substring for a non-collapsed selection', () => {
    // `textBeforeCaret` is derived LAZILY (it is an O(text-node) string copy that
    // only the three typeaheads read), so the condition it guards on lives in a
    // getter rather than in the eager derivation — a place a narrowing mistake
    // can hide. All three typeaheads treat null as "no query".
    const editor = editorWith('say /he')
    const hub = createCommitHub(editor, () => {})
    const seen: Array<{ collapsed: boolean; before: string | null }> = []
    hub.onCommit((f) => seen.push({ collapsed: f.isCollapsed, before: f.textBeforeCaret }))
    editor.update(
      () => {
        const node = $getRoot().getFirstDescendant()
        if ($isTextNode(node)) node.select(0, 3)
      },
      { discrete: true },
    )
    expect(seen).toEqual([{ collapsed: false, before: null }])
    hub.dispose()
  })

  it('derives the trigger substring lazily, and exactly once per commit', () => {
    // EXACTLY one, and both halves of that matter. The count is taken from inside
    // a subscriber, so an eager derivation scores 0 (the slice already happened
    // before anyone asked — the cost an editor running only `table` +
    // `code-language` should never pay) and an unmemoized getter scores 3 (three
    // typeaheads read the field twice each: a null check, then a `match`).
    const editor = editorWith('say /he')
    const hub = createCommitHub(editor, () => {})
    let slices = 0
    const reads: Array<string | null> = []
    hub.onCommit((f) => {
      const anchor = f.anchorNode
      if (anchor === null) return
      const original = anchor.getTextContent.bind(anchor)
      // Count the string copies the getter performs, not the field reads.
      anchor.getTextContent = () => {
        slices++
        return original()
      }
      reads.push(f.textBeforeCaret, f.textBeforeCaret, f.textBeforeCaret)
      anchor.getTextContent = original
    })
    editor.update(
      () => {
        const node = $getRoot().getFirstDescendant()
        if (node !== null && 'select' in node) node.selectEnd()
      },
      { discrete: true },
    )
    expect(reads).toEqual(['say /he', 'say /he', 'say /he'])
    expect(slices).toBe(1)
    hub.dispose()
  })

  it('marks a commit that dirtied nothing as selection-only', () => {
    const editor = editorWith('abc')
    const hub = createCommitHub(editor, () => {})
    const flags: boolean[] = []
    hub.onCommit((f) => flags.push(f.selectionOnly))

    editor.update(
      () => {
        $getRoot().getFirstDescendant()?.selectStart()
      },
      { discrete: true },
    )
    editor.update(
      () => {
        $getRoot().append($createParagraphNode())
      },
      { discrete: true },
    )

    expect(flags).toEqual([true, false])
    hub.dispose()
  })

  it('buffers emissions until the read context has closed', () => {
    const editor = editorWith('abc')
    // Under 0.49 a dispatch made while a read-only context is on the stack is
    // rerouted through `$beginUpdate` and warned about in dev; under 0.48 it was
    // silently dropped. The hub makes that shape unrepresentable, so record
    // whether each emission arrived inside or outside the read.
    const insideRead: boolean[] = []
    let reading = false
    const hub = createCommitHub<string>(editor, () => insideRead.push(reading))
    hub.onCommit(() => {
      reading = true
      hub.emit('a')
      hub.emit('b')
      reading = false
    })

    editor.update(
      () => {
        $getRoot().getFirstDescendant()?.selectStart()
      },
      { discrete: true },
    )

    expect(insideRead).toEqual([false, false])
    hub.dispose()
  })

  it('delivers each buffered emission exactly once when a reducer re-enters the hub', () => {
    // The re-entrancy hazard the drain has to survive. LLui's `send` is
    // SYNCHRONOUS, so a drained emission runs its host reducer — and everything
    // the reducer's commit triggers — while the drain is still in flight. If that
    // work re-enters the hub, `dispatching` is already back at 0, so the nested
    // call starts a drain of its OWN. Unless the outer drain took ownership of its
    // batch first, the nested one re-sends everything already sent.
    //
    // `withFacts` is the synchronous re-entry that is actually reachable: it is
    // part of the plugin contract (the scroll/resize path) and nothing stops a
    // reducer or effect from calling it. A nested `editor.update` is NOT the
    // trigger — Lexical queues an update raised from inside its update-listener
    // loop and commits it after the loop returns — so do not "simplify" the fix
    // on the theory that only a nested commit could re-enter.
    const editor = editorWith('abc')
    const received: string[] = []
    let reentered = false
    const hub = createCommitHub<string>(editor, (msg) => {
      received.push(msg)
      if (msg !== 'a' || reentered) return
      reentered = true
      // Stand-in for a reducer/effect re-deriving geometry mid-dispatch.
      hub.withFacts(() => {
        hub.emit('x')
      })
    })
    hub.onCommit(() => {
      hub.emit('a')
      hub.emit('b')
    })

    editor.update(
      () => {
        $getRoot().getFirstDescendant()?.selectStart()
      },
      { discrete: true },
    )

    // `a` reaches the reducer, whose re-entrant `withFacts` runs to completion
    // (`x`), and only then does the outer batch resume with `b`. Every message
    // appears exactly once, in emission order.
    expect(received).toEqual(['a', 'x', 'b'])
    hub.dispose()
  })

  it('does not replay already-delivered emissions when an emit throws mid-drain', () => {
    // A throwing host reducer must stay the host's problem. It may not abort the
    // Lexical commit it is dispatched from (the update-listener loop has no
    // isolation of its own — cf. 7a284002), it may not strand the emissions
    // queued behind it, and — the silent one — it may not leave the queue
    // populated so the NEXT commit re-sends what was already delivered.
    const editor = editorWith('abc')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const received: string[] = []
    const hub = createCommitHub<string>(editor, (msg) => {
      received.push(msg)
      if (msg === 'boom') throw new Error('reducer blew up')
    })
    hub.onCommit(() => {
      hub.emit('boom')
      hub.emit('after')
    })

    const commit = (): void =>
      editor.update(
        () => {
          const node = $getRoot().getFirstDescendant()
          if (node !== null && 'select' in node) node.selectStart()
          else node?.selectStart()
        },
        { discrete: true },
      )

    expect(commit).not.toThrow()
    expect(commit).not.toThrow()

    // Two commits, two emissions each — never the first commit's replayed.
    expect(received).toEqual(['boom', 'after', 'boom', 'after'])
    // Isolated, not swallowed.
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
    hub.dispose()
  })

  it('isolates a throwing subscriber from the others and from the commit', () => {
    // Lexical dispatches update listeners in a bare loop, so before the hub one
    // throwing plugin took the other five down with it. Collapsing six listeners
    // into one makes that a single place to fix — and an obligation to.
    const editor = editorWith('abc')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ran: string[] = []
    const hub = createCommitHub(editor, () => {})
    hub.onCommit(() => {
      ran.push('first')
    })
    hub.onCommit(() => {
      throw new Error('plugin blew up')
    })
    hub.onCommit(() => {
      ran.push('third')
    })

    expect(() =>
      editor.update(
        () => {
          $getRoot().getFirstDescendant()?.selectStart()
        },
        { discrete: true },
      ),
    ).not.toThrow()

    expect(ran).toEqual(['first', 'third'])
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
    hub.dispose()
  })

  it('refreshes every subscriber BEFORE draining any emission (batched, not interleaved)', () => {
    // THE ORDERING CONTRACT (issue #74). Before the hub each plugin owned its own
    // update listener, so a commit ran A-refresh → A-emit → B-refresh → B-emit:
    // plugin A's overlay had already reconciled by the time plugin B measured.
    // The hub batches instead — every subscriber refreshes inside the one shared
    // read, then every emission drains in subscription order.
    //
    // This is a deliberate behavioural change, accepted because it is the SAFER
    // order (no reconcile can move layout under a later plugin's measurement) and
    // because no reducer reachable from a commit-time emission writes back to the
    // editor — pinned for the six shipped plugins by the sibling test in
    // `@llui/markdown-editor` (`commit-cost.test.ts`). Anything that reintroduces
    // interleaving must fail HERE rather than quietly change when overlays move.
    const editor = editorWith('abc')
    const log: string[] = []
    const hub = createCommitHub<string>(editor, (msg) => log.push(`emit:${msg}`))
    for (const name of ['A', 'B', 'C']) {
      hub.onCommit(() => {
        log.push(`refresh:${name}`)
        hub.emit(name)
      })
    }

    editor.update(
      () => {
        $getRoot().getFirstDescendant()?.selectStart()
      },
      { discrete: true },
    )

    expect(log).toEqual(['refresh:A', 'refresh:B', 'refresh:C', 'emit:A', 'emit:B', 'emit:C'])
    hub.dispose()
  })

  it('stops dispatching once disposed', () => {
    const editor = editorWith('abc')
    const hub = createCommitHub(editor, () => {})
    let commits = 0
    hub.onCommit(() => commits++)

    editor.update(
      () => {
        $getRoot().getFirstDescendant()?.selectStart()
      },
      { discrete: true },
    )
    expect(commits).toBe(1)

    hub.dispose()
    editor.update(
      () => {
        $getRoot().getFirstDescendant()?.selectEnd()
      },
      { discrete: true },
    )
    expect(commits).toBe(1)
  })
})
