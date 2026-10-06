"""Dart Sensing: with a dart switch wired and the setting on, the pusher pushes only when the switch
shows a dart that arrived after the last push, and pulls back once that dart has gone and Min Push
has passed. A queued shot waits for a dart up to Dart Wait; then the queue is dropped and the wheels
follow the rev switch again. The darts come from the simulator's magazine, which the dart switch
reads."""

import re

import pytest

from helpers import keyed_nodes, schema
from trifolium_sim import FULLSPEED, IDLE

DART_PIN = 20  # free on a v1.2
SENSING = {"dartSwitchPin": DART_PIN, "dartSwitchDebounce_ms": 10, "dartSensing": True,
           "dartWaitTimeout_ms": 1000, "minPushTime_ms": 8}
FULL_PUSH_MS = (25, 28)  # the v1.2's extend time at the simulator's 16.4 V, to the tick


def one_mode(b, mode, device=None, **fields):
    """A v1.2 with Dart Sensing on and `mode` its only fire mode, booted and armed, no magazine in."""
    fire = {"burstMode": mode, "burstLength": 1, "targetDPS": 15, "reversible": False,
            "binaryTriggerTimeout_ms": 2000, "includeInCycle": True}
    fire.update(fields)
    b.flash_preset("trifolium_v1_2", {**SENSING, **(device or {})})
    b.flash_profile(1, {"schemaVersion": 2, "activeModeCount": 1, "defaultFiringMode": 0,
                        "switchPositionAssignment": [0, 0, 0], "fireModes": [fire]})
    assert b.boot(2500)
    return b


def loaded(b, capacity, load_rate=100, leave_ms=4):
    """A full magazine in, its first dart in the breech and past the debounce. Each pushed dart
    clears the switch `leave_ms` into its push."""
    b.magazine(capacity=capacity, load_rate=load_rate, leave_ms=leave_ms)
    b.reload()
    b.run_ms(30)
    return b


def fire(b, ms):
    b.press("trigger")
    b.run_ms(ms)
    b.release("trigger")
    b.run_ms(500)


def pulses(b):
    """How long each push this boot held the pusher's FET on, in ms."""
    rise, found = None, []
    for at, level in b.edges(b.wiring()["pusherFetPin"]):
        if level:
            rise = at
        elif rise is not None:
            found.append((at - rise) / 1000)
    return found


def waiting(b):
    """Pulls the trigger and runs until the queued shot is waiting for a dart."""
    b.press("trigger")
    assert b.run_until(lambda: b.peek("dart")["waitMs"] is not None, 1500)


def test_with_dart_sensing_off_the_pusher_pushes_an_empty_breech_as_before(blaster):
    b = loaded(one_mode(blaster, "auto", device={"dartSensing": False}, burstLength=100), 2)
    fire(b, 1000)
    pushes = len(b.extends())
    assert pushes > 2
    assert b.magazine_state()["dry"] == pushes - 2


def test_with_no_dart_a_pull_revs_the_wheels_but_never_pushes(blaster):
    b = one_mode(blaster, "semi")
    b.press("trigger")
    b.run_ms(600)
    assert b.peek("flywheelState") == FULLSPEED
    assert b.peek("shotsToFire") == 1
    assert b.extends() == []


def test_a_dart_arriving_while_a_shot_waits_is_pushed_once_it_has_shown_for_the_debounce(blaster):
    b = one_mode(blaster, "semi")
    waiting(b)
    b.run_ms(300)
    reloaded_us = b.uptime_us
    b.reload()  # the first dart reaches the breech 10 ms on, and counts 10 ms after that
    assert b.run_until(lambda: len(b.extends()) == 1, 100)
    assert 20000 <= b.extends()[0] - reloaded_us <= 25000
    b.release("trigger")
    b.run_ms(300)
    assert len(b.extends()) == 1
    assert b.magazine_state()["launched"] == 1


def test_a_dart_that_never_leaves_the_switch_is_pushed_only_once(blaster):
    b = one_mode(blaster, "auto", burstLength=100)
    b.press("dart")  # held by hand: the breech never reads empty
    b.run_ms(50)
    b.press("trigger")
    b.run_ms(800)
    assert len(b.extends()) == 1
    assert b.peek("dart")["waitMs"] is not None


def test_a_flicker_shorter_than_the_debounce_does_not_push(blaster):
    b = one_mode(blaster, "semi")
    waiting(b)
    for _ in range(5):
        b.press("dart")
        b.run_ms(4)
        b.release("dart")
        b.run_ms(4)
    b.run_ms(50)
    assert b.extends() == []


@pytest.mark.parametrize("drive", ["fet", "esc"])
def test_auto_pushes_once_for_each_dart_in_the_magazine(blaster, drive):
    b = loaded(one_mode(blaster, "auto", device={"pusherDrive": drive}, burstLength=100), 5)
    fire(b, 1500)
    state = b.magazine_state()
    assert len(b.extends()) == 5
    assert state["launched"] == 5 and state["dry"] == 0


@pytest.mark.parametrize("rev_held", [False, True])
def test_dart_wait_drops_the_queue_and_the_wheels_then_follow_the_rev_switch(blaster, rev_held):
    b = one_mode(blaster, "semi", device={"dartWaitTimeout_ms": 500, "printTelemetry": True})
    if rev_held:
        b.press("rev")
    waiting(b)
    b.run_ms(450)
    assert b.peek("shotsToFire") == 1
    start = len(b.transcript)
    b.run_ms(100)
    assert b.peek("shotsToFire") == 0
    assert "No dart in the breech for 500 ms, dropping 1 queued shots" in b.transcript[start:]
    b.run_ms(20)
    assert b.peek("flywheelState") == (FULLSPEED if rev_held else IDLE)
    if rev_held:
        b.release("rev")
        assert b.run_until_peek("flywheelState", IDLE, limit_ms=100)
    assert b.extends() == []


def test_a_binary_release_after_dart_wait_dropped_the_queue_queues_one_more_shot(blaster):
    b = one_mode(blaster, "binary", device={"dartWaitTimeout_ms": 500})
    waiting(b)
    b.run_ms(600)
    assert b.peek("shotsToFire") == 0
    b.release("trigger")  # inside the 2000 ms binary timeout
    b.run_ms(50)
    assert b.peek("shotsToFire") == 1
    loaded(b, 18)
    b.run_ms(500)
    assert len(b.extends()) == 1


def gaps(b):
    pushes = b.extends()
    return [(later - earlier) / 1000 for earlier, later in zip(pushes, pushes[1:])]


def test_target_dps_still_spaces_pushes_that_end_early(blaster):
    """A push cut short gives its time back to the spacing, so the rate is still the one set."""
    b = loaded(one_mode(blaster, "auto", burstLength=100, targetDPS=8), 10, load_rate=200)
    fire(b, 1000)
    assert len(b.extends()) >= 5
    assert all(p < 12 for p in pulses(b)), pulses(b)
    assert all(abs(gap - 125) <= 3 for gap in gaps(b)), gaps(b)


def test_with_no_target_dps_pulling_back_early_fires_as_fast_as_the_retract_allows(blaster):
    """A 9 ms push then the 30 ms retract, against 27 ms and 30 ms for a whole push."""
    b = loaded(one_mode(blaster, "auto", burstLength=100, targetDPS=0), 10, load_rate=200)
    fire(b, 300)
    assert len(b.extends()) >= 5
    assert all(abs(gap - 40) <= 2 for gap in gaps(b)), gaps(b)


def dps_ceiling(b):
    """The highest Target DPS the menu and console offer an AUTO mode."""
    auto = next(c for c in schema(b)["fireModeCaps"] if c["burstMode"] == "auto")
    return next(f for f in auto["fields"] if f["key"] == "profile:fireModes[*].targetDPS")["hi"]


@pytest.mark.parametrize("sensing, ceiling", [(False, 17), (True, 25)])
def test_the_target_dps_ceiling_counts_a_push_as_min_push_while_dart_sensing_is_on(
        blaster, sensing, ceiling):
    """A 27 ms push at the simulator's 16.4 V, or 9 ms once Min Push lets the dart go, then the
    30 ms retract."""
    b = one_mode(blaster, "auto", device={"dartSensing": sensing}, burstLength=100)
    assert dps_ceiling(b) == ceiling


def test_a_target_dps_past_the_full_push_rate_is_reached_with_dart_sensing(blaster):
    b = loaded(one_mode(blaster, "auto", burstLength=100, targetDPS=25), 10, load_rate=200)
    fire(b, 500)
    assert len(b.extends()) >= 5
    assert all(abs(gap - 40) <= 2 for gap in gaps(b)), gaps(b)


@pytest.mark.parametrize("min_push, leave_ms, expected_ms", [
    (0, 4, 4),    # as soon as the dart has gone
    (8, 4, 9),    # gone sooner than Min Push, so at the first tick after it
    (8, 15, 15),  # gone after Min Push
    (20, 4, 21),
])
def test_the_pusher_pulls_back_once_the_dart_has_left_and_min_push_has_passed(
        blaster, min_push, leave_ms, expected_ms):
    b = one_mode(blaster, "auto", device={"minPushTime_ms": min_push}, burstLength=100)
    loaded(b, 3, leave_ms=leave_ms)
    fire(b, 600)
    assert len(pulses(b)) == 3
    assert all(abs(p - expected_ms) <= 1 for p in pulses(b)), pulses(b)
    assert b.magazine_state()["launched"] == 3


def test_each_early_pull_back_logs_how_long_the_dart_took_to_leave(blaster):
    b = one_mode(blaster, "auto", device={"printTelemetry": True}, burstLength=100)
    loaded(b, 3)
    start = len(b.transcript)
    fire(b, 600)
    left = re.findall(r"Solenoid retracting, the dart left after (\d+) ms", b.transcript[start:])
    assert [int(ms) for ms in left] == [9, 9, 9]


@pytest.mark.parametrize("device, by_hand", [
    ({"minPushTime_ms": 60}, False),  # at or past the push time
    ({"dartSensing": False}, False),
    ({}, True),                       # a dart that never leaves the switch
], ids=["min-push-past-the-push-time", "sensing-off", "dart-never-leaves"])
def test_a_push_lasts_the_whole_push_time_unless_the_dart_is_seen_to_leave_first(
        blaster, device, by_hand):
    b = one_mode(blaster, "semi", device=device)
    if by_hand:
        b.press("dart")
        b.run_ms(50)
    else:
        loaded(b, 3)
    fire(b, 300)
    lo, hi = FULL_PUSH_MS
    assert len(pulses(b)) == 1
    assert all(lo <= p <= hi for p in pulses(b)), pulses(b)


def test_the_rpm_drop_counter_counts_each_dart_once(blaster):
    b = loaded(one_mode(blaster, "auto", device={"useRpmBaseShotCounter": True}, burstLength=100), 4)
    fire(b, 1500)
    assert len(b.extends()) == 4
    assert b.peek("runtimeShotCounter") == 4


def test_dump_motors_says_how_long_a_shot_has_waited_for_a_dart(blaster):
    b = one_mode(blaster, "semi")
    assert b.command("DUMP_MOTORS")["dart"]["waitMs"] is None
    waiting(b)
    b.run_ms(200)
    assert 195 <= b.command("DUMP_MOTORS")["dart"]["waitMs"] <= 210
    loaded(b, 18)
    assert len(b.extends()) == 1
    assert b.command("DUMP_MOTORS")["dart"]["waitMs"] is None


def test_a_dart_switch_that_lost_its_pin_leaves_the_pusher_pushing_without_it(blaster):
    b = one_mode(blaster, "semi", device={"dartSwitchPin": 21})  # the v1.2's trigger pin
    assert b.peek("pins")["dart"] == 255
    b.press("trigger")
    assert b.run_until(lambda: len(b.extends()) == 1, 1500)


@pytest.mark.parametrize("pin, sensing", [(DART_PIN, True), (DART_PIN, False), (255, True)])
def test_the_dart_rows_show_only_for_a_wired_switch_and_the_sensing_ones_only_with_sensing_on(
        blaster, pin, sensing):
    b = one_mode(blaster, "semi", device={"dartSwitchPin": pin, "dartSensing": sensing})
    nodes = keyed_nodes(schema(b)["tree"])
    wired = pin != 255
    for key in ("device:dartSensing", "device:revOnlyWithDart", "device:dartSwitchDebounce_ms"):
        assert nodes[key].get("visible", True) is wired, key
    for key in ("device:dartWaitTimeout_ms", "device:minPushTime_ms"):
        assert nodes[key].get("visible", True) is (wired and sensing), key
