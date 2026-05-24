---
author: human
kind: rect
captureLevel: standard
url: http://localhost:5174/
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
annotations:
  - type: rect
    x: 663
    y: 475
    w: 263
    h: 240
intent: task
screenshot: 006-human-rect-layout-jumps-when-reset.png
agentSchemas: []
llui:
  runtime: unknown
  compiler: unknown
id: '006'
ts: 2026-05-24T21:40:06.726Z
---

the layout jumps when the reset button is rendered, make the alignament fixed

```json
{
  "stateSnapshot": {
    "Counter": {
      "count": 3
    }
  },
  "messageLog": [
    {
      "ts": "2026-05-24T21:39:39.585Z",
      "component": "Counter",
      "msg": {
        "type": "inc"
      }
    },
    {
      "ts": "2026-05-24T21:39:41.451Z",
      "component": "Counter",
      "msg": {
        "type": "inc"
      }
    },
    {
      "ts": "2026-05-24T21:39:41.764Z",
      "component": "Counter",
      "msg": {
        "type": "inc"
      }
    }
  ]
}
```
