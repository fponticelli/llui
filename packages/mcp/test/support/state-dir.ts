import { afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Vitest setup file (issue #85): give every test worker its OWN directory
 * for the MCP handshake state — the `active.json` marker and the per-launch
 * HTTP bearer token.
 *
 * The default location is workspace-rooted
 * (`node_modules/.cache/llui-mcp/`), which is exactly right in production
 * — the MCP server and the Vite plugin must find each other without
 * coordination — and exactly wrong for tests: two concurrent runs from
 * one checkout stomp each other's marker, so a server started by run A
 * hands run B's browser the wrong port and B's doctor reads a marker that
 * vanishes underneath it.
 *
 * `LLUI_MCP_STATE_DIR` is read by BOTH `@llui/mcp` (marker + token) and
 * `@llui/vite-plugin` (marker watch + `/__llui_mcp_status`), so the whole
 * handshake moves together. Setting it here — before any test module is
 * imported — covers in-process servers, the in-process Vite plugin, and
 * every spawned `llui-mcp` child (which inherits the environment).
 */
const stateDir = mkdtempSync(join(tmpdir(), 'llui-mcp-state-'))
process.env['LLUI_MCP_STATE_DIR'] = stateDir

afterAll(() => {
  rmSync(stateDir, { recursive: true, force: true })
})
