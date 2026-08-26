import { blockquote, code, h1, h2, h3, h4, li, p, pre, ul } from '@llui/dom'
import { classPart } from '@/lib/utils'

/**
 * Typography — prose primitives for rendered content.
 *
 * Deliberately individual components rather than one `.prose` class on a
 * wrapper: content in this framework is usually BUILT (a view assembling
 * headings and paragraphs), not injected as an HTML blob, so per-element
 * helpers are what a view actually reaches for. Use a prose plugin instead when
 * you are rendering untrusted HTML you do not construct.
 */
export const TypographyH1 = classPart(
  h1,
  'scroll-m-20 text-4xl font-extrabold tracking-tight text-balance',
)
export const TypographyH2 = classPart(
  h2,
  'scroll-m-20 border-b border-border pb-2 text-3xl font-semibold tracking-tight first:mt-0',
)
export const TypographyH3 = classPart(h3, 'scroll-m-20 text-2xl font-semibold tracking-tight')
export const TypographyH4 = classPart(h4, 'scroll-m-20 text-xl font-semibold tracking-tight')
export const TypographyP = classPart(p, 'leading-7 not-first:mt-6')
export const TypographyLead = classPart(p, 'text-xl text-muted-foreground')
export const TypographyLarge = classPart(p, 'text-lg font-semibold')
export const TypographySmall = classPart(p, 'text-sm leading-none font-medium')
export const TypographyMuted = classPart(p, 'text-sm text-muted-foreground')
export const TypographyBlockquote = classPart(
  blockquote,
  'mt-6 border-l-2 border-border pl-6 italic',
)
export const TypographyList = classPart(ul, 'my-6 ml-6 list-disc [&>li]:mt-2')
export const TypographyListItem = classPart(li, '')
export const TypographyInlineCode = classPart(
  code,
  'relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold',
)
export const TypographyPre = classPart(
  pre,
  'my-6 overflow-x-auto rounded-lg border border-input bg-muted p-4 font-mono text-sm',
)
