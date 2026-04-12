#!/usr/bin/env node
import { LluiMcpServer } from './index.js'

const port = Number(process.env.LLUI_MCP_PORT ?? 5200)
const server = new LluiMcpServer(port)
server.startBridge()
server.start()
process.stderr.write(`[llui-mcp] listening on stdio; bridge ws://127.0.0.1:${port}\n`)

// Clean up the active marker file on graceful shutdown
const cleanup = (): void => {
  server.stopBridge()
  process.exit(0)
}
process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)
