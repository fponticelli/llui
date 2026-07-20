import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHeadlessEditor } from '@lexical/headless'
import { $convertFromMarkdownString, $convertToMarkdownString, CODE } from '@lexical/markdown'
import { $createParagraphNode, $getRoot, type LexicalEditor } from 'lexical'
import { $isCodeNode } from '@lexical/code-core'
import { mountApp } from '@llui/dom'
import { corePlugin } from '../src/plugins/core.js'
import {
  CODE_INFO_TRANSFORMER,
  codeLanguagePlugin,
  normalizeCodeInfo,
  type CodeLanguageMsg,
  type CodeLanguageState,
} from '../src/plugins/code-language.js'
import { buildTransformers } from '../src/transformers/registry.js'
import { GFM_NODES } from '../src/transformers/gfm.js'
import { markdownEditor } from '../src/editor.js'

// Order is irrelevant here: both plugins contribute the same
// `CODE_INFO_TRANSFORMER` reference and the registry de-duplicates it. See the
// 'transformer precedence' block below, which pins that.
const transformers = buildTransformers([codeLanguagePlugin(), corePlugin()])

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Parsed {
  markdown: string
  language: string | null | undefined
  code: string
  isCode: boolean
}

function parse(markdown: string): Parsed {
  const editor = createHeadlessEditor({
    namespace: 'code-lang',
    nodes: [...GFM_NODES],
    onError: (e) => {
      throw e
    },
  })
  editor.update(() => $convertFromMarkdownString(markdown, transformers), { discrete: true })
  return editor.getEditorState().read(() => {
    const first = $getRoot().getFirstChild()
    return {
      markdown: $convertToMarkdownString(transformers),
      language: $isCodeNode(first) ? first.getLanguage() : undefined,
      code: $isCodeNode(first) ? first.getTextContent() : '',
      isCode: $isCodeNode(first),
    }
  })
}

const roundtrip = (markdown: string): string => parse(markdown).markdown

describe('normalizeCodeInfo', () => {
  it('maps absent / blank info strings to null', () => {
    expect(normalizeCodeInfo(undefined)).toBeNull()
    expect(normalizeCodeInfo(null)).toBeNull()
    expect(normalizeCodeInfo('')).toBeNull()
    expect(normalizeCodeInfo('   ')).toBeNull()
    expect(normalizeCodeInfo('\t')).toBeNull()
  })

  it('keeps an arbitrary token verbatim, trimming only the edges', () => {
    expect(normalizeCodeInfo('ts')).toBe('ts')
    expect(normalizeCodeInfo('  lance table  ')).toBe('lance table')
    expect(normalizeCodeInfo('c++')).toBe('c++')
    expect(normalizeCodeInfo('objective-c')).toBe('objective-c')
    expect(normalizeCodeInfo('{.foo #bar}')).toBe('{.foo #bar}')
  })

  it('strips characters that would make the exported fence unparseable', () => {
    // A backtick in a backtick-fenced info string is illegal in CommonMark and
    // a newline would end the fence line — either would emit markdown that no
    // longer re-imports to the same block.
    expect(normalizeCodeInfo('ts`x')).toBe('tsx')
    expect(normalizeCodeInfo('a\nb')).toBe('a b')
    expect(normalizeCodeInfo('```')).toBeNull()
  })
})

describe('code fence info-string round-trip', () => {
  const cases: Array<[string, string]> = [
    ['bare fence', '```\nconst a = 1\n```'],
    ['single-token language', '```ts\nconst a: number = 1\n```'],
    ['downstream marker', '```lance\nsum(x)\n```'],
    ['multi-token info string', '```lance table\nsum(x)\n```'],
    ['three-token info string', '```lance table strict\nsum(x)\n```'],
    ['non-word characters', '```c++\nint main() {}\n```'],
    ['dotted language', '```objective-c\nid x;\n```'],
    ['multi-line body', '```py\na = 1\nb = 2\n\nc = 3\n```'],
    ['empty body', '```\n```'],
    ['empty body with language', '```ts\n```'],
  ]

  for (const [name, md] of cases) {
    it(`${name} survives markdown → editor → markdown`, () => {
      expect(roundtrip(md)).toBe(md)
    })
  }

  it('surfaces the language on the node', () => {
    expect(parse('```ts\nx\n```').language).toBe('ts')
    expect(parse('```lance\nx\n```').language).toBe('lance')
  })

  it('a bare fence has a null language and never gains a spurious one', () => {
    const parsed = parse('```\nplain\n```')
    expect(parsed.isCode).toBe(true)
    expect(normalizeCodeInfo(parsed.language)).toBeNull()
    expect(parsed.markdown).toBe('```\nplain\n```')
  })

  it('a fence whose info string is only whitespace stays bare', () => {
    const parsed = parse('```   \nplain\n```')
    expect(normalizeCodeInfo(parsed.language)).toBeNull()
    expect(parsed.markdown).toBe('```\nplain\n```')
  })

  it('keeps a multi-token info string OUT of the code body', () => {
    // Regression against @lexical/markdown's CODE transformer, whose
    // `([\w-]+)?` info capture takes only the first token and pushes the rest
    // ('table') into the code content, silently corrupting the block.
    const parsed = parse('```lance table\nsum(x)\n```')
    expect(parsed.language).toBe('lance table')
    expect(parsed.code).toBe('sum(x)')
  })

  it('keeps a non-word language OUT of the code body', () => {
    const parsed = parse('```c++\nint main() {}\n```')
    expect(parsed.language).toBe('c++')
    expect(parsed.code).toBe('int main() {}')
  })

  it('normalizes surrounding whitespace in the info string', () => {
    expect(roundtrip('```   ts   \nx\n```')).toBe('```ts\nx\n```')
  })

  it('widens the exported fence when the body contains a fence run', () => {
    const out = roundtrip('````ts\n```\nnested\n```\n````')
    expect(out).toBe('````ts\n```\nnested\n```\n````')
    // And the widened block still re-imports to the same content.
    expect(parse(out).code).toBe('```\nnested\n```')
    expect(parse(out).language).toBe('ts')
  })

  it('treats a longer fence as the terminator only at matching width', () => {
    const parsed = parse('````lance table\n```\nx\n```\n````')
    expect(parsed.language).toBe('lance table')
    expect(parsed.code).toBe('```\nx\n```')
  })

  it('closes an unterminated fence at the end of the document', () => {
    const parsed = parse('```ts\nconst a = 1')
    expect(parsed.language).toBe('ts')
    expect(parsed.code).toBe('const a = 1')
  })

  it('treats a single-line fence as content with no language (matching Lexical)', () => {
    const parsed = parse('```inline```')
    expect(parsed.isCode).toBe(true)
    expect(normalizeCodeInfo(parsed.language)).toBeNull()
    expect(parsed.code).toBe('inline')
  })

  it('does not disturb non-code markdown', () => {
    expect(roundtrip('# Heading')).toBe('# Heading')
    expect(roundtrip('Some **bold** text')).toBe('Some **bold** text')
    expect(roundtrip('- one\n- two')).toBe('- one\n- two')
  })

  it('round-trips a code block among other blocks', () => {
    const md = '# Title\n\n```lance table\nsum(x)\n```\n\nAfter'
    expect(roundtrip(md)).toBe(md)
  })
})

describe('transformer precedence', () => {
  it('is the code transformer `corePlugin()` ships', () => {
    // `CODE_INFO_TRANSFORMER` is part of `GFM_TRANSFORMERS`, so a consumer gets
    // the CommonMark-correct parse whether or not they enable this plugin.
    const built = buildTransformers([corePlugin()])
    expect(built.filter((t) => t.type === 'multiline-element')).toContain(CODE_INFO_TRANSFORMER)
  })

  it('is contributed once no matter how the plugins are ordered', () => {
    // Both plugins contribute the SAME reference, so the registry's identity
    // de-duplication collapses them and order cannot change the parse. If
    // either ever contributes a distinct copy, two multiline transformers race.
    for (const plugins of [
      [codeLanguagePlugin(), corePlugin()],
      [corePlugin(), codeLanguagePlugin()],
    ]) {
      const built = buildTransformers(plugins)
      expect(built.filter((t) => t === CODE_INFO_TRANSFORMER)).toHaveLength(1)
      expect(built.filter((t) => t.type === 'multiline-element')).toHaveLength(1)
    }
  })

  it('upstream `CODE` corrupts a multi-token info string — why we replaced it', () => {
    // Pins the upstream defect DIRECTLY (not via `corePlugin()`, which no longer
    // ships it). If this ever starts failing, `@lexical/markdown` fixed its
    // `([\w-]+)?` info-string capture and `transformers/code.ts` can be
    // reconsidered.
    const editor = createHeadlessEditor({
      namespace: 'upstream-code',
      nodes: [...GFM_NODES],
      onError: (e) => {
        throw e
      },
    })
    editor.update(() => $convertFromMarkdownString('```lance table\nsum(x)\n```', [CODE]), {
      discrete: true,
    })
    const code = editor.getEditorState().read(() => {
      const first = $getRoot().getFirstChild()
      return $isCodeNode(first) ? first.getTextContent() : ''
    })
    expect(code).toBe('table\nsum(x)')
  })
})

describe('typed-shortcut path (transformer.replace with children)', () => {
  // `registerMarkdownShortcuts` calls `replace(parent, siblings, match, ...)`
  // when the user types an opening fence — the info string must be picked up
  // there too, not only on import.
  function typeFence(line: string): { language: string | null | undefined; isCode: boolean } {
    const editor = createHeadlessEditor({
      namespace: 'shortcut',
      nodes: [...GFM_NODES],
      onError: (e) => {
        throw e
      },
    })
    editor.update(
      () => {
        const paragraph = $createParagraphNode()
        $getRoot().clear().append(paragraph)
        const match = line.match(CODE_INFO_TRANSFORMER.regExpStart)
        if (!match) throw new Error(`regExpStart did not match ${JSON.stringify(line)}`)
        CODE_INFO_TRANSFORMER.replace(paragraph, [], match, null, null, false)
      },
      { discrete: true },
    )
    return editor.getEditorState().read(() => {
      const first = $getRoot().getFirstChild()
      return {
        language: $isCodeNode(first) ? first.getLanguage() : undefined,
        isCode: $isCodeNode(first),
      }
    })
  }

  it('creates a bare code block from a bare fence', () => {
    const result = typeFence('``` ')
    expect(result.isCode).toBe(true)
    expect(normalizeCodeInfo(result.language)).toBeNull()
  })

  it('creates a code block carrying the typed language', () => {
    expect(typeFence('```ts ').language).toBe('ts')
  })

  // HONESTY NOTE (adversarial review). `typeFence` calls the transformer's
  // `replace` directly, so it bypasses `registerMarkdownShortcuts`' length gate
  // (`match[0].length !== matchLength`). In the LIVE editor that gate is
  // satisfied the moment the user types the first space — `FENCE_START`'s
  // `(.*)$` consumes the whole line — so the conversion fires with
  // `language = 'lance'` and everything typed afterwards lands in the code body.
  //
  // The transformer therefore handles a multi-token info string correctly, but
  // TYPING one is not a way to produce it: multi-token info strings arrive via
  // import/paste or the language badge. This test pins the transformer's
  // contract, not a reachable typing interaction — hence the renamed title.
  it('accepts a multi-token info string when `replace` is invoked directly', () => {
    expect(typeFence('```lance table ').language).toBe('lance table')
  })
})

describe('standalone use (no corePlugin)', () => {
  it('registers its own nodes and round-trips a fence', () => {
    const only = buildTransformers([codeLanguagePlugin()])
    const editor = createHeadlessEditor({
      namespace: 'standalone',
      nodes: [...(codeLanguagePlugin().nodes ?? [])],
      onError: (e) => {
        throw e
      },
    })
    editor.update(() => $convertFromMarkdownString('```lance table\nsum(x)\n```', only), {
      discrete: true,
    })
    expect(editor.getEditorState().read(() => $convertToMarkdownString(only))).toBe(
      '```lance table\nsum(x)\n```',
    )
  })
})

// ── Pure reducer ────────────────────────────────────────────────────────────

function reducerOf(): (
  state: CodeLanguageState,
  msg: CodeLanguageMsg,
) => [CodeLanguageState, unknown[]] {
  const ui = codeLanguagePlugin().ui
  if (!ui?.update) throw new Error('codeLanguagePlugin must expose a UI reducer')
  const update = ui.update
  return (state, msg) => {
    const result = update(state, msg)
    return Array.isArray(result)
      ? [result[0] as CodeLanguageState, result[1] as unknown[]]
      : [result as CodeLanguageState, []]
  }
}

function initialState(): CodeLanguageState {
  const ui = codeLanguagePlugin().ui
  if (!ui) throw new Error('codeLanguagePlugin must expose a UI')
  return ui.init() as CodeLanguageState
}

describe('code-language reducer', () => {
  const reduce = reducerOf()

  it('starts closed', () => {
    const state = initialState()
    expect(state.open).toBe(false)
    expect(state.key).toBe('')
    expect(state.language).toBe('')
    expect(state.editing).toBe(false)
  })

  it('opens at the anchor with the block language', () => {
    const [next] = reduce(initialState(), {
      type: 'show',
      key: '7',
      x: 10,
      y: 20,
      language: 'ts',
    })
    expect(next).toMatchObject({ open: true, key: '7', x: 10, y: 20, language: 'ts' })
  })

  it('shows an empty value for a bare fence', () => {
    const [next] = reduce(initialState(), { type: 'show', key: '7', x: 0, y: 0, language: null })
    expect(next.language).toBe('')
    expect(next.open).toBe(true)
  })

  it('is idempotent on an unchanged show (no reconcile churn)', () => {
    const [a] = reduce(initialState(), { type: 'show', key: '7', x: 1, y: 2, language: 'ts' })
    const [b] = reduce(a, { type: 'show', key: '7', x: 1, y: 2, language: 'ts' })
    expect(b).toBe(a)
  })

  it('hides', () => {
    const [open] = reduce(initialState(), { type: 'show', key: '7', x: 1, y: 2, language: 'ts' })
    const [hidden] = reduce(open, { type: 'hide' })
    expect(hidden.open).toBe(false)
  })

  it('preserves the reference when hiding an already-closed overlay', () => {
    const state = initialState()
    const [next] = reduce(state, { type: 'hide' })
    expect(next).toBe(state)
  })

  it('does not clobber an in-flight edit when the anchor refreshes', () => {
    let [state] = reduce(initialState(), { type: 'show', key: '7', x: 1, y: 2, language: 'ts' })
    ;[state] = reduce(state, { type: 'edit' })
    ;[state] = reduce(state, { type: 'input', language: 'lan' })
    // The register listener re-emits `show` for the same block on every editor
    // update; it must not overwrite what the user is typing.
    ;[state] = reduce(state, { type: 'show', key: '7', x: 5, y: 9, language: 'ts' })
    expect(state.language).toBe('lan')
    expect(state.x).toBe(5)
    expect(state.y).toBe(9)
  })

  it('drops an in-flight edit when the anchor moves to a different block', () => {
    let [state] = reduce(initialState(), { type: 'show', key: '7', x: 1, y: 2, language: 'ts' })
    ;[state] = reduce(state, { type: 'edit' })
    ;[state] = reduce(state, { type: 'input', language: 'lan' })
    ;[state] = reduce(state, { type: 'show', key: '9', x: 1, y: 2, language: 'py' })
    expect(state.key).toBe('9')
    expect(state.language).toBe('py')
    expect(state.editing).toBe(false)
  })

  it('commits the edited info string as an apply effect', () => {
    let [state] = reduce(initialState(), { type: 'show', key: '7', x: 1, y: 2, language: 'ts' })
    ;[state] = reduce(state, { type: 'edit' })
    ;[state] = reduce(state, { type: 'input', language: 'lance table' })
    const [committed, effects] = reduce(state, { type: 'commit' })
    expect(effects).toEqual([{ type: 'apply', key: '7', language: 'lance table' }])
    expect(committed.editing).toBe(false)
  })

  it('commits an empty value as a language removal (bare fence)', () => {
    let [state] = reduce(initialState(), { type: 'show', key: '7', x: 1, y: 2, language: 'ts' })
    ;[state] = reduce(state, { type: 'edit' })
    ;[state] = reduce(state, { type: 'input', language: '' })
    const [, effects] = reduce(state, { type: 'commit' })
    expect(effects).toEqual([{ type: 'apply', key: '7', language: null }])
  })

  it('emits no effect when committing an unchanged value', () => {
    let [state] = reduce(initialState(), { type: 'show', key: '7', x: 1, y: 2, language: 'ts' })
    ;[state] = reduce(state, { type: 'edit' })
    const [, effects] = reduce(state, { type: 'commit' })
    expect(effects).toEqual([])
  })

  it('emits no effect when a bare fence is committed still bare', () => {
    let [state] = reduce(initialState(), { type: 'show', key: '7', x: 1, y: 2, language: null })
    ;[state] = reduce(state, { type: 'edit' })
    ;[state] = reduce(state, { type: 'input', language: '   ' })
    const [, effects] = reduce(state, { type: 'commit' })
    expect(effects).toEqual([])
  })

  it('cancel restores the committed value and emits nothing', () => {
    let [state] = reduce(initialState(), { type: 'show', key: '7', x: 1, y: 2, language: 'ts' })
    ;[state] = reduce(state, { type: 'edit' })
    ;[state] = reduce(state, { type: 'input', language: 'nonsense' })
    const [cancelled, effects] = reduce(state, { type: 'cancel' })
    expect(effects).toEqual([])
    expect(cancelled.language).toBe('ts')
    expect(cancelled.editing).toBe(false)
  })

  it('defers a hide requested while editing until the edit ends', () => {
    // Focusing the overlay input can collapse the editor selection, which makes
    // the register listener emit `hide` — closing the overlay out from under the
    // user mid-keystroke. The hide is remembered and applied on commit instead.
    let [state] = reduce(initialState(), { type: 'show', key: '7', x: 1, y: 2, language: 'ts' })
    ;[state] = reduce(state, { type: 'edit' })
    ;[state] = reduce(state, { type: 'hide' })
    expect(state.open).toBe(true)
    ;[state] = reduce(state, { type: 'input', language: 'py' })
    expect(state.open).toBe(true)
    const [closed, effects] = reduce(state, { type: 'commit' })
    expect(closed.open).toBe(false)
    expect(effects).toEqual([{ type: 'apply', key: '7', language: 'py' }])
  })

  it('applies a deferred hide on cancel too', () => {
    let [state] = reduce(initialState(), { type: 'show', key: '7', x: 1, y: 2, language: 'ts' })
    ;[state] = reduce(state, { type: 'edit' })
    ;[state] = reduce(state, { type: 'hide' })
    const [closed] = reduce(state, { type: 'cancel' })
    expect(closed.open).toBe(false)
  })

  // REVISED (adversarial review). This previously asserted that a re-`show`
  // while editing CLEARS the deferred hide. That pinned a bug: `show` is
  // re-emitted by `onViewportChange(refresh)` on every scroll and resize, from
  // the block under Lexical's RETAINED selection — it carries no evidence that
  // the caret came back. Honouring it dropped the pending hide, so a scroll
  // while the input was focused left the badge anchored over a block the caret
  // had already left. A deferred hide now survives a same-block refresh, for
  // the same reason `language` and `editing` do.
  it('keeps a deferred hide across a refresh-driven re-show while editing', () => {
    let [state] = reduce(initialState(), { type: 'show', key: '7', x: 1, y: 2, language: 'ts' })
    ;[state] = reduce(state, { type: 'edit' })
    ;[state] = reduce(state, { type: 'hide' })
    ;[state] = reduce(state, { type: 'show', key: '7', x: 1, y: 2, language: 'ts' })
    const [committed] = reduce(state, { type: 'commit' })
    expect(committed.open).toBe(false)
  })

  it('still opens normally when a DIFFERENT block is shown after a deferred hide', () => {
    let [state] = reduce(initialState(), { type: 'show', key: '7', x: 1, y: 2, language: 'ts' })
    ;[state] = reduce(state, { type: 'edit' })
    ;[state] = reduce(state, { type: 'hide' })
    // A different key is not a refresh — it is a genuine move, so `keepEdit` is
    // false and the stale pending hide must not follow the badge to the new block.
    ;[state] = reduce(state, { type: 'show', key: '9', x: 1, y: 2, language: 'ts' })
    expect(state.pendingHide).toBe(false)
    const [committed] = reduce(state, { type: 'commit' })
    expect(committed.open).toBe(true)
  })
})

// ── Live editor integration ─────────────────────────────────────────────────

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

const INPUT_SELECTOR = '[data-scope="md-code-language"][data-part="input"]'

function mount(defaultValue: string, languages?: readonly string[]): Promise<LexicalEditor> {
  return new Promise((resolve) => {
    app = mountApp(
      container,
      markdownEditor({
        plugins: [codeLanguagePlugin(languages ? { languages } : {}), corePlugin()],
        defaultValue,
        onReady: (editor) => resolve(editor),
      }),
    )
  })
}

/** Put the caret at the start of the document's first code block. */
function selectCodeBlock(editor: LexicalEditor): void {
  editor.update(
    () => {
      const first = $getRoot().getFirstChild()
      if ($isCodeNode(first)) first.selectStart()
    },
    { discrete: true },
  )
}

function readMarkdown(editor: LexicalEditor): string {
  return editor.getEditorState().read(() => $convertToMarkdownString(transformers))
}

describe('code-language overlay (live editor)', () => {
  it('is hidden until the caret enters a code block', async () => {
    const editor = await mount('```ts\nconst a = 1\n```')
    await wait(0)
    expect(document.querySelector(INPUT_SELECTOR)).toBeNull()

    selectCodeBlock(editor)
    await wait(0)
    const input = document.querySelector(INPUT_SELECTOR) as HTMLInputElement | null
    expect(input).not.toBeNull()
    expect(input?.value).toBe('ts')
  })

  it('shows an empty, placeholder-labelled input for a bare fence', async () => {
    const editor = await mount('```\nplain\n```')
    selectCodeBlock(editor)
    await wait(0)
    const input = document.querySelector(INPUT_SELECTOR) as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.value).toBe('')
    expect(input.getAttribute('placeholder')).toBeTruthy()
    expect(input.getAttribute('aria-label')).toBe('Code block language')
  })

  it('a bare fence does not gain a language just by being visited', async () => {
    const editor = await mount('```\nplain\n```')
    selectCodeBlock(editor)
    await wait(0)
    const input = document.querySelector(INPUT_SELECTOR) as HTMLInputElement
    input.dispatchEvent(new FocusEvent('focus'))
    input.dispatchEvent(new FocusEvent('blur'))
    await wait(0)
    expect(readMarkdown(editor)).toBe('```\nplain\n```')
    expect(
      editor.getEditorState().read(() => {
        const first = $getRoot().getFirstChild()
        return $isCodeNode(first) ? normalizeCodeInfo(first.getLanguage()) : 'not-code'
      }),
    ).toBeNull()
  })

  it('typing a language and blurring writes it through to the markdown', async () => {
    const editor = await mount('```\nsum(x)\n```')
    selectCodeBlock(editor)
    await wait(0)
    const input = document.querySelector(INPUT_SELECTOR) as HTMLInputElement
    input.dispatchEvent(new FocusEvent('focus'))
    input.value = 'lance table'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new FocusEvent('blur'))
    await wait(0)
    expect(readMarkdown(editor)).toBe('```lance table\nsum(x)\n```')
  })

  it('Enter commits the edited language', async () => {
    const editor = await mount('```\nx\n```')
    selectCodeBlock(editor)
    await wait(0)
    const input = document.querySelector(INPUT_SELECTOR) as HTMLInputElement
    input.dispatchEvent(new FocusEvent('focus'))
    input.value = 'ts'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await wait(0)
    expect(readMarkdown(editor)).toBe('```ts\nx\n```')
  })

  it('Escape abandons the edit and restores the shown value', async () => {
    const editor = await mount('```ts\nx\n```')
    selectCodeBlock(editor)
    await wait(0)
    const input = document.querySelector(INPUT_SELECTOR) as HTMLInputElement
    input.dispatchEvent(new FocusEvent('focus'))
    input.value = 'garbage'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wait(0)
    expect(readMarkdown(editor)).toBe('```ts\nx\n```')
    expect((document.querySelector(INPUT_SELECTOR) as HTMLInputElement).value).toBe('ts')
  })

  it('clearing the language returns the block to a bare fence', async () => {
    const editor = await mount('```ts\nx\n```')
    selectCodeBlock(editor)
    await wait(0)
    const input = document.querySelector(INPUT_SELECTOR) as HTMLInputElement
    input.dispatchEvent(new FocusEvent('focus'))
    input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new FocusEvent('blur'))
    await wait(0)
    expect(readMarkdown(editor)).toBe('```\nx\n```')
  })

  it('offers configured languages as datalist suggestions without constraining input', async () => {
    const editor = await mount('```\nx\n```', ['ts', 'python', 'lance'])
    selectCodeBlock(editor)
    await wait(0)
    const input = document.querySelector(INPUT_SELECTOR) as HTMLInputElement
    const listId = input.getAttribute('list')
    expect(listId).toBeTruthy()
    const datalist = document.getElementById(listId as string)
    expect(datalist?.tagName.toLowerCase()).toBe('datalist')
    expect(
      [...(datalist?.querySelectorAll('option') ?? [])].map((o) => o.getAttribute('value')),
    ).toEqual(['ts', 'python', 'lance'])
    // A value outside the suggestion list is still accepted verbatim.
    input.dispatchEvent(new FocusEvent('focus'))
    input.value = 'lance table'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new FocusEvent('blur'))
    await wait(0)
    expect(readMarkdown(editor)).toBe('```lance table\nx\n```')
  })

  it('emits no datalist when no languages are configured', async () => {
    const editor = await mount('```\nx\n```')
    selectCodeBlock(editor)
    await wait(0)
    const input = document.querySelector(INPUT_SELECTOR) as HTMLInputElement
    expect(input.hasAttribute('list')).toBe(false)
  })

  it('stops its keystrokes from propagating to document-level editor handlers', async () => {
    const editor = await mount('```ts\nkeep me\n```')
    selectCodeBlock(editor)
    await wait(0)
    const input = document.querySelector(INPUT_SELECTOR) as HTMLInputElement
    const seen: string[] = []
    const spy = (e: Event): void => void seen.push((e as KeyboardEvent).key)
    document.addEventListener('keydown', spy)
    try {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    } finally {
      document.removeEventListener('keydown', spy)
    }
    await wait(0)
    expect(seen).toEqual([])
    expect(readMarkdown(editor)).toBe('```ts\nkeep me\n```')
  })
})

// ── Review findings (adversarial pass) ───────────────────────────────────────

describe('the typed path and the import path agree (MAJOR)', () => {
  it('treats a self-closing fence line as CONTENT in `replace`, as import does', () => {
    // `$convertFromMarkdownString('```inline```')` yields a code block with no
    // language whose text is `inline`. The typed shortcut MUST agree: without
    // this, typing the paragraph '```inline```' and pressing Enter produced an
    // EMPTY code block labelled 'inline' — the word was silently destroyed.
    const editor = createHeadlessEditor({
      namespace: 'code-single-line',
      nodes: [...GFM_NODES],
      onError: (e) => {
        throw e
      },
    })
    const source = '```inline```'
    const match = source.match(CODE_INFO_TRANSFORMER.regExpStart)
    expect(match).not.toBeNull()

    let typed: { language: string | null; text: string } | null = null
    editor.update(
      () => {
        const p = $createParagraphNode()
        $getRoot().clear().append(p)
        CODE_INFO_TRANSFORMER.replace?.(p, [], match as RegExpMatchArray, null, null, false)
        const first = $getRoot().getFirstChild()
        typed = {
          language: $isCodeNode(first) ? (first.getLanguage() ?? null) : null,
          text: first?.getTextContent() ?? '',
        }
      },
      { discrete: true },
    )

    // Compare against the IMPORT path rather than a hand-written literal: the
    // property under test is that the two agree, whatever the agreed value is.
    const imported = createHeadlessEditor({
      namespace: 'code-single-line-import',
      nodes: [...GFM_NODES],
      onError: (e) => {
        throw e
      },
    })
    imported.update(() => $convertFromMarkdownString(source, buildTransformers([corePlugin()])), {
      discrete: true,
    })
    const viaImport = imported.getEditorState().read(() => {
      const first = $getRoot().getFirstChild()
      return {
        language: $isCodeNode(first) ? (first.getLanguage() ?? null) : null,
        text: first?.getTextContent() ?? '',
      }
    })

    expect(viaImport).toEqual({ language: null, text: 'inline' })
    expect(typed).toEqual(viaImport)
  })
})

describe('the language badge is reachable from the keyboard (MINOR)', () => {
  it('contributes a command item that focuses the badge input', async () => {
    const plugin = codeLanguagePlugin()
    const item = plugin.items?.find((i) => i.id === 'codeLanguage')
    expect(item).toBeDefined()
    expect(item?.surfaces).toContain('slash')

    let editor!: LexicalEditor
    app = mountApp(
      container,
      markdownEditor({
        plugins: [corePlugin(), plugin],
        defaultValue: '```ts\nconst a = 1\n```',
        onReady: (e) => {
          editor = e
        },
      }),
    )
    await wait(0)
    editor.update(
      () => {
        const first = $getRoot().getFirstChild()
        if (first && 'select' in first) (first as unknown as { select(): void }).select()
      },
      { discrete: true },
    )
    await wait(0)

    const input = document.querySelector<HTMLInputElement>(
      '[data-scope="md-code-language"][data-part="input"]',
    )
    expect(input).not.toBeNull()

    item?.run(editor, { send: () => {} })
    await wait(0)
    expect(document.activeElement).toBe(input)
  })
})
