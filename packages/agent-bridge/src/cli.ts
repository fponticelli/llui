#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBridgeServer } from './bridge.js'
import { BindingMap } from './binding.js'

const PACKAGE_VERSION = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const pkg = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8')) as {
      version?: string
    }
    return typeof pkg.version === 'string' ? pkg.version : 'unknown'
  } catch {
    return 'unknown'
  }
})()

async function main(): Promise<void> {
  const bindings = new BindingMap()
  // Stdio is one session per process. Use a fixed session id.
  const sessionId = 'stdio'
  const server = createBridgeServer({ sessionId, bindings, version: PACKAGE_VERSION })
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('[llui-agent] fatal:', err)
  process.exit(1)
})
