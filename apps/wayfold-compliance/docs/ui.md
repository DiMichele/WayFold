# UI — WayFold Compliance

## Principio

Le superfici **WayFold** (engine su `:8092`) seguono la visual language di **WayFold Bills** / wayfold.xyz.

Il frontend CISO upstream non viene rifatto: si estende con viste brandizzate.

## Token

Vedi `engine/ui_shell.py` (allineati a `apps/wayfold-bills/apps/web/src/app/globals.css`):

| Token | Valore |
|---|---|
| bg | `#F7F6F3` |
| ink / charcoal | `#1A242B` |
| accent terracotta | `#D97B5C` |
| sage | `#98A9A2` |
| sand | `#D9C5A0` |
| display | Jost |
| ui | Inter |
| mono | DM Mono |

## Shell

```python
from engine.ui_shell import render_shell
html = render_shell(title, nav_qs, body)
```

Nuove pagine: **sempre** `render_shell`, mai CSS inline isolato.
