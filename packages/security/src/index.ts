// @llui/security — the tiny, dependency-free, DOM/Node-agnostic home of the
// framework's security-sensitive primitives, owned in exactly ONE place so a fix
// to any of them can't drift between copies.
//
//   - url       — `sanitizeUrl` scheme allow-listing (shared by @llui/markdown,
//                 @llui/markdown-editor, @llui/a2ui).
//   - loopback  — same-machine authority/origin recognition for CSRF/CSWSH
//                 gating (shared by @llui/mcp and @llui/vite-plugin).
//
// Everything here uses only WHATWG `URL` + regex — no `node:*` builtins — so it
// is safe to import from browser bundles.

export * from './url.js'
export * from './loopback.js'
