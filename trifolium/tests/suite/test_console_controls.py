"""What the console can make the blaster do on its own: spin one motor to test it, set an ESC's
direction and spin to check, and hold a rev for an RPM capture. Never fire: there is no command for
it. The v1.2 preset enables motors 2 and 4, on ESC pins 1 and 3."""

import pytest
from helpers import armed_v12, open_menu

from trifolium_sim import FULLSPEED, IDLE

TEST_THROTTLE = 400  # menuMotors.cpp's FLYWHEEL_TEST_THROTTLE
SPIN_DIRECTION_1, SPIN_DIRECTION_2, SAVE_SETTINGS = 7, 8, 12
BOTH = 0b1010  # motors 2 and 4, the v1.2's enabled pair
SAFETY = {"safetySwitchPin": 11}


def throttles(b):
    escs = b.escs()
    return {pin: escs[pin]["lastThrottle"] for pin in (1, 3)}


def hold_rev(b, mask, ms, every_ms=100):
    """Renews REV_HOLD as the console does while its button is held."""
    for _ in range(ms // every_ms):
        assert b.command(f"REV_HOLD {mask}")["ok"] is True
        b.run_ms(every_ms)


def test_motor_test_spins_that_motor_alone_then_stops(blaster):
    b = armed_v12(blaster, display=False)
    assert b.command("MOTOR_TEST 1")["ok"] is True
    b.run_ms(500)
    assert throttles(b) == {1: TEST_THROTTLE, 3: 0}
    b.run_ms(2000)
    assert throttles(b) == {1: 0, 3: 0}


@pytest.mark.parametrize("command,direction", [("MOTOR_NORMAL", SPIN_DIRECTION_1),
                                               ("MOTOR_REVERSED", SPIN_DIRECTION_2)])
def test_a_direction_command_writes_it_to_that_esc_saves_it_and_spins_to_check(
        blaster, command, direction):
    b = armed_v12(blaster, display=False)
    assert b.command(f"{command} 3")["ok"] is True
    b.run_ms(1000)
    sent = b.escs()[3]["commands"]
    assert sent.count(direction) == 10 and sent.count(SAVE_SETTINGS) == 10
    assert not {SPIN_DIRECTION_1, SPIN_DIRECTION_2, SAVE_SETTINGS} & set(b.escs()[1]["commands"])
    assert throttles(b)[3] == TEST_THROTTLE
    b.run_ms(2500)
    assert throttles(b) == {1: 0, 3: 0}


def test_a_motor_action_waits_for_the_blaster_to_be_at_rest(blaster):
    b = armed_v12(blaster, display=False)
    b.press("rev")
    assert b.run_until_peek("flywheelState", FULLSPEED, limit_ms=1500)
    reply = b.command("MOTOR_TEST 1")
    assert reply["ok"] is False and reply["err"] == "blaster busy"


@pytest.mark.parametrize("line", ["MOTOR_TEST 0", "MOTOR_TEST 4", "MOTOR_TEST", "MOTOR_NORMAL 2"])
def test_a_motor_action_on_a_motor_that_is_not_enabled_is_refused(blaster, line):
    b = armed_v12(blaster, display=False)
    reply = b.command(line)
    assert reply["ok"] is False and reply["err"] == "no such motor enabled"
    b.run_ms(300)
    assert throttles(b) == {1: 0, 3: 0}


def test_a_motor_action_is_refused_with_the_menu_open_or_the_safety_on(blaster, make_blaster):
    b = armed_v12(blaster)
    open_menu(b)
    assert b.command("MOTOR_TEST 1")["err"] == "menu open"
    b = armed_v12(make_blaster(), SAFETY, display=False)
    b.press("safety")
    b.run_ms(100)
    assert b.command("MOTOR_TEST 1")["err"] == "safety engaged"


def test_a_held_rev_spins_the_ticked_motors_and_lapses_when_the_renewals_stop(blaster):
    b = armed_v12(blaster, display=False)
    hold_rev(b, 0b0010, 1500)
    motors = b.peek("motors")
    assert b.peek("flywheelState") == FULLSPEED
    assert motors[1]["targetRPM"] > 0 and motors[3]["targetRPM"] == 0
    b.run_ms(400)
    assert b.peek("flywheelState") == IDLE


def test_motors_left_out_of_a_held_rev_stay_still_through_its_dwell_and_idle(blaster):
    """The idle after a rev spins every motor on its own - but not one the rev was told to leave."""
    b = armed_v12(blaster, display=False)
    b.reset_peak(3)
    hold_rev(b, 0b0010, 1500)
    for _ in range(40):  # the lease lapses, then the dwell and the idle window after it
        b.run_ms(100)
        assert b.peek("motors")[3]["targetRPM"] == 0
    assert b.wheels()[3]["peak"] < 100


def test_after_a_held_rev_on_some_motors_the_trigger_revs_them_all_and_fires(blaster):
    b = armed_v12(blaster, display=False)
    hold_rev(b, 0b0010, 1000)
    b.run_ms(3000)
    fired = len(b.extends())
    b.press("trigger")
    assert b.run_until(lambda: all(m["targetRPM"] > 0 for m in b.peek("motors") if m["enabled"]),
                       1000)
    b.run_ms(800)
    b.release("trigger")
    assert len(b.extends()) > fired


def test_rev_release_lets_go_at_once(blaster):
    b = armed_v12(blaster, display=False)
    hold_rev(b, BOTH, 1200)
    assert b.peek("flywheelState") == FULLSPEED
    assert b.command("REV_RELEASE")["ok"] is True
    b.run_ms(50)
    assert b.peek("flywheelState") == IDLE


def test_a_rev_on_some_motors_never_fires_even_from_the_trigger(blaster):
    """A dart pushed through a wheel that is not turning jams."""
    b = armed_v12(blaster, display=False)
    fired = len(b.extends())
    hold_rev(b, 0b0010, 800)
    b.press("trigger")
    hold_rev(b, 0b0010, 800)
    b.release("trigger")
    assert len(b.extends()) == fired


def test_a_rev_on_every_motor_still_fires_from_the_trigger(blaster):
    b = armed_v12(blaster, display=False)
    fired = len(b.extends())
    hold_rev(b, BOTH, 800)
    b.press("trigger")
    hold_rev(b, BOTH, 800)
    b.release("trigger")
    assert len(b.extends()) > fired


@pytest.mark.parametrize("line,err", [("REV_HOLD 1", "no enabled motor in the mask"),
                                      ("REV_HOLD 0", "needs a motor mask, 1-15"),
                                      ("REV_HOLD 16", "needs a motor mask, 1-15")])
def test_a_rev_hold_naming_no_enabled_motor_is_refused(blaster, line, err):
    b = armed_v12(blaster, display=False)
    reply = b.command(line)
    assert reply["ok"] is False and reply["err"] == err


def test_a_rev_hold_is_refused_in_safe_and_with_the_menu_open(blaster, make_blaster):
    b = armed_v12(blaster, SAFETY, display=False)
    b.press("safety")
    b.run_ms(100)
    assert b.command(f"REV_HOLD {BOTH}")["err"] == "SAFE"
    assert b.peek("flywheelState") == IDLE
    b = armed_v12(make_blaster())
    open_menu(b)
    assert b.command(f"REV_HOLD {BOTH}")["err"] == "menu open"
