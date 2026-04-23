---
title: '@llui/eslint-plugin'
description: '21 ESLint rules enforcing idiomatic LLui patterns'
---

# @llui/eslint-plugin

ESLint plugin for [LLui](https://github.com/fponticelli/llui) that enforces idiomatic patterns and catches common anti-patterns at the source level.

```bash
pnpm add -D @llui/eslint-plugin
```

## Usage

In your `eslint.config.ts`:

```ts
import llui from '@llui/eslint-plugin'

export default [
  {
    plugins: { llui },
    rules: {
      ...llui.configs.recommended.rules,
    },
  },
]
```

## Rules

| Rule                           | Severity | Description                                                                    |
| ------------------------------ | -------- | ------------------------------------------------------------------------------ |
| `spread-in-children`           | error    | `show()`/`branch()`/`each()` used without spread in children array             |
| `view-bag-import`              | error    | Direct import of view-bag primitives inside a component (use destructured bag) |
| `forgotten-spread`             | error    | Structural primitive result not spread into children                           |
| `string-effect-callback`       | error    | Deprecated string-based `onSuccess`/`onError` in effect declarations           |
| `imperative-dom-in-view`       | error    | Using `document.querySelector` etc. in `view()` instead of primitives          |
| `nested-send-in-update`        | error    | Calling `send()` inside `update()` causes recursive dispatch                   |
| `accessor-side-effect`         | error    | Side effects (fetch, console.log, etc.) inside reactive accessor functions     |
| `async-update`                 | error    | `async`/`await` in `update()` — must be synchronous and pure                   |
| `effect-without-handler`       | error    | Component returns effects but has no `onEffect` handler                        |
| `exhaustive-effect-handling`   | error    | Empty `.else()` handler silently drops unhandled effects                       |
| `direct-state-in-view`         | error    | Stale state capture in event handler instead of using an accessor              |
| `state-mutation`               | error    | Direct mutation of state in `update()` instead of returning a new object       |
| `each-closure-violation`       | error    | Capturing mutable outer variable inside `each()` render callback               |
| `agent-exclusive-annotations`  | error    | Agent-exclusive annotations used in non-agent context                          |
| `pure-update-function`         | error    | `update()` function has side effects — must be pure                            |
| `missing-memo`                 | warn     | Expensive derived computation in `view()` without `memo()`                     |
| `map-on-state-array`           | warn     | Calling `.map()` on a state array in `view()` (use `each()` instead)           |
| `unnecessary-child`            | warn     | Using `child()` boundary when a view function would suffice                    |
| `form-boilerplate`             | warn     | Repetitive form field pattern that could use a view function                   |
| `agent-missing-intent`         | warn     | Agent handler is missing an `@intent` annotation                               |
| `agent-nonextractable-handler` | warn     | Agent handler cannot be statically extracted                                   |

<!-- auto-api:start -->
<!-- auto-api:end -->
