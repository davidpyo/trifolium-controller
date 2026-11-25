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

The console draws the art 340 px wide.

### The hookup view

The Wiring page can also draw each part wired to the board, which works out where each wire goes
from the sheet's names. It draws the board as a schematic block of its pins rather than as
`board.svg`, and not in the board's shape: only the pins something is wired to are drawn, each
`data-connector` a named group of them, put on the side and in the order that suits the parts
wired to it, with the sides evened up; the free pins are listed under the drawing. A pin is named
for its GPIO, or for its `data-label` (else its `data-pin`) on a power pad. A board needs nothing
extra for it beyond these conventions:

- A part's ground goes to the `GND` pad in its own `data-connector`, else the nearest one. Pads on
  a connector named for power, `XT30` or a battery are never used as a part's ground.
- A display's supply comes from the `VCC` pad in its own plug. A speed pot's comes only from a pad
  named `3V3` or `3.3V`, and nothing else: its wiper is an ADC pin. A pad whose label says power
  arrives on it (`VCC from ESC`) is never used as a supply.
- The battery's leads go to the pads whose label names a battery, else those in a connector that
  does (or `XT30 IN`); an on-board solenoid's go to those naming the solenoid the same way (or
  `XT30 OUT`). `+` in the label or a `VCC` name marks the positive one.
- An LED wired on the board goes to the pads of a connector whose name has `LED` in it. A label
  with `switched` in it marks a low side switched by the board, which is never shared as a ground.
- A connector with a battery, solenoid or power pad in it goes along the bottom of the block, by the
  battery. A connector's name loses a trailing ` connector` when drawn.

A board with no drawing gets a block with one pin per wire, grouped by the part each is for.

## Checking

```
python tests/checks/check_bundle.py --presets
```

It checks every board: its keys, its pins, the id against its folder, both drawing files or neither,
and that a `diagram` names a board that has a drawing.
