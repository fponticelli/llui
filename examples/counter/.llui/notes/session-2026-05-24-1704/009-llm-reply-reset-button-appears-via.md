---
author: llm
kind: reply
captureLevel: standard
url: ''
route: null
routeParams: {}
viewport:
  w: 0
  h: 0
  dpr: 1
componentPath: null
componentMeta: null
annotations: []
screenshot: null
agentSchemas: []
llui:
  runtime: unknown
  compiler: unknown
intent: note
replyTo: '008'
proposedDiff:
  files:
    - path: examples/counter/src/styles.css
      patch: |
        --- a/examples/counter/src/styles.css
        +++ b/examples/counter/src/styles.css
        @@ -20,6 +20,7 @@
         #app {
           display: flex;
           flex-direction: column;
           align-items: center;
           gap: 1rem;
        +  min-height: 6rem; /* 2.5rem counter row + 1rem gap + 2.5rem reset button — keeps the counter row pinned when Reset toggles */
         }
         
         .counter {
  summary: "Reserve vertical space in #app so the counter row doesn't shift when the Reset button mounts/unmounts"
  confidence: high
id: '009'
ts: 2026-05-24T21:52:20.524Z
---

The Reset button appears via `show()` when `count > 0`. The `#app` container is centered vertically by `body { place-items: center }`. When Reset enters the DOM, `#app` grows from one row (counter) to two rows (counter + reset), and since it stays centered, the counter row shifts up.

Cleanest fix: reserve vertical space in `#app` by giving it a `min-height` that accommodates both rows. Counter row = 2.5rem, gap = 1rem, reset button = 2.5rem → 6rem. With default `justify-content: flex-start`, the counter row stays pinned to the top of `#app`, and the reset button slots in below without displacing it.

```json
{}
```
