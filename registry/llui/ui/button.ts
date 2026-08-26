import { button as buttonEl, type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { createVariants, type VariantProps } from '@llui/components/styles'
import { mergeClass, splitArgs } from '@/lib/utils'

/**
 * Recipes ported VERBATIM from shadcn/ui (new-york-v4, MIT © 2023 shadcn), with
 * only the changes LLui genuinely requires. Keeping them byte-identical is the
 * point: it is what makes a shadcn theme, a shadcn screenshot and a shadcn
 * tutorial all still describe what you get here.
 *
 * The shared idioms below are shadcn's and recur across every control — do not
 * "simplify" them into LLui inventions:
 *   - focus ring: `focus-visible:border-ring ring-[3px] ring-ring/50`, NOT a
 *     2px solid ring.
 *   - hover: an ALPHA of the base colour (`hover:bg-primary/90`), not a separate
 *     `--primary-hover` token. The derived tokens in `theme.css` exist for the
 *     baseline stylesheet; recipes here do not use them.
 *   - control borders are `border-input`, not `border-border`.
 *   - `shadow-xs`, not `shadow-sm`.
 *   - invalid: `aria-invalid:border-destructive aria-invalid:ring-destructive/20`.
 *   - icon guards: `[&_svg:not([class*='size-'])]:size-4` sizes icons only when
 *     the caller has not, which is why an explicit `size-` on an icon wins.
 */
const variants = {
  variant: {
    default: 'bg-primary text-primary-foreground hover:bg-primary/90',
    destructive:
      'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40',
    outline:
      'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
    link: 'text-primary underline-offset-4 hover:underline',
  },
  size: {
    default: 'h-9 px-4 py-2 has-[>svg]:px-3',
    xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
    sm: 'h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5',
    lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
    icon: 'size-9',
    'icon-xs': "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
    'icon-sm': 'size-8',
    'icon-lg': 'size-10',
  },
}

export const buttonVariants = createVariants({
  base: "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  variants,
  defaultVariants: { variant: 'default', size: 'default' },
})

export type ButtonVariants = VariantProps<typeof variants>
export type ButtonProps = ElProps & ButtonVariants

/**
 * Button — a presentational element helper, NOT a TEA component: no state, no
 * `update`, no scope of its own.
 *
 * `props` is a plain `ElProps` bag, so a `connect()` part bag spreads in and
 * keeps its handlers, ARIA and `data-*`:
 *
 *   Button({ ...parts.trigger, variant: 'outline' }, [text('Open')])
 *
 * `type: 'button'` is applied BEFORE the spread so a part bag declaring its own
 * `type` still wins.
 */
export function Button(
  a0?: ButtonProps | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { variant, size, class: className, ...rest } = props as ButtonProps
  return buttonEl(
    { type: 'button', ...rest, class: mergeClass(buttonVariants({ variant, size }), className) },
    children,
  )
}
