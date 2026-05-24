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
replyTo: '012'
proposedDiff:
  files:
    - path: examples/counter/src/main.ts
      patch: |
        --- a/examples/counter/src/main.ts
        +++ b/examples/counter/src/main.ts
        @@ -26,9 +26,9 @@
           },
           view: ({ send, text, show }) => [
             div({ class: 'counter' }, [
        -      button({ onClick: () => send({ type: 'dec' }) }, [text('-')]),
        +      button({ class: 'dec', onClick: () => send({ type: 'dec' }) }, [text('-')]),
               text((s) => String(s.count)),
        -      button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
        +      button({ class: 'inc', onClick: () => send({ type: 'inc' }) }, [text('+')]),
             ]),
             ...show({
               when: (s) => s.count > 0,
    - path: examples/counter/src/styles.css
      patch: |
        --- a/examples/counter/src/styles.css
        +++ b/examples/counter/src/styles.css
        @@ -51,6 +51,26 @@
           width: 2.5rem;
           padding: 0;
           font-size: 1.25rem;
         }
         
        +#app .counter button.inc {
        +  background: #2e7d32;
        +  color: #fff;
        +  border-color: #1b5e20;
        +}
        +
        +#app .counter button.inc:hover {
        +  background: #1b5e20;
        +  border-color: #14471a;
        +}
        +
        +#app .counter button.dec {
        +  background: #c62828;
        +  color: #fff;
        +  border-color: #8e1a1a;
        +}
        +
        +#app .counter button.dec:hover {
        +  background: #8e1a1a;
        +  border-color: #5a1010;
        +}
        +
         #app button:hover {
           background: #eef0f3;
           border-color: #b6bac1;
  summary: 'Differentiate +/- buttons: green for increment, red for decrement (class + CSS).'
  confidence: high
id: '013'
ts: 2026-05-24T22:10:03.433Z
---

The rect highlights the `-` / `0` / `+` row and the developer wants the two action buttons to look visually distinct. I'll give the increment button a green look and the decrement button a red look — a common, immediately-readable convention — by adding `class: 'inc'` / `class: 'dec'` to the two buttons in `main.ts` and corresponding rules in `styles.css`. The new rules use `#app .counter button.{inc,dec}` to outrank the existing `#app button` defaults.

```json
{}
```
