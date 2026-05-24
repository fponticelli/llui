---
replyTo: '005'
---

Made the reset button flashy: gave it a `reset` class and added vibrant styling in `styles.css`.

What changed visually:

- Hot gradient fill (`#ff5f6d → #ffc371 → #ff5f6d`) that animates side-to-side via a shimmer keyframe.
- Continuous pulsing glow (two-layer outer box-shadow that breathes between dim and bright).
- Bold uppercase tracked-out label in white, no border, slightly wider padding for presence.
- Hover lifts the button (`translateY(-1px) scale(1.04)`) and intensifies the glow; active settles back with a small press-in.

Only the reset button is affected — the `+` / `-` buttons keep the existing neutral styling because the new rules are scoped to `#app button.reset`.

```diff
diff --git a/examples/counter/src/main.ts b/examples/counter/src/main.ts
index 8c7e04a..cd3fd60 100644
--- a/examples/counter/src/main.ts
+++ b/examples/counter/src/main.ts
@@ -32,7 +32,9 @@ const Counter = component<State, Msg, never>({
     ]),
     ...show({
       when: (s) => s.count > 0,
-      render: () => [button({ onClick: () => send({ type: 'reset' }) }, [text('Reset')])],
+      render: () => [
+        button({ class: 'reset', onClick: () => send({ type: 'reset' }) }, [text('Reset')]),
+      ],
     }),
   ],
 })
diff --git a/examples/counter/src/styles.css b/examples/counter/src/styles.css
index 6df5f2d..6ee1fee 100644
--- a/examples/counter/src/styles.css
+++ b/examples/counter/src/styles.css
@@ -61,3 +61,68 @@ body {
 #app button:active {
   background: #e2e5ea;
 }
+
+#app button.reset {
+  position: relative;
+  padding: 0 1.5rem;
+  font-weight: 700;
+  letter-spacing: 0.04em;
+  text-transform: uppercase;
+  color: #fff;
+  border: none;
+  background: linear-gradient(135deg, #ff5f6d 0%, #ffc371 50%, #ff5f6d 100%);
+  background-size: 200% 200%;
+  box-shadow:
+    0 0 12px rgba(255, 95, 109, 0.6),
+    0 0 28px rgba(255, 195, 113, 0.45),
+    0 4px 12px rgba(0, 0, 0, 0.18);
+  animation:
+    reset-shimmer 2.4s ease-in-out infinite,
+    reset-pulse 1.6s ease-in-out infinite;
+  transition:
+    transform 0.12s ease,
+    box-shadow 0.2s ease;
+}
+
+#app button.reset:hover {
+  background: linear-gradient(135deg, #ff5f6d 0%, #ffc371 50%, #ff5f6d 100%);
+  background-size: 200% 200%;
+  transform: translateY(-1px) scale(1.04);
+  box-shadow:
+    0 0 18px rgba(255, 95, 109, 0.85),
+    0 0 36px rgba(255, 195, 113, 0.6),
+    0 6px 16px rgba(0, 0, 0, 0.22);
+}
+
+#app button.reset:active {
+  transform: translateY(0) scale(0.98);
+  background: linear-gradient(135deg, #ff5f6d 0%, #ffc371 50%, #ff5f6d 100%);
+}
+
+@keyframes reset-shimmer {
+  0% {
+    background-position: 0% 50%;
+  }
+  50% {
+    background-position: 100% 50%;
+  }
+  100% {
+    background-position: 0% 50%;
+  }
+}
+
+@keyframes reset-pulse {
+  0%,
+  100% {
+    box-shadow:
+      0 0 12px rgba(255, 95, 109, 0.6),
+      0 0 28px rgba(255, 195, 113, 0.45),
+      0 4px 12px rgba(0, 0, 0, 0.18);
+  }
+  50% {
+    box-shadow:
+      0 0 22px rgba(255, 95, 109, 0.9),
+      0 0 44px rgba(255, 195, 113, 0.7),
+      0 4px 16px rgba(0, 0, 0, 0.22);
+  }
+}
```
