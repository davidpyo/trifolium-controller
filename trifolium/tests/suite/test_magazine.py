"""The simulator's magazine: a spring that feeds the breech at the load rate once the pusher is back,
a push that carries the breech's dart past the dart switch and into the wheels, and a dry push once
it is empty. This is the world outside the firmware; the firmware is only reading its dart switch.
An ESC-driven pusher is a brushed motor on an ESC in place of a FET, so it pushes the same way."""

import pytest

from helpers import armed_v12

DART = {"dartSwitchPin": 20, "dartSwitchDebounce_ms": 10}
DRIVES = pytest.mark.parametrize("drive", ["fet", "esc"])


def loaded(b, capacity=5, load_rate=100, device=None, drive="fet"):
    """A v1.2 with a dart switch on GPIO 20, AUTO selected, and a full magazine just gone in. An
    "esc" drive puts the pusher on ESC channel 3, which the v1.2's two wheels leave free."""
    armed_v12(b, {**DART, "pusherDrive": drive, **(device or {})})
    b.press("select0")  # AUTO on the v1.2's default profile
    b.run_ms(50)
    b.magazine(capacity=capacity, load_rate=load_rate)
    b.reload()
    return b


def fire(b, ms=1000):
    b.press("trigger")
    b.run_ms(ms)
    b.release("trigger")
    b.run_ms(500)


def test_with_no_magazine_in_the_breech_stays_empty_and_the_counts_do_not_move(blaster):
    b = armed_v12(blaster, DART)
    b.press("select0")
    fire(b)
    state = b.magazine_state()
    assert state["fitted"] is False
    assert state["launched"] == 0 and state["dry"] == 0
    assert b.peek("dart")["present"] is False


def test_a_reload_fills_the_breech_one_feed_interval_later(blaster):
    b = loaded(blaster, load_rate=100)  # 10 ms a dart
    assert b.magazine_state()["breech"] is False
    b.run_ms(8)
    assert b.magazine_state()["breech"] is False
    b.run_ms(4)
    state = b.magazine_state()
    assert state["breech"] is True
    assert state["darts"] == 4


def test_the_load_rate_sets_how_long_the_spring_takes(blaster):
    b = loaded(blaster, load_rate=20)  # 50 ms a dart
    b.run_ms(45)
    assert b.magazine_state()["breech"] is False
    b.run_ms(10)
    assert b.magazine_state()["breech"] is True


def test_the_dart_switch_reads_the_breech_through_its_debounce(blaster):
    b = loaded(blaster)
    b.run_ms(15)
    assert b.magazine_state()["breech"] is True
    assert b.peek("dart")["present"] is False  # 5 ms on the switch, of a 10 ms debounce
    b.run_ms(10)
    assert b.peek("dart")["present"] is True


def test_a_normally_closed_dart_switch_reads_the_breech_the_right_way_round(blaster):
    b = armed_v12(blaster, {**DART, "dartSwitchNormallyClosed": True})
    b.run_ms(50)
    assert b.peek("dart")["present"] is False  # no magazine in: the breech is empty
    b.reload()
    b.run_ms(5)
    assert b.peek("dart")["present"] is False
    b.run_ms(30)
    assert b.peek("dart")["present"] is True


@DRIVES
def test_each_push_carries_a_dart_out_until_the_magazine_is_empty_then_the_pushes_are_dry(blaster,
                                                                                           drive):
    b = loaded(blaster, capacity=5, drive=drive)
    b.run_ms(20)
    fire(b)
    pushes = len(b.extends())
    state = b.magazine_state()
    assert pushes > 5
    assert state["launched"] == 5
    assert state["dry"] == pushes - 5
    assert state["darts"] == 0 and state["breech"] is False
    assert b.peek("dart")["present"] is False


@DRIVES
def test_only_the_darts_that_went_through_the_wheels_count_as_shots(blaster, drive):
    b = loaded(blaster, capacity=3, device={"useRpmBaseShotCounter": True}, drive=drive)
    b.run_ms(20)
    fire(b)
    assert len(b.extends()) > 3
    assert b.peek("runtimeShotCounter") == 3


@DRIVES
def test_the_breech_stays_empty_while_the_pusher_is_out(blaster, drive):
    b = loaded(blaster, load_rate=200, drive=drive)  # 5 ms a dart, far quicker than a push
    b.run_ms(20)
    b.press("trigger")
    assert b.run_until(lambda: len(b.extends()) == 1, 1500)
    b.run_ms(8)  # the dart has cleared the switch; the pusher is still out
    assert b.magazine_state()["breech"] is False
    assert b.peek("firing") is True


def test_the_magazine_stays_in_across_a_power_cycle(blaster):
    b = loaded(blaster, capacity=5)
    b.run_ms(20)
    b.press("trigger")
    assert b.run_until(lambda: len(b.extends()) == 2, 1500)
    b.release("trigger")  # AUTO finishes the shot in flight
    b.run_ms(500)
    before = b.magazine_state()
    assert before["launched"] == len(b.extends()) < 5

    b.power_cycle()
    assert b.boot(500)
    after = b.magazine_state()
    for key in ("fitted", "capacity", "darts", "breech", "launched", "dry"):
        assert after[key] == before[key], key
    assert b.peek("dart")["present"] is True


def test_a_dart_switch_held_by_hand_outranks_the_magazine(blaster):
    b = loaded(blaster, capacity=1)
    b.run_ms(20)
    fire(b)
    assert b.magazine_state()["breech"] is False
    b.press("dart")
    b.run_ms(20)
    assert b.peek("dart")["present"] is True


def test_a_reload_refills_the_magazine_and_starts_its_counts_again(blaster):
    b = loaded(blaster, capacity=2)
    b.run_ms(20)
    fire(b)
    assert b.magazine_state()["dry"] > 0
    b.reload()
    b.run_ms(20)
    state = b.magazine_state()
    assert state["launched"] == 0 and state["dry"] == 0
    assert state["darts"] == 1 and state["breech"] is True


def pushes(b, pin):
    """Each push of a magazine's first second of AUTO, as (start, length) in µs from the first."""
    b.run_ms(20)
    fire(b)
    rise, found = None, []
    for at, level in b.edges(pin):  # a FET's gate is first driven low at setup
        if level:
            rise = at
        elif rise is not None:
            found.append((rise, at - rise))
    return [(at - found[0][0], length) for at, length in found]


def test_an_esc_driven_pusher_is_powered_for_the_same_pushes_as_a_fet(blaster):
    fet = pushes(loaded(blaster, capacity=3), blaster.wiring()["pusherFetPin"])
    blaster.power_cycle()
    b = loaded(blaster, capacity=3, drive="esc")
    esc = pushes(b, b.wiring()["escPins"][2])
    assert len(esc) == len(fet) > 3
    for (esc_at, esc_len), (fet_at, fet_len) in zip(esc, fet):
        assert abs(esc_at - fet_at) <= 5000 and abs(esc_len - fet_len) <= 1000
    assert len(b.extends()) == len(esc)
    assert b.magazine_state()["launched"] == 3
