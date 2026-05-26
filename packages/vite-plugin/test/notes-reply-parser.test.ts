import { describe, expect, it } from 'vitest'
import { parseLluiReply } from '../src/notes/router.js'

const wrap = (json: string): string => `\`\`\`llui-reply\n${json}\n\`\`\``

describe('parseLluiReply', () => {
  it('parses a valid block (new shape: files is a path list)', () => {
    const result = parseLluiReply(
      `some narrative\n\n${wrap(
        JSON.stringify({
          summary: 'fix the copy',
          confidence: 'high',
          files: [{ path: 'src/a.ts' }, 'src/b.ts'],
        }),
      )}\n`,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.reply.summary).toBe('fix the copy')
    expect(result.reply.files).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('accepts the legacy shape ({ path, patch }) but drops the patch', () => {
    const result = parseLluiReply(
      wrap(
        JSON.stringify({
          summary: 'compat',
          confidence: 'high',
          files: [
            { path: 'src/a.ts', patch: '--- a/src/a.ts\n+++ b/src/a.ts\n' },
            { path: 'src/b.ts' },
          ],
        }),
      ),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.reply.files).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('takes the LAST block when there are multiple', () => {
    const a = wrap(JSON.stringify({ summary: 'first draft', confidence: 'low', files: [] }))
    const b = wrap(JSON.stringify({ summary: 'final', confidence: 'high', files: [] }))
    const result = parseLluiReply(`${a}\nrethought it…\n${b}`)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.reply.summary).toBe('final')
  })

  it('errors on missing block', () => {
    const r = parseLluiReply('I just chatted about it.')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/no .* block/i)
  })

  it('errors on malformed JSON', () => {
    const r = parseLluiReply('```llui-reply\n{ this is not json\n```')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/parse failed/i)
  })

  it('errors on missing summary', () => {
    const r = parseLluiReply(wrap(JSON.stringify({ confidence: 'high', files: [] })))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/summary/i)
  })

  it('errors on invalid confidence', () => {
    const r = parseLluiReply(wrap(JSON.stringify({ summary: 's', confidence: 'huge', files: [] })))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/confidence/i)
  })

  it('errors when files is not an array', () => {
    const r = parseLluiReply(
      wrap(JSON.stringify({ summary: 's', confidence: 'low', files: 'oops' })),
    )
    expect(r.ok).toBe(false)
  })

  it('treats `files` as an optional hint — omitting it parses fine', () => {
    const r = parseLluiReply(wrap(JSON.stringify({ summary: 's', confidence: 'low' })))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reply.files).toEqual([])
  })

  it('skips file entries without a usable `path`', () => {
    const r = parseLluiReply(
      wrap(
        JSON.stringify({
          summary: 's',
          confidence: 'low',
          files: [{ path: 'a.ts' }, { nope: true }, 'b.ts', 42],
        }),
      ),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reply.files).toEqual(['a.ts', 'b.ts'])
  })

  it('accepts empty files array (no-fix reply)', () => {
    const r = parseLluiReply(
      wrap(
        JSON.stringify({ summary: 'ambiguous; need more context', confidence: 'low', files: [] }),
      ),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reply.files).toHaveLength(0)
  })
})
