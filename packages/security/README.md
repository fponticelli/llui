# @llui/security

Tiny, **dependency-free** home of [LLui](https://github.com/fponticelli/llui)'s security-sensitive
primitives. Each lives here in exactly ONE place so a fix can't drift between copies (the flaw this
package was extracted to remove).

Everything uses only WHATWG `URL` + regex — no `node:*` builtins — so it is safe to import from
browser bundles.

- `url` — `sanitizeUrl(url, allowedProtocols?)` scheme allow-listing (`defaultAllowedProtocols`),
  the micromark-style parse shared by `@llui/markdown`, `@llui/markdown-editor`, and `@llui/a2ui`.
- `loopback` — `isLoopbackHost` / `isLoopbackAuthority` / `isLoopbackOrigin`, the same-machine
  recognition that gates CSRF/CSWSH in `@llui/mcp` and `@llui/vite-plugin`. Host set is
  `{ localhost, 127.0.0.1, ::1 }`; `0.0.0.0` is deliberately NOT loopback.

```bash
pnpm add @llui/security
```

```ts
import { sanitizeUrl, defaultAllowedProtocols } from '@llui/security'
import { isLoopbackOrigin, isLoopbackAuthority } from '@llui/security'
// or via subpaths:
import { sanitizeUrl } from '@llui/security/url'
import { isLoopbackAuthority } from '@llui/security/loopback'
```
