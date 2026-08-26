import { type ElProps, type Mountable } from '@llui/dom'
import { mergeClass } from '../../lib/utils'
import { LoaderIcon } from './icons'

/**
 * Spinner — shadcn's is `<Loader2Icon className="size-4 animate-spin" />`, so
 * this is the same Lucide arc from the shared icon set rather than a second
 * hand-drawn one.
 *
 * `aria-hidden` (inherited from the icon set) is deliberate: the loading STATE
 * belongs on the region it describes — `aria-busy`, or a live region — not on
 * the decoration. A spinner that announces itself reads as "image" and tells the
 * user nothing.
 */
export function Spinner(props?: ElProps): Mountable {
  const { class: className, ...rest } = props ?? {}
  return LoaderIcon({ ...rest, class: mergeClass('size-4 animate-spin', className) })
}
