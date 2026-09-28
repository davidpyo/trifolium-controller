"""Idle hold: a standing request to keep the wheels at idle with nothing pressed, set by a switch held
at power-on or by the root menu's Idle Mode row. SAFE and an open menu both stop the wheels; closing
the menu starts them again with no trigger or rev."""

import pytest
from helpers import armed_v12, close_menu, open_menu, select

from trifolium_sim import IDLE, MENU, POWER_ON_MAGIC

IDLE_HOLD_ON_REV = {"bootAction": ["bootloader", "esc_passthrough", "idle_hold", "none", "none",
                                   "none", "none", "none"]}


def power_on_holding_rev(b, overrides=None, settle_ms=3000):
    """A v1.2 with idle hold on the rev switch, powered on with rev held until the boot has read it,
    as a person would."""
    b.flash_preset("trifolium_v1_2", dict(IDLE_HOLD_ON_REV, **(overrides or {})))
    b.attach_display()
    b.press("rev")
    b.power_on()
    b.run_ms(200)
    b.release("rev")
    assert b.wait_booted(5000)
    b.run_ms(settle_ms)
    return b


def at_idle(b):
    """Both wheels turning at the shipped profile's 1000 RPM idle, give or take the open loop."""
    wheels = b.wheels()
    return all(wheels[i]["rpm"] == pytest.approx(1000, rel=0.25) for i in (1, 3))


def stopped(b):
    return all(w["rpm"] < 50 for w in b.wheels() if w["attached"])


def test_idle_hold_from_a_switch_held_at_power_on_spins_every_wheel_at_idle(blaster):
    b = power_on_holding_rev(blaster, settle_ms=5000)
    assert b.peek("idleHoldActive") is True
    assert b.command("DUMP_BOOT")["idleHold"] is True
    assert at_idle(b)
    assert b.peek("flywheelState") == IDLE


def test_without_the_switch_held_the_boot_leaves_the_wheels_still(blaster):
    b = armed_v12(blaster, IDLE_HOLD_ON_REV, settle_ms=3000)
    assert b.peek("idleHoldActive") is False
    assert b.command("DUMP_BOOT")["idleHold"] is False
    assert stopped(b)


def test_the_switch_held_through_a_menu_reboot_does_not_arm_idle_hold(blaster):
    b = blaster
    b.set_noinit(MENU, magic=POWER_ON_MAGIC)
    power_on_holding_rev(b)
    assert b.peek("idleHoldActive") is False
    assert b.command("DUMP_BOOT")["idleHold"] is False
    assert stopped(b)


def test_the_open_menu_stops_idle_hold_and_closing_it_brings_the_wheels_straight_back(blaster):
    """Back to the same throttle, not wherever the open loop's downward ratchet left it."""
    b = power_on_holding_rev(blaster)
    assert at_idle(b)
    throttle = b.escs()[1]["lastThrottle"]
    assert throttle > 0

    open_menu(b)
    b.run_ms(2000)
    assert stopped(b)
    assert b.escs()[1]["lastThrottle"] == 0

    close_menu(b)
    b.run_ms(1000)
    assert b.escs()[1]["lastThrottle"] == throttle
    assert at_idle(b)


def test_safe_keeps_the_wheels_still_under_idle_hold_even_through_a_menu_cycle(blaster):
    b = power_on_holding_rev(blaster, {"safetySwitchPin": 11})
    assert at_idle(b)

    b.press("safety")
    b.run_ms(2000)
    assert stopped(b)

    open_menu(b)
    close_menu(b)
    b.run_ms(1500)
    assert stopped(b)
    assert b.peek("idleHoldActive") is True

    b.release("safety")
    b.run_ms(1500)
    assert at_idle(b)


def test_the_idle_mode_row_starts_idle_hold_live_once_the_menu_closes(blaster):
    b = armed_v12(blaster, settle_ms=3000)
    open_menu(b)
    select(b, "Idle Mode")
    assert b.panel().highlighted == "Idle Mode: OFF"
    b.tap("menu")
    assert b.panel().highlighted == "Idle Mode: ON"
    assert b.peek("menuOpen")  # a toggle, with nothing to confirm
    b.run_ms(1000)
    assert stopped(b)

    close_menu(b)
    b.run_ms(1000)
    assert at_idle(b)
    assert b.command("DUMP_BOOT")["idleHold"] is True


def test_idle_mode_set_from_the_menu_is_gone_after_a_reboot(blaster):
    b = armed_v12(blaster, settle_ms=3000)
    open_menu(b)
    select(b, "Idle Mode")
    b.tap("menu")
    close_menu(b)
    assert b.peek("idleHoldActive") is True

    assert b.command("REBOOT")["rebooting"] is True
    assert b.run_until_reboot(2000) and b.wait_booted()
    b.run_ms(3000)
    assert b.peek("idleHoldActive") is False
    assert b.command("DUMP_BOOT")["idleHold"] is False
    assert stopped(b)


@pytest.mark.parametrize("home", ["counter", "fire_mode", "both"])
@pytest.mark.parametrize("show_rpm", [False, True])
def test_the_home_screen_says_idle_only_where_it_is_not_showing_live_rpm(blaster, home, show_rpm):
    b = power_on_holding_rev(blaster, {"homeScreenDisplayMode": home,
                                       "showCurrentRpmOnHomeScreen": show_rpm})
    lines = [line.text for line in b.panel().lines]
    assert ("IDLE" in lines) is not show_rpm, b.panel().text
