import { z } from 'zod'
import {
  FORWARDED_TOOL_DESCRIPTORS,
  DISCONNECT_SESSION_DESCRIPTOR,
  type McpForwardedToolDescriptor,
  type McpMetaToolDescriptor,
} from '@llui/agent/mcp/tools'

/**
 * Tool catalogue for the bridge. Forwarded tools and disconnect_session
 * are imported from `@llui/agent/mcp/tools` (the single source of truth).
 * `connect_session` is defined here because the bridge requires a `url`
 * argument that the server-side MCP does not — the two surfaces have
 * different signatures.
 *
 * Spec §8.
 */

// Re-export types so callers don't need a second import.
export type { McpForwardedToolDescriptor as ForwardedToolDescriptor }
export type { McpMetaToolDescriptor as MetaToolDescriptor }
export type ToolDescriptor = McpForwardedToolDescriptor | McpMetaToolDescriptor

const CONNECT_SESSION_DESCRIPTOR: McpMetaToolDescriptor = {
  kind: 'meta',
  name: 'connect_session',
  description:
    'Bind this Claude conversation to a specific LLui app. Call ONCE per chat when the user pastes a connect snippet from the LLui app — the snippet contains the url and token to forward here. The result includes the full observe bundle ({state, actions, description, context}) so you have everything you need to start acting — no separate describe_app / get_state / list_actions / describe_context follow-up is required on the first turn. Use observe later when you want a refreshed snapshot.',
  schema: z.object({
    url: z.string().describe('LAP base URL (e.g. https://app.example/agent/lap/v1)'),
    token: z.string().describe('Bearer token for LAP calls'),
  }),
}

export const TOOL_DESCRIPTORS: ToolDescriptor[] = [
  CONNECT_SESSION_DESCRIPTOR,
  DISCONNECT_SESSION_DESCRIPTOR,
  ...FORWARDED_TOOL_DESCRIPTORS,
]
