# Components Demo

A gallery of LLui's headless component library (`@llui/components`). Each section wires up one family of accessible, unstyled primitives with live controls.

## What it demonstrates

- A broad slice of `@llui/components`: dialogs, popovers, tooltips, menus, menubars, toolbars, breadcrumbs, selects, comboboxes, drawers, tabs, accordions, carousels, sliders, meters, toggles, checkboxes, radio groups, pagination, tables, sortable lists, tree-view, fields/fieldsets/forms, theme switches, and in-view tracking.
- The higher-level `@llui/components/patterns`: command menu (⌘K palette), data table (paged · sortable · selectable), searchable select, form field, and a multi-step wizard.
- Composing many independent sections under a single root app, each owning a slice of state.
- Effects-as-data — section effects (data-table page loads, wizard step validation, command execution) are forwarded and routed through the root `onEffect`, alongside cross-section event buses driving toasts and confirm dialogs.
- The headless `connect(...)` / `overlay(...)` part-bag pattern consumers spread onto their own elements.

## UI

A multi-section catalogue grouped by category — overlays, inputs, data & lists, pickers, time inputs, content, surfaces, and canvas — each demoing a component you can interact with directly.

## Running locally

```bash
pnpm install
pnpm --filter @llui/example-components-demo dev
```
