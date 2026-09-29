"""The firmware's heap, counted at the allocator in the blocks newlib would give, against what the
pico build leaves for it. Past that an allocation fails, as it does on the device. The PC's pointers
are twice the size, so the counts here are an upper bound on the RP2040's."""

import json

from helpers import armed_v12, close_menu, open_menu

DUMPS = ["DUMP_SCHEMA", "DUMP_DEVICE", "DUMP_PROFILE 0", "DUMP_PROFILE 1", "DUMP_PROFILE 2",
         "DUMP_BOOT", "DUMP_MOTORS", "DUMP_GPIO"]


def test_dump_schema_streams_the_menu_tree_rather_than_holding_it(blaster):
    b = armed_v12(blaster, display=False)
    b.reset_heap_peak()
    before = b.heap()["live"]
    schema = b.command("DUMP_SCHEMA", parse=False)
    assert len(schema) > 30000
    assert b.heap()["peak"] - before < 2048


def test_every_command_the_menu_and_firing_give_back_what_they_take(blaster):
    b = armed_v12(blaster)
    baseline = b.heap()["live"]
    for line in DUMPS:
        assert b.command(line, parse=False), line
        assert b.heap()["live"] == baseline, line

    ack = b.command("LOAD_PROFILE 2\n" + json.dumps({"schemaVersion": 2, "dwellTime_ms": 2000}))
    assert ack["ok"] is True and ack["rebooting"] is False
    assert b.heap()["live"] == baseline

    open_menu(b)
    close_menu(b)
    b.press("rev")
    b.run_ms(1000)
    b.tap("trigger")
    b.release("rev")
    b.run_ms(3000)
    assert b.heap()["live"] == baseline
    assert b.heap()["refused"] == 0


def test_a_body_too_big_for_the_heap_is_refused_and_nothing_is_applied(blaster):
    """ArduinoJson grows the document until an allocation fails and reports NoMemory, which the
    command answers as too large. On a PC's heap the same body is accepted and applied."""
    b = armed_v12(blaster, display=False)
    baseline = b.heap()["live"]
    stored = b.flash_get("/device.cfg")
    body = json.dumps({"schemaVersion": 3, "blasterName": "big", "junk": [0] * 60000},
                      separators=(",", ":"))

    start = len(b.transcript)
    b.send("LOAD_DEVICE\n" + body + "\n")
    assert b.run_until(lambda: '"cmd":"LOAD_DEVICE"' in b.transcript[start:], 3000)
    ack = json.loads(next(line for line in b.transcript[start:].splitlines() if "LOAD_DEVICE" in line))
    assert ack == {"cmd": "LOAD_DEVICE", "ok": False, "err": "too large"}
    assert b.heap()["refused"] >= 1

    b.run_ms(1000)
    assert b.boot_count == 1
    assert b.flash_get("/device.cfg") == stored
    assert b.heap()["live"] == baseline
    assert b.command("DUMP_DEVICE")["blasterName"] == "example"
