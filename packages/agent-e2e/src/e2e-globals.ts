/**
 * The page globals `host.ts` exposes so the test harness (running in Node,
 * reaching into the page through Playwright's `page.evaluate`) can drive the app
 * without any in-browser MCP wiring. Declared ONCE, here, so the producer (the
 * page) and every reader (`harness.ts`, `test-utils.ts`, the e2e tests) agree on
 * the types — instead of each reader re-asserting `window` into a shape of its
 * own choosing.
 *
 * - `__lluiE2eClient`: lets tests call `client.effectHandler()` to open a WS
 *   after minting a token — bypasses the "Connect with Claude" button.
 * - `__lluiE2eHandle`: lets tests read state and dispatch messages.
 * - `__lluiE2eFrames`: every frame the agent server has sent the page, in
 *   arrival order.
 *
 * Each is `undefined` until `host.ts` has finished bootstrapping.
 */
import type { SignalComponentHandle } from '@llui/dom'
import type { AgentClient } from '@llui/agent/client'
import type { Msg as E2eMsg, State as E2eState } from './host.js'

/** A server→client frame as recorded by the page (only its `t` is checked). */
export type RecordedFrame = { t: string } & Record<string, unknown>

declare global {
  var __lluiE2eClient: AgentClient | undefined
  var __lluiE2eHandle: SignalComponentHandle<E2eState, E2eMsg> | undefined
  var __lluiE2eFrames: RecordedFrame[] | undefined
}
