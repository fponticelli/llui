---
replyTo: '003'
---

Added a minimal stylesheet at `examples/counter/src/styles.css` and imported it from `main.ts`. The rect highlighted the cramped, unstyled counter pinned to the top-left of the page (default UA styling, tiny buttons touching each other).

Changes:

- Centered the app on the viewport via `body { display: grid; place-items: center }`.
- Laid the counter row out as a flex with `gap: 1rem`, bumped the digit to `2rem` and enabled `tabular-nums` so the digit doesn't reflow when count widens.
- Sized buttons to `2.5rem` square with a soft border, rounded corners, and hover/active states.
- Added a `vite-env.d.ts` so the CSS side-effect import type-checks under TypeScript's strict mode.

`pnpm exec tsc --noEmit` passes clean.

```diff
diff --git a/examples/counter/src/main.ts b/examples/counter/src/main.ts
index b127b6a..8c7e04a 100644
--- a/examples/counter/src/main.ts
+++ b/examples/counter/src/main.ts
@@ -1,5 +1,6 @@
 import { component, mountApp, div, button } from '@llui/dom'
 import { mountAnnotateHud } from '@llui/devmode-annotate'
+import './styles.css'

 type State = { count: number }
 type Msg =
diff --git a/examples/counter/src/styles.css b/examples/counter/src/styles.css
new file mode 100644
--- /dev/null
+++ b/examples/counter/src/styles.css
@@ -0,0 +1,53 @@
+:root {
+  font-family:
+    system-ui,
+    -apple-system,
+    'Segoe UI',
+    Roboto,
+    sans-serif;
+  color-scheme: light dark;
+}
+
+body {
+  margin: 0;
+  min-height: 100vh;
+  display: grid;
+  place-items: center;
+  background: #f6f7f9;
+  color: #1a1a1a;
+}
+
+#app {
+  display: flex;
+  flex-direction: column;
+  align-items: center;
+  gap: 1rem;
+}
+
+.counter {
+  display: flex;
+  align-items: center;
+  gap: 1rem;
+  font-size: 2rem;
+  font-variant-numeric: tabular-nums;
+}
+
+.counter button {
+  width: 2.5rem;
+  height: 2.5rem;
+  font-size: 1.25rem;
+  border: 1px solid #d0d3d8;
+  border-radius: 0.5rem;
+  background: #fff;
+  color: inherit;
+  cursor: pointer;
+  transition:
+    background 0.15s,
+    border-color 0.15s;
+}
+
+.counter button:hover {
+  background: #eef0f3;
+  border-color: #b6bac1;
+}
+
+.counter button:active {
+  background: #e2e5ea;
+}
diff --git a/examples/counter/src/vite-env.d.ts b/examples/counter/src/vite-env.d.ts
new file mode 100644
--- /dev/null
+++ b/examples/counter/src/vite-env.d.ts
@@ -0,0 +1 @@
+/// <reference types="vite/client" />
```
