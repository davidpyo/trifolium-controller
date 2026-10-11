"""Dart Sensing, an encoder selector and a speed pot on one blaster, through the whole firmware: a
Trifolium v1.2 whose two select pins are read as an encoder rather than a three-position switch,
with a dart switch on GPIO 20 and a pot on GPIO 27, both free on that board."""

import pytest

from helpers import schema
from trifolium_sim import IDLE

DEVICE = {
    "selectFireType": "encoder",
    "variableFPS": False,
    "dartSwitchPin": 20,
    "dartSensing": True,
    "speedPotPin": 27,
    "speedPotMinRPM": 10000,
    "speedPotMaxRPM": 30000,
    "minFiringRPM": 5000,
    "firingRPMTolerance": 500,
}


def fire_mode(mode, burst=1):
    return {"burstMode": mode, "burstLength": burst, "targetDPS": 0, "reversible": False,
            "binaryTriggerTimeout_ms": 2000, "includeInCycle": True}


# No line grounded is the Default Mode, SAFE; select 1 alone SEMI, select 3 alone BINARY, both AUTO.
PROFILE = {"schemaVersion": 2, "activeModeCount": 4, "defaultFiringMode": 0,
           "fireModes": [fire_mode("safe"), fire_mode("semi"), fire_mode("binary"),
                         fire_mode("auto", burst=100)],
           "switchPositionAssignment": [1, 2, 3, -1, -1, -1, -1]}


def built(b):
    """The build booted and past ESC arming, no magazine in."""
    b.flash_preset("trifolium_v1_2", DEVICE)
    for slot in range(3):
        b.flash_profile(slot, PROFILE)
    assert b.boot(2500)
    return b


def select(b, *lines):
    """The selector with `lines` grounded and the other open, held past its debounce."""
    for line in ("select0", "select2"):
        (b.press if line in lines else b.release)(line)
    b.run_ms(100)


def loaded(b, capacity=18):
    b.magazine(capacity=capacity, load_rate=100)
    b.reload()
    b.run_ms(30)
    return b


def pulses(b):
    """How long each push this boot held the pusher's FET on, in ms."""
    rise, found = None, []
    for at, level in b.edges(b.wiring()["pusherFetPin"]):
        if level:
            rise = at
        elif rise is not None:
            found.append((at - rise) / 1000)
    return found


def test_the_build_boots_with_every_control_on_its_pin(blaster):
    b = built(blaster)
    pins = b.peek("pins")
    assert (pins["dart"], pins["speedPot"], pins["select0"], pins["select2"]) == (20, 27, 9, 10)
    assert schema(b)["pinConflicts"] == []


@pytest.mark.parametrize("lines, expected", [
    ((), "safe"),
    (("select0",), "semi"),
    (("select2",), "binary"),
    (("select0", "select2"), "auto"),
], ids=["none", "select1", "select3", "both"])
def test_each_encoder_position_picks_its_mode(blaster, lines, expected):
    b = built(blaster)
    select(b, *lines)
    assert b.command("DUMP_MOTORS")["burstMode"] == expected


@pytest.mark.parametrize("pot, rpm", [(0.0, 10000), (1.0, 30000)])
def test_semi_fires_one_dart_a_pull_with_the_pot_at_either_end(blaster, pot, rpm):
    b = built(blaster)
    b.pot(pot)
    select(b, "select0")
    loaded(b)
    for _ in range(3):
        b.press("trigger")
        b.run_ms(400)
        b.release("trigger")
        b.run_ms(400)
    motors = b.command("DUMP_MOTORS")["motors"]
    assert {m["revRPM"] for m in motors if m["enabled"]} == {rpm}
    assert len(b.extends()) == 3
    assert b.magazine_state()["launched"] == 3


def test_with_the_magazine_empty_a_pull_revs_and_is_dropped_after_dart_wait(blaster):
    b = built(blaster)
    select(b, "select0")
    b.press("trigger")
    b.run_ms(1500)
    assert b.extends() == []
    assert b.peek("shotsToFire") == 0
    assert b.run_until_peek("flywheelState", IDLE, limit_ms=1500)


def test_auto_pushes_each_dart_once_and_pulls_back_as_each_one_leaves(blaster):
    b = built(blaster)
    select(b, "select0", "select2")
    loaded(b, capacity=6)
    b.press("trigger")
    b.run_ms(1500)
    b.release("trigger")
    b.run_ms(500)
    state = b.magazine_state()
    assert len(b.extends()) == 6
    assert state["launched"] == 6 and state["dry"] == 0
    assert all(p < 12 for p in pulses(b)), pulses(b)  # Min Push, not the whole push time
