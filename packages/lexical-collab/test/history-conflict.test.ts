// The collab ↔ built-in-history conflict is STRUCTURAL here, not a documented
// precondition (issue #72).
//
// A Yjs session replaces `@lexical/history` with a CRDT-scoped undo manager;
// leaving the local stack registered alongside it double-applies every undo and
// diverges the shared document. `lexicalForeign` already forces the built-in
// stack off whenever its `externalUndo` slot is filled — so the only thing that
// can go wrong is a consumer filling the OTHER slot (`register`) instead.
//
// These tests pin that a consumer cannot: `yjsCollab` exposes its registration
// only as `externalUndo`, and `foreign` carries the complete set of seam options
// a session requires, so wiring it is the same act as disabling local history.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { component, mountApp } from '@llui/dom'
import { lexicalForeign, type LexicalForeignOptions } from '@llui/lexical'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  CLEAR_HISTORY_COMMAND,
  type LexicalEditor,
} from 'lexical'
import { Doc as YDoc } from 'yjs'
import { yjsCollab, type YjsCollab } from '../src/index.js'
import { TestHub, TestProvider } from './network.js'

interface AppState {
  readonly: boolean
}
type AppMsg = { type: 'noop' }

function serialize(editor: LexicalEditor): string {
  return editor.getEditorState().read(() => $getRoot().getTextContent())
}

function deserialize(_editor: LexicalEditor, value: string): void {
  const root = $getRoot()
  root.clear()
  root.append($createParagraphNode().append($createTextNode(value)))
}

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

/** Mount the low-level seam, wiring `collab` through the ONLY route the handle
 * offers. Nothing here passes `history` — that is the whole point. */
function mountSeam(namespace: string, collab: YjsCollab | null): LexicalEditor {
  let editor: LexicalEditor | null = null
  const def = component<AppState, AppMsg, never>({
    name: 'CollabHistory',
    init: () => ({ readonly: false }),
    update: (s) => s,
    view: ({ state }) => [
      lexicalForeign({
        namespace,
        readonly: state.at('readonly'),
        serialize,
        deserialize,
        onReady: (e) => {
          editor = e
        },
        ...(collab ? collab.foreign : {}),
      }),
    ],
  })
  app = mountApp(container, def)
  if (!editor) throw new Error('editor was never handed to onReady')
  return editor
}

/** Is `@lexical/history` live on this editor? It is the only registrant of
 * `CLEAR_HISTORY_COMMAND` in this stack, and its handler returns `true`, so a
 * dispatch that reports "handled" means the built-in stack is registered. */
function builtInHistoryIsLive(editor: LexicalEditor): boolean {
  return editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined)
}

function makeCollab(id: string): YjsCollab {
  const doc = new YDoc()
  return yjsCollab({ id, doc, provider: new TestProvider(doc, new TestHub()) })
}

describe('yjsCollab ↔ lexicalForeign: the local history stack cannot survive', () => {
  it('leaves the built-in @lexical/history stack unregistered, with nothing passed by the host', () => {
    const editor = mountSeam('collab-history', makeCollab('room-history'))
    expect(builtInHistoryIsLive(editor)).toBe(false)
  })

  it('control: the same seam DOES register the built-in stack without the collab wiring', () => {
    const editor = mountSeam('plain-history', null)
    expect(builtInHistoryIsLive(editor)).toBe(true)
  })

  it('offers no `register` member, so the seam slot that keeps history cannot be filled', () => {
    const collab = makeCollab('room-shape')
    expect(Object.hasOwn(collab, 'register')).toBe(false)
    expect(typeof collab.externalUndo).toBe('function')
  })

  // The last residue: `register` and `externalUndo` take the same shape, so
  // dropping the `register` MEMBER only closes the name-directed route —
  // `lexicalForeign({ register: collab.externalUndo })` would still have
  // compiled. The `ExternalUndoOwner` brand closes it in the type system.
  it('is rejected from the seam’s `register` slot (compile-time)', () => {
    const collab = makeCollab('room-brand')
    const options: Pick<LexicalForeignOptions, 'register'> = {
      // @ts-expect-error — a branded undo owner cannot fill `register`; that slot
      // leaves the built-in `@lexical/history` stack registered (#72). An "unused
      // '@ts-expect-error' directive" error here means this test went vacuous.
      register: collab.externalUndo,
    }
    // The rejection is purely type-level: it is the same live function, so the
    // guard costs nothing at runtime.
    expect(options.register).toBe(collab.externalUndo)
  })

  it('control: a plain registration function still fits `register` unchanged', () => {
    // `@llui/lexical-loro` splits `register` + `externalUndo` and passes plain
    // functions for both. The brand must not touch that.
    const plain: Pick<LexicalForeignOptions, 'register'> = {
      register: (_editor: LexicalEditor) => () => {},
    }
    expect(typeof plain.register).toBe('function')
  })

  it('carries every seam option a session requires in `foreign`', () => {
    const collab = makeCollab('room-foreign')
    // Typed against the seam itself: a fragment that stopped being spreadable
    // into `lexicalForeign` would fail to compile here.
    const spreadable: Pick<LexicalForeignOptions, 'externalUndo' | 'seedMode'> = collab.foreign
    expect(spreadable.externalUndo).toBe(collab.externalUndo)
    expect(spreadable.seedMode).toBe('deferred')
  })
})
