# GitHub Explorer

A multi-page GitHub browser: search repositories, drill into a repo's file tree, README, and issues.

## What it demonstrates

- `@llui/router` for client-side routing across search, repo, and tree pages.
- `branch(...)` conditional page rendering keyed on the current route.
- Effects-as-data for async calls to the GitHub REST API.

## UI

A search page with paginated repo results; a repo page with an expandable file-tree code browser, README, and issues tabs.

> This demo calls the public GitHub API and may be rate-limited for unauthenticated requests.

## Running locally

```bash
pnpm install
pnpm --filter github-explorer dev
```
