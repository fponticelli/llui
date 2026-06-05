---
title: 'Form Validation'
description: 'A sign-up form with Zod schema validation and live field errors.'
---

<div class="example-embed">
  <div class="example-embed-bar">
    <span class="example-embed-dots"><i></i><i></i><i></i></span>
    <span class="example-embed-url">/apps/form-validation/</span>
    <a class="example-embed-open" href="/apps/form-validation/" target="_blank" rel="noopener">Open ↗</a>
  </div>
  <iframe class="example-embed-frame" src="/apps/form-validation/" title="Form Validation — live demo" loading="lazy"></iframe>
</div>

<p class="example-source"><a href="https://github.com/fponticelli/llui/tree/main/examples/form-validation" target="_blank" rel="noopener">View source on GitHub ↗</a></p>

A sign-up form with [Zod](https://zod.dev/) schema validation and real-time, field-level error messages.

## What it demonstrates

- The `@llui/components` form state machine driving values, touched-state, and errors.
- Zod schemas wired in through the Standard Schema interface for validation.
- Field-level errors that appear only after a field is blurred (touch tracking).
- `derived(...)` computed signals for form-wide validity and submission state.

## UI

Email, username, password, and age fields with inline validation messages that surface after blur, plus a success banner once the form submits cleanly.

## Running locally

```bash
pnpm install
pnpm --filter @llui/example-form-validation dev
```
