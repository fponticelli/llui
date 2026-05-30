# Signals Showcase — feature coverage

This example exists to exercise the **entire** signal authoring surface across a
small set of components, so collectively every feature is demonstrated. It is the
canonical reference for authoring LLui with signals.

| Feature                                                         | Where                                                                       |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `state.at('path')` leaf read                                    | counter (`count`), todos (`title`)                                          |
| deep / nested `.at()` path                                      | counter (`state.at('count')`), todos item `at('done')`                      |
| `.map(fn)` transform in a slot                                  | counter value, todos `done` glyph                                           |
| `.peek()` in an event handler                                   | counter Reset (`state.at('count').peek()`), todos toggle (`item.peek().id`) |
| `derived([...], fn)` (independent signals)                      | todos summary (`todos` + `filter`)                                          |
| reactive attribute                                              | counter `class`, todos `<li>` `class`                                       |
| event handlers (`on*`)                                          | both (buttons)                                                              |
| `show(cond, render)` conditional mount                          | counter Reset region                                                        |
| `branch(disc, arms)` discriminated union                        | todos `empty` / `list`                                                      |
| `each(items, { key, render })` keyed list + per-row item signal | todos list                                                                  |
| `foreign()` imperative boundary + `LiveSignal.bind`             | editor                                                                      |
| effects-as-data (`update` returns effects) + `onEffect`         | counter `beep`, todos `load`                                                |
| effect → `send` back into the loop                              | counter (`beep` → `beeped`), todos (`load` → `loaded`)                      |
| initial effects from `init`                                     | todos (`[{ type: 'load' }]`)                                                |
| msg `@intent` agent annotations                                 | both                                                                        |

## Notes

- `foreign()` is authored in `editor.ts` (a contenteditable widget) and also
  runtime-tested in `packages/dom/test/signals/foreign.test.ts`.

## How it runs

`component`, `mountApp` are kept by the compiler; `text` / `div` / `each` / `show`
/ `branch` / … are **rewritten** by `@llui/vite-plugin` into the runtime form
(`signalText` / `el` / `signalEach` / …). `pnpm dev` compiles and serves it;
`pnpm check` type-checks the authored source against `@llui/dom`.
