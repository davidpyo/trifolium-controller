"""The console's offline fixtures, tools/console/src/fixtures/, are this firmware's own dumps of the
configs they hold. The console renders them with no device connected, and check_bundle.py and
check_visibility.py read the schema, so a stale one is wrong in several places at once. After a
schema change, run with TRIFOLIUM_UPDATE_FIXTURES=1 set and review the diff.
"""

import json
import os

from helpers import flatten

from trifolium_sim import PROJECT

FIXTURES = PROJECT / "tools" / "console" / "src" / "fixtures"
PROFILES = [f"profile{slot}.json" for slot in range(3)]


def read(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def config(reply, framing):
    return {key: value for key, value in reply.items() if key not in framing}


def test_the_consoles_fixtures_are_what_this_firmware_dumps_of_their_configs(blaster):
    b = blaster
    b.flash_device(read("device.json"))
    for slot, name in enumerate(PROFILES):
        b.flash_profile(slot, read(name))
    b.attach_display()
    b.set_pack(500)  # near zero, as on the USB power they were captured on - it sets Target DPS's limit
    b.press("select2")  # with variableFPS, the selector position picks the active profile
    assert b.boot(2500)

    dumped = {"schema.json": json.loads(b.command("DUMP_SCHEMA", timeout_ms=5000, parse=False)),
              "device.json": config(b.command("DUMP_DEVICE"), {"cmd"})}
    for slot, name in enumerate(PROFILES):
        dumped[name] = config(b.command(f"DUMP_PROFILE {slot}"), {"cmd", "index"})

    if os.environ.get("TRIFOLIUM_UPDATE_FIXTURES"):
        for name, doc in dumped.items():
            (FIXTURES / name).write_text(json.dumps(doc), encoding="utf-8", newline="\n")
        return
    for name, doc in dumped.items():
        want, got = flatten(read(name)), flatten(doc)
        stale = sorted(path for path in want.keys() | got.keys() if want.get(path) != got.get(path))
        assert not stale, f"{name} differs at {stale[:10]} - rerun with TRIFOLIUM_UPDATE_FIXTURES=1"
