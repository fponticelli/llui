# Form Validation

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
