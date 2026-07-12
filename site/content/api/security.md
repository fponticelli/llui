---
title: '@llui/security'
description: 'Shared URL + loopback-origin sanitization for the DOM-sink and dev-server security surfaces'
---

# @llui/security

The tiny, dependency-free home of [LLui](https://github.com/fponticelli/llui)'s security-sensitive primitives, owned in exactly **one** place so a fix to any of them can't drift between copies. Everything here uses only the WHATWG `URL` API plus regex — no `node:*` builtins — so it is safe to import from browser bundles.

Two surfaces:

- **`url`** — `sanitizeUrl` scheme allow-listing, shared by every package that renders untrusted URLs into the DOM: [`@llui/markdown`](/api/markdown), [`@llui/markdown-editor`](/api/markdown-editor), and [`@llui/a2ui`](/api/a2ui).
- **`loopback`** — same-machine authority/origin recognition for CSRF / CSWSH gating on the dev-server surfaces, shared by [`@llui/mcp`](/api/mcp) and [`@llui/vite-plugin`](/api/vite-plugin).

```bash
pnpm add @llui/security
```

## Usage

```ts
import { sanitizeUrl, defaultAllowedProtocols } from '@llui/security/url'
import { isLoopbackOrigin, isLoopbackAuthority } from '@llui/security/loopback'

// Neutralize a javascript:/data: URL before it reaches an href/src sink.
const href = sanitizeUrl(userSuppliedUrl) // null when the scheme is not allowed

// Gate a dev-server request to same-machine callers.
if (!isLoopbackOrigin(req.headers.origin)) reject()
```

## Entry points

| Import                    | Purpose                                                                   |
| ------------------------- | ------------------------------------------------------------------------- |
| `@llui/security`          | Barrel — re-exports both modules below                                    |
| `@llui/security/url`      | `sanitizeUrl` + `defaultAllowedProtocols` scheme allow-listing            |
| `@llui/security/loopback` | `isLoopbackHost` / `isLoopbackAuthority` / `isLoopbackOrigin` recognizers |

<!-- auto-api:start -->

## Functions

### `isLoopbackAuthority()`

True when an authority (`host` or `host:port`, IPv6 bracketed as `[::1]:port`)
is a loopback host. An ABSENT/empty authority → `false`: a request with no
Host header is not provably same-machine, so it must not pass the guard.

```typescript
function isLoopbackAuthority(authority: string | undefined): boolean
```

### `isLoopbackHost()`

True when `host` — a bare hostname with NO port (IPv6 may be bracketed
`[::1]` or bare `::1`) — names the loopback interface.

```typescript
function isLoopbackHost(host: string): boolean
```

### `isLoopbackOrigin()`

True when an `Origin` header value is same-origin/local: either ABSENT (a
native, non-browser client sends none) or a loopback host. A cross-origin
browser page (CSWSH / drive-by hijack) presents a non-loopback Origin and is
rejected. A literal `Origin: null` (sandboxed / `file:` / `data:` context)
fails `new URL` and is likewise rejected — it is NOT the same as an absent
header.
IPv6 loopback origins arrive bracketed (`http://[::1]`), and WHATWG
`URL.hostname` keeps the brackets (`[::1]`); {@link isLoopbackHost} strips them
before the comparison so bracketed IPv6 loopback is recognised.

```typescript
function isLoopbackOrigin(origin: string | undefined): boolean
```

### `sanitizeUrl()`

Returns the URL unchanged if its scheme is on `allowedProtocols` (or it is a
relative/anchor/query URL — always safe), otherwise `null`.
Mirrors micromark's `sanitizeUri`: a scheme only "counts" when its colon
precedes any `/`, `?`, or `#`. Tab/CR/LF are stripped and leading control/space
chars ignored first, the way a browser does — so `java\tscript:` or a leading
control char cannot hide a dangerous scheme.
`allowedProtocols` defaults to {@link defaultAllowedProtocols}.

```typescript
function sanitizeUrl(
  url: string,
  allowedProtocols: readonly string[] = defaultAllowedProtocols,
): string | null
```

## Constants

### `defaultAllowedProtocols`

The schemes permitted by default in links (and, via markdown, images).
Relative URLs (no scheme) are always allowed regardless of this list. This is
the shared baseline every consumer builds on instead of hand-rolling a
divergent allowlist.

```typescript
const defaultAllowedProtocols: readonly string[]
```

<!-- auto-api:end -->
