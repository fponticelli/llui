import type { Send } from '@llui/dom'

/**
 * Wrap a child machine's `send` into the PARENT's own message type, the way
 * `menubar.ts`'s per-submenu `menuSend` and `gradient-picker.ts`'s embedded
 * `pickerSend` both do — and additionally mark the returned function's
 * `__lluiVariants`, which plain `mapSend` (`@llui/dom`) does not.
 *
 * That tag is what makes every `tagSend(...)` call built INSIDE the child's
 * own `connect()` report the PARENT's wrapper variant(s) instead of the
 * child's own specific ones (`binding-descriptors.ts`'s `tagSend`: a
 * `send.__lluiVariants` tag on the dispatcher itself always wins over the
 * `libraryVariants` array a given `tagSend` call names). That is the
 * TRUTHFUL external view: an agent driving the parent only ever sees the
 * wrapper type dispatched (`'picker'`, `'menuMsg'`, …), with the child's
 * real action nested inside `msg` — not `menu.ts`'s internal `'highlight'`/
 * `'selectItem'`/… vocabulary leaking out as if the parent could dispatch
 * those directly. Left unset (the untagged `mapSend`), a submenu's own
 * `tagSend(send, ['highlightNext'], …)` call reports `'highlightNext'` to
 * anything introspecting the PARENT's variants — a message type the parent's
 * own `Msg` union does not even have a case for.
 */
export function wrapChildSend<Outer extends { type: string }, Inner>(
  send: Send<Outer>,
  wrap: (inner: Inner) => Outer,
  variants: readonly Outer['type'][],
): Send<Inner> {
  const wrapped: Send<Inner> = (msg) => send(wrap(msg))
  Object.assign(wrapped, { __lluiVariants: variants })
  return wrapped
}
