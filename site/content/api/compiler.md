---
title: '@llui/compiler'
description: 'Engine: 3-pass TypeScript transform + 41 compile-time lint rules'
---

# @llui/compiler

Build-tool-agnostic compiler engine for [LLui](https://github.com/fponticelli/llui). It runs the 3-pass TypeScript transform (static/dynamic prop split → dependency analysis + bitmask injection → import cleanup) and enforces 41 idiomatic-LLui lint rules as compile-time errors.

This package is the engine. End users normally consume it through an adapter:

- [`@llui/vite-plugin`](/api/vite-plugin) — the Vite adapter
- [`@llui/compiler-introspection`](/api/compiler-introspection) — opt-in agent schemas + annotations
- [`@llui/compiler-devtools`](/api/compiler-devtools) — opt-in `__componentMeta` emission
- [`@llui/compiler-ssr`](/api/compiler-ssr) — opt-in `'use client'` directive handling

## Why compile-time errors, not lint warnings

All 41 rules report at **error** severity through the compiler. LLM-generated code routinely ignores lint warnings; non-bypassable compiler errors are the only effective channel for catching idiomatic-LLui mistakes before they reach the runtime.

The `@llui/eslint-plugin` package was removed when the rules migrated into this engine.

## Rule catalogue

| Rule ID                                     | Description                                                 |
| ------------------------------------------- | ----------------------------------------------------------- |
| `llui/accessibility`                        | A11y issues in element helpers                              |
| `llui/accessor-side-effect`                 | Side effects inside reactive accessor functions             |
| `llui/agent-emits-drift`                    | `@emits` annotation drifts from the Msg union               |
| `llui/agent-example-on-payload`             | `@example` annotation placed incorrectly                    |
| `llui/agent-exclusive-annotations`          | Agent-exclusive annotations used in non-agent context       |
| `llui/agent-missing-intent`                 | Agent handler missing an `@intent` annotation               |
| `llui/agent-msg-resolvable`                 | Agent handler cannot resolve a Msg                          |
| `llui/agent-nonextractable-handler`         | Agent handler cannot be statically extracted                |
| `llui/agent-optional-field-undocumented`    | Optional Msg field missing a `@should` annotation           |
| `llui/agent-tagsend-translator-missing`     | `tagSend()` is missing a translator                         |
| `llui/agent-warning-on-confirm`             | Mis-tagged confirmation annotation                          |
| `llui/async-update`                         | `async`/`await` in `update()`                               |
| `llui/bitmask-overflow`                     | Component has more than 62 state paths                      |
| `llui/controlled-input`                     | Controlled input pattern violations                         |
| `llui/direct-state-in-view`                 | Stale state capture in event handler                        |
| `llui/each-closure-violation`               | Capturing mutable outer variable inside `each()`            |
| `llui/effect-without-handler`               | Component returns effects but has no `onEffect`             |
| `llui/empty-props`                          | Empty props object — pass `null` or omit                    |
| `llui/exhaustive-effect-handling`           | `.else()` handler silently drops unhandled effects          |
| `llui/exhaustive-update`                    | `update()` does not exhaustively handle every Msg variant   |
| `llui/forgotten-spread`                     | Structural primitive result not spread into children        |
| `llui/form-boilerplate`                     | Repetitive form field pattern                               |
| `llui/imperative-dom-in-view`               | `document.querySelector` etc. in `view()`                   |
| `llui/map-on-state-array`                   | `.map()` on a state array (use `each()`)                    |
| `llui/missing-memo`                         | Expensive derived computation without `memo()`              |
| `llui/namespace-import`                     | Namespace import where a named import is required           |
| `llui/nested-send-in-update`                | Calling `send()` inside `update()`                          |
| `llui/no-barrel-import-when-subpath-exists` | Use the subpath export, not the barrel                      |
| `llui/no-eager-item-accessor`               | Eager item-accessor evaluation                              |
| `llui/no-let-reactive-accessor`             | `let`-bound reactive accessor                               |
| `llui/no-list-render-in-sample`             | List rendering inside `sample()`                            |
| `llui/no-sample-in-accessor`                | `sample()` used inside a reactive accessor                  |
| `llui/no-sample-in-reactive-position`       | `sample()` used in a reactive position                      |
| `llui/pure-update-function`                 | `update()` has side effects                                 |
| `llui/spread-in-children`                   | `show()`/`branch()`/`each()` used without spread            |
| `llui/state-mutation`                       | Direct mutation of state in `update()`                      |
| `llui/static-items`                         | Static items emitted incorrectly                            |
| `llui/static-on`                            | Static `on*` handler emitted incorrectly                    |
| `llui/string-effect-callback`               | Deprecated string-based `onSuccess`/`onError`               |
| `llui/subapp-requires-reason`               | `subApp` call missing a non-empty `reason`                  |
| `llui/view-bag-import`                      | Direct import of view-bag primitives (use destructured bag) |

<!-- auto-api:start -->
<!-- auto-api:end -->
