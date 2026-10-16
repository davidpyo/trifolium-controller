"""Each firing mode, through the whole firmware: a debounced trigger in, darts at the pusher gate and
the wheels' commanded speed out. Timings count from the firmware's own triggerTime_ms, since a press
reaches the mode one debounce interval after the switch closes."""

import pytest

from trifolium_sim import FULLSPEED, IDLE

DEBOUNCE_MS = 20
REV_RPM = 30000


def one_mode(b, mode, device=None, **fields):
    """A v1.2 whose only fire mode is `mode`, booted and armed, on a pack that sets 57 ms of solenoid
    cycle - about 17.5 DPS at most."""
    fire = {"burstMode": mode, "burstLength": 1, "targetDPS": 15, "reversible": False,
            "binaryTriggerTimeout_ms": 2000, "includeInCycle": True}
    fire.update(fields)
    b.flash_preset("trifolium_v1_2", device)
    b.flash_profile(1, {"schemaVersion": 2, "activeModeCount": 1, "defaultFiringMode": 0,
                        "switchPositionAssignment": [0, 0, 0], "fireModes": [fire]})
    assert b.boot(2500)
    return b


def pressed(b):
    """Presses the trigger and runs until the mode has seen it. When it did, in firmware time -
    triggerTime_ms, or for PLASMA, which times its charge itself, the tick it asked for rev."""
    before = b.peek("triggerTime_ms")
    b.press("trigger")
    seen = lambda: b.peek("triggerTime_ms") != before or b.peek("requestRev")
    assert b.run_until(seen, 100)
    after = b.peek("triggerTime_ms")
    return after if after != before else b.uptime_ms - 1


def release_at(b, t_ms):
    """Releases so the mode sees the release at firmware time `t_ms`."""
    b.run_ms(max(0, t_ms - DEBOUNCE_MS - b.uptime_ms))
    b.release("trigger")
    b.run_ms(DEBOUNCE_MS + 5)


def settle(b, ms=2500):
    """Lets the last shot finish and the wheels stop, so the next pull starts from rest."""
    b.run_ms(ms)
    assert b.run_until_peek("flywheelState", IDLE, limit_ms=3000)


def darts_during(b, action):
    before = len(b.extends())
    action()
    return len(b.extends()) - before


def test_auto_fires_while_held_and_finishes_only_the_shot_in_flight(blaster):
    b = one_mode(blaster, "auto", burstLength=100)
    pressed(b)
    assert b.run_until(lambda: len(b.extends()) >= 3, 1500)
    b.release("trigger")
    b.run_ms(DEBOUNCE_MS + 5)
    at_release = len(b.extends())
    b.run_ms(1000)
    assert len(b.extends()) - at_release <= 1


def test_burst_fires_its_burst_per_pull_and_a_second_pull_mid_burst_adds_none(blaster):
    b = one_mode(blaster, "burst", burstLength=3)
    assert darts_during(b, lambda: (b.tap("trigger"), settle(b))) == 3
    # Both pulls land before the wheels are up, while three shots are still pending.
    assert darts_during(b, lambda: (b.tap("trigger"), b.tap("trigger"), settle(b))) == 3


def test_reversible_burst_revs_while_held_and_fires_on_release(blaster):
    b = one_mode(blaster, "burst", burstLength=3, reversible=True)
    t = pressed(b)
    b.run_ms(800)
    assert b.peek("flywheelState") == FULLSPEED
    assert b.extends() == []
    release_at(b, t + 850)
    settle(b)
    assert len(b.extends()) == 3


def test_binary_fires_on_the_pull_and_again_on_a_release_inside_the_timeout(blaster):
    b = one_mode(blaster, "binary", binaryTriggerTimeout_ms=2000)
    assert darts_during(b, lambda: (b.tap("trigger", hold_ms=300), settle(b))) == 2

    def slow():
        t = pressed(b)
        release_at(b, t + 2100)
        settle(b)

    assert darts_during(b, slow) == 1


def test_safe_as_a_selected_mode_neither_revs_nor_fires(blaster):
    b = one_mode(blaster, "safe")
    b.press("trigger")
    b.run_ms(1000)
    assert b.extends() == []
    assert b.peek("flywheelState") == IDLE
    assert b.wheels()[1]["rpm"] < 100


def test_semi_fires_one_per_pull_and_queues_at_most_one_more(blaster):
    b = one_mode(blaster, "semi", burstLength=5)  # the length is ignored: SEMI is always one
    assert darts_during(b, lambda: (b.tap("trigger"), settle(b))) == 1
    # Quick enough that every pull lands before the wheels are up and the first shot goes.
    quick = lambda: b.tap("trigger", hold_ms=25, gap_ms=25)
    assert darts_during(b, lambda: (quick(), quick(), settle(b))) == 2
    assert darts_during(b, lambda: (quick(), quick(), quick(), settle(b))) == 2


def test_reversible_semi_revs_while_held_and_fires_one_on_release(blaster):
    b = one_mode(blaster, "semi", reversible=True)
    t = pressed(b)
    b.run_ms(600)
    assert b.peek("flywheelState") == FULLSPEED
    assert b.extends() == []
    release_at(b, t + 650)
    settle(b)
    assert len(b.extends()) == 1


def test_devotion_ramps_its_rate_from_3_dps_to_the_solenoids_limit_over_three_seconds(blaster):
    b = one_mode(blaster, "devotion")
    t = pressed(b)
    assert b.peek("liveTargetDPS") == pytest.approx(3.0)
    b.run_ms(max(0, t + 1500 - b.uptime_ms))
    assert b.peek("liveTargetDPS") == pytest.approx(11.5, abs=0.2)
    b.run_ms(max(0, t + 3600 - b.uptime_ms))
    assert b.peek("liveTargetDPS") == pytest.approx(20.0)
    b.release("trigger")
    b.run_ms(500)

    intervals = [(b2 - a) / 1000 for a, b2 in zip(b.extends(), b.extends()[1:])]
    print("DEVOTION intervals, ms:", [round(i) for i in intervals])
    # The ramp is already climbing by the second shot, so the first gap is short of 3 DPS's 333 ms.
    assert intervals[0] > 150
    assert max(intervals[-5:]) < 70  # the 57 ms solenoid cycle, once the ramp passes it
    assert intervals[0] > 2.5 * max(intervals[-5:])
    assert all(later <= earlier + 3 for earlier, later in zip(intervals, intervals[1:]))


# PLASMA: READY 1646 ms after the pull, a slot every 700 ms after that, overheat 1000 ms past the
# third, then a 2 s lockout. The charge is the wheels' commanded speed as a fraction of revRPM.

def charge(b):
    return b.peek("motors")[1]["targetRPM"] / REV_RPM


def test_plasma_starts_charging_at_20_percent_of_rev_speed(blaster):
    b = one_mode(blaster, "plasma")
    pressed(b)
    b.run_ms(2)
    assert charge(b) == pytest.approx(0.20, abs=0.01)
    assert b.peek("requestRev") is True


def test_plasma_charge_never_leaves_20_to_100_percent_before_ready(blaster):
    b = one_mode(blaster, "plasma")
    t = pressed(b)
    seen = []
    while b.uptime_ms < t + 1640:
        b.run_ms(5)
        seen.append(charge(b))
    assert min(seen) >= 0.20 - 1e-3
    assert max(seen) <= 1.0
    assert b.extends() == []


@pytest.mark.parametrize("held_ms, darts", [(1700, 1), (2450, 2), (3150, 3), (4000, 3)])
def test_plasma_fires_as_many_darts_as_slots_armed_when_released(blaster, held_ms, darts):
    b = one_mode(blaster, "plasma")
    t = pressed(b)
    release_at(b, t + held_ms)
    settle(b)
    assert len(b.extends()) == darts


def test_plasma_released_before_ready_fires_one_weak_dart_only_if_the_wheels_got_there(blaster):
    b = one_mode(blaster, "plasma")
    t = pressed(b)
    release_at(b, t + 150)  # the wheels are nowhere near the charge yet
    settle(b)
    assert b.extends() == []

    t = pressed(b)
    b.run_ms(max(0, t + 1400 - DEBOUNCE_MS - b.uptime_ms))
    at_speed = b.peek("flywheelState") == FULLSPEED
    release_at(b, t + 1400)
    settle(b)
    assert len(b.extends()) == (1 if at_speed else 0)


def test_plasma_buzzes_the_solenoid_as_each_slot_arms_and_again_on_overheat(blaster):
    b = one_mode(blaster, "plasma", device={"vibrationPulseMs": 5})
    b.darts(loaded=False)
    t = pressed(b)
    b.run_ms(max(0, t + 1646 + 400 - b.uptime_ms))
    assert len(b.extends()) == 4  # READY
    b.run_ms(max(0, t + 3046 + 400 - b.uptime_ms))
    assert len(b.extends()) == 12  # the second and third slots
    b.run_ms(max(0, t + 4046 + 1200 - b.uptime_ms))
    assert len(b.extends()) == 22  # overheat
    assert b.peek("motors")[1]["targetRPM"] == 0 or b.peek("rpmScale") < 0


def test_plasma_overheats_a_second_after_the_third_slot_and_locks_out_for_two(blaster):
    b = one_mode(blaster, "plasma")
    t = pressed(b)
    release_at(b, t + 4300)  # overheated: fires nothing, locked out until 2 s after this release
    released = b.uptime_ms - 5
    b.run_ms(300)
    assert b.extends() == []
    assert b.peek("requestRev") is False

    # A pull made and released inside the lockout leaves the wheels stopped.
    b.run_ms(max(0, released + 1000 - b.uptime_ms))
    b.release("trigger")  # already released; keep the switch open
    b.run_ms(max(0, released + 2100 - b.uptime_ms))
    t = pressed(b)
    b.run_ms(5)
    assert charge(b) == pytest.approx(0.20, abs=0.01)


def test_plasma_locks_out_for_a_fixed_two_seconds_whatever_is_pulled_during_it(blaster):
    """A pull during the lockout neither fires nor moves the lockout's end."""
    b = one_mode(blaster, "plasma")
    t = pressed(b)
    release_at(b, t + 4300)
    overheated = b.uptime_ms - 5  # locked out until overheated + 2000

    b.run_ms(max(0, overheated + 500 - b.uptime_ms))
    b.press("trigger")
    b.run_ms(100)
    b.release("trigger")
    b.run_ms(max(0, overheated + 2100 - b.uptime_ms))

    pressed(b)  # just past the lockout's end: a fresh charge
    b.run_ms(5)
    assert b.peek("requestRev") is True
    assert charge(b) == pytest.approx(0.20, abs=0.01)
    assert b.extends() == []


def test_plasma_a_pull_held_past_the_lockouts_end_fires_nothing_and_locks_out_nothing(blaster):
    b = one_mode(blaster, "plasma")
    t = pressed(b)
    release_at(b, t + 4300)
    overheated = b.uptime_ms - 5

    b.run_ms(max(0, overheated + 1000 - b.uptime_ms))
    b.press("trigger")  # during the lockout
    b.run_ms(max(0, overheated + 3000 - b.uptime_ms))  # and held past its end
    assert b.peek("requestRev") is False
    b.release("trigger")
    b.run_ms(300)
    assert b.extends() == []

    b.press("trigger")  # the next pull charges straight away
    b.run_ms(DEBOUNCE_MS + 10)
    assert b.peek("requestRev") is True


# ---- a mode change mid-burst ------------------------------------------------------------------

AUTO_100 = {"burstMode": "auto", "burstLength": 100, "targetDPS": 10, "reversible": False,
            "binaryTriggerTimeout_ms": 2000, "includeInCycle": True}
SEMI_1 = dict(AUTO_100, burstMode="semi", burstLength=1)


def auto_then_semi(b, device=None):
    """Mode 1 AUTO with 100 shots a pull, mode 2 SEMI; select position 1 picks AUTO, 3 picks SEMI.
    In every slot, since the select type and the switch at power-on decide which one boots."""
    b.flash_preset("trifolium_v1_2", device)
    for slot in range(3):
        b.flash_profile(slot, {"schemaVersion": 2, "activeModeCount": 2, "defaultFiringMode": 0,
                               "switchPositionAssignment": [0, -1, 1],
                               "fireModes": [AUTO_100, SEMI_1]})
    return b


def darts_after_letting_go(b):
    b.release("trigger")
    before = len(b.extends())
    b.run_ms(3000)
    return len(b.extends()) - before


def test_flipping_the_select_switch_mid_burst_ends_the_burst(blaster):
    # SEMI ignores a release, so without the end AUTO's queue fired out with the trigger let go.
    b = auto_then_semi(blaster)
    assert b.boot(2500)
    b.press("select0")
    b.run_ms(50)
    assert b.peek("firingMode") == 0
    b.press("trigger")
    assert b.run_until(lambda: len(b.extends()) >= 3, 3000)
    b.release("select0")
    b.press("select2")
    b.run_ms(50)
    assert b.peek("firingMode") == 1
    assert darts_after_letting_go(b) <= 1  # the shot in flight at most
    assert b.peek("shotsToFire") == 0


def test_cycling_the_mode_with_the_menu_button_mid_burst_ends_the_burst(blaster):
    # The menu button cycles the mode from core 1, between the firing loop's ticks.
    b = auto_then_semi(blaster, {"selectFireType": "button", "select0Pin": 19})
    assert b.boot(2500)
    assert b.peek("firingMode") == 0
    b.press("trigger")
    assert b.run_until(lambda: len(b.extends()) >= 3, 3000)
    b.tap("menu")
    assert b.peek("firingMode") == 1
    assert darts_after_letting_go(b) <= 1
    assert b.peek("shotsToFire") == 0
