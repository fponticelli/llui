---
status: accepted
---

# Validation is a reducer concern, and Standard Schema is the seam

Form validation in LLui runs inside `update` as an ordinary message, producing errors as ordinary data. `@llui/components/patterns/form-field` owns the composition: a `validate` / `validateAsync` message runs any [Standard Schema](https://standardschema.dev) (Zod, Valibot, ArkType) against values the consumer already holds, maps each issue's PATH to a flat field name, and stores the issues in state. `connect` derives every id (`${base}:${name}:control` / `:label` / `:description` / `:error`) and every reactive ARIA attribute from that one slice. Values stay ordinary application state; the pattern holds only validity, touched, submission status and the id derivation.

This is the deliberate replacement for what shadcn/ui's `form.tsx` gets from react-hook-form. RHF supplies a Controller, a context that derives ids and error state, and a resolver seam for a schema. In TEA the first two are a part bag over a state slice, and the third is a message — so the registry's `form` item ports upstream's five class recipes and re-binds them, rather than dropping them for lack of a binding target.

Two rules fall out and are not negotiable. Errors become visible only when `touched[name] || status === 'submitted'`, so a form does not shout at someone who has typed one character. And an async validation carries a `requestId` stamped into `validationId`, so a slow earlier validation can never overwrite a newer result; `reset` bumps it to invalidate anything in flight.

## Consequences

The reducer stays pure and the state stays JSON-serializable, so a validated form is time-travelable, replayable through `@llui/test`, and inspectable by the agent surface like any other state. `validateAsync` does not run the promise — the consumer dispatches `validateResult` — because running it in the reducer would break that.

There is no `FormControl`. Upstream's is a Radix `Slot` that renders nothing and forwards `id` / `aria-describedby` / `aria-invalid` onto its child; `{...field.control}` already carries exactly those, reactively, and spreads onto any control. A wrapper returning its child unchanged would be a name with no behaviour behind it.

`FormMessage` stays mounted and hides itself. `errorText` carries its own reactive `hidden`, so the live region is registered before it has anything to say; wrapping it in `show(...)` unmounts and rebuilds the region on every transition.

## Considered options

**Ship no `form` item and document the equivalent.** Honest, and cheapest, but `llui add form` fails for anyone following a shadcn tutorial and the machine that already exists stays undiscoverable.

**Ship `form` as an alias of `field`.** Resolves discoverability at the cost of a name that means something different from what it says, and actively hides `patterns/form-field` — the thing a consumer actually needs.

**Design a form machine from scratch.** Rejected as already done: `patterns/form-field` had the submit lifecycle, the touched gating, the Standard Schema seam, the path→name mapping and the stale-response protection before this decision was written down. What was missing was the write-up, the registry item, and one API fix — `errorText` mixed the message and the issue list in with its attributes, making it the one part bag in the package a consumer could not spread.
