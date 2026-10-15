"""The pack as the firmware reads it, through a divider that reads far below it for tens of seconds
after power-on. Measured once, on a v1.2: 3.3 V at 7.1 s against a real 13.2 V. RISE_MS is the
first-order time constant that one reading fits; the wheels have the whole pack from the start."""

import pytest
from helpers import armed_v12
from test_idle_hold import power_on_holding_rev

from trifolium_sim import FULLSPEED, IDLE

PACK_MV = 16400
RISE_MS = 24000
QUICK_RISE_MS = 5000  # still under the cutoff at 2 s, over it by 9 s: the same story, sooner
CUTOFF_MV = 4 * 3300  # the shipped 4S cutoff, which throttleReferenceVoltage_mv() floors at
TARGET = 30000
IDLE_RPM = 1000


def test_the_divider_climbs_from_power_on_stays_charged_through_a_reboot_and_starts_again_after_power(
        blaster):
    b = blaster
    b.set_pack(PACK_MV, rise_ms=QUICK_RISE_MS)
    armed_v12(b, display=False, settle_ms=0)
    assert b.peek("battery")["mv"] < PACK_MV * 0.3

    b.run_ms(20000)
    assert b.command("REBOOT")["rebooting"] is True
    assert b.run_until_reboot(2000) and b.wait_booted()
    assert b.peek("battery")["mv"] > PACK_MV * 0.95

    b.power_cycle()
    assert b.boot()
    assert b.peek("battery")["mv"] < PACK_MV * 0.3


def test_the_idle_kicked_at_power_on_stays_near_idle_while_the_divider_reads_low(blaster):
    """The kick divides by the reading, which is floored at the cutoff: at most pack / cutoff over,
    where the raw reading would ask for full throttle."""
    b = blaster
    b.set_pack(PACK_MV, rise_ms=RISE_MS)
    power_on_holding_rev(b, settle_ms=0)
    b.reset_peak(1)
    b.run_ms(5000)
    assert b.peek("idleHoldActive") is True
    assert IDLE_RPM * 0.5 < b.wheels()[1]["peak"] < IDLE_RPM * PACK_MV / CUTOFF_MV * 1.1


def test_a_rev_while_the_divider_reads_low_reaches_speed_without_running_away(blaster):
    b = blaster
    b.set_pack(PACK_MV, rise_ms=RISE_MS)
    armed_v12(b, display=False)
    assert b.peek("battery")["mv"] < CUTOFF_MV
    b.reset_peak(1)
    b.press("rev")
    assert b.run_until(lambda: b.peek("motors")[1]["motorRPM"] >= TARGET - 500, 500)
    b.run_ms(1500)
    assert b.wheels()[1]["peak"] < TARGET * 1.05
    assert b.wheels()[1]["rpm"] == pytest.approx(TARGET, rel=0.01)


def test_with_nothing_reading_the_pack_it_is_taken_as_3_5_v_a_cell_and_never_cut_or_warned(blaster):
    """A board with no divider: the firmware works from 3.5 V a cell - under the 3.7 V warning - and
    skips the cutoff and the warning altogether. It fires, and nothing will stop it running a pack
    flat either."""
    b = blaster
    armed_v12(b, {"batteryAdcPin": 255, "escEnablePin": 22, "ledDataPin": 20,
                  "ledWarningMode": "warn_batt"}, display=False)
    assert b.peek("battery") == {"defined": False, "mv": 4 * 3500}
    armed_at = b.uptime_us
    b.press("trigger")
    assert b.run_until(lambda: len(b.extends()) >= 1, 1500)
    b.release("trigger")
    b.run_ms(3000)
    assert b.pin(22)["outputLevel"] is True  # the ESCs were never cut
    assert len(b.edges(20, armed_at)) <= 1  # the LED came on, at most, and never blinked


def test_a_divider_still_rising_at_boot_does_not_cut_the_escs_for_the_session(blaster):
    b = blaster
    b.esc_startup()
    b.set_pack(PACK_MV, rise_ms=QUICK_RISE_MS)
    armed_v12(b, {"escEnablePin": 22}, display=False)
    b.run_ms(15000)
    assert b.peek("battery")["mv"] > CUTOFF_MV
    assert b.pin(22)["outputLevel"] is True


FLAT_MV = 12400  # 3.1 V a cell, under the 3.3 V cutoff
RESTED_MV = 13600  # what a flat pack reads back at with the load off


def wheels_stopped(b):
    return all(m["targetRPM"] == 0 for m in b.peek("motors") if m["enabled"])


def test_a_flat_pack_at_rest_refuses_rev_and_fire_cuts_the_escs_and_stays_flat_until_restart(
        blaster):
    b = armed_v12(blaster, {"escEnablePin": 22}, display=False)
    b.set_pack(FLAT_MV)
    b.run_ms(900)
    assert b.peek("batteryFlat") is False  # under the line, but not yet for a second
    b.run_ms(200)
    assert b.peek("batteryFlat") is True
    assert b.pin(22)["outputLevel"] is False

    b.set_pack(RESTED_MV)
    fired = len(b.extends())
    b.press("rev")
    b.press("trigger")
    b.run_ms(1000)
    assert b.peek("flywheelState") == IDLE
    assert wheels_stopped(b)
    assert len(b.extends()) == fired
    assert b.peek("batteryFlat") is True
    b.release("trigger")
    b.release("rev")

    assert b.command("REBOOT")["rebooting"] is True
    assert b.run_until_reboot(2000) and b.wait_booted()
    b.run_ms(2500)
    assert b.peek("batteryFlat") is False
    assert b.pin(22)["outputLevel"] is True
    b.press("rev")
    assert b.run_until_peek("flywheelState", FULLSPEED, limit_ms=600)


def test_a_rev_and_its_dwell_are_never_judged_and_the_second_starts_as_the_wheels_coast(blaster):
    """The pack reads under the line from mid-rev on. It is judged from the moment the dwell lets
    the wheels coast, and flat a second after that - however long the rev and dwell took. ESC
    Enable waits for the wheels to stop."""
    b = armed_v12(blaster, {"escEnablePin": 22}, display=False)
    b.press("rev")
    assert b.run_until_peek("flywheelState", FULLSPEED, limit_ms=600)
    b.set_pack(FLAT_MV)
    b.run_ms(1500)
    assert b.peek("flywheelState") == FULLSPEED
    b.tap("trigger")
    b.release("rev")
    assert b.run_until(lambda: b.peek("motors")[1]["targetRPM"] < TARGET, 2000)  # coasting
    assert b.peek("batteryFlat") is False

    b.run_ms(900)
    assert b.peek("batteryFlat") is False
    assert b.run_until_peek("batteryFlat", True, limit_ms=200)
    if not wheels_stopped(b):
        assert b.pin(22)["outputLevel"] is True
    assert b.run_until(lambda: wheels_stopped(b), 5000)
    b.run_ms(10)
    assert b.pin(22)["outputLevel"] is False


def test_sag_under_the_cutoff_that_recovers_after_a_rev_never_trips_it_or_refuses_a_follow_up_rev(
        blaster):
    """In every RPM capture on the v1.2 the reading is back at rest within 16 ms of a rev ending. Here
    it stays under the cutoff for 500 ms of coasting, through a second rev, and for 100 ms of the
    ramp after that: none of it may trip the cutoff."""
    b = armed_v12(blaster, {"escEnablePin": 22}, display=False)

    def ramping_down():
        return b.run_until(lambda: b.peek("motors")[1]["targetRPM"] < TARGET, 2000)

    b.press("rev")
    assert b.run_until_peek("flywheelState", FULLSPEED, limit_ms=600)
    b.set_pack(FLAT_MV)  # sagging under the cutoff under load
    b.tap("trigger")
    b.release("rev")
    assert ramping_down()

    b.run_ms(500)  # coasting on a reading still sagged
    b.press("rev")
    assert b.run_until_peek("flywheelState", FULLSPEED, limit_ms=600)
    b.release("rev")
    assert ramping_down()

    b.run_ms(100)
    b.set_pack(PACK_MV)  # the load is off and the pack is back
    b.run_ms(2000)
    assert b.peek("batteryFlat") is False
    assert b.pin(22)["outputLevel"] is True
    b.press("rev")
    assert b.run_until_peek("flywheelState", FULLSPEED, limit_ms=600)


def test_idle_hold_is_judged_and_a_flat_pack_takes_the_idle_away(blaster):
    """Without this a blaster left idling would never be judged, and would run its pack flat."""
    b = power_on_holding_rev(blaster, {"escEnablePin": 22})
    assert b.peek("motors")[1]["targetRPM"] == IDLE_RPM
    assert b.pin(22)["outputLevel"] is True
    b.set_pack(FLAT_MV)
    b.run_ms(900)
    assert b.peek("batteryFlat") is False
    assert b.run_until_peek("batteryFlat", True, limit_ms=200)
    assert b.peek("motors")[1]["targetRPM"] > 0
    assert b.pin(22)["outputLevel"] is True  # the ESCs bring the wheels down from idle first
    assert b.run_until(lambda: wheels_stopped(b), 3000)
    b.run_ms(10)
    assert b.pin(22)["outputLevel"] is False
    b.run_ms(1000)
    assert wheels_stopped(b)  # idle hold does not bring them back


def test_the_idle_switch_gets_no_idle_from_a_flat_pack(blaster):
    b = armed_v12(blaster, {"idleSwitchPin": 11}, display=False)
    b.press("idle")
    assert b.run_until(lambda: b.peek("motors")[1]["targetRPM"] == IDLE_RPM, 500)
    b.set_pack(FLAT_MV)
    b.run_ms(1100)
    assert b.peek("batteryFlat") is True
    assert b.run_until(lambda: wheels_stopped(b), 3000)
    b.release("idle")
    b.press("idle")
    b.run_ms(1000)
    assert wheels_stopped(b)
