---
title: 'GitHub Explorer'
description: 'Routed GitHub browser with search, file tree, and agent affordances.'
---

<div class="example-embed">
  <div class="example-embed-bar">
    <span class="example-embed-dots"><i></i><i></i><i></i></span>
    <span class="example-embed-url">/apps/github-explorer/</span>
    <a class="example-embed-open" href="/apps/github-explorer/" target="_blank" rel="noopener">Open ↗</a>
  </div>
  <iframe class="example-embed-frame" src="/apps/github-explorer/" title="GitHub Explorer — live demo" loading="lazy"></iframe>
</div>

<p class="example-source"><a href="https://github.com/fponticelli/llui/tree/main/examples/github-explorer" target="_blank" rel="noopener">View source on GitHub ↗</a></p>

A multi-page GitHub browser: search repositories, drill into a repo's file tree, README, and issues — with optional agent-assisted navigation.

## What it demonstrates

- `@llui/router` for client-side routing across search, repo, and tree pages.
- `branch(...)` conditional page rendering keyed on the current route.
- Effects-as-data for async calls to the GitHub REST API.
- `@llui/agent` integration — connect/confirm affordances and context metadata that let an agent drive the app.

## UI

A search page with paginated repo results; a repo page with an expandable file-tree code browser, README, and issues tabs; plus an agent panel for AI-assisted navigation.

> This demo calls the public GitHub API and may be rate-limited for unauthenticated requests.

## Running locally

```bash
pnpm install
pnpm --filter github-explorer dev
```
