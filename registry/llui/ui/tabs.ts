import { button, div, type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { classPart, mergeClass, splitArgs } from '@/lib/utils'

/**
 * Tabs — the SKIN for `@llui/components/tabs`. Roving focus, arrow-key
 * navigation and the `aria-controls`/`aria-labelledby` pairing all live in the
 * package's `connect()`; spread its bags into these helpers.
 *
 *   const parts = tabsConnect(state.at('tabs'), tabsSend, { id: 'settings' })
 *   Tabs({ ...parts.root }, [
 *     TabsList({ ...parts.list }, [
 *       TabsTrigger({ ...parts.item('general').trigger }, [text('General')]),
 *     ]),
 *     TabsContent({ ...parts.item('general').panel }, [ … ]),
 *   ])
 */
export const Tabs = classPart(div, 'flex flex-col gap-2')
export const TabsList = classPart(
  div,
  'inline-flex h-9 w-fit items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground',
)
export const TabsContent = classPart(
  div,
  'flex-1 outline-none focus-visible:ring-2 focus-visible:ring-ring',
)

export function TabsTrigger(
  a0?: ElProps | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { class: className, ...rest } = props as ElProps
  return button(
    {
      ...rest,
      class: mergeClass(
        'inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap transition-colors duration-fast outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      ),
    },
    children,
  )
}
