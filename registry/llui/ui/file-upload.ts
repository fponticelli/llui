import { button, div, img, input, label, li, p, ul } from '@llui/dom'
import { classPart } from '@/lib/utils'
import { buttonVariants } from '@/ui/button'

/**
 * File upload — skin for `@llui/components/file-upload`. No shadcn counterpart;
 * the dashed dropzone is the common vocabulary and the tokens are the
 * registry's.
 *
 * `data-dragging` is published on BOTH the root and the dropzone, and that is
 * not duplication: the dropzone highlights itself, while the root lets sibling
 * content (a hint line, a preview strip) respond to the same drag without
 * reaching inside.
 *
 * `hiddenInput` is the real `<input type="file">`. It must stay in the DOM for
 * the picker to open and for a native form submit, so it is `sr-only` — never
 * `hidden`, which makes `.click()` on it a no-op in some browsers.
 *
 * The invalid state is `data-invalid` on the root and `aria-invalid` on the
 * hidden input: the styling hook and the announced state, both needed.
 */
export const FileUpload = classPart(
  div,
  'flex w-full max-w-sm flex-col gap-3 data-disabled:pointer-events-none data-disabled:opacity-50 data-readonly:pointer-events-none',
)
export const FileUploadLabel = classPart(label, 'text-sm leading-none font-medium select-none')
export const FileUploadDropzone = classPart(
  div,
  "flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-input px-6 py-8 text-center text-sm text-muted-foreground transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 data-dragging:border-primary data-dragging:bg-accent/50 [&_svg:not([class*='size-'])]:size-6",
)
export const FileUploadTrigger = classPart(
  button,
  buttonVariants({ variant: 'outline', size: 'sm' }),
)
export const FileUploadHiddenInput = classPart(input, 'sr-only')
export const FileUploadClearTrigger = classPart(
  button,
  buttonVariants({ variant: 'ghost', size: 'sm' }),
)
export const FileUploadItemGroup = classPart(ul, 'flex flex-col gap-2')
export const FileUploadItem = classPart(li, 'flex items-center gap-3 rounded-md border p-2 text-sm')
export const FileUploadItemPreview = classPart(
  img,
  'size-10 shrink-0 rounded-sm border object-cover',
)
export const FileUploadItemName = classPart(p, 'min-w-0 flex-1 truncate font-medium')
export const FileUploadItemSizeText = classPart(
  p,
  'shrink-0 text-xs text-muted-foreground tabular-nums',
)
export const FileUploadItemDeleteTrigger = classPart(
  button,
  "inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg:not([class*='size-'])]:size-4",
)
