// URL-scheme policy: dangerous schemes must be neutralized at every editor
// ingress — the link commit / typed shortcut (global LinkNode transform), pasted
// or imported markdown links, and image src (insert + import transformer).

import { describe, it, expect } from 'vitest'
import { createHeadlessEditor } from '@lexical/headless'
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown'
import { $getRoot, type ElementNode } from 'lexical'
import { $isLinkNode, $toggleLink } from '@lexical/link'
import { $isLLuiDecoratorNode, LLuiDecoratorNode } from '@llui/lexical'
import { corePlugin } from '../src/plugins/core.js'
import { imagePlugin } from '../src/plugins/image.js'
import { buildTransformers } from '../src/transformers/registry.js'
import { GFM_NODES } from '../src/transformers/gfm.js'
import { $insertMarkdownAtSelection } from '../src/paste.js'
import {
  sanitizeLinkUrl,
  sanitizeImageUrl,
  $sanitizeLinkNodes,
  registerLinkSanitizer,
} from '../src/security.js'

const transformers = buildTransformers([corePlugin(), imagePlugin()])

function newEditor() {
  return createHeadlessEditor({
    namespace: 'security',
    nodes: [...GFM_NODES, LLuiDecoratorNode],
    onError: (e: Error) => {
      throw e
    },
  })
}

/** All link URLs found anywhere in the current document. */
function linkUrls(editor: ReturnType<typeof newEditor>): string[] {
  return editor.getEditorState().read(() => {
    const urls: string[] = []
    const visit = (node: import('lexical').LexicalNode): void => {
      if ($isLinkNode(node)) urls.push(node.getURL())
      if ('getChildren' in node) {
        for (const child of (node as import('lexical').ElementNode).getChildren()) visit(child)
      }
    }
    visit($getRoot())
    return urls
  })
}

/** All image decorator srcs in the current document. */
function imageSrcs(editor: ReturnType<typeof newEditor>): string[] {
  return editor.getEditorState().read(() => {
    const srcs: string[] = []
    const visit = (node: import('lexical').LexicalNode): void => {
      if ($isLLuiDecoratorNode(node) && node.getBridgeType() === 'image') {
        const data = node.getData() as { src?: string }
        if (typeof data.src === 'string') srcs.push(data.src)
      }
      if ('getChildren' in node) {
        for (const child of (node as import('lexical').ElementNode).getChildren()) visit(child)
      }
    }
    visit($getRoot())
    return srcs
  })
}

describe('URL sanitizers (shared @llui/markdown policy)', () => {
  it('drops javascript:/vbscript:/data: hyperlink schemes, keeps http/mailto/relative', () => {
    expect(sanitizeLinkUrl('javascript:alert(1)')).toBeNull()
    expect(sanitizeLinkUrl('JAVASCRIPT:alert(1)')).toBeNull()
    expect(sanitizeLinkUrl('vbscript:msgbox(1)')).toBeNull()
    expect(sanitizeLinkUrl('data:text/html,<script>alert(1)</script>')).toBeNull()
    expect(sanitizeLinkUrl('https://example.com')).toBe('https://example.com')
    expect(sanitizeLinkUrl('mailto:a@b.com')).toBe('mailto:a@b.com')
    expect(sanitizeLinkUrl('/relative/path')).toBe('/relative/path')
    // Obfuscation: a control char / tab hidden inside the scheme is still unsafe.
    expect(sanitizeLinkUrl('java\tscript:alert(1)')).toBeNull()
  })

  it('drops javascript: image src but ALLOWS data: images (non-executing)', () => {
    expect(sanitizeImageUrl('javascript:alert(1)')).toBeNull()
    expect(sanitizeImageUrl('https://example.com/a.png')).toBe('https://example.com/a.png')
    const dataUri = 'data:image/png;base64,iVBORw0KGgo='
    expect(sanitizeImageUrl(dataUri)).toBe(dataUri)
  })
})

describe('link commit ($toggleLink) — enforced by the global LinkNode transform', () => {
  it('neutralizes a javascript: URL committed via $toggleLink, keeps a safe one', () => {
    const editor = newEditor()
    const dispose = registerLinkSanitizer(editor)
    editor.update(() => $convertFromMarkdownString('select me', transformers), { discrete: true })
    // Select the paragraph and wrap it in a javascript: link, as the link dialog's
    // $toggleLink would; the global transform must strip it.
    editor.update(
      () => {
        ;($getRoot().getFirstChild() as ElementNode).select()
        $toggleLink('javascript:alert(1)')
      },
      { discrete: true },
    )
    expect(linkUrls(editor)).not.toContain('javascript:alert(1)')

    editor.update(
      () => {
        ;($getRoot().getFirstChild() as ElementNode).select()
        $toggleLink('https://ok.com')
      },
      { discrete: true },
    )
    expect(linkUrls(editor)).toContain('https://ok.com')
    dispose()
  })

  it('$sanitizeLinkNodes unwraps an unsafe link node, preserving its visible text', () => {
    const editor = newEditor()
    // Import an unsafe link WITHOUT the transform registered, then run the walker.
    // (Paren-free scheme so a real LinkNode forms — see the paste test.)
    editor.update(() => $convertFromMarkdownString('[click](javascript:evil)', transformers), {
      discrete: true,
    })
    editor.update(() => $sanitizeLinkNodes($getRoot()), { discrete: true })
    expect(linkUrls(editor)).toHaveLength(0)
    expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toContain('click')
  })
})

describe('markdown paste / import — link sanitization', () => {
  function pasteInto(markdown: string): { urls: string[]; out: string } {
    const editor = newEditor()
    editor.update(
      () => {
        $convertFromMarkdownString('seed', transformers)
        $getRoot().selectEnd()
      },
      { discrete: true },
    )
    editor.update(() => $insertMarkdownAtSelection(markdown, transformers), { discrete: true })
    return {
      urls: linkUrls(editor),
      out: editor.getEditorState().read(() => $convertToMarkdownString(transformers)),
    }
  }

  it('neutralizes a pasted javascript: link (no live link, text preserved)', () => {
    // A paren-free scheme so the markdown LINK transformer actually forms a
    // LinkNode (a URL with `(`/`)` never parses as a markdown link to begin with).
    const { urls, out } = pasteInto('a [danger](javascript:evil) link')
    expect(urls).not.toContain('javascript:evil')
    expect(out).not.toContain('javascript:')
    expect(out).toContain('danger') // the text survives
  })

  it('keeps a pasted safe link intact', () => {
    const { urls } = pasteInto('a [safe](https://example.com) link')
    expect(urls).toContain('https://example.com')
  })
})

describe('image src — enforced by the image transformer on import/paste', () => {
  function importImage(markdown: string): string[] {
    const editor = newEditor()
    editor.update(() => $convertFromMarkdownString(markdown, transformers), { discrete: true })
    return imageSrcs(editor)
  }

  it('drops an imported javascript: image', () => {
    expect(importImage('![x](javascript:alert(1))')).toHaveLength(0)
  })

  it('keeps an imported https: image', () => {
    expect(importImage('![x](https://example.com/a.png)')).toContain('https://example.com/a.png')
  })

  it('keeps an imported data: image', () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgo='
    expect(importImage(`![x](${dataUri})`)).toContain(dataUri)
  })
})
