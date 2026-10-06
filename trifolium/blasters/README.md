# Blasters

One file per blaster, `blasters/<id>.json`: the config of a blaster built to a published design -
its settings and all three profiles. When the console connects to a board with no wiring, it asks
which board it is and then offers these configs, so someone who has built one from a kit can start
from the builders' settings rather than the firmware defaults.

The pins come from the board you pick, because a config saved on one board need not line up with
another's. On the board the config was saved on, a pin the board leaves unused comes from the config
instead. That is the blaster's own wiring, and on a bare module whose preset claims no pins, such as
the Seeed XIAO RP2040, it is all of it. Everything else comes from the config, including how the
pusher is driven, which is not a pin. A build wired differently from the board's usual pins is
corrected in the Wiring tab after.

## Adding one

Set the blaster up and try it, then save **Backup > Full Backup** from the console and put the file
here, named for the blaster (`ophid2_6s.json`). The name is its id. The console lists it by
`blasterName` and the board it was saved on - "Ophid 2 6S (built on Trifolium v1.4)" - so check both.
A blaster built on a bare module is saved on that module's board, its pins set in the Wiring tab, so
the file carries its wiring.

A file can also carry `notes`: a list of lines the console shows when the config is picked, for
what someone setting the blaster up needs to know that its settings cannot say - a build with
nothing reading its battery, say. Full Backup does not write them, so add them by hand, and carry
them over when the file is saved again.

A file is written for one schema version, and the console refuses to load it onto firmware that
speaks another. After a release that changes the schema, update a blaster running the file to the
new firmware - it migrates its stored config - and save it again.

## Checking

```
python tests/checks/check_bundle.py
```

It checks every file against the schema. The console tests (`tests/suite/test_console.py`) also set
a simulated blaster up from each file and fail if the firmware changes any setting on the way in.
