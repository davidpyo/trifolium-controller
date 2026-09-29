"""Boot, ESC arming, rev, firing and the switches that gate them - through the same pins, ESC frames
and serial port a real blaster has."""

import pytest
from helpers import armed_v12

from trifolium_sim import FULLSPEED, IDLE

EDT_ENABLE = 13  # DSHOT_CMD_EXTENDED_TELEMETRY_ENABLE


def test_an_unwired_board_drives_no_pin_and_says_so_until_a_host_speaks(blaster):
    b = blaster
    assert b.boot()
    assert b.run_ms(7000)

    assert b.pin_mode_calls() == 0
    assert b.transcript.count('{"evt":"unconfigured"') == 3  # at 0, 3 and 6 s

    assert b.command("DUMP_BOOT")["wiring"]["configured"] is False
    before = b.transcript.count('"evt"')
    assert b.run_ms(7000)
    assert b.transcript.count('"evt"') == before
    assert b.pin_mode_calls() == 0


def test_a_command_sent_before_core_1_serves_the_port_waits_for_it_rather_than_being_lost(blaster):
    """The core starts USB before setup(), and loop1() only runs once setup1() has waited for the
    settings and brought the panel up. TinyUSB holds what arrives in between - 256 bytes, then the
    host's write stalls - and nothing on the way reads the port."""
    b = blaster
    b.flash_preset("trifolium_v1_2")
    b.attach_display()
    b.power_on()
    b.send("DUMP_BOOT\n")
    assert b.wait_booted()
    assert b.run_until(lambda: '"cmd":"DUMP_BOOT"' in b.transcript, 1000)


def test_v12_answers_on_both_escs_and_arms_them_before_any_throttle(blaster):
    b = blaster
    b.flash_preset("trifolium_v1_2")
    b.attach_display()
    assert b.boot()

    # The shipped motorConfig enables motors 2 and 4, on GPIO 1 and 3.
    enabled = [m["enabled"] for m in b.peek("motors")]
    assert enabled == [False, True, False, True]
    wheels = b.wheels()
    assert wheels[1]["attached"] and wheels[3]["attached"]

    highest = 0

    def watch():
        nonlocal highest
        escs = b.escs()
        highest = max(highest, escs[1]["lastThrottle"], escs[3]["lastThrottle"])
        return False

    b.run_until(watch, 2500, step_ms=5)
    assert highest == 0

    boot = b.command("DUMP_BOOT")
    assert boot["escArming"]["ran"] is True
    assert boot["escArming"]["timedOut"] is False
    for pin in (1, 3):
        assert b.escs()[pin]["commands"].count(EDT_ENABLE) == 10


def test_the_rev_switch_brings_both_wheels_to_speed_and_they_stop_after_release(blaster):
    b = armed_v12(blaster)
    b.press("rev")
    assert b.run_until_peek("flywheelState", FULLSPEED, limit_ms=500)
    b.run_ms(300)
    wheels = b.wheels()
    assert wheels[1]["rpm"] == pytest.approx(30000, rel=0.02)
    assert wheels[3]["rpm"] == pytest.approx(30000, rel=0.02)
    assert wheels[0]["rpm"] == 0

    b.release("rev")
    b.run_ms(4000)
    assert b.peek("flywheelState") == IDLE
    assert b.peek("motors")[1]["targetRPM"] == 0
    assert all(w["rpm"] < 1000 for w in b.wheels())


def test_semi_auto_fires_one_dart_per_pull_and_the_rpm_drop_counts_it(blaster):
    b = armed_v12(blaster)
    b.press("select2")  # position 2 is SEMI in the default profile
    b.run_ms(100)
    assert b.peek("firingMode") == 2

    b.tap("trigger")
    b.run_ms(1500)
    assert len(b.extends()) == 1
    assert b.peek("runtimeShotCounter") == 1


def test_a_dry_fire_on_settled_wheels_is_not_counted_as_a_shot(blaster):
    b = armed_v12(blaster)
    b.darts(loaded=False)
    b.press("select2")
    b.press("rev")
    b.run_ms(800)
    b.tap("trigger")
    b.run_ms(1500)
    b.release("rev")
    assert len(b.extends()) == 1
    assert b.peek("runtimeShotCounter") == 0


def test_a_dry_fire_from_rest_is_not_counted_as_a_shot_either(blaster):
    """A pull from rest fires as soon as the wheels are inside firingRPMTolerance. The fitted wheel
    settles from there without a drop goodRpmShotReads would count. A real one hunts around its
    target, by more than rpmDropThreshold at 32k RPM in the captures, which this model does not."""
    b = armed_v12(blaster)
    b.darts(loaded=False)
    b.press("select2")
    b.run_ms(100)
    b.tap("trigger")
    b.run_ms(1500)
    assert len(b.extends()) == 1
    assert b.peek("runtimeShotCounter") == 0


def test_full_auto_holds_the_configured_15_dps_while_the_trigger_is_held(blaster):
    b = armed_v12(blaster)
    b.press("select0")  # position 0 is AUTO, 15 DPS
    b.run_ms(100)
    assert b.peek("firingMode") == 0

    b.press("trigger")
    b.run_ms(3000)
    b.release("trigger")
    b.run_ms(1000)

    extends = b.extends()
    assert len(extends) > 10
    # Steady state only: the first shot waits on the wheels, not the rate.
    dps = (len(extends) - 3) / ((extends[-1] - extends[2]) / 1e6)
    assert dps == pytest.approx(15.0, rel=0.05)
    assert b.peek("runtimeShotCounter") == len(extends)


@pytest.mark.parametrize("control", ["pid", "tbh"])
def test_a_wired_board_on_usb_power_alone_arms_and_revs_without_dividing_by_zero(blaster, control):
    """The pack reads 0 mV with only USB connected, and every throttle calculation divides by it -
    TBH's rev start as well as the loops."""
    b = blaster
    b.flash_preset("trifolium_v1_2", {"flywheelControl": control})
    b.set_pack(0)
    assert b.boot()
    assert b.run_ms(7000)
    assert b.command("DUMP_BOOT")["escArming"]["timedOut"] is True  # unpowered ESCs never answer
    b.press("rev")
    assert b.run_ms(500)
