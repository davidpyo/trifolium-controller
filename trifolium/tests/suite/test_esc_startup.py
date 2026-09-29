"""ESC start-up as the v1.2 blaster's ESCs do it: each answers a fixed time after the signal first
reaches it, the same 715 ms longer on a reboot it stayed powered through, and not at all without a
pack. The firmware's own arming record has to read what the blaster's did."""

import pytest
from helpers import armed_v12

from trifolium_sim import ESC_RESTART_MS, ESC_STARTUP_MS

PACK_MV = 16400
HOLD_MS = 1500  # zero throttle held after the last ESC answers
MOTORS = (1, 3)  # a v1.2's


def arming(b):
    return b.command("DUMP_BOOT")["escArming"]


def assert_armed_after(record, extra_ms=0):
    for i in MOTORS:
        assert record["answeredAt_ms"][i] == pytest.approx(ESC_STARTUP_MS[i] + extra_ms, abs=2)
    last = max(ESC_STARTUP_MS[i] for i in MOTORS) + extra_ms
    assert record["duration_ms"] == pytest.approx(last + HOLD_MS, abs=2)
    assert record["timedOut"] is False


def test_a_pack_power_on_arms_on_the_blasters_own_timings(blaster):
    b = blaster
    b.esc_startup()
    armed_v12(b, display=False, settle_ms=4000)
    assert_armed_after(arming(b))


def test_a_reboot_adds_the_restart_to_every_esc_and_a_power_cycle_takes_it_off_again(blaster):
    b = blaster
    b.esc_startup()
    armed_v12(b, display=False, settle_ms=4000)
    assert b.command("REBOOT")["rebooting"] is True
    assert b.run_until_reboot(2000) and b.wait_booted()
    b.run_ms(5000)
    assert_armed_after(arming(b), ESC_RESTART_MS)

    b.power_cycle()
    assert b.boot(4000)
    assert_armed_after(arming(b))


def test_escs_powered_after_a_usb_boot_start_from_the_pack_and_ignore_throttle_until_then(blaster):
    b = blaster
    b.esc_startup()
    b.flash_preset("trifolium_v1_2")
    b.set_pack(0)
    assert b.boot()
    assert b.run_ms(7000)
    record = arming(b)
    assert record["timedOut"] is True
    assert record["answeredAt_ms"] == [-1, -1, -1, -1]
    assert all(w["esc"] == "unpowered" for w in b.wheels())

    b.set_pack(PACK_MV)
    b.press("rev")
    b.run_ms(ESC_STARTUP_MS[3] - 20)
    wheels = b.wheels()
    assert [wheels[i]["esc"] for i in MOTORS] == ["starting", "starting"]
    assert all(wheels[i]["throttle"] == 0 and wheels[i]["rpm"] < 100 for i in MOTORS)

    b.run_ms(150)  # motor 4's ESC up and past its wheel's start delay; motor 2's still starting
    wheels = b.wheels()
    assert wheels[3]["esc"] == "up" and wheels[3]["throttle"] > 0 and wheels[3]["rpm"] > 100
    assert wheels[1]["esc"] == "starting" and wheels[1]["throttle"] == 0
