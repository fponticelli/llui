# @llui/lint-idiomatic

AST linter for idiomatic [LLui](https://github.com/fponticelli/llui) patterns. Catches common anti-patterns at the source level.

```bash
pnpm add -D @llui/lint-idiomatic
```

## Vite plugin (recommended)

```ts
// vite.config.ts
import llui from '@llui/vite-plugin'
import lintIdiomatic from '@llui/lint-idiomatic/vite'

export default {
  plugins: [llui(), lintIdiomatic()],
}
```

Violations appear as warnings in the Vite dev server overlay and in CI
build output. The plugin dedupes rules that overlap with `@llui/vite-plugin`'s
built-in `diagnose()` pass so you don't see the same warning twice.

### Plugin options

| Option        | Type                                  | Default                                        | Description                                                                    |
| ------------- | ------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `exclude`     | `readonly string[]`                   | `['map-on-state-array']`                       | Rule names to skip. Pass `[]` to include all rules.                            |
| `skip`        | `readonly RegExp[]`                   | `[/\/node_modules\//, /\/dist\//]`             | File patterns to skip.                                                         |
| `devOnly`     | `boolean`                             | `false`                                        | Only lint in dev mode (skip in production builds).                             |
| `failOnError` | `boolean`                             | `false`                                        | Call `this.error()` instead of `this.warn()` on violations (fails the build). |
| `onLint`      | `(filename, result) => void`          | —                                              | Callback for each linted file. Useful for summary reporters.                   |

## Library usage

For eval harnesses, CLIs, or editor integrations that need the pure function:

```ts
import { lintIdiomatic } from '@llui/lint-idiomatic'

const source = `...`
const { violations, score } = lintIdiomatic(source, 'counter.ts', {
  exclude: ['state-mutation'], // optional: skip specific rules
})

console.log(score) // 17 = fully idiomatic
console.log(violations) // [{ rule, line, column, message, suggestion? }]
```

## API

```ts
lintIdiomatic(
  source: string,
  filename?: string,
  options?: { exclude?: readonly string[] },
) => { violations: Violation[], score: number }
```

| Field        | Type          | Description                                 |
| ------------ | ------------- | ------------------------------------------- |
| `violations` | `Violation[]` | List of rule violations found               |
| `score`      | `number`      | Idiomatic score 0-17 (17 = fully idiomatic) |

### Violation

| Field        | Type     | Description                            |
| ------------ | -------- | -------------------------------------- |
| `rule`       | `string` | Rule identifier                        |
| `line`       | `number` | Source line number                     |
| `column`     | `number` | Source column number                   |
| `message`    | `string` | Human-readable explanation             |
| `suggestion` | `string` | Optional fix suggestion                |

## Rules

| Rule                         | Description                                                                |
| ---------------------------- | -------------------------------------------------------------------------- |
| `state-mutation`             | Direct mutation of state in `update()` instead of returning a new object   |
| `missing-memo`               | Expensive derived computation in `view()` without `memo()`                 |
| `each-closure-violation`     | Capturing mutable outer variable inside `each()` render callback           |
| `map-on-state-array`         | Calling `.map()` on a state array in `view()` (use `each()` instead)       |
| `unnecessary-child`          | Using `child()` boundary when a view function would suffice                |
| `form-boilerplate`           | Repetitive form field pattern that could use a view function               |
| `async-update`               | Using `async`/`await` in `update()` — must be synchronous and pure         |
| `direct-state-in-view`       | Stale state capture in event handler instead of using an accessor          |
| `exhaustive-effect-handling` | Empty `.else()` handler silently drops unhandled effects                   |
| `effect-without-handler`     | Component returns effects but has no `onEffect` handler                    |
| `forgotten-spread`           | `show()`/`branch()`/`each()` used without spread in children array         |
| `string-effect-callback`     | Deprecated string-based `onSuccess`/`onError` in effect declarations       |
| `nested-send-in-update`      | Calling `send()` inside `update()` causes recursive dispatch               |
| `imperative-dom-in-view`     | Using `document.querySelector` etc. in `view()` instead of primitives      |
| `accessor-side-effect`       | Side effects (fetch, console.log, etc.) inside reactive accessor functions |
| `view-bag-import`            | Importing view helpers instead of destructuring from the `View<S, M>` bag   |
| `spread-in-children`         | Spreading array literals into children instead of `show()`/`each()`/`branch()` |
