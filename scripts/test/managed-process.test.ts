import { describe, expect, it } from 'vitest'

import { withManagedProcess } from '../lib/managed-process'

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('owned benchmark process lifecycle', () => {
  it('terminates the owned process tree when the benchmark body fails', async () => {
    let pid = 0

    await expect(
      withManagedProcess(
        process.execPath,
        ['-e', 'setInterval(() => {}, 1_000)'],
        { stdio: 'ignore' },
        async (child) => {
          pid = child.pid
          expect(isAlive(pid)).toBe(true)
          throw new Error('benchmark failed')
        },
      ),
    ).rejects.toThrow('benchmark failed')

    expect(isAlive(pid)).toBe(false)
  })
})
