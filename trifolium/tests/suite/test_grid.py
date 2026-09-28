"""steppedToGrid() against suite/fixtures/stepped_to_grid.json, which the console's port in
tools/console/src/schema/grid.ts is held to as well - so the device and the console offer the same
reachable values, which is the reason the port exists.

The table is the firmware's own answers. After an intended change to the stepping, run with
TRIFOLIUM_UPDATE_FIXTURES=1 set, review the diff, and both sides are held to it.
"""

import json
import os

from helpers import SUITE

TABLE = SUITE / "fixtures" / "stepped_to_grid.json"

# Grids with a lo on and off the step, a negative range, a coarse step, and one that fits once.
GRIDS = [(1, 0, 10), (5, 5, 50), (5, 3, 48), (10, -25, 25), (50, 0, 200), (3, 1, 10), (7, 7, 7),
         (4, 0, 3)]


def cases():
    for step, lo, hi in GRIDS:
        for value in range(lo - 7, hi + 8):
            for direction in (-1, 1):
                for wrap in (False, True):
                    yield (value, direction, step, lo, hi, wrap)


def test_stepped_to_grid_gives_the_answers_its_table_records(blaster):
    if os.environ.get("TRIFOLIUM_UPDATE_FIXTURES"):
        rows = [list(c) + [r] for c, r in zip(cases(), blaster.grid(list(cases())))]
        body = ",\n".join("    " + json.dumps(row) for row in rows)
        TABLE.write_text('{\n  "columns": ["value", "direction", "step", "lo", "hi", "wrap", '
                         f'"expected"],\n  "cases": [\n{body}\n  ]\n}}\n', encoding="utf-8",
                         newline="\n")
        return
    table = json.loads(TABLE.read_text(encoding="utf-8"))["cases"]
    assert len(table) > 500
    got = blaster.grid([row[:6] for row in table])
    wrong = [(row, g) for row, g in zip(table, got) if g != row[6]]
    assert not wrong


def test_stepped_to_grid_lands_on_the_grid_and_inside_the_range_whatever_it_starts_from(blaster):
    wide = [(v, d, step, lo, hi, w) for step, lo, hi in GRIDS if hi - lo >= step
            for v in range(lo - 20, hi + 21) for d in (-1, 1) for w in (False, True)]
    results = blaster.grid(wide)
    bad = [(c, r) for c, r in zip(wide, results)
           if not (c[3] <= r <= c[4]) or r % c[2] != 0]
    assert len(wide) > 1000
    assert not bad
