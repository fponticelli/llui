import { describe, expect, it } from 'vitest'
import { testComponent, reducer } from '@llui/test'
import {
  formatProgress,
  queueCounts,
  reduceTask,
  taskInitialState,
  type TaskState,
  type TaskMsg,
  type TaskEffect,
} from '../src/hud-core.js'

const def = reducer<TaskState, TaskMsg, TaskEffect>({
  init: () => [taskInitialState(), []],
  update: reduceTask,
})

const track = (noteId: string, chainName = 'chain-1', sessionId = 's1'): TaskMsg => ({
  type: 'task/track',
  task: { noteId, sessionId, chainName, status: 'claimed' },
})

describe('task reducer: tracking', () => {
  it('track sets the latest task and an optimistic status line', () => {
    const h = testComponent(def)
    h.send(track('n1'))
    expect(h.state.latestTaskId).toBe('n1')
    expect(h.state.tracked['n1']?.status).toBe('claimed')
    expect(h.state.statusLine).toContain('working')
  })

  it('queueCounts reflects working vs ready', () => {
    const h = testComponent(def)
    h.send(track('n1'))
    h.send(track('n2'))
    h.send({ type: 'task/status', noteId: 'n2', to: 'proposed', reason: 'fix', now: 1000 })
    expect(queueCounts(h.state)).toEqual({ working: 1, ready: 1 })
  })
})

describe('task reducer: progress + ticker', () => {
  it('progress for the latest task formats the line and starts the ticker', () => {
    const h = testComponent(def)
    h.send(track('n1'))
    h.send({
      type: 'task/progress',
      noteId: 'n1',
      elapsedMs: 5000,
      tokens: { in: 12000, out: 800 },
      now: 5000,
    })
    expect(h.effects).toEqual([{ type: 'startTicker' }])
    expect(h.state.statusLine).toContain('12k ctx')
    expect(h.state.statusLine).toContain('5s')
  })

  it('progress for a non-latest task is ignored', () => {
    const h = testComponent(def)
    h.send(track('n1'))
    h.send(track('n2')) // n2 is now latest
    h.send({ type: 'task/progress', noteId: 'n1', elapsedMs: 9000, now: 9000 })
    expect(h.state.progress).toBe(null)
  })

  it('tick recomputes elapsed from the snapshot', () => {
    const h = testComponent(def)
    h.send(track('n1'))
    h.send({ type: 'task/progress', noteId: 'n1', elapsedMs: 0, now: 0 })
    h.send({ type: 'task/tick', now: 3000 })
    expect(h.state.statusLine).toContain('3s')
  })

  it('formatProgress includes a cached-tokens suffix', () => {
    const line = formatProgress(
      {
        noteId: 'n',
        reportedElapsedMs: 0,
        reportedAt: 0,
        tokens: { in: 20000, out: 1000, cacheRead: 18000 },
      },
      0,
    )
    expect(line).toContain('18k cached')
  })
})

describe('task reducer: status transitions', () => {
  it('entering a working state starts the liveness ticker', () => {
    const h = testComponent(def)
    h.send(track('n1'))
    h.send({ type: 'task/status', noteId: 'n1', to: 'in-progress', now: 1000 })
    expect(h.effects).toContainEqual({ type: 'startTicker' })
    expect(h.state.progress?.noteId).toBe('n1')
  })

  it('first proposal records the chain, auto-selects it, and toasts Accept/Reject', () => {
    const h = testComponent(def)
    h.send(track('n1', 'chain-7'))
    h.send({
      type: 'task/status',
      noteId: 'n1',
      to: 'proposed',
      reason: 'fixed the off-by-one',
      now: 1234,
    })
    expect(h.state.chains['chain-7']).toMatchObject({
      lastTaskId: 'n1',
      summary: 'fixed the off-by-one',
    })
    expect(h.state.selectedChain).toBe('chain-7')
    const toast = h.state.toasts.at(-1)!
    expect(toast.kind).toBe('info')
    expect(toast.actions.map((a) => a.label)).toEqual(['Reject', 'Accept'])
    expect(toast.actions[1]!.msg).toEqual({ type: 'task/accept', noteId: 'n1', sessionId: 's1' })
  })

  it('stops the ticker when a running task becomes proposed', () => {
    const h = testComponent(def)
    h.send(track('n1'))
    h.send({ type: 'task/progress', noteId: 'n1', elapsedMs: 0, now: 0 }) // ticker running
    h.send({ type: 'task/status', noteId: 'n1', to: 'proposed', reason: 'x', now: 1 })
    expect(h.effects).toContainEqual({ type: 'stopTicker' })
    expect(h.state.progress).toBe(null)
  })

  it('does not re-toast on a duplicate proposed event', () => {
    const h = testComponent(def)
    h.send(track('n1'))
    h.send({ type: 'task/status', noteId: 'n1', to: 'proposed', reason: 'x', now: 1 })
    const count = h.state.toasts.length
    h.send({ type: 'task/status', noteId: 'n1', to: 'proposed', reason: 'x', now: 2 })
    expect(h.state.toasts.length).toBe(count)
  })

  it('applied is terminal: ok toast, task dropped, latest promoted', () => {
    const h = testComponent(def)
    h.send(track('n1'))
    h.send(track('n2'))
    h.send({ type: 'task/status', noteId: 'n2', to: 'applied', now: 1 })
    expect(h.state.tracked['n2']).toBeUndefined()
    expect(h.state.latestTaskId).toBe('n1') // promoted back to the remaining task
    expect(h.state.toasts.at(-1)!.kind).toBe('ok')
  })

  it('failed is terminal with a fail toast', () => {
    const h = testComponent(def)
    h.send(track('n1'))
    h.send({ type: 'task/status', noteId: 'n1', to: 'failed', reason: 'boom', now: 1 })
    expect(h.state.toasts.at(-1)!.kind).toBe('fail')
    expect(h.state.latestTaskId).toBe(null)
  })

  it('status for an untracked note is a no-op', () => {
    const h = testComponent(def)
    h.send({ type: 'task/status', noteId: 'ghost', to: 'applied', now: 1 })
    expect(h.state.toasts).toEqual([])
  })
})

describe('task reducer: toast actions + dismissal', () => {
  it('accept/reject emit a postStatus effect', () => {
    const h = testComponent(def)
    h.send({ type: 'task/accept', noteId: 'n1', sessionId: 's1' })
    expect(h.effects).toEqual([
      { type: 'postStatus', noteId: 'n1', sessionId: 's1', to: 'accepted' },
    ])
    h.send({ type: 'task/reject', noteId: 'n1', sessionId: 's1' })
    expect(h.effects).toEqual([
      { type: 'postStatus', noteId: 'n1', sessionId: 's1', to: 'rejected' },
    ])
  })

  it('dismiss removes a toast by id', () => {
    const h = testComponent(def)
    h.send(track('n1'))
    h.send({ type: 'task/status', noteId: 'n1', to: 'proposed', reason: 'x', now: 1 })
    const id = h.state.toasts.at(-1)!.id
    h.send({ type: 'toast/dismiss', id })
    expect(h.state.toasts.find((t) => t.id === id)).toBeUndefined()
  })
})
