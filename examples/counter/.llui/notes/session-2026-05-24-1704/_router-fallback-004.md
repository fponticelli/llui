---
replyTo: '004'
---

The rect points at the `Reset` button, which is rendered outside the `.counter` div (it's a sibling appended after the counter row via `show()`). The styles added in note 003 used `.counter button` as the selector, so they only matched the `−` / `+` buttons — Reset fell through to default UA styling.

Fix: broaden the base button rules to `#app button` so any button in the app picks up the rounded white pill look, and keep the fixed-square `width: 2.5rem` / larger font on `.counter button` so the `−` / `+` buttons stay compact and identical to before. The Reset button now picks up height, padding, border, hover/active treatment automatically.

No TS or markup changes — CSS only.

```diff
diff --git a/examples/counter/src/styles.css b/examples/counter/src/styles.css
index e746550..6df5f2d 100644
--- a/examples/counter/src/styles.css
+++ b/examples/counter/src/styles.css
@@ -32,10 +32,11 @@ body {
   font-variant-numeric: tabular-nums;
 }

-.counter button {
-  width: 2.5rem;
+#app button {
   height: 2.5rem;
-  font-size: 1.25rem;
+  padding: 0 0.85rem;
+  font-size: 1rem;
+  font-family: inherit;
   border: 1px solid #d0d3d8;
   border-radius: 0.5rem;
   background: #fff;
@@ -46,11 +47,17 @@ body {
     border-color 0.15s;
 }

-.counter button:hover {
+.counter button {
+  width: 2.5rem;
+  padding: 0;
+  font-size: 1.25rem;
+}
+
+#app button:hover {
   background: #eef0f3;
   border-color: #b6bac1;
 }

-.counter button:active {
+#app button:active {
   background: #e2e5ea;
 }
```
