import { div, h3, p } from '@llui/dom'
import { classPart } from '../../lib/utils'

export const Card = classPart(
  div,
  'rounded-xl border border-border bg-card text-card-foreground shadow-sm',
)
export const CardHeader = classPart(div, 'flex flex-col space-y-1.5 p-6')
export const CardTitle = classPart(h3, 'font-semibold leading-none tracking-tight')
export const CardDescription = classPart(p, 'text-sm text-muted-foreground')
export const CardContent = classPart(div, 'p-6 pt-0')
export const CardFooter = classPart(div, 'flex items-center p-6 pt-0')
