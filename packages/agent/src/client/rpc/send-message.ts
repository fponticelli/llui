import { randomUUID } from '../uuid.js'
import type { LapMessageResponse, MessageAnnotations } from '../../protocol.js'

export type SendMessageArgs = {
  msg: { type: string; [k: string]: unknown }
  reason?: string
  waitFor?: 'idle' | 'none'
  timeoutMs?: number
}

export type SendMessageHost = {
  getState(): unknown
  send(msg: unknown): void
  flush(): void
  getMsgAnnotations(): Record<string, MessageAnnotations> | null
  /** Called when @requiresConfirm; caller stores a ConfirmEntry in state. */
  proposeConfirm(entry: {
    id: string
    variant: string
    payload: unknown
    intent: string
    reason: string | null
    proposedAt: number
    status: 'pending'
  }): void
}

export async function handleSendMessage(
  host: SendMessageHost,
  args: SendMessageArgs,
): Promise<LapMessageResponse> {
  if (!args.msg || typeof args.msg.type !== 'string') {
    return { status: 'rejected', reason: 'invalid' }
  }
  const annotations = host.getMsgAnnotations() ?? {}
  const ann = annotations[args.msg.type]

  // If annotations map is non-empty and this variant isn't in it, it's an
  // unknown msg type that the app never declared — reject early so the
  // browser never dispatches an unrecognised variant into update().
  const hasAnnotations = Object.keys(annotations).length > 0
  if (hasAnnotations && !ann) {
    return { status: 'rejected', reason: 'invalid', detail: `unknown variant: ${args.msg.type}` }
  }

  if (ann?.humanOnly) {
    return { status: 'rejected', reason: 'humanOnly' }
  }
  if (ann?.requiresConfirm) {
    const id = randomUUID()
    const { type: _type, ...payload } = args.msg
    host.proposeConfirm({
      id,
      variant: args.msg.type,
      payload,
      intent: ann?.intent ?? args.msg.type,
      reason: args.reason ?? null,
      proposedAt: Date.now(),
      status: 'pending',
    })
    return { status: 'pending-confirmation', confirmId: id }
  }

  host.send(args.msg)
  if (args.waitFor !== 'none') {
    host.flush()
    // Let the microtask queue settle:
    await Promise.resolve()
  }
  return { status: 'dispatched', stateAfter: host.getState() }
}
