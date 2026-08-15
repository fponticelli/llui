import {
  registerAnnotateEditor,
  type AnnotateEditorRegistration,
} from '@llui/devmode-annotate/editor'
import { mountSignalComponent } from '@llui/dom'
import {
  corePlugin,
  floatingToolbarPlugin,
  linkPlugin,
  markdownEditor,
  slashPlugin,
  type EditorState,
} from '@llui/markdown-editor'
import '@llui/markdown-editor/styles/editor.css'
import EDITOR_CSS from '@llui/markdown-editor/styles/editor.css?raw'
import type { LexicalEditor } from 'lexical'

/** The rich Markdown surface installed into future annotation-HUD mounts. */
export const markdownAnnotateEditor: AnnotateEditorRegistration = {
  hint: 'Rich editor · select text to format · / for commands · ⌘↵ to submit',
  shadowCss: EDITOR_CSS,
  mount({ host, initialValue, placeholder, onChange }) {
    let editor: LexicalEditor | null = null
    const app = mountSignalComponent(
      host,
      markdownEditor({
        defaultValue: initialValue,
        placeholder,
        // Preserve the HUD's near-synchronous draft mirror while getValue()
        // below remains authoritative for a submit in the debounce window.
        changeDebounceMs: 50,
        plugins: [corePlugin(), linkPlugin(), floatingToolbarPlugin(), slashPlugin()],
        onChange,
        onReady: (next) => {
          editor = next
        },
      }),
      // The HUD's editor is chrome, not part of the app being annotated.
      { devtools: false },
    )

    return {
      getValue: () => (app.getState() as EditorState).value,
      setValue: (value) => app.send({ type: 'setValue', value }),
      focus: () => editor?.focus(),
      dispose: () => {
        app.dispose()
        editor = null
      },
    }
  },
}

/** Register the rich editor explicitly and receive a scoped disposer. */
export function registerMarkdownAnnotateEditor(): () => void {
  return registerAnnotateEditor(markdownAnnotateEditor)
}

// Importing this package is the opt-in. Marking dist/index.js as a package side
// effect prevents a bundler from dropping the registration-only module.
registerMarkdownAnnotateEditor()
