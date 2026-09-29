"""The flywheel control loops through the real fwControlLoop(): PID, TBH and open loop, the EMA filter
and the ESC telemetry they read, against the simulated wheels. Response numbers - time to speed,
overshoot - are pinned to SimFlywheel, not to a blaster."""

import pytest
from helpers import armed_v12

from trifolium_sim import IDLE

TARGET = 30000


def motor(b, index=1):
    return b.peek("motors")[index]


def test_pid_reaches_firing_speed_inside_the_default_500_ms_rampup_timeout(blaster):
    b = armed_v12(blaster, display=False)
    start = b.now_ms
    b.press("rev")
    assert b.run_until(lambda: motor(b)["motorRPM"] >= TARGET - 500, 500)  # firingRPMTolerance
    print("PID from rest to within 500 RPM:", b.now_ms - start, "ms")
    assert b.now_ms - start < 400


def test_pid_settles_on_target_and_overshoots_it_by_less_than_one_and_a_half_percent(blaster):
    b = armed_v12(blaster, display=False)
    b.reset_peak(1)
    b.press("rev")
    b.run_ms(2000)
    wheel = b.wheels()[1]
    print("peak", wheel["peak"], "settled", wheel["rpm"])
    assert wheel["peak"] < TARGET * 1.015
    assert wheel["rpm"] == pytest.approx(TARGET, rel=0.01)
    assert motor(b)["motorRPM"] == pytest.approx(TARGET, rel=0.01)


def test_pid_holds_the_integral_at_zero_until_the_first_crossing(blaster):
    b = armed_v12(blaster, display=False)
    b.press("rev")
    for _ in range(1000):
        b.run_ms(1)
        m = motor(b)
        if m["firstCrossing"]:
            return
        assert m["PIDIntegral"] == 0 and m["iTerm"] == 0, m
    pytest.fail("no first crossing within a second of rev")


def test_pid_stale_telemetry_mid_ramp_does_not_count_as_settling(blaster):
    """Without the PIDErrorPrior != PIDError clause, a tick with no new eRPM frame repeats the last
    error exactly, which reads as settled and starts the integral mid-ramp."""
    b = blaster
    b.wheel(1, replyEvery=5)
    armed_v12(b, display=False)
    b.press("rev")
    for _ in range(2000):
        b.run_ms(1)
        m = motor(b)
        if m["motorRPM"] >= TARGET * 0.9:
            return
        assert not m["firstCrossing"], f"first crossing at {m['motorRPM']} RPM on a ramp to {TARGET}"
    pytest.fail("never reached 90% of target with every fifth frame answered")


def test_the_throttle_never_leaves_0_to_1999_and_saturates_on_a_target_past_the_pack(blaster):
    b = blaster
    b.flash_profile(1, {"schemaVersion": 2, "revRPM": [45000, 45000, 45000, 45000]})
    armed_v12(b, display=False)
    b.press("rev")
    seen = []
    for _ in range(300):
        b.run_ms(2)
        seen.append(b.escs()[1]["lastThrottle"])
    assert max(seen) == 1999  # 45k RPM is past what 4S at 3200 kV reaches
    b.release("rev")
    b.run_ms(3000)
    assert b.escs()[1]["lastThrottle"] == 0


def test_open_loop_spin_down_only_ever_lowers_the_throttle(blaster):
    b = armed_v12(blaster, display=False)
    b.press("rev")
    b.run_ms(800)
    b.release("rev")
    b.run_ms(1100)  # past the dwell, into the spin-down
    assert b.peek("flywheelState") == IDLE
    last = b.escs()[1]["lastThrottle"]
    for _ in range(300):
        b.run_ms(2)
        now = b.escs()[1]["lastThrottle"]
        assert now <= last
        last = now


def test_the_ema_ignores_an_impossible_reading(blaster):
    b = armed_v12(blaster, display=False)
    b.press("rev")
    b.run_ms(1500)
    before = motor(b)["motorRPM"]
    # 4S at 3200 kV cannot turn past ~53.8k RPM, so 90k is a bad frame, not a reading.
    b.esc_reply(1, erpm=90000 * 7)
    b.run_ms(3)
    assert motor(b)["motorRPM"] == pytest.approx(before, abs=300)


def test_a_corrupt_frame_holds_the_filtered_reading(blaster):
    b = armed_v12(blaster, display=False)
    b.press("rev")
    b.run_ms(1500)
    before = motor(b)["motorRPM"]
    b.esc_reply(1, corrupt=True)
    b.run_ms(2)
    assert motor(b)["motorRPM"] == pytest.approx(before, abs=300)


def test_an_extended_telemetry_frame_fills_the_esc_dashboard_and_leaves_rpm_alone(blaster):
    b = armed_v12(blaster, display=False)
    b.press("rev")
    b.run_ms(1500)
    before = motor(b)
    assert not before["tempSeen"]
    b.esc_reply(1, edt="temperature", value=47)
    b.run_ms(2)
    b.esc_reply(1, edt="voltage", value=66)
    b.run_ms(2)
    after = motor(b)
    assert after["tempSeen"] and after["tempRaw"] == 47
    assert after["voltageSeen"] and after["voltageRaw"] == 66
    assert after["motorRPM"] == pytest.approx(before["motorRPM"], abs=300)
    assert b.command("DUMP_MOTORS")["motors"][1]["edtSeen"] == {"v": True, "i": False, "t": True}


def test_an_esc_that_answers_shows_erpm_seen_and_one_that_never_does_does_not(blaster):
    b = blaster
    b.wheel(3, replies=False)
    armed_v12(b, display=False, settle_ms=7000)
    motors = b.command("DUMP_MOTORS")["motors"]
    assert motors[1]["erpmSeen"] is True
    assert motors[3]["erpmSeen"] is False


def lost(b, pins=(1, 3)):
    escs = b.escs()
    return {pin: {k: escs[pin][k] for k in ("framesCut", "repliesAborted", "repliesFifoFull")}
            for pin in pins}


@pytest.mark.parametrize("control", ["pid", "tbh"])
@pytest.mark.parametrize("dshot", ["dshot300", "dshot600", "dshot1200"])
def test_the_control_loop_gives_every_reply_time_to_land_and_reads_each_one(blaster, dshot, control):
    """A frame offered before the last one's reply has landed - 140 us at DShot300 - jumps the PIO
    back to transmit and loses that reply. Through arming, the extended-telemetry requests, a rev,
    fire and the spindown, each ESC gets one frame a tick, and once armed the loop reads every reply
    before four pile up in the FIFO."""
    b = armed_v12(blaster, {"dshotMode": dshot, "flywheelControl": control}, display=False)
    assert all(e["speed"] == int(dshot[5:]) for e in b.escs().values())
    armed = lost(b)
    assert all(v["framesCut"] == 0 and v["repliesAborted"] == 0 for v in armed.values()), armed

    b.press("rev")
    assert b.run_until(lambda: motor(b)["motorRPM"] >= TARGET - 500, 1000)
    b.press("trigger")
    b.run_ms(500)
    b.release("trigger")
    b.release("rev")
    b.run_ms(3000)
    assert lost(b) == armed
    assert b.peek("flywheelState") == IDLE


def test_tbh_never_commands_past_1999_however_large_the_error(blaster):
    b = blaster
    b.flash_profile(1, {"schemaVersion": 2, "revRPM": [45000, 45000, 45000, 45000]})
    armed_v12(b, {"flywheelControl": "tbh"}, display=False)
    b.press("rev")
    for _ in range(200):
        b.run_ms(2)
        assert b.escs()[1]["lastThrottle"] <= 1999
