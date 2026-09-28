"""Behaviour that lives in main.cpp's loops rather than any one module: the second control algorithm,
boot actions, the battery cutoff, pin conflicts at boot, the RPM log, a charged mode, the timeouts
and the solenoid's timing."""

import pytest
from helpers import armed_v12, close_menu, open_menu, schema

from trifolium_sim import ACCELERATING, FULLSPEED, IDLE, MENU, POWER_ON_MAGIC


def rev_once(b, wheel=1):
    """Rev from a standstill for a second, then let the wheels stop. (ms to full speed, peak RPM)"""
    b.reset_peak(wheel)
    start = b.now_ms
    b.press("rev")
    reached = b.run_until_peek("flywheelState", FULLSPEED, limit_ms=1000)
    to_full = b.now_ms - start if reached else None
    b.run_ms(max(0, 1000 - (b.now_ms - start)))
    peak = b.wheels()[wheel]["peak"]
    b.release("rev")
    b.run_ms(4000)
    assert b.wheels()[wheel]["rpm"] < 500
    return to_full, peak


def test_tbh_brings_the_wheels_to_speed_on_the_first_rev_and_every_rev_after(blaster):
    b = armed_v12(blaster, {"flywheelControl": "tbh"})
    revs = [rev_once(b) for _ in range(3)]
    print("TBH ms to full speed and peak:", revs)
    for to_full, peak in revs:
        assert to_full is not None and to_full < 500  # rampupTimeout_ms
        assert peak < 30000 * 1.10


def test_tbh_first_rev_after_boot_is_no_faster_than_every_rev_after(blaster):
    """Current behaviour: resetControl(TBH_CONTROL) never clears firstCrossing, so from the second
    rev on TBH integrates from the first tick. The ESC's current limit bounds the spin-up either
    way, so the later revs come out only a few ms sooner, with a little more overshoot."""
    b = armed_v12(blaster, {"flywheelControl": "tbh"})
    (first, first_peak), (second, second_peak) = rev_once(b), rev_once(b)
    assert second <= first
    assert second_peak > first_peak


def test_the_menu_button_held_at_power_on_reboots_into_the_bootloader(blaster):
    b = blaster
    b.flash_preset("trifolium_v1_2")
    b.press("menu")
    b.power_on()
    assert b.run_until_stopped(2000)
    assert b.last_stop == "bootloader"
    assert b.state == "bootloader"


def test_a_boot_action_never_fires_on_a_reboot_only_from_power_on(blaster):
    b = blaster
    b.flash_preset("trifolium_v1_2")
    b.set_noinit(MENU, magic=POWER_ON_MAGIC)  # what a menu reboot leaves behind
    b.press("menu")
    assert b.boot(500)
    assert b.state == "running"


def test_below_the_cutoff_the_status_led_blinks_and_above_it_holds_steady(blaster):
    b = blaster
    b.flash_preset("trifolium_v1_2", {"ledDataPin": 22})
    assert b.boot(3000)
    assert b.pin(22)["outputLevel"] is True
    assert len(b.edges(22)) == 1  # on at boot, nothing since

    b.set_pack(12400)  # 3.1 V per cell, under the 3.3 V cutoff
    b.run_ms(3000)
    toggles = len(b.edges(22)) - 1
    assert 5 <= toggles <= 7

    b.set_pack(16400)
    b.run_ms(100)
    assert b.pin(22)["outputLevel"] is True


def test_a_trigger_wired_to_an_esc_pin_is_detached_and_reported_and_the_esc_keeps_it(blaster):
    b = armed_v12(blaster, {"triggerSwitchPin": 1})
    assert b.peek("pins")["trigger"] == 255
    conflicts = b.peek("pinConflicts")
    assert conflicts["losses"] == 1
    assert conflicts["menuButtonLost"] is False
    assert b.pin(1).get("mode") != "input_pullup"  # nothing attached an input over the DShot line
    assert b.wheels()[1]["attached"]

    reported = schema(b)["pinConflicts"]
    assert reported == [{"field": "triggerSwitchPin", "pin": 1, "against": "esc2",
                         "action": "pinCleared"}]


def test_a_menu_button_that_collides_with_a_higher_priority_input_is_lost_and_says_so(blaster):
    b = blaster
    b.flash_preset("trifolium_v1_2", {"menuButtonPin": 21})  # the trigger's pin
    assert b.boot(100)
    assert b.peek("pins")["menuButton"] == 255
    assert b.peek("pinConflicts")["menuButtonLost"] is True
    assert "the on-device menu cannot be opened" in b.transcript


def test_an_rpm_log_captures_the_rev_then_prints_it_and_reboots(blaster):
    b = armed_v12(blaster, {"useRpmLogging": True, "rpmLogLength": 150}, display=False)
    mark = len(b.transcript)
    b.press("rev")
    assert b.run_until_stopped(3000)
    assert b.last_stop == "reboot"

    log = b.transcript[mark:]
    header = log.find("Voltage_mv,Motor 1,TargetRPM 1,Throttle 1,value 1,Motor 3,")
    assert header >= 0
    rows = log[log.find("\n", header) + 1:].splitlines()[:150]
    rpms = [int(row.split(",")[1]) for row in rows]
    assert len(rpms) == 150
    assert rpms[-1] > rpms[0] + 10000  # 150 ms of a spin-up


def test_plasma_through_the_real_loop_the_wheels_follow_the_charge_and_release_fires_the_slots(blaster):
    b = blaster
    b.flash_preset("trifolium_v1_2")
    b.flash_profile(1, {"schemaVersion": 2, "activeModeCount": 1, "defaultFiringMode": 0,
                        "switchPositionAssignment": [0, 0, 0],
                        "fireModes": [{"burstMode": "plasma", "burstLength": 1, "targetDPS": 15}]})
    b.attach_display()
    assert b.boot(2500)

    b.press("trigger")
    b.run_ms(600)
    charging = b.wheels()[1]["rpm"]
    b.run_ms(1400)  # READY at 1646 ms
    ready = b.wheels()[1]["rpm"]
    b.run_ms(400)  # the second slot arms at 2346 ms
    b.release("trigger")
    b.run_ms(1500)

    assert 30000 * 0.2 < charging < 30000 * 0.9
    assert ready == pytest.approx(30000, rel=0.03)
    assert len(b.extends()) == 2


def test_a_wheel_that_cannot_reach_firing_speed_aborts_the_rev_inside_rampup_timeout(blaster):
    b = blaster
    b.wheel(3, loaded=0.5)  # tops out near 26k RPM on this pack: short of 29.5k
    armed_v12(b)
    b.press("select2")
    b.run_ms(100)
    b.tap("trigger")

    seen = set()

    def aborted():
        state = b.peek("flywheelState")
        seen.add(state)
        return ACCELERATING in seen and state == IDLE

    assert b.run_until(aborted, 700)
    b.run_ms(1000)
    assert b.extends() == []  # no dart fired into wheels that are not at speed
    motors = b.peek("motors")
    assert motors[1]["targetRPM"] == 0 and motors[3]["targetRPM"] == 0


def test_rev_safety_timeout_spins_the_wheels_down_under_a_held_rev_until_it_is_released(blaster):
    b = blaster
    b.flash_profile(1, {"schemaVersion": 2, "revSafetyTimeout_ms": 2000})
    armed_v12(b)

    b.press("rev")
    b.run_ms(1500)
    assert b.peek("flywheelState") == FULLSPEED
    b.run_ms(1000)  # past 2 s held without a shot
    assert b.peek("flywheelState") == IDLE
    b.run_ms(3000)
    assert b.wheels()[1]["rpm"] < 1000  # still held, still down: the timeout latches

    b.release("rev")
    b.run_ms(100)
    b.press("rev")
    assert b.run_until_peek("flywheelState", FULLSPEED, limit_ms=600)


def test_an_esc_that_never_answers_is_armed_blind_when_the_arming_timeout_runs_out(blaster):
    b = blaster
    b.wheel(3, replies=False)
    armed_v12(b, settle_ms=7000)
    arming = b.command("DUMP_BOOT")["escArming"]
    assert arming["ran"] is True
    assert arming["timedOut"] is True
    assert arming["answeredAt_ms"][1] >= 0
    assert arming["answeredAt_ms"][3] == -1
    assert arming["duration_ms"] >= 6000


@pytest.mark.parametrize("pack_mv, extend_ms", [(16400, 27), (14000, 35)])
def test_the_solenoid_extends_longer_as_the_pack_sags(blaster, pack_mv, extend_ms):
    """Defaults: 25 ms extend at 16.8 V, 40 ms at 11.8 V, and a straight line between."""
    b = blaster
    b.set_pack(pack_mv)
    armed_v12(b, display=False)
    b.press("select2")
    b.run_ms(100)
    b.tap("trigger")
    b.run_ms(1000)
    gate = b.edges(24)
    assert len(gate) >= 3  # low at boot, then the extend and the retract
    assert (gate[2][0] - gate[1][0]) / 1000 == pytest.approx(extend_ms, rel=0.1)


def test_a_button_selected_firing_mode_survives_a_power_cycle(blaster):
    b = armed_v12(blaster, {"selectFireType": "button"}, display=False)
    before = b.peek("firingMode")
    b.tap("select0", hold_ms=80)
    b.run_ms(3000)  # past the settle time, with the wheels stopped
    assert b.peek("firingMode") == (before + 1) % 3

    b.power_cycle()
    assert b.boot(500)
    assert b.peek("firingMode") == (before + 1) % 3


def test_a_mode_picked_on_the_screen_survives_a_power_cycle(blaster):
    b = armed_v12(blaster, {"selectFireType": "screen"}, settle_ms=3000)
    assert b.peek("firingMode") == 1
    open_menu(b)
    b.tap("menu")  # Firing Mode, highlighted as the menu opens
    b.tap("rev")
    b.tap("menu")
    assert b.panel().highlighted == "Firing Mode: SEMI"
    close_menu(b)
    b.run_ms(3000)
    assert b.peek("firingMode") == 2

    b.power_cycle()
    assert b.boot(500)
    assert b.peek("firingMode") == 2


def test_with_a_selector_switch_the_mode_at_boot_is_the_switchs_not_the_last_one_used(blaster):
    b = armed_v12(blaster, display=False)  # positions [AUTO, BINARY, SEMI], BINARY with none
    b.press("select2")
    b.run_ms(3000)
    assert b.peek("firingMode") == 2

    b.power_cycle()
    b.release("select2")
    assert b.boot(500)
    assert b.peek("firingMode") == 1

    b.power_cycle()
    b.press("select0")
    assert b.boot(500)
    assert b.peek("firingMode") == 0
