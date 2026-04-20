import { describe, it, expect } from 'vitest'
import { extractMsgAnnotations } from '../src/msg-annotations.js'

describe('extractMsgAnnotations', () => {
  it('reads @intent, @requiresConfirm, @humanOnly, @alwaysAffordable from union member JSDoc', () => {
    const source = `
type Msg =
  /** @intent("Increment the counter") */
  | { type: 'inc' }
  /** @intent("Delete item") @requiresConfirm */
  | { type: 'delete', id: string }
  /** @intent("Place order") @humanOnly */
  | { type: 'checkout' }
  /** @intent("Navigate") @alwaysAffordable */
  | { type: 'nav', to: 'reports' | 'settings' }
`
    const result = extractMsgAnnotations(source)
    expect(result).toEqual({
      inc: {
        intent: 'Increment the counter',
        alwaysAffordable: false,
        requiresConfirm: false,
        humanOnly: false,
      },
      delete: {
        intent: 'Delete item',
        alwaysAffordable: false,
        requiresConfirm: true,
        humanOnly: false,
      },
      checkout: {
        intent: 'Place order',
        alwaysAffordable: false,
        requiresConfirm: false,
        humanOnly: true,
      },
      nav: {
        intent: 'Navigate',
        alwaysAffordable: true,
        requiresConfirm: false,
        humanOnly: false,
      },
    })
  })
})
