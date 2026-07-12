// Security-focused unit tests for the attention-router wiring:
//   - the router is OPT-IN (an unset `router` resolves to disabled), so it
//     never auto-spawns an LLM CLI in the project root from a forgeable
//     same-origin/loopback task note.
//   - the default `claude` preset args carry NO `--dangerously-skip-permissions`;
//     that unattended-tool-access flag is appended only on explicit opt-in.

import { describe, expect, it } from 'vitest'

import { resolveRouterInput } from '../src/index.js'
import { createEventBus } from '../src/notes/event-bus.js'
import { resolveCliInvocation } from '../src/notes/router.js'

const bus = createEventBus()

describe('router is opt-in (no default auto-spawn)', () => {
  it('resolves an unset router to null (disabled)', () => {
    expect(resolveRouterInput(undefined, undefined)).toBeNull()
  })

  it('stays disabled even when the deprecated routerTimeoutMs alias is set alone', () => {
    // The timeout alias must not implicitly enable the router.
    expect(resolveRouterInput(undefined, 60_000)).toBeNull()
  })

  it('resolves an explicit `false` to null', () => {
    expect(resolveRouterInput(false, undefined)).toBeNull()
  })

  it('enables only on an explicit preset opt-in', () => {
    expect(resolveRouterInput('claude', undefined)).toEqual({ preset: 'claude' })
  })

  it('enables on an explicit config object and honours the legacy timeout there', () => {
    expect(resolveRouterInput({ preset: 'claude' }, 60_000)).toEqual({
      preset: 'claude',
      timeoutMs: 60_000,
    })
  })
})

describe('claude preset does not skip permissions by default', () => {
  it('default claude invocation contains no --dangerously-skip-permissions', () => {
    const inv = resolveCliInvocation({
      notesRoot: '',
      projectRoot: '',
      bus,
      preset: 'claude',
    })
    expect(inv.command).toBe('claude')
    expect(inv.args).not.toContain('--dangerously-skip-permissions')
  })

  it('appends --dangerously-skip-permissions only on explicit opt-in', () => {
    const inv = resolveCliInvocation({
      notesRoot: '',
      projectRoot: '',
      bus,
      preset: 'claude',
      dangerouslySkipPermissions: true,
    })
    expect(inv.args).toContain('--dangerously-skip-permissions')
  })

  it('ignores the opt-in for presets that expose no skip-permissions flag', () => {
    const inv = resolveCliInvocation({
      notesRoot: '',
      projectRoot: '',
      bus,
      preset: 'gemini',
      dangerouslySkipPermissions: true,
    })
    expect(inv.args).not.toContain('--dangerously-skip-permissions')
  })
})
