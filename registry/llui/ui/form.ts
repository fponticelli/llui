import { div, form as formEl, label, p } from '@llui/dom'
import { classPart } from '@/lib/utils'

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn), with `data-slot` rewritten to
 * LLui's `data-part`.
 *
 * # What this is a skin FOR
 *
 * Upstream's `form.tsx` is a **react-hook-form** binding: `FormField` wraps
 * RHF's `Controller`, `useFormField` reads RHF context to derive the control /
 * description / message ids and the error state, and the five recipes below are
 * thin wrappers wired to that context.
 *
 * LLui's equivalent of RHF is **`@llui/components/patterns/form-field`**, and
 * the mapping is one-for-one:
 *
 * | shadcn                    | LLui                                            |
 * | ------------------------- | ----------------------------------------------- |
 * | `useForm` + `zodResolver` | a `validate` message + any Standard Schema       |
 * | `<Form>` (FormProvider)   | one `FormFieldState` slice in your own state     |
 * | `<FormField>` (Controller)| `parts.formField(name)`                          |
 * | `useFormField()`          | the returned bag: ids, aria, error, touched      |
 * | `<FormControl>` (a Slot)  | `{...field.control}` spread onto YOUR control    |
 *
 * So this file ports the RECIPES; the binding they were wired to is replaced by
 * a part bag rather than removed. Validation stays a reducer concern, which is
 * what makes it time-travelable and testable like everything else in TEA.
 *
 * ```ts
 * import { z } from 'zod'
 * import { formField } from '@llui/components/patterns/form-field'
 *
 * const schema = z.object({ email: z.string().email() })
 *
 * // update:
 * case 'submit': {
 *   const [ff] = formField.update(state.ff, { type: 'validate', schema, values: state.values })
 *   return [{ ...state, ff }, []]
 * }
 *
 * // view:
 * const parts = formField.connect(state.at('ff'), ffSend, { id: 'signup', fields: ['email'] })
 * const field = parts.formField('email', { hasDescription: true })
 *
 * Form({ ...parts.root, onSubmit: (e) => { e.preventDefault(); send({ type: 'submit' }) } }, [
 *   FormItem({ ...field.root }, [
 *     FormLabel({ ...field.label }, [text('Email')]),
 *     Input({ ...field.control, type: 'email' }),
 *     FormDescription({ ...field.description }, [text('We never share it.')]),
 *     FormMessage({ ...field.errorText }, [text(field.error.message)]),
 *   ]),
 * ])
 * ```
 *
 * # There is deliberately no `FormControl`
 *
 * Upstream's is a Radix `Slot` — it renders no element of its own, it only
 * forwards `id` / `aria-describedby` / `aria-invalid` onto whatever child you
 * pass. `{...field.control}` already carries exactly those, reactively, and
 * spreads onto any control. A wrapper that returned its child unchanged would
 * be a name with no behaviour behind it.
 *
 * # `FormMessage` stays MOUNTED
 *
 * `field.errorText` carries its own reactive `hidden` and `role="alert"`, so
 * the live region is registered before it has anything to say. Upstream returns
 * `null` when there is no error, which is the React equivalent; wrapping this in
 * `show(...)` is NOT — it unmounts and rebuilds the region on every transition.
 */

/** The `<form>` element. Spread `formField.connect(...).root`, which carries
 *  `data-state` (the submit lifecycle) and `aria-busy`. */
export const Form = classPart(formEl, 'grid gap-6')

/** One field row. Spread `field.root`, which carries `data-invalid` and
 *  `data-touched`; `group/form-item` is what lets the label read them. */
export const FormItem = classPart(div, 'group/form-item grid gap-2')

/**
 * Both spellings of the error state are bound, for the reason
 * `registry/README.md` gives for `input-otp` and `scroll-area`: upstream sets
 * `data-error="true"` on the label itself from RHF context, while the LLui
 * machine publishes the bare `data-invalid` on the field ROOT. A pasted shadcn
 * snippet keeps working and a spread part bag turns the label red.
 */
export const FormLabel = classPart(
  label,
  'flex items-center gap-2 text-sm leading-none font-medium select-none data-[error=true]:text-destructive group-data-invalid/form-item:text-destructive',
)

export const FormDescription = classPart(p, 'text-sm text-muted-foreground')

export const FormMessage = classPart(p, 'text-sm font-medium text-destructive')
