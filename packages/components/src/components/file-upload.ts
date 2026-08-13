import type { Send, Signal } from '@llui/dom'
import { useContext, tagSend } from '@llui/dom'
import { LocaleContext } from '../locale.js'

/**
 * File upload — input element + drag-and-drop zone. Tracks selected files,
 * drag state, accept filters, validation errors. Multiple or single selection.
 *
 * `accept` can be either a raw HTML-accept string (`"image/*,.pdf"`) or a
 * MIME-object (`{ 'image/*': ['.png', '.jpg'], 'application/pdf': [] }`).
 * The object form is validated client-side per file; the raw string form
 * only drives the browser's native picker filter.
 *
 * Files that fail validation (too large, too small, wrong type, over the
 * count limit) flow into `rejectedFiles` with a list of `FileError` codes
 * attached. The view can render them alongside accepted files.
 *
 * State holds `FileMeta` records — plain JSON — never the live `File`
 * objects: State must be JSON-serializable (CLAUDE.md), and a `File` came
 * back from a round-trip as `{}`, wiping every name and turning `totalSize`
 * into NaN (#119). The handles live in a module-scoped registry keyed by
 * `FileMeta.id`; see `trackFile`/`getFile`/`releaseDropped`.
 */

export type AcceptValue = string | Record<string, string[]>

export type FileError =
  | { code: 'TOO_LARGE'; max: number }
  | { code: 'TOO_SMALL'; min: number }
  | { code: 'INVALID_TYPE' }
  | { code: 'TOO_MANY'; max: number }
  | { code: 'CUSTOM'; message: string }

/**
 * The serializable half of a selected file. `id` is the registry key for the
 * live handle; the rest mirrors the `File` fields a view needs.
 */
export interface FileMeta {
  id: string
  name: string
  size: number
  type: string
  lastModified: number
}

/** Everything `fileMatchesAccept` needs — satisfied by both `File` and `FileMeta`. */
export interface FileLike {
  name: string
  type: string
}

export interface RejectedFile {
  file: FileMeta
  errors: FileError[]
}

export interface FileUploadState {
  files: FileMeta[]
  rejectedFiles: RejectedFile[]
  disabled: boolean
  multiple: boolean
  accept: AcceptValue
  maxFiles: number
  maxSize: number
  minFileSize: number
  required: boolean
  readonly: boolean
  invalid: boolean
  /** `dragDepth > 0`, materialized so views bind one boolean. */
  dragging: boolean
  /**
   * Nesting depth of the in-flight drag. `dragenter`/`dragleave` both bubble
   * and fire in the order enter@child → leave@parent, so a plain boolean flips
   * off while the pointer is still inside the dropzone (#119).
   */
  dragDepth: number
}

export type FileUploadMsg =
  /** @humanOnly */
  | { type: 'setFiles'; files: FileMeta[]; customRejected?: RejectedFile[] }
  /** @humanOnly */
  | { type: 'addFiles'; files: FileMeta[]; customRejected?: RejectedFile[] }
  /** @intent("Remove the accepted file at the given index") */
  | { type: 'removeFile'; index: number }
  /** @intent("Remove the rejected file at the given index") */
  | { type: 'removeRejected'; index: number }
  /** @intent("Clear all accepted files") */
  | { type: 'clear' }
  /** @intent("Clear the rejected-files list") */
  | { type: 'clearRejected' }
  /** @humanOnly */
  | { type: 'dragEnter' }
  /** @humanOnly */
  | { type: 'dragLeave' }
  /** @humanOnly */
  | { type: 'drop' }
  /** @humanOnly */
  | { type: 'setInvalid'; invalid: boolean }

export interface FileUploadInit {
  files?: FileMeta[]
  disabled?: boolean
  multiple?: boolean
  accept?: AcceptValue
  maxFiles?: number
  maxSize?: number
  minFileSize?: number
  required?: boolean
  readonly?: boolean
  invalid?: boolean
}

export function init(opts: FileUploadInit = {}): FileUploadState {
  return {
    files: opts.files ?? [],
    rejectedFiles: [],
    disabled: opts.disabled ?? false,
    multiple: opts.multiple ?? false,
    accept: opts.accept ?? '',
    maxFiles: opts.maxFiles ?? 0,
    maxSize: opts.maxSize ?? 0,
    minFileSize: opts.minFileSize ?? 0,
    required: opts.required ?? false,
    readonly: opts.readonly ?? false,
    invalid: opts.invalid ?? false,
    dragging: false,
    dragDepth: 0,
  }
}

/**
 * Live `File` handles, keyed by `FileMeta.id`. Module-scoped because State
 * cannot hold them (see the file header) and because a host's upload effect
 * needs to reach a handle far from the view that produced it.
 *
 * Entries are dropped by `releaseFile`/`releaseDropped`. `connect` calls
 * `releaseDropped` after every message it sends, so the handles a transition
 * made unreachable are freed without the host doing anything; a host that
 * drives the reducer itself should call it too.
 */
const fileRegistry = new Map<string, File>()
let fileSeq = 0

const idOf = (ref: FileMeta | string): string => (typeof ref === 'string' ? ref : ref.id)

/** Register a live `File` and return the serializable record that goes in State. */
export function trackFile(file: File): FileMeta {
  const id = `file:${++fileSeq}`
  fileRegistry.set(id, file)
  return {
    id,
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
  }
}

export function trackFiles(files: readonly File[]): FileMeta[] {
  return files.map(trackFile)
}

/** The live handle for a tracked file, or undefined once released. */
export function getFile(ref: FileMeta | string): File | undefined {
  return fileRegistry.get(idOf(ref))
}

export function releaseFile(ref: FileMeta | string): void {
  fileRegistry.delete(idOf(ref))
}

export function releaseFiles(refs: readonly (FileMeta | string)[]): void {
  for (const ref of refs) releaseFile(ref)
}

function referencedIds(state: FileUploadState, into: Set<string>): Set<string> {
  for (const f of state.files) into.add(f.id)
  for (const r of state.rejectedFiles) into.add(r.file.id)
  return into
}

/**
 * Release the handles that `next` no longer references. Pure bookkeeping over
 * two states, so it is correct for every transition — including the ones that
 * drop a file without naming it (single-select replacement, a rejected list
 * overwritten by the next selection).
 */
export function releaseDropped(prev: FileUploadState, next: FileUploadState): void {
  if (prev.files === next.files && prev.rejectedFiles === next.rejectedFiles) return
  const kept = referencedIds(next, new Set<string>())
  for (const id of referencedIds(prev, new Set<string>())) {
    if (!kept.has(id)) fileRegistry.delete(id)
  }
}

/**
 * Serialize an AcceptValue into a comma-joined string suitable for the
 * HTML `accept` attribute. Both MIME types and extensions are emitted.
 */
export function acceptToString(accept: AcceptValue): string {
  if (typeof accept === 'string') return accept
  const parts: string[] = []
  for (const [mime, exts] of Object.entries(accept)) {
    parts.push(mime)
    for (const ext of exts) parts.push(ext)
  }
  return parts.join(',')
}

/**
 * Check whether a file matches the accept configuration. Raw-string accept
 * is passed through to the browser picker so we always return true here;
 * MIME-object accept is validated by checking MIME type (with wildcards)
 * and extension membership.
 */
export function fileMatchesAccept(file: FileLike, accept: AcceptValue): boolean {
  if (typeof accept === 'string' || Object.keys(accept).length === 0) return true
  const name = file.name.toLowerCase()
  for (const [mime, exts] of Object.entries(accept)) {
    if (matchMime(file.type, mime)) return true
    for (const ext of exts) {
      if (name.endsWith(ext.toLowerCase())) return true
    }
  }
  return false
}

function matchMime(fileType: string, pattern: string): boolean {
  if (!fileType) return false
  if (pattern === fileType) return true
  // Wildcard support: "image/*" matches "image/png"
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -1) // "image/"
    return fileType.startsWith(prefix)
  }
  return false
}

/**
 * The count limit actually in force: a single-select uploader accepts exactly
 * one file whatever `maxFiles` says. Without this, dropping three files on a
 * `multiple: false` zone accepted all three with zero rejections (#119).
 */
export function effectiveMaxFiles(state: FileUploadState): number {
  return state.multiple ? state.maxFiles : 1
}

/**
 * Partition incoming files into accepted and rejected based on state's
 * accept/size/count constraints. The current accepted-file count is used
 * to enforce the count limit — the caller is responsible for passing the
 * post-combine accepted total when appending.
 */
export function validateFiles(
  incoming: FileMeta[],
  state: FileUploadState,
  existingAcceptedCount: number,
): { accepted: FileMeta[]; rejected: RejectedFile[] } {
  const accepted: FileMeta[] = []
  const rejected: RejectedFile[] = []
  const maxFiles = effectiveMaxFiles(state)
  let count = existingAcceptedCount
  for (const f of incoming) {
    const errors: FileError[] = []
    if (state.maxSize > 0 && f.size > state.maxSize) {
      errors.push({ code: 'TOO_LARGE', max: state.maxSize })
    }
    if (state.minFileSize > 0 && f.size < state.minFileSize) {
      errors.push({ code: 'TOO_SMALL', min: state.minFileSize })
    }
    if (!fileMatchesAccept(f, state.accept)) {
      errors.push({ code: 'INVALID_TYPE' })
    }
    if (maxFiles > 0 && count >= maxFiles) {
      errors.push({ code: 'TOO_MANY', max: maxFiles })
    }
    if (errors.length > 0) {
      rejected.push({ file: f, errors })
    } else {
      accepted.push(f)
      count++
    }
  }
  return { accepted, rejected }
}

export function update(state: FileUploadState, msg: FileUploadMsg): [FileUploadState, never[]] {
  if (state.disabled && msg.type !== 'clear' && msg.type !== 'clearRejected') {
    return [state, []]
  }
  if (state.readonly && (msg.type === 'setFiles' || msg.type === 'addFiles')) {
    return [state, []]
  }
  switch (msg.type) {
    case 'setFiles': {
      const { accepted, rejected } = validateFiles(msg.files, state, 0)
      const merged = msg.customRejected ? [...rejected, ...msg.customRejected] : rejected
      return [{ ...state, files: accepted, rejectedFiles: merged }, []]
    }
    case 'addFiles': {
      const base = state.multiple ? state.files : []
      const { accepted, rejected } = validateFiles(msg.files, state, base.length)
      const combined = state.multiple ? [...base, ...accepted] : accepted
      const merged = msg.customRejected ? [...rejected, ...msg.customRejected] : rejected
      return [{ ...state, files: combined, rejectedFiles: merged }, []]
    }
    case 'removeFile':
      return [{ ...state, files: state.files.filter((_, i) => i !== msg.index) }, []]
    case 'removeRejected':
      return [
        { ...state, rejectedFiles: state.rejectedFiles.filter((_, i) => i !== msg.index) },
        [],
      ]
    case 'clear':
      return [{ ...state, files: [], rejectedFiles: [] }, []]
    case 'clearRejected':
      return [{ ...state, rejectedFiles: [] }, []]
    case 'setInvalid':
      return [{ ...state, invalid: msg.invalid }, []]
    case 'dragEnter': {
      const dragDepth = state.dragDepth + 1
      return [{ ...state, dragDepth, dragging: true }, []]
    }
    case 'dragLeave': {
      const dragDepth = Math.max(0, state.dragDepth - 1)
      return [{ ...state, dragDepth, dragging: dragDepth > 0 }, []]
    }
    case 'drop':
      // A drop ends the whole drag, however many nested enters preceded it.
      return [{ ...state, dragDepth: 0, dragging: false }, []]
  }
}

export function totalSize(state: FileUploadState): number {
  let total = 0
  for (const f of state.files) total += f.size
  return total
}

/**
 * Install a document-level dragover/drop blocker. Without this, dragging a
 * file outside the dropzone causes the browser to navigate away from the
 * page. Call from onMount and invoke the returned disposer on unmount.
 */
export function preventDocumentDrop(): () => void {
  const prevent = (e: DragEvent): void => {
    // Only prevent default if the drop is NOT on an element inside a
    // file-upload dropzone — let those handle their own drops.
    const target = e.target as Element | null
    if (target?.closest('[data-scope="file-upload"][data-part="dropzone"]')) return
    e.preventDefault()
  }
  document.addEventListener('dragover', prevent)
  document.addEventListener('drop', prevent)
  return () => {
    document.removeEventListener('dragover', prevent)
    document.removeEventListener('drop', prevent)
  }
}

export interface FileUploadItemParts {
  item: {
    'data-scope': 'file-upload'
    'data-part': 'item'
    'data-index': string
  }
  itemName: {
    'data-scope': 'file-upload'
    'data-part': 'item-name'
  }
  itemSizeText: {
    'data-scope': 'file-upload'
    'data-part': 'item-size-text'
  }
  itemPreview: {
    'data-scope': 'file-upload'
    'data-part': 'item-preview'
  }
  removeTrigger: {
    type: 'button'
    'aria-label': string
    'data-scope': 'file-upload'
    'data-part': 'item-remove'
    onClick: (e: MouseEvent) => void
  }
  /** Zag-aligned alias for removeTrigger. Same wiring. */
  itemDeleteTrigger: {
    type: 'button'
    'aria-label': string
    'data-scope': 'file-upload'
    'data-part': 'item-delete-trigger'
    onClick: (e: MouseEvent) => void
  }
}

export interface FileUploadParts {
  root: {
    'data-scope': 'file-upload'
    'data-part': 'root'
    'data-disabled': Signal<'' | undefined>
    'data-dragging': Signal<'' | undefined>
    'data-invalid': Signal<'' | undefined>
    'data-readonly': Signal<'' | undefined>
  }
  dropzone: {
    'data-scope': 'file-upload'
    'data-part': 'dropzone'
    'data-dragging': Signal<'' | undefined>
    onClick: (e: MouseEvent) => void
    onDragEnter: (e: DragEvent) => void
    onDragOver: (e: DragEvent) => void
    onDragLeave: (e: DragEvent) => void
    onDrop: (e: DragEvent) => void
  }
  trigger: {
    type: 'button'
    'data-scope': 'file-upload'
    'data-part': 'trigger'
    disabled: Signal<boolean>
    onClick: (e: MouseEvent) => void
  }
  hiddenInput: {
    type: 'file'
    tabindex: -1
    'aria-hidden': 'true'
    style: string
    disabled: Signal<boolean>
    multiple: Signal<boolean>
    accept: Signal<string>
    required: Signal<boolean>
    'aria-invalid': Signal<'true' | undefined>
    capture?: string | boolean
    webkitdirectory?: '' | undefined
    'data-scope': 'file-upload'
    'data-part': 'hidden-input'
    id: string
    onChange: (e: Event) => void
  }
  label: {
    for: string
    'data-scope': 'file-upload'
    'data-part': 'label'
  }
  clearTrigger: {
    type: 'button'
    'aria-label': string
    'data-scope': 'file-upload'
    'data-part': 'clear-trigger'
    onClick: (e: MouseEvent) => void
  }
  itemGroup: {
    'data-scope': 'file-upload'
    'data-part': 'item-group'
  }
  item: (index: number) => FileUploadItemParts
}

export interface ConnectOptions {
  id: string
  removeLabel?: string
  clearLabel?: string
  /**
   * Hints the browser to use the device camera/microphone for capture. Only
   * applies to mobile. Pass `'user'` for the front camera, `'environment'`
   * for the back, or `true` to accept either.
   */
  capture?: 'user' | 'environment' | boolean
  /** Show a directory-picker instead of a file-picker (webkit only). */
  directory?: boolean
  /**
   * Per-file synchronous validator. Return a non-empty array of `FileError`
   * codes to reject the file, or null/empty to accept. Runs in addition to
   * the state-driven accept/size/count checks — its errors accumulate into
   * `rejectedFiles` alongside the built-in errors.
   */
  validate?: (file: File) => FileError[] | null
  /**
   * Optional transform pipeline. Runs before validation. Can return a
   * Promise; onChange awaits it before dispatching. Use for image resizing,
   * format conversion, etc.
   */
  transformFiles?: (files: File[]) => File[] | Promise<File[]>
}

const HIDDEN_STYLE =
  'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;'

export function connect(
  state: Signal<FileUploadState>,
  send: Send<FileUploadMsg>,
  opts: ConnectOptions,
): FileUploadParts {
  const locale = useContext(LocaleContext)
  const inputId = `${opts.id}:input`
  const removeLabel = opts.removeLabel ?? locale.fileUpload.remove
  const clearLabel = opts.clearLabel ?? locale.fileUpload.clear

  /**
   * Send, then free the handles the transition dropped. `send` is synchronous
   * (CLAUDE.md), so the post-send peek is the state the message produced — no
   * handler has to know which messages remove a file, or whether a gate
   * swallowed one. `peek()` is undefined only outside a live mount (unit tests
   * over `rootSignal()`), where there is nothing to release either.
   */
  const sendTracked = (msg: FileUploadMsg): void => {
    const before = state.peek()
    send(msg)
    const after = state.peek()
    if (before && after) releaseDropped(before, after)
  }

  const runPipeline = async (
    raw: File[],
  ): Promise<{ files: FileMeta[]; customRejected: RejectedFile[] }> => {
    let files = raw
    if (opts.transformFiles) files = await opts.transformFiles(files)
    const customRejected: RejectedFile[] = []
    if (opts.validate) {
      const passed: File[] = []
      for (const f of files) {
        const errors = opts.validate(f)
        // Tracked as well: a rejected file is still shown, and a host may retry it.
        if (errors && errors.length > 0) customRejected.push({ file: trackFile(f), errors })
        else passed.push(f)
      }
      files = passed
    }
    return { files: trackFiles(files), customRejected }
  }

  const dispatchAdd = (raw: File[]): void => {
    if (!opts.transformFiles && !opts.validate) {
      sendTracked({ type: 'addFiles', files: trackFiles(raw) })
      return
    }
    // Fire-and-forget — transforms may be async.
    void runPipeline(raw).then(({ files, customRejected }) => {
      sendTracked({ type: 'addFiles', files, customRejected })
    })
  }

  const openPicker = (e: MouseEvent): void => {
    const target = e.target as HTMLElement
    if (target.getAttribute('data-part') === 'hidden-input') return
    const root = (e.currentTarget as HTMLElement).closest(
      '[data-scope="file-upload"][data-part="root"]',
    )
    const input = root?.querySelector<HTMLInputElement>(
      '[data-scope="file-upload"][data-part="hidden-input"]',
    )
    input?.click()
  }

  return {
    root: {
      'data-scope': 'file-upload',
      'data-part': 'root',
      'data-disabled': state.map((st) => (st.disabled ? '' : undefined)),
      'data-dragging': state.map((st) => (st.dragging ? '' : undefined)),
      'data-invalid': state.map((st) => (st.invalid ? '' : undefined)),
      'data-readonly': state.map((st) => (st.readonly ? '' : undefined)),
    },
    dropzone: {
      'data-scope': 'file-upload',
      'data-part': 'dropzone',
      'data-dragging': state.map((st) => (st.dragging ? '' : undefined)),
      onClick: openPicker,
      onDragEnter: tagSend(send, ['dragEnter'], (e) => {
        e.preventDefault()
        send({ type: 'dragEnter' })
      }),
      onDragOver: (e) => e.preventDefault(),
      onDragLeave: tagSend(send, ['dragLeave'], (e) => {
        e.preventDefault()
        send({ type: 'dragLeave' })
      }),
      onDrop: tagSend(send, ['drop'], (e) => {
        e.preventDefault()
        const files = Array.from(e.dataTransfer?.files ?? [])
        send({ type: 'drop' })
        dispatchAdd(files)
      }),
    },
    trigger: {
      type: 'button',
      'data-scope': 'file-upload',
      'data-part': 'trigger',
      disabled: state.map((st) => st.disabled),
      onClick: openPicker,
    },
    hiddenInput: {
      type: 'file',
      tabindex: -1,
      'aria-hidden': 'true',
      style: HIDDEN_STYLE,
      disabled: state.map((st) => st.disabled),
      multiple: state.map((st) => st.multiple),
      accept: state.map((st) => acceptToString(st.accept)),
      required: state.map((st) => st.required),
      'aria-invalid': state.map((st) => (st.invalid ? 'true' : undefined)),
      ...(opts.capture !== undefined ? { capture: opts.capture } : {}),
      ...(opts.directory === true ? { webkitdirectory: '' as const } : {}),
      'data-scope': 'file-upload',
      'data-part': 'hidden-input',
      id: inputId,
      onChange: (e) => {
        const input = e.target as HTMLInputElement
        const files = input.files ? Array.from(input.files) : []
        dispatchAdd(files)
        input.value = ''
      },
    },
    label: {
      for: inputId,
      'data-scope': 'file-upload',
      'data-part': 'label',
    },
    clearTrigger: {
      type: 'button',
      'aria-label': clearLabel,
      'data-scope': 'file-upload',
      'data-part': 'clear-trigger',
      onClick: tagSend(send, ['clear'], () => sendTracked({ type: 'clear' })),
    },
    itemGroup: {
      'data-scope': 'file-upload',
      'data-part': 'item-group',
    },
    item: (index: number): FileUploadItemParts => ({
      item: {
        'data-scope': 'file-upload',
        'data-part': 'item',
        'data-index': String(index),
      },
      itemName: {
        'data-scope': 'file-upload',
        'data-part': 'item-name',
      },
      itemSizeText: {
        'data-scope': 'file-upload',
        'data-part': 'item-size-text',
      },
      itemPreview: {
        'data-scope': 'file-upload',
        'data-part': 'item-preview',
      },
      removeTrigger: {
        type: 'button',
        'aria-label': removeLabel,
        'data-scope': 'file-upload',
        'data-part': 'item-remove',
        onClick: tagSend(send, ['removeFile'], () => sendTracked({ type: 'removeFile', index })),
      },
      itemDeleteTrigger: {
        type: 'button',
        'aria-label': removeLabel,
        'data-scope': 'file-upload',
        'data-part': 'item-delete-trigger',
        onClick: tagSend(send, ['removeFile'], () => sendTracked({ type: 'removeFile', index })),
      },
    }),
  }
}

export const fileUpload = {
  init,
  update,
  connect,
  totalSize,
  acceptToString,
  fileMatchesAccept,
  validateFiles,
  preventDocumentDrop,
}
