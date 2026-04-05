/**
 * Live demo: drive a real LLui app via the MCP bridge.
 *
 * 1. Starts an MCP server with WS bridge on :5400
 * 2. Launches a headless Chromium page loading todomvc via its Vite dev server
 * 3. Browser auto-connects to the bridge via injected startRelay()
 * 4. Drives a sequence of tool calls and prints the transcript
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { LluiMcpServer } from './src/index'

const VITE_PORT = 5199
const BRIDGE_PORT = 5200 // matches the Vite plugin's default injection

async function waitForPort(port: number, timeoutMs = 10_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`)
      if (r.ok) return
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`Vite didn't come up on :${port}`)
}

function pp(label: string, value: unknown): void {
  const body = JSON.stringify(value, null, 2)
  const short = body.length > 400 ? body.slice(0, 400) + '\n  ...' : body
  console.log(`\n\x1b[36m${label}\x1b[0m`)
  console.log(
    short
      .split('\n')
      .map((l) => '  ' + l)
      .join('\n'),
  )
}

async function main() {
  console.log('🚀 Starting Vite dev server for todomvc...')
  const vite = spawn('npx', ['vite', '--port', String(VITE_PORT), '--host', '127.0.0.1'], {
    stdio: 'pipe',
    cwd: new URL('../../examples/todomvc', import.meta.url).pathname,
  })
  vite.stderr.on('data', () => {})
  vite.stdout.on('data', () => {})

  try {
    await waitForPort(VITE_PORT)
    console.log(`✓ Vite ready on :${VITE_PORT}`)

    console.log(`\n🌉 Starting MCP bridge on :${BRIDGE_PORT}...`)
    const server = new LluiMcpServer(BRIDGE_PORT)
    server.startBridge()

    console.log('\n🌐 Launching headless browser...')
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    page.on('console', (msg) => {
      const t = msg.text()
      if (!t.includes('[vite]') && !t.includes('[LLui HMR]')) {
        console.log(`   [page] ${t}`)
      }
    })

    page.on('pageerror', (e) => console.log(`   [pageerror] ${e.message}`))
    await page.goto(`http://127.0.0.1:${VITE_PORT}/`)
    await new Promise((r) => setTimeout(r, 2000))
    await new Promise((r) => setTimeout(r, 500))

    console.log('\n' + '─'.repeat(60))
    console.log('📡 LLM→MCP→Browser tool-call transcript')
    console.log('─'.repeat(60))

    pp(
      '📋 llui_component_info  →  where is this component defined?',
      await server.handleToolCall('llui_component_info', {}),
    )

    pp(
      '🏷️  llui_describe_state  →  State shape (type, not value)',
      await server.handleToolCall('llui_describe_state', {}),
    )

    pp(
      '📬 llui_list_messages  →  all valid message variants',
      await server.handleToolCall('llui_list_messages', {}),
    )

    pp(
      '🗺️  llui_mask_legend  →  bit → field map',
      await server.handleToolCall('llui_mask_legend', {}),
    )

    pp(
      '🔎 llui_get_state  →  read the initial state',
      await server.handleToolCall('llui_get_state', {}),
    )

    pp(
      '🔎 llui_search_state({query:"todos"})  →  just the todos slice',
      await server.handleToolCall('llui_search_state', { query: 'todos' }),
    )

    pp(
      '✏️ llui_send_message  →  add a new todo',
      await server.handleToolCall('llui_send_message', {
        msg: { type: 'add', text: 'Wire up the MCP bridge' },
      }),
    )

    pp(
      '✏️ llui_send_message  →  toggle the first todo (id=1) complete',
      await server.handleToolCall('llui_send_message', {
        msg: { type: 'toggle', id: 1 },
      }),
    )

    pp(
      '✏️ llui_send_message  →  change filter to "active"',
      await server.handleToolCall('llui_send_message', {
        msg: { type: 'setFilter', filter: 'active' },
      }),
    )

    pp(
      '🔮 llui_eval_update  →  DRY RUN: what would "clearCompleted" do? (no mutation)',
      await server.handleToolCall('llui_eval_update', {
        msg: { type: 'clearCompleted' },
      }),
    )

    pp(
      '🔎 llui_get_state  →  verify state unchanged after dry-run',
      await server.handleToolCall('llui_get_state', {}),
    )

    pp(
      '✏️ llui_send_message  →  actually clear completed',
      await server.handleToolCall('llui_send_message', {
        msg: { type: 'clearCompleted' },
      }),
    )

    pp(
      '📜 llui_get_message_history  →  timeline with DECODED dirty masks',
      await Promise.all(
        (
          (await server.handleToolCall('llui_get_message_history', {})) as Array<
            Record<string, unknown>
          >
        ).map(async (h) => ({
          index: h.index,
          msg: h.msg,
          dirtyMask: h.dirtyMask,
          fieldsChanged: await server.handleToolCall('llui_decode_mask', { mask: h.dirtyMask }),
        })),
      ),
    )

    pp(
      '🚫 llui_send_message  →  try sending an invalid message shape',
      await server.handleToolCall('llui_send_message', {
        msg: { type: 'bogus', wrongField: true },
      }),
    )

    console.log('\n' + '─'.repeat(60))
    console.log('✓ demo complete')
    console.log('─'.repeat(60))

    await browser.close()
    server.stopBridge()
  } finally {
    vite.kill()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
