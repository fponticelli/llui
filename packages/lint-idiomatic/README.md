# @llui/lint-idiomatic

AST linter for idiomatic [LLui](https://github.com/fponticelli/llui) patterns. Catches common anti-patterns at the source level.

```bash
pnpm add -D @llui/lint-idiomatic
```

## Usage

```ts
import { lintIdiomatic } from '@llui/lint-idiomatic'

const source = `
  function update(state: State, msg: Msg): [State, Effect[]] {
    switch (msg.type) {
      case 'increment':
        state.count++ // mutation!
        return [state, []]
    }
  }
`

const { violations, score } = lintIdiomatic(source, 'counter.ts')

console.log(score) // 5 (out of 6)
console.log(violations) // [{ rule: 'state-mutation', line: 5, message: '...' }]
```

## API

```ts
lintIdiomatic(source: string, filename?: string) => { violations: Violation[], score: number }
```

| Field        | Type          | Description                               |
| ------------ | ------------- | ----------------------------------------- |
| `violations` | `Violation[]` | List of rule violations found             |
| `score`      | `number`      | Idiomatic score 0-6 (6 = fully idiomatic) |

### Violation

| Field     | Type     | Description                |
| --------- | -------- | -------------------------- |
| `rule`    | `string` | Rule identifier            |
| `line`    | `number` | Source line number         |
| `message` | `string` | Human-readable explanation |

## Rules

| Rule                     | Description                                                              |
| ------------------------ | ------------------------------------------------------------------------ |
| `state-mutation`         | Direct mutation of state in `update()` instead of returning a new object |
| `missing-memo`           | Expensive derived computation in `view()` without `memo()`               |
| `each-closure-violation` | Capturing mutable outer variable inside `each()` render callback         |
| `map-on-state-array`     | Calling `.map()` on a state array in `view()` (use `each()` instead)     |
| `unnecessary-child`      | Using `child()` boundary when a view function would suffice              |
| `form-boilerplate`       | Repetitive form field pattern that could use a view function             |

## License

MIT
