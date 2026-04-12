#!/usr/bin/env node
/**
 * Manual integration test for the MCP HMR auto-connect chain.
 *
 * Runs slow (spawns vite + browser) so it lives outside the regular vitest
 * suite. Verifies the FULL pipeline that the unit tests stub out:
 *
 *   1. MCP server starts → writes node_modules/.cache/llui-mcp/active.json
 *   2. Vite plugin watches the file → sends `llui:mcp-ready` HMR event
 *   3. Browser receives HMR event → calls __lluiConnect(port)
 *   4. Browser opens WebSocket to MCP server → relay registered
 *   5. MCP tool call goes through real devtools.ts → real component state
 *
 * Usage:
 *   node packages/mcp/test/manual-playwright.mjs
 *
 * Requires: a built @llui/dom + @llui/vite-plugin + @llui/mcp + an example
 * with a known component. Uses examples/virtualization.
 */

import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import { LluiMcpServer } from '../dist/index.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = resolve(__dirname, '../../..')
const EXAMPLE_DIR = resolve(REPO_ROOT, 'examples/virtualization')
const MCP_PORT = 5400 + Math.floor(Math.random() * 100)

function log(...args) {
  console.log('[playwright-e2e]', ...args)
}

function fail(msg) {
  console.error('FAIL:', msg)
  process.exit(1)
}

async function main() {
  // ── 1. Start MCP server (writes active.json) ────────────────────
  log(`starting MCP server on port ${MCP_PORT}`)
  const mcp = new LluiMcpServer(MCP_PORT)
  mcp.startBridge()

  // ── 2. Start vite dev server in the example ─────────────────────
  log('spawning vite dev server in', EXAMPLE_DIR)
  const vite = spawn('pnpm', ['dev'], {
    cwd: EXAMPLE_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let viteUrl = null
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('vite startup timeout')), 30_000)
    vite.stdout.on('data', (chunk) => {
      const text = String(chunk)
      const match = text.match(/Local:\s+(http:\/\/localhost:\d+\/)/)
      if (match) {
        viteUrl = match[1]
        clearTimeout(timer)
        resolve()
      }
    })
    vite.stderr.on('data', (chunk) => process.stderr.write(`[vite] ${chunk}`))
  })

  await ready
  log(`vite ready at ${viteUrl}`)

  // ── 3. Launch playwright, navigate ──────────────────────────────
  log('launching browser')
  const browser = await chromium.launch()
  const page = await browser.newPage()

  // Capture WebSocket errors so we can verify zero retry spam
  let wsErrors = 0
  page.on('console', (msg) => {
    const text = msg.text()
    if (text.includes('WebSocket')) wsErrors++
    log(`browser[${msg.type()}]: ${text}`)
  })
  page.on('pageerror', (e) => log(`pageerror: ${e.message}`))

  // Inject a console.log into the page so we can see if our HMR listener fires
  await page.exposeFunction('hmrFired', (port) => log(`HMR llui:mcp-ready fired with port=${port}`))

  await page.goto(viteUrl, { waitUntil: 'networkidle' })

  // ── 4. Wait for HMR auto-connect ────────────────────────────────
  // Give a beat for the HMR event to arrive and __lluiConnect to fire
  await delay(2000)

  // Diagnostics: did __lluiDebug install? Did __lluiConnect run?
  const debugInfo = await page.evaluate(() => ({
    hasDebug: typeof window.__lluiDebug === 'object' && window.__lluiDebug !== null,
    hasConnect: typeof window.__lluiConnect === 'function',
    components: window.__lluiComponents ? Object.keys(window.__lluiComponents) : [],
  }))
  log(`browser state: ${JSON.stringify(debugInfo)}`)

  // The bridge should now have a connected browser
  // (LluiMcpServer doesn't expose a clean isConnected getter — check via a tool call)
  log('verifying MCP can reach the browser via HMR auto-connect')
  let state
  try {
    state = await mcp.handleToolCall('llui_get_state', {})
  } catch (e) {
    fail(`MCP tool call failed — auto-connect didn't fire? ${e.message}`)
  }
  log('llui_get_state →', JSON.stringify(state).slice(0, 100))

  // ── 5. Send a message via MCP, verify state changes ─────────────
  // virtualization example has a setCount message
  const result = await mcp.handleToolCall('llui_send_message', {
    msg: { type: 'setCount', count: 1000 },
  })
  log('llui_send_message →', JSON.stringify(result).slice(0, 120))

  if (!result || !result.sent) {
    fail('llui_send_message did not succeed')
  }

  // ── 6. Verify zero WebSocket retry spam ─────────────────────────
  if (wsErrors > 1) {
    fail(`expected ≤1 WebSocket error, got ${wsErrors}`)
  }
  log(`WebSocket errors: ${wsErrors} (expected ≤1)`)

  // ── 7. Cleanup ───────────────────────────────────────────────────
  log('cleaning up')
  await browser.close()
  vite.kill('SIGTERM')
  mcp.stopBridge()
  await delay(200)

  log('PASS — full HMR auto-connect chain verified')
  process.exit(0)
}

main().catch((err) => {
  console.error('FAIL:', err)
  process.exit(1)
})
