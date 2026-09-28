# Boards

One folder per board, `boards/<id>/`. The folder's name is the board's id.

| File | |
|---|---|
| `board.json` | The board's wiring preset. Required. |
| `board.svg` | The board as drawn - the art. Optional, and comes with `pins.svg`. |
| `pins.svg` | The pads marked over that art. Both or neither. |

## board.json

The file is a `LOAD_DEVICE` payload: the wiring keys sit at the top level, and the console sends
them when someone picks the board. It carries wiring only, never tuning - loading a board to fix a
pin must not reset anything else.

These keys describe the board and are never sent:

| Key | |
|---|---|
| `kind` | Always `trifolium-wiring-preset`. |
| `presetVersion` | The format's version, 1. |
| `id` | The folder's name. |
| `name` | What the console shows. |
| `notes` | Shown when the board is picked. |
| `aliases` | Older ids a device may still report for this board. |
| `diagram` | Another board's id, whose drawing this one uses - for a board with no drawing of its own that is the same design. |
| `retired` | Recognised, but no longer offered. |
| `unread` | Values recorded that nothing reads. |

## The drawing

`pins.svg` uses the same `viewBox` as `board.svg`, so a marker sits on the art at any size. Only the
marker attributes matter; the rest is ordinary SVG.

| Attribute | On | |
|---|---|---|
| `data-gpio="18"` | a GPIO pad | The GPIO it is. |
| `data-internal="pusherFetPin"` | a GPIO pad | Wired on the board rather than brought out, to that device setting. |
| `data-pin="GND"` | a power pad | A pad that is not a GPIO. |
| `data-label="GND to I2C"` | any pad | The pad's own name, shown when nothing is assigned to it. |
| `data-connector="I2C connector"` | a pad, or a `<g>` around a plug's pads | The plug it belongs to. The name sets the colour: I2C, ESC, power, or plain GPIO. |

The console draws the art 340 px wide. A board narrower than the Trifolium v1.2 is drawn at that
board's height, and narrower, instead.

## Checking

```
python tests/checks/check_bundle.py --presets
```

It checks every board: its keys, its pins, the id against its folder, both drawing files or neither,
and that a `diagram` names a board that has a drawing.
