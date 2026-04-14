import type { Send } from '@llui/dom'
import { useContext } from '@llui/dom'
import { LocaleContext } from '../locale.js'
import type { Locale } from '../locale.js'

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
 */

export type AcceptValue = string | Record<string, string[]>

export type FileError =
  | { code: 'TOO_LARGE'; max: number }
  | { code: 'TOO_SMALL'; min: number }
  | { code: 'INVALID_TYPE' }
  | { code: 'TOO_MANY'; max: number }
  | { code: 'CUSTOM'; message: string }

export interface RejectedFile {
  file: File
  errors: FileError[]
}

export interface FileUploadState {
  files: File[]
  rejectedFiles: RejectedFile[]
  disabled: boolean
  multiple: boolean
  accept: AcceptValue
  maxFiles: number
  maxSize: number
  minFileSize: number
  required: boolean
  readOnly: boolean
  invalid: boolean
  dragging: boolean
}

export type FileUploadMsg =
  | { type: 'setFiles'; files: File[]; customRejected?: RejectedFile[] }
  | { type: 'addFiles'; files: File[]; customRejected?: RejectedFile[] }
  | { type: 'removeFile'; index: number }
  | { type: 'removeRejected'; index: number }
  | { type: 'clear' }
  | { type: 'clearRejected' }
  | { type: 'dragEnter' }
  | { type: 'dragLeave' }
  | { type: 'drop' }
  | { type: 'setInvalid'; invalid: boolean }

export interface FileUploadInit {
  files?: File[]
  disabled?: boolean
  multiple?: boolean
  accept?: AcceptValue
  maxFiles?: number
  maxSize?: number
  minFileSize?: number
  required?: boolean
  readOnly?: boolean
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
    readOnly: opts.readOnly ?? false,
    invalid: opts.invalid ?? false,
    dragging: false,
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
export function fileMatchesAccept(file: File, accept: AcceptValue): boolean {
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
 * Partition incoming files into accepted and rejected based on state's
 * accept/size/count constraints. The current accepted-file count is used
 * to enforce `maxFiles` — the caller is responsible for passing the
 * post-combine accepted total when appending.
 */
export function validateFiles(
  incoming: File[],
  state: FileUploadState,
  existingAcceptedCount: number,
): { accepted: File[]; rejected: RejectedFile[] } {
  const accepted: File[] = []
  const rejected: RejectedFile[] = []
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
    if (state.maxFiles > 0 && count >= state.maxFiles) {
      errors.push({ code: 'TOO_MANY', max: state.maxFiles })
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
  if (state.readOnly && (msg.type === 'setFiles' || msg.type === 'addFiles')) {
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
    case 'dragEnter':
      return [{ ...state, dragging: true }, []]
    case 'dragLeave':
    case 'drop':
      return [{ ...state, dragging: false }, []]
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

export interface FileUploadItemParts<S> {
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
    'aria-label': string | ((s: S) => string)
    'data-scope': 'file-upload'
    'data-part': 'item-remove'
    onClick: (e: MouseEvent) => void
  }
  /** Zag-aligned alias for removeTrigger. Same wiring. */
  itemDeleteTrigger: {
    type: 'button'
    'aria-label': string | ((s: S) => string)
    'data-scope': 'file-upload'
    'data-part': 'item-delete-trigger'
    onClick: (e: MouseEvent) => void
  }
}

export interface FileUploadParts<S> {
  root: {
    'data-scope': 'file-upload'
    'data-part': 'root'
    'data-disabled': (s: S) => '' | undefined
    'data-dragging': (s: S) => '' | undefined
    'data-invalid': (s: S) => '' | undefined
    'data-readonly': (s: S) => '' | undefined
  }
  dropzone: {
    'data-scope': 'file-upload'
    'data-part': 'dropzone'
    'data-dragging': (s: S) => '' | undefined
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
    disabled: (s: S) => boolean
    onClick: (e: MouseEvent) => void
  }
  hiddenInput: {
    type: 'file'
    tabIndex: -1
    'aria-hidden': 'true'
    style: string
    disabled: (s: S) => boolean
    multiple: (s: S) => boolean
    accept: (s: S) => string
    required: (s: S) => boolean
    'aria-invalid': (s: S) => 'true' | undefined
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
    'aria-label': string | ((s: S) => string)
    'data-scope': 'file-upload'
    'data-part': 'clear-trigger'
    onClick: (e: MouseEvent) => void
  }
  itemGroup: {
    'data-scope': 'file-upload'
    'data-part': 'item-group'
  }
  item: (index: number) => FileUploadItemParts<S>
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

export function connect<S>(
  get: (s: S) => FileUploadState,
  send: Send<FileUploadMsg>,
  opts: ConnectOptions,
): FileUploadParts<S> {
  const locale = useContext<S, Locale>(LocaleContext)
  const inputId = `${opts.id}:input`
  const removeLabel: string | ((s: S) => string) =
    opts.removeLabel ?? ((s: S) => locale(s).fileUpload.remove)
  const clearLabel: string | ((s: S) => string) =
    opts.clearLabel ?? ((s: S) => locale(s).fileUpload.clear)

  const runPipeline = async (
    raw: File[],
  ): Promise<{ files: File[]; customRejected: RejectedFile[] }> => {
    let files = raw
    if (opts.transformFiles) files = await opts.transformFiles(files)
    const customRejected: RejectedFile[] = []
    if (opts.validate) {
      const passed: File[] = []
      for (const f of files) {
        const errors = opts.validate(f)
        if (errors && errors.length > 0) customRejected.push({ file: f, errors })
        else passed.push(f)
      }
      files = passed
    }
    return { files, customRejected }
  }

  const dispatchAdd = (raw: File[]): void => {
    if (!opts.transformFiles && !opts.validate) {
      send({ type: 'addFiles', files: raw })
      return
    }
    // Fire-and-forget — transforms may be async.
    void runPipeline(raw).then(({ files, customRejected }) => {
      send({ type: 'addFiles', files, customRejected })
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
      'data-disabled': (s) => (get(s).disabled ? '' : undefined),
      'data-dragging': (s) => (get(s).dragging ? '' : undefined),
      'data-invalid': (s) => (get(s).invalid ? '' : undefined),
      'data-readonly': (s) => (get(s).readOnly ? '' : undefined),
    },
    dropzone: {
      'data-scope': 'file-upload',
      'data-part': 'dropzone',
      'data-dragging': (s) => (get(s).dragging ? '' : undefined),
      onClick: openPicker,
      onDragEnter: (e) => {
        e.preventDefault()
        send({ type: 'dragEnter' })
      },
      onDragOver: (e) => e.preventDefault(),
      onDragLeave: (e) => {
        e.preventDefault()
        send({ type: 'dragLeave' })
      },
      onDrop: (e) => {
        e.preventDefault()
        const files = Array.from(e.dataTransfer?.files ?? [])
        send({ type: 'drop' })
        dispatchAdd(files)
      },
    },
    trigger: {
      type: 'button',
      'data-scope': 'file-upload',
      'data-part': 'trigger',
      disabled: (s) => get(s).disabled,
      onClick: openPicker,
    },
    hiddenInput: {
      type: 'file',
      tabIndex: -1,
      'aria-hidden': 'true',
      style: HIDDEN_STYLE,
      disabled: (s) => get(s).disabled,
      multiple: (s) => get(s).multiple,
      accept: (s) => acceptToString(get(s).accept),
      required: (s) => get(s).required,
      'aria-invalid': (s) => (get(s).invalid ? 'true' : undefined),
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
      onClick: () => send({ type: 'clear' }),
    },
    itemGroup: {
      'data-scope': 'file-upload',
      'data-part': 'item-group',
    },
    item: (index: number): FileUploadItemParts<S> => ({
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
        onClick: () => send({ type: 'removeFile', index }),
      },
      itemDeleteTrigger: {
        type: 'button',
        'aria-label': removeLabel,
        'data-scope': 'file-upload',
        'data-part': 'item-delete-trigger',
        onClick: () => send({ type: 'removeFile', index }),
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
