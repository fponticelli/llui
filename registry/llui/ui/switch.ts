import { button, span, type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { mergeClass } from '@/lib/utils'

/**
 * Switch — the SKIN for `@llui/components/switch`. The state machine, keyboard
 * handling and ARIA stay in the package; these helpers add the element tag and
 * the class recipe, and nothing else.
 *
 * Spread the part bag in; every visual state is driven by the `data-state` /
 * `data-disabled` attributes the bag already emits, so nothing here reads state:
 *
 *   const parts = switchConnect(state.at('enabled'), switchSend)
 *   Switch({ ...parts.root }, [ SwitchThumb({ ...parts.thumb }) ])
 */
export function Switch(props: ElProps | undefined, children: readonly ChildNode[] = []): Mountable {
  const { class: className, ...rest } = props ?? {}
  return button(
    {
      type: 'button',
      ...rest,
      class: mergeClass(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors duration-fast outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:bg-primary data-[state=unchecked]:bg-accent-strong data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
        className,
      ),
    },
    children,
  )
}

export function SwitchThumb(props?: ElProps): Mountable {
  const { class: className, ...rest } = props ?? {}
  return span({
    ...rest,
    class: mergeClass(
      'pointer-events-none block size-4 rounded-full bg-background shadow-lg ring-0 transition-transform duration-fast data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0',
      className,
    ),
  })
}
