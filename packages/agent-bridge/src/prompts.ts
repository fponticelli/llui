import type { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js'
import {
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  type ListPromptsResult,
  type GetPromptResult,
} from '@modelcontextprotocol/sdk/types.js'

export function registerPrompts(server: McpServer): void {
  server.setRequestHandler(ListPromptsRequestSchema, async (): Promise<ListPromptsResult> => ({
    prompts: [
      {
        name: 'llui-connect',
        description: 'Bind this Claude conversation to an LLui app. Paste the URL and token the app showed you.',
        arguments: [
          { name: 'url', description: 'LAP base URL', required: true },
          { name: 'token', description: 'Bearer token', required: true },
        ],
      },
    ],
  }))

  server.setRequestHandler(GetPromptRequestSchema, async (req): Promise<GetPromptResult> => {
    if (req.params.name !== 'llui-connect') {
      throw new Error(`unknown prompt: ${req.params.name}`)
    }
    const url = req.params.arguments?.['url'] ?? ''
    const token = req.params.arguments?.['token'] ?? ''
    return {
      description: `Bind to LLui app at ${url}`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Please connect this conversation to the LLui app at ${url}. ` +
              `Call llui_connect_session with url=${JSON.stringify(url)} and token=${JSON.stringify(token)}.`,
          },
        },
      ],
    }
  })
}
