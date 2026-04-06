# @llui/transitions

Animation helpers for [LLui](https://github.com/fponticelli/llui) structural primitives. Works with `show`, `branch`, and `each`.

```bash
pnpm add @llui/transitions
```

## Usage

```ts
import { fade, slide, mergeTransitions } from '@llui/transitions'
import { div } from '@llui/dom'

// Fade + slide on a show block
view({ show, text }) {
  show({
    when: (s) => s.visible,
    render: () => div({}, text((s) => s.message)),
    ...mergeTransitions(fade(), slide({ direction: 'down' })),
  })
}
```

## API

### Core

| Function                    | Description                                          |
| --------------------------- | ---------------------------------------------------- |
| `transition({ enter, leave })` | Core transition -- define custom enter/leave animations |
| `mergeTransitions(a, b)`    | Combine two transitions into one                     |

### Presets

| Function             | Options                         | Description                    |
| -------------------- | ------------------------------- | ------------------------------ |
| `fade(options?)`     | `duration`, `easing`            | Fade in/out                    |
| `slide(options?)`    | `direction`, `duration`, `easing` | Slide from direction (`up`, `down`, `left`, `right`) |
| `scale(options?)`    | `from`, `duration`, `easing`    | Scale transform in/out         |
| `collapse(options?)` | `duration`, `easing`            | Height collapse/expand         |
| `flip(options?)`     | `duration`, `easing`            | FLIP reorder animation for `each()` |

### Integration

Presets return `{ enter, leave }` objects that spread directly into `show`, `branch`, or `each`:

```ts
// show with fade
show({ when: (s) => s.open, render: () => content(), ...fade() })

// each with FLIP reorder
each({
  items: (s) => s.list,
  key: (item) => item.id,
  render: (item) => li({}, text(() => item.name)),
  ...flip({ duration: 200 }),
})
```

## License

MIT
