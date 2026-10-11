"""Rev Only With Dart: with a dart switch wired and the setting on, a rev, from the rev switch or a
trigger pull, only starts with a dart in the breech. Once the wheels are up, an empty breech changes
nothing: they follow the rev switch as before."""

from helpers import armed_v12
from trifolium_sim import FULLSPEED, IDLE

DART_PIN = 20  # free on a v1.2
GATED = {"dartSwitchPin": DART_PIN, "dartSwitchDebounce_ms": 10, "revOnlyWithDart": True}
REFUSED = "No dart in the breech, not revving"


def semi(b, device):
    """A v1.2 with SEMI its only fire mode, booted and armed."""
    b.flash_preset("trifolium_v1_2", device)
    b.flash_profile(1, {"schemaVersion": 2, "activeModeCount": 1, "defaultFiringMode": 0,
                        "switchPositionAssignment": [0, 0, 0],
                        "fireModes": [{"burstMode": "semi", "burstLength": 1, "targetDPS": 15,
                                       "reversible": False, "binaryTriggerTimeout_ms": 2000,
                                       "includeInCycle": True}]})
    assert b.boot(2500)
    return b


def state(b):
    return b.peek("flywheelState")


def reaches_full_speed(b):
    return b.run_until(lambda: state(b) == FULLSPEED, 1500)


def test_with_no_dart_the_rev_switch_does_not_rev_and_says_so_once(blaster):
    b = armed_v12(blaster, {**GATED, "printTelemetry": True})
    start = len(b.transcript)
    b.press("rev")
    b.run_ms(500)
    assert state(b) == IDLE
    assert b.transcript[start:].count(REFUSED) == 1


def test_a_dart_arriving_while_the_rev_switch_is_held_starts_the_rev(blaster):
    b = armed_v12(blaster, GATED)
    b.press("rev")
    b.run_ms(200)
    assert state(b) == IDLE
    b.press("dart")
    assert reaches_full_speed(b)


def test_with_a_dart_the_rev_switch_revs_and_an_empty_breech_does_not_spin_it_down(blaster):
    b = armed_v12(blaster, GATED)
    b.press("dart")
    b.run_ms(30)
    b.press("rev")
    assert reaches_full_speed(b)
    b.release("dart")
    b.run_ms(500)
    assert state(b) == FULLSPEED
    b.release("rev")
    assert b.run_until(lambda: state(b) == IDLE, 500)


def test_a_pull_with_no_dart_neither_revs_nor_stays_queued(blaster):
    b = semi(blaster, GATED)
    b.press("trigger")
    b.run_ms(300)
    assert state(b) == IDLE
    assert b.peek("shotsToFire") == 0
    b.release("trigger")
    b.press("dart")
    b.run_ms(300)
    assert state(b) == IDLE  # the earlier pull was dropped, not kept for the dart
    assert b.extends() == []


def test_a_pull_with_a_dart_revs_and_fires(blaster):
    b = semi(blaster, GATED)
    b.press("dart")
    b.run_ms(30)
    b.press("trigger")
    assert b.run_until(lambda: len(b.extends()) == 1, 1500)


def test_with_the_setting_off_the_rev_switch_revs_an_empty_breech(blaster):
    b = armed_v12(blaster, {**GATED, "revOnlyWithDart": False})
    b.press("rev")
    assert reaches_full_speed(b)


def test_with_no_dart_switch_wired_the_setting_is_ignored(blaster):
    b = armed_v12(blaster, {**GATED, "dartSwitchPin": 255})
    b.press("rev")
    assert reaches_full_speed(b)
