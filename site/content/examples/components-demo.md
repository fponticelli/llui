---
title: 'Components Demo'
description: 'A gallery of the headless @llui/components primitives.'
---

<div class="example-embed">
  <div class="example-embed-bar">
    <span class="example-embed-dots"><i></i><i></i><i></i></span>
    <span class="example-embed-url">/apps/components-demo/</span>
    <a class="example-embed-open" href="/apps/components-demo/" target="_blank" rel="noopener">Open ↗</a>
  </div>
  <iframe class="example-embed-frame" src="/apps/components-demo/" title="Components Demo — live demo" loading="lazy"></iframe>
</div>

<p class="example-source"><a href="https://github.com/fponticelli/llui/tree/main/examples/components-demo" target="_blank" rel="noopener">View source on GitHub ↗</a></p>

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
