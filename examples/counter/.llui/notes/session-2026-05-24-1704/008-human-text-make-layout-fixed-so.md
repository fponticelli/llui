---
author: human
kind: text
captureLevel: standard
url: http://localhost:5180/
route: null
routeParams: {}
viewport:
  w: 1560
  h: 1158
  dpr: 2
componentPath:
  - Counter
componentMeta:
  file: /Users/franco/projects/llui/examples/counter/src/main.ts
  line: 14
  name: Counter
annotations: []
intent: task
screenshot: null
agentSchemas: []
llui:
  runtime: unknown
  compiler: unknown
id: '008'
ts: 2026-05-24T21:51:34.287Z
---

make the layout fixed so that when reset is displayed the previous row does not shift

```json
{
  "stateSnapshot": {
    "Counter": {
      "count": 1
    }
  },
  "messageLog": [
    {
      "ts": "2026-05-24T21:51:08.188Z",
      "component": "Counter",
      "msg": {
        "type": "inc"
      }
    }
  ]
}
```
