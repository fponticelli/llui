# @llui/a2ui

## 0.1.0

Initial release — a renderer for Google's A2UI protocol v0.9 on the LLui signal
runtime, reusing `@llui/components` for interactive controls.

- **Protocol**: full server→client message set (`createSurface`,
  `updateComponents`, `updateDataModel`, `deleteSurface`); `mountA2ui()` with
  `apply()` / `getState()` / `subscribe()` / `capabilities()` / `dispose()`.
- **Bindings**: literal, `{ path }` (JSON-Pointer), and nested `{ call }`;
  structure reacts to the component map, data to the data model (streaming
  `updateDataModel` never rebuilds the tree).
- **Templates** over arrays and objects, with spec-correct item-scoped paths and
  two-way write-back.
- **Functions**: `formatString`, `formatNumber/Currency/Date`, `pluralize`,
  `required`/`regex`/`length`/`numeric`/`email`, `and`/`or`/`not`.
- **Validation `checks`**: input error messages + button disabling.
- **Basic catalog** (all 18 components): display/layout as semantic HTML;
  `CheckBox`/`Tabs`/`Modal`/`Slider`/`ChoicePicker`/`DateTimeInput` on
  `@llui/components` (checkbox/tabs/dialog/slider/combobox/date-picker), with
  focus-trap + scroll-lock on Modal.
- **Open catalog registry** via `defineCatalog` (extend the Basic catalog or
  bring your own); `catalogId` selects the catalog, unknown ids fall back.
- **Transport-agnostic**: `onAction` for user actions; `sendDataModel`
  client→server sync rides the action event; best-effort version negotiation.
- Conformance-tested against the real `google/A2UI` v0.9 sample payloads.
