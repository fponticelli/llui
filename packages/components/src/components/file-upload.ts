import type { Send } from '@llui/dom'

/**
 * File upload — input element + drag-and-drop zone. Tracks selected files,
 * drag state, and accept filters. Multiple or single selection.
 */

export interface FileUploadState {
  files: File[]
  disabled: boolean
  multiple: boolean
  accept: string
  maxFiles: number
  maxSize: number
  dragging: boolean
}

export type FileUploadMsg =
  | { type: 'setFiles'; files: File[] }
  | { type: 'addFiles'; files: File[] }
  | { type: 'removeFile'; index: number }
  | { type: 'clear' }
  | { type: 'dragEnter' }
  | { type: 'dragLeave' }
  | { type: 'drop' }

export interface FileUploadInit {
  files?: File[]
  disabled?: boolean
  multiple?: boolean
  accept?: string
  maxFiles?: number
  maxSize?: number
}

export function init(opts: FileUploadInit = {}): FileUploadState {
  return {
    files: opts.files ?? [],
    disabled: opts.disabled ?? false,
    multiple: opts.multiple ?? false,
    accept: opts.accept ?? '',
    maxFiles: opts.maxFiles ?? 0,
    maxSize: opts.maxSize ?? 0,
    dragging: false,
  }
}

function filterFiles(incoming: File[], state: FileUploadState): File[] {
  const out: File[] = []
  for (const f of incoming) {
    if (state.maxSize > 0 && f.size > state.maxSize) continue
    out.push(f)
    if (state.maxFiles > 0 && out.length >= state.maxFiles) break
  }
  return out
}

export function update(state: FileUploadState, msg: FileUploadMsg): [FileUploadState, never[]] {
  if (state.disabled && msg.type !== 'clear') return [state, []]
  switch (msg.type) {
    case 'setFiles':
      return [{ ...state, files: filterFiles(msg.files, state) }, []]
    case 'addFiles': {
      const combined = state.multiple ? [...state.files, ...msg.files] : msg.files
      return [{ ...state, files: filterFiles(combined, state) }, []]
    }
    case 'removeFile':
      return [{ ...state, files: state.files.filter((_, i) => i !== msg.index) }, []]
    case 'clear':
      return [{ ...state, files: [] }, []]
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

export interface FileUploadItemParts<_S> {
  item: {
    'data-scope': 'file-upload'
    'data-part': 'item'
    'data-index': string
  }
  removeTrigger: {
    type: 'button'
    'aria-label': string
    'data-scope': 'file-upload'
    'data-part': 'item-remove'
    onClick: (e: MouseEvent) => void
  }
}

export interface FileUploadParts<S> {
  root: {
    'data-scope': 'file-upload'
    'data-part': 'root'
    'data-disabled': (s: S) => '' | undefined
    'data-dragging': (s: S) => '' | undefined
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
    style: string
    disabled: (s: S) => boolean
    multiple: (s: S) => boolean
    accept: (s: S) => string
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
  item: (index: number) => FileUploadItemParts<S>
}

export interface ConnectOptions {
  id: string
  removeLabel?: string
  clearLabel?: string
}

const HIDDEN_STYLE =
  'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;'

export function connect<S>(
  get: (s: S) => FileUploadState,
  send: Send<FileUploadMsg>,
  opts: ConnectOptions,
): FileUploadParts<S> {
  const inputId = `${opts.id}:input`
  const removeLabel = opts.removeLabel ?? 'Remove file'
  const clearLabel = opts.clearLabel ?? 'Clear files'

  return {
    root: {
      'data-scope': 'file-upload',
      'data-part': 'root',
      'data-disabled': (s) => (get(s).disabled ? '' : undefined),
      'data-dragging': (s) => (get(s).dragging ? '' : undefined),
    },
    dropzone: {
      'data-scope': 'file-upload',
      'data-part': 'dropzone',
      'data-dragging': (s) => (get(s).dragging ? '' : undefined),
      onClick: (e) => {
        const target = e.target as HTMLElement
        if (target.getAttribute('data-part') === 'hidden-input') return
        const root = (e.currentTarget as HTMLElement).closest(
          '[data-scope="file-upload"][data-part="root"]',
        )
        const input = root?.querySelector<HTMLInputElement>(
          '[data-scope="file-upload"][data-part="hidden-input"]',
        )
        input?.click()
      },
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
        send({ type: 'addFiles', files })
      },
    },
    trigger: {
      type: 'button',
      'data-scope': 'file-upload',
      'data-part': 'trigger',
      disabled: (s) => get(s).disabled,
      onClick: (e) => {
        const root = (e.currentTarget as HTMLElement).closest(
          '[data-scope="file-upload"][data-part="root"]',
        )
        const input = root?.querySelector<HTMLInputElement>(
          '[data-scope="file-upload"][data-part="hidden-input"]',
        )
        input?.click()
      },
    },
    hiddenInput: {
      type: 'file',
      tabIndex: -1,
      style: HIDDEN_STYLE,
      disabled: (s) => get(s).disabled,
      multiple: (s) => get(s).multiple,
      accept: (s) => get(s).accept,
      'data-scope': 'file-upload',
      'data-part': 'hidden-input',
      id: inputId,
      onChange: (e) => {
        const input = e.target as HTMLInputElement
        const files = input.files ? Array.from(input.files) : []
        send({ type: 'addFiles', files })
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
    item: (index: number): FileUploadItemParts<S> => ({
      item: {
        'data-scope': 'file-upload',
        'data-part': 'item',
        'data-index': String(index),
      },
      removeTrigger: {
        type: 'button',
        'aria-label': removeLabel,
        'data-scope': 'file-upload',
        'data-part': 'item-remove',
        onClick: () => send({ type: 'removeFile', index }),
      },
    }),
  }
}

export const fileUpload = { init, update, connect, totalSize }
