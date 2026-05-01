import { describe, it, expect, vi } from 'vitest'
import {
  makeDurableObjectUserInputStorage,
  type DurableObjectStorageLike,
} from '../../../src/server/cloudflare/durable-object.js'

// Inline fake of DO's `state.storage`. The CF runtime's actual API is
// larger; the adapter only depends on get/put/delete, so we model just
// those. Generic methods are typed manually because vi.fn loses
// per-invocation type parameters.
function makeFakeStorage(): {
  storage: DurableObjectStorageLike
  data: Map<string, unknown>
  getCalls: string[]
  putCalls: Array<[string, unknown]>
  deleteCalls: string[]
} {
  const data = new Map<string, unknown>()
  const getCalls: string[] = []
  const putCalls: Array<[string, unknown]> = []
  const deleteCalls: string[] = []
  const storage: DurableObjectStorageLike = {
    async get<T>(key: string): Promise<T | undefined> {
      getCalls.push(key)
      return data.get(key) as T | undefined
    },
    async put<T>(key: string, value: T): Promise<void> {
      putCalls.push([key, value])
      data.set(key, value)
    },
    async delete(key: string): Promise<boolean> {
      deleteCalls.push(key)
      return data.delete(key)
    },
  }
  return { storage, data, getCalls, putCalls, deleteCalls }
}
// Silences the "vi imported but unused" lint when no vi.fn is used.
void vi

describe('makeDurableObjectUserInputStorage', () => {
  it('writes the buffer under a per-tid namespaced key', async () => {
    const fake = makeFakeStorage()
    const adapter = makeDurableObjectUserInputStorage(fake.storage)
    await adapter.write('t1', [{ text: 'a', at: 1 }])
    expect(fake.putCalls).toEqual([['__llui_agent_user_input_buf__:t1', [{ text: 'a', at: 1 }]]])
  })

  it('reads the same key and returns the persisted buffer', async () => {
    const fake = makeFakeStorage()
    const adapter = makeDurableObjectUserInputStorage(fake.storage)
    await adapter.write('t1', [{ text: 'a', at: 1 }])
    const restored = await adapter.read('t1')
    expect(restored).toEqual([{ text: 'a', at: 1 }])
  })

  it('returns an empty array when nothing is stored for the tid', async () => {
    const fake = makeFakeStorage()
    const adapter = makeDurableObjectUserInputStorage(fake.storage)
    expect(await adapter.read('unknown')).toEqual([])
  })

  it('clear deletes the per-tid key', async () => {
    const fake = makeFakeStorage()
    const adapter = makeDurableObjectUserInputStorage(fake.storage)
    await adapter.write('t1', [{ text: 'a', at: 1 }])
    await adapter.clear('t1')
    expect(fake.deleteCalls).toEqual(['__llui_agent_user_input_buf__:t1'])
    expect(await adapter.read('t1')).toEqual([])
  })

  it('different tids use different keys (no cross-talk)', async () => {
    const fake = makeFakeStorage()
    const adapter = makeDurableObjectUserInputStorage(fake.storage)
    await adapter.write('t1', [{ text: 'one', at: 1 }])
    await adapter.write('t2', [{ text: 'two', at: 2 }])
    expect(await adapter.read('t1')).toEqual([{ text: 'one', at: 1 }])
    expect(await adapter.read('t2')).toEqual([{ text: 'two', at: 2 }])
    await adapter.clear('t1')
    expect(await adapter.read('t1')).toEqual([])
    expect(await adapter.read('t2')).toEqual([{ text: 'two', at: 2 }])
  })
})
