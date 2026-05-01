import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

/**
 * Registers the bundled `llui-connect` MCP prompt. Both Claude Desktop
 * and Claude Code surface it as a slash command (Desktop:
 * `/llui-connect <url> <token>`; CC: `/mcp__<server>__llui-connect …`).
 * The prompt body Claude sees is the same natural-language instruction
 * the LLui app shows in its connect snippet — so pasting either form
 * lands the same `connect_session` tool call.
 */
export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'llui-connect',
    {
      description:
        'Bind this Claude conversation to an LLui app. Paste the URL and token the app showed you.',
      argsSchema: {
        url: z.string().describe('LAP base URL'),
        token: z.string().describe('Bearer token'),
      },
    },
    ({ url, token }) => ({
      description: `Bind to LLui app at ${url}`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Please connect this conversation to the LLui app at ${url}. ` +
              `Call the LLui MCP server's \`connect_session\` tool ` +
              `with url=${JSON.stringify(url)} and token=${JSON.stringify(token)}. ` +
              `After connecting, I may message you through the app's in-app ` +
              `chat composer — when you're idle or waiting for further ` +
              `instructions, call the \`wait_for_user_input\` tool to receive ` +
              `those messages. ` +
              `(In Claude Code the tools may be namespaced as ` +
              `\`mcp__<server>__connect_session\` / ` +
              `\`mcp__<server>__wait_for_user_input\` and deferred — load them ` +
              `via tool search if needed.)`,
          },
        },
      ],
    }),
  )
}
