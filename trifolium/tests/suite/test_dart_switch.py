"""The dart switch: a switch or sensor in the breech that sees a dart waiting to be pushed. It is
read every tick and counts a dart only once it has shown one for the debounce time without a break;
the breech reads empty at once. With Dart Sensing off, as here, the pusher does not act on it;
test_dart_sensing.py has it on."""

import json

from helpers import armed_v12, schema

DART_PIN = 20  # free on a v1.2
DART = {"dartSwitchPin": DART_PIN, "dartSwitchDebounce_ms": 10}


def dart(b):
    return b.peek("dart")


def test_a_dart_switch_pin_is_attached_as_a_pulled_up_input_and_reported_under_its_role(blaster):
    b = armed_v12(blaster, DART)
    assert b.peek("pins")["dart"] == DART_PIN
    assert b.pin(DART_PIN)["mode"] == "input_pullup"
    gpio = b.command("DUMP_GPIO")
    assert "dart" in [p.get("role") for p in gpio["gpio"] if p["n"] == DART_PIN]
    assert schema(b)["pinConflicts"] == []
    assert b.command("DUMP_MOTORS")["dart"] == {"present": False, "emptiedSincePush": True,
                                                "waitMs": None}


def test_a_dart_counts_only_once_the_switch_has_shown_it_for_the_debounce(blaster):
    b = armed_v12(blaster, DART)
    b.press("dart")
    b.run_ms(8)
    assert dart(b)["present"] is False
    b.run_ms(5)
    assert dart(b)["present"] is True
    b.release("dart")
    b.run_ms(2)
    assert dart(b)["present"] is False


def test_a_flicker_shorter_than_the_debounce_is_not_a_dart(blaster):
    b = armed_v12(blaster, DART)
    seen = []
    for _ in range(5):
        b.press("dart")
        b.run_ms(4)
        seen.append(dart(b)["present"])
        b.release("dart")
        b.run_ms(4)
        seen.append(dart(b)["present"])
    assert not any(seen)


def test_each_change_is_one_log_line(blaster):
    b = armed_v12(blaster, {**DART, "printTelemetry": True})
    start = len(b.transcript)
    b.press("dart")
    b.run_ms(50)
    b.release("dart")
    b.run_ms(50)
    log = b.transcript[start:]
    assert log.count("Dart in the breech") == 1
    assert log.count("Breech empty") == 1


def test_a_normally_closed_dart_switch_reads_a_dart_when_it_opens(blaster):
    b = armed_v12(blaster, {**DART, "dartSwitchNormallyClosed": True})
    b.release("dart")
    b.run_ms(50)
    assert dart(b)["present"] is False
    assert b.pin(DART_PIN)["level"] is False  # held closed, to ground, with no dart
    b.press("dart")
    b.run_ms(50)
    assert dart(b)["present"] is True


def test_a_dart_already_in_the_breech_at_power_on_counts_at_once(blaster):
    b = blaster
    b.flash_preset("trifolium_v1_2", DART)
    b.press("dart")
    assert b.boot(0)
    assert b.run_until_peek("bootSettingsLoaded", True, limit_ms=5000)
    assert dart(b) == {"present": True, "emptiedSincePush": True, "waitMs": None}


def test_a_push_clears_emptied_since_push_until_the_breech_reads_empty(blaster):
    b = armed_v12(blaster, DART)
    b.press("dart")
    b.press("select0")  # AUTO on the v1.2's default profile
    b.run_ms(50)
    b.press("trigger")
    assert b.run_until(lambda: len(b.extends()) >= 1, 1500)
    b.release("trigger")
    b.run_ms(100)
    assert dart(b) == {"present": True, "emptiedSincePush": False, "waitMs": None}
    b.release("dart")
    b.run_ms(2)
    assert dart(b)["emptiedSincePush"] is True


def test_a_pin_the_dart_switch_and_the_idle_switch_both_claim_goes_to_the_dart_switch(blaster):
    b = armed_v12(blaster, {**DART, "idleSwitchPin": DART_PIN})
    pins = b.peek("pins")
    assert pins["dart"] == DART_PIN
    assert pins["idle"] == 255
    assert schema(b)["pinConflicts"] == [{"field": "idleSwitchPin", "pin": DART_PIN,
                                          "against": "dartSwitchPin", "action": "pinCleared"}]


def test_a_config_written_before_the_dart_switch_loads_it_unwired(blaster):
    b = blaster
    b.flash_preset("trifolium_v1_2")
    stored = b.flash_json("/device.cfg")
    for key in ("dartSwitchPin", "dartSwitchNormallyClosed", "dartSwitchDebounce_ms",
                "dartSensing", "dartWaitTimeout_ms", "minPushTime_ms"):
        stored.pop(key, None)
    b.flash_put("/device.cfg", json.dumps(stored))
    assert b.boot(500)
    assert b.peek("pins")["dart"] == 255
    assert b.command("DUMP_MOTORS")["dart"] is None
    device = b.command("DUMP_DEVICE")
    assert device["dartSwitchDebounce_ms"] == 10
    assert device["dartSensing"] is False and device["dartWaitTimeout_ms"] == 1000
    assert device["minPushTime_ms"] == 8


def auto_extends(b):
    b.press("select0")  # AUTO on the v1.2's default profile
    b.run_ms(50)
    start = b.uptime_ms
    b.press("trigger")
    b.run_ms(1000)
    b.release("trigger")
    b.run_ms(500)
    return [round(t / 1000 - start) for t in b.extends()]


def test_a_wired_dart_switch_leaves_the_firing_rhythm_as_it_was(make_blaster):
    """With no dart in the breech, too: with Dart Sensing off the pusher does not read the switch.
    A shot it held back would be a whole cycle late or missing. Two boots whose stored configs
    differ at all drift a few milliseconds apart over a burst, whatever the difference is, so that
    is allowed for."""
    without = auto_extends(armed_v12(make_blaster()))
    wired = auto_extends(armed_v12(make_blaster(), DART))
    assert len(without) > 5
    assert len(wired) == len(without)
    assert all(abs(a - b) <= 5 for a, b in zip(wired, without)), (wired, without)

