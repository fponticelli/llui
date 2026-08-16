import { describe, expect, it } from 'vitest'
import { mapSend, type Send } from '../../src/index.js'

type SearchMsg = { type: 'select'; resultId: string } | { type: 'reset' }

type SortMsg = { type: 'select'; column: string } | { type: 'reset' }

type AppMsg = { type: 'search'; msg: SearchMsg } | { type: 'sort'; msg: SortMsg }

describe('mapSend', () => {
  it('routes components with colliding message discriminants through distinct parent variants', () => {
    const received: AppMsg[] = []
    const send: Send<AppMsg> = (msg) => received.push(msg)

    const sendSearch: Send<SearchMsg> = mapSend<AppMsg, SearchMsg>(send, (msg) => ({
      type: 'search',
      msg,
    }))
    const sendSort: Send<SortMsg> = mapSend<AppMsg, SortMsg>(send, (msg) => ({
      type: 'sort',
      msg,
    }))

    sendSearch({ type: 'select', resultId: 'result-1' })
    sendSort({ type: 'select', column: 'name' })
    sendSearch({ type: 'reset' })
    sendSort({ type: 'reset' })

    expect(received).toEqual([
      { type: 'search', msg: { type: 'select', resultId: 'result-1' } },
      { type: 'sort', msg: { type: 'select', column: 'name' } },
      { type: 'search', msg: { type: 'reset' } },
      { type: 'sort', msg: { type: 'reset' } },
    ])
  })
})
