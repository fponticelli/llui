# TodoMVC

The classic [TodoMVC](https://todomvc.com/) reference app, implemented in LLui. Add tasks, toggle them complete, filter the list, and clear what's done.

## What it demonstrates

- `each(...)` keyed lists that reconcile rows as todos are added, removed, and reordered.
- A discriminated `Msg` union driving every mutation (`add`, `toggle`, `destroy`, `clearCompleted`, `setFilter`).
- Filter-based list projection with signal `.map(...)` (all / active / completed).
- `show(...)` for the footer and "toggle-all" affordances that only appear when there are todos.
- Reactive `class` attributes that flip per-row styling without rebuilding the DOM.

## UI

A todo input, a toggle-all control, the filtered list with per-item checkboxes and delete buttons, and a footer showing the active count plus **Clear completed**.

## Running locally

```bash
pnpm install
pnpm --filter @llui/example-todomvc dev
```
