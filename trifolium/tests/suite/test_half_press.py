"""A dual-stage trigger's half press firing a mode of its own: the rev contact drives the selected
mode's revStageMode until the trigger contact closes, and the full press then has the trigger to
itself until the rev contact opens again."""

import pytest
from helpers import check_golden

from trifolium_sim import FULLSPEED, IDLE

DEBOUNCE_MS = 20


def mode(burst_mode, **fields):
    fire = {"burstMode": burst_mode, "burstLength": 1, "targetDPS": 15, "reversible": False,
            "binaryTriggerTimeout_ms": 2000, "includeInCycle": True, "revStageMode": -1}
    fire.update(fields)
    return fire


def paired(b, full, half, dual_stage=True, half_index=1, home=None):
    """A v1.2 whose selected mode is `full`, with `half` as its half press, booted and armed. With
    `home`, a screen on that home layout."""
    full = dict(full, revStageMode=half_index)
    device = {"dualStageTrigger": dual_stage}
    if home:
        device["homeScreenDisplayMode"] = home
        b.attach_display()
    b.flash_preset("trifolium_v1_2", device)
    b.flash_profile(1, {"schemaVersion": 2, "activeModeCount": 2, "defaultFiringMode": 0,
                        "switchPositionAssignment": [0, 0, 0], "fireModes": [full, half]})
    assert b.boot(2500)
    return b


def settle(b, ms=2500):
    b.run_ms(ms)
    assert b.run_until_peek("flywheelState", IDLE, limit_ms=3000)


def darts(b):
    return len(b.extends())


def test_a_half_press_fires_the_half_press_mode(blaster):
    b = paired(blaster, mode("auto", burstLength=100), mode("semi"))
    b.press("rev")
    b.run_ms(DEBOUNCE_MS + 5)
    assert b.peek("liveFireModeIndex") == 1
    b.run_ms(1500)
    assert darts(b) == 1
    b.release("rev")
    settle(b)
    assert darts(b) == 1
    assert b.peek("liveFireModeIndex") == 0


def test_a_full_press_takes_over_and_easing_back_to_half_fires_nothing(blaster):
    b = paired(blaster, mode("auto", burstLength=100), mode("semi"))
    b.press("rev")
    b.run_ms(600)
    assert darts(b) == 1
    b.press("trigger")
    assert b.run_until(lambda: darts(b) >= 4, 1500)
    assert b.peek("liveFireModeIndex") == 0
    b.release("trigger")
    b.run_ms(DEBOUNCE_MS + 5)
    at_release = darts(b)
    b.run_ms(1000)
    assert darts(b) - at_release <= 1
    held_half = darts(b)
    b.release("rev")
    settle(b)
    assert darts(b) == held_half


def test_a_full_press_drops_the_half_press_shot_that_has_not_started(blaster):
    # From rest the half press's shot waits for the wheels, so a quick full pull overtakes it.
    b = paired(blaster, mode("burst", burstLength=3), mode("semi"))
    b.press("rev")
    b.run_ms(DEBOUNCE_MS + 10)
    assert b.peek("shotsToFire") == 1
    b.press("trigger")
    b.run_ms(300)
    b.release("trigger")
    b.release("rev")
    settle(b)
    assert darts(b) == 3


def test_a_reversible_half_press_never_sees_its_release_once_a_full_press_takes_over(blaster):
    b = paired(blaster, mode("burst", burstLength=2), mode("semi", reversible=True))
    b.press("rev")
    b.run_ms(600)
    assert b.peek("flywheelState") == FULLSPEED
    assert darts(b) == 0
    b.press("trigger")
    b.run_ms(800)
    b.release("trigger")
    b.run_ms(100)
    b.release("rev")
    settle(b)
    assert darts(b) == 2


def test_both_contacts_closing_together_is_a_full_press(blaster):
    b = paired(blaster, mode("burst", burstLength=3), mode("semi"))
    b.press("rev")
    b.press("trigger")
    b.run_ms(800)
    b.release("trigger")
    b.release("rev")
    settle(b)
    assert darts(b) == 3


def test_safe_selected_ignores_its_half_press(blaster):
    b = paired(blaster, mode("safe"), mode("semi"))
    b.press("rev")
    b.run_ms(1000)
    assert darts(b) == 0
    assert b.peek("liveFireModeIndex") == 0
    assert b.peek("flywheelState") == IDLE


def test_plasma_cannot_be_a_half_press(blaster):
    b = paired(blaster, mode("auto", burstLength=100), mode("plasma"))
    b.press("rev")
    b.run_ms(1000)
    assert b.peek("liveFireModeIndex") == 0
    assert darts(b) == 0
    assert b.peek("flywheelState") == FULLSPEED  # the rev contact still revs


def test_without_dual_stage_trigger_the_rev_contact_only_revs_and_the_pairing_is_kept(blaster):
    b = paired(blaster, mode("auto", burstLength=100), mode("semi"), dual_stage=False)
    b.press("rev")
    b.run_ms(1000)
    assert b.peek("flywheelState") == FULLSPEED
    assert darts(b) == 0
    assert b.peek("liveFireModeIndex") == 0
    assert b.command("DUMP_PROFILE 1")["fireModes"][0]["revStageMode"] == 1


def test_an_out_of_range_half_press_mode_only_revs(blaster):
    b = paired(blaster, mode("auto", burstLength=100), mode("semi"), half_index=7)
    b.press("rev")
    b.run_ms(1000)
    assert darts(b) == 0
    assert b.peek("liveFireModeIndex") == 0


def test_a_profile_without_the_field_loads_every_mode_as_rev_only(blaster):
    modes = [mode(m) for m in ("auto", "semi", "burst", "binary")]
    for m in modes:
        del m["revStageMode"]
    blaster.flash_preset("trifolium_v1_2", {"dualStageTrigger": True})
    blaster.flash_profile(1, {"schemaVersion": 2, "activeModeCount": 4, "defaultFiringMode": 0,
                              "switchPositionAssignment": [0, 0, 0], "fireModes": modes})
    assert blaster.boot(2500)
    stored = blaster.command("DUMP_PROFILE 1")["fireModes"]
    assert [m["revStageMode"] for m in stored] == [-1, -1, -1, -1]


def screen_after(b, ms=250):
    """The panel once the home screen has redrawn, which it does every 100 ms."""
    b.run_ms(ms)
    return b.panel()


@pytest.mark.parametrize("home", ["fire_mode", "both"])
def test_the_home_screen_shows_the_pair_and_lights_the_stage_firing(blaster, home):
    b = paired(blaster, mode("auto", burstLength=100), mode("semi"), home=home)
    panel = screen_after(b)
    assert panel.shows("AUTO") and panel.shows("½ SEMI"), panel.text
    assert panel.highlighted == ""
    b.press("rev")
    assert screen_after(b).highlighted == "½ SEMI"
    b.press("trigger")
    assert screen_after(b).highlighted == "AUTO"
    b.release("trigger")
    b.release("rev")
    assert screen_after(b).highlighted == ""


def test_the_counter_screen_shows_the_pair_in_its_mode_row(blaster):
    b = paired(blaster, mode("auto", burstLength=100), mode("semi"), home="counter")
    panel = screen_after(b)
    assert panel.shows("AUTO/SEMI"), panel.text
    b.press("rev")
    assert screen_after(b).highlighted == "SEMI"


def test_the_counter_screen_shows_the_mode_in_control_when_the_pair_will_not_fit(blaster):
    b = paired(blaster, mode("auto", burstLength=100, name="LONG AUTO NAME"),
               mode("semi", name="LONG SEMI NAME"), home="counter")
    panel = screen_after(b)
    assert panel.shows("LONG AUTO NAME") and not panel.shows("LONG SEMI NAME"), panel.text
    b.press("rev")
    panel = screen_after(b)
    assert panel.shows("LONG SEMI NAME") and not panel.shows("LONG AUTO NAME"), panel.text


def test_a_mode_without_a_half_press_keeps_its_large_name(blaster):
    b = paired(blaster, mode("auto", burstLength=100), mode("semi"), half_index=-1,
               home="fire_mode")
    panel = screen_after(b)
    assert not panel.shows("½"), panel.text


def test_the_half_press_screen_matches_its_golden_image(blaster):
    b = paired(blaster, mode("auto", burstLength=100), mode("semi"), home="fire_mode")
    b.press("rev")
    b.run_ms(250)
    check_golden("home_half_press", b.panel(pixels=True))
