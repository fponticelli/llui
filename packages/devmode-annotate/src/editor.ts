/**
 * Optional note-editor seam for the HUD.
 *
 * Core owns the note value and keyboard behavior. An editor package owns only
 * the live editing surface, so the core package never needs to import its
 * implementation (or any of that implementation's dependencies).
 */
export interface AnnotateEditorMountOptions {
  host: HTMLElement
  initialValue: string
  placeholder: string
  onChange(value: string): void
}

export interface AnnotateEditorInstance {
  getValue(): string
  setValue(value: string): void
  focus(): void
  dispose(): void
}

export interface AnnotateEditorRegistration {
  /** Human-readable help rendered below the editor surface. */
  hint: string
  /** Styles adopted into the HUD shadow root when isolation is enabled. */
  shadowCss?: string
  mount(options: AnnotateEditorMountOptions): AnnotateEditorInstance
}

let currentEditor: AnnotateEditorRegistration | null = null

/**
 * Register an optional editor implementation. The returned disposer restores
 * the previous registration, which makes temporary host overrides safe.
 */
export function registerAnnotateEditor(editor: AnnotateEditorRegistration): () => void {
  const previous = currentEditor
  currentEditor = editor
  return () => {
    if (currentEditor === editor) currentEditor = previous
  }
}

/** The editor registration captured by the next HUD mount, if any. */
export function registeredAnnotateEditor(): AnnotateEditorRegistration | null {
  return currentEditor
}
