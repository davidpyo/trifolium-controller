"""The first push of each trigger press waits for every wheel to be back above its at-speed point,
as the spin-up did, so a press made while the wheels are still recovering from the last dart waits
for them. The pushes within a burst keep their rhythm, and a press the wheels can't get back to
speed for is dropped after the Rampup Timeout."""

from trifolium_sim import FULLSPEED

LOSS_RPM = 12000  # a dart that takes the wheels well below their at-speed point
SLOW_RPM_PER_S = 40000  # wheels that take 300 ms to win that back, longer than a pusher cycle


def heavy_darts(b):
    b.darts(loss_rpm=LOSS_RPM)
    for i in range(4):
        b.wheel(i, maxAccel=SLOW_RPM_PER_S)


def one_mode(b, mode, device=None, **fields):
    """A v1.2 whose only fire mode is `mode`, with no Target DPS spacing, booted and armed."""
    fire = {"burstMode": mode, "burstLength": 1, "targetDPS": 0, "reversible": False,
            "binaryTriggerTimeout_ms": 2000, "includeInCycle": True}
    fire.update(fields)
    b.flash_preset("trifolium_v1_2", device)
    b.flash_profile(1, {"schemaVersion": 2, "activeModeCount": 1, "defaultFiringMode": 0,
                        "switchPositionAssignment": [0, 0, 0], "fireModes": [fire]})
    assert b.boot(2500)
    return b


def revved(b):
    b.press("rev")
    assert b.run_until_peek("flywheelState", FULLSPEED, limit_ms=2000)
    b.run_ms(1500)
    return b


def motor(b):
    return b.peek("motors")[1]  # motor 2, enabled on a v1.2


def at_speed(b):
    return motor(b)["targetRPM"] - b.wiring()["firingRPMTolerance"]


def push(b, n):
    assert b.run_until(lambda: len(b.extends()) >= n, 1000)


def test_a_second_press_while_the_wheels_recover_waits_for_them(blaster):
    b = revved(one_mode(blaster, "semi"))
    heavy_darts(b)
    b.press("trigger")
    push(b, 1)
    b.release("trigger")
    b.run_ms(25)  # the dart is through, and the wheels well down
    assert motor(b)["motorRPM"] < at_speed(b)
    pressed_at = b.now_ms
    b.press("trigger")
    push(b, 2)
    assert b.now_ms - pressed_at > 100
    assert motor(b)["motorRPM"] > at_speed(b) - 100


def test_shots_within_a_burst_keep_their_rhythm_while_the_wheels_sag(blaster):
    b = revved(one_mode(blaster, "auto", burstLength=5))
    heavy_darts(b)
    b.press("trigger")
    readings = []
    for n in range(1, 6):
        push(b, n)
        readings.append(motor(b)["motorRPM"])
    extends = b.extends()
    gaps = [later - earlier for earlier, later in zip(extends, extends[1:])]
    assert max(gaps) - min(gaps) < 2000, gaps  # µs
    assert min(readings[1:]) < at_speed(b), readings  # it pushed with the wheels still down


def test_a_press_the_wheels_cannot_get_back_to_speed_for_is_dropped_after_the_rampup_timeout(
        blaster):
    b = revved(one_mode(blaster, "semi", device={"printTelemetry": True}))
    for i in range(4):
        b.wheel(i, loaded=0.5)  # half the speed they had: below the at-speed point for good
    b.run_ms(300)
    assert motor(b)["motorRPM"] < at_speed(b)
    start = len(b.transcript)
    b.press("trigger")
    b.run_ms(400)
    assert b.extends() == []
    assert b.peek("shotsToFire") == 1  # still waiting, inside the 500 ms timeout
    b.run_ms(300)
    assert b.extends() == []
    assert b.peek("shotsToFire") == 0
    log = b.transcript[start:]
    assert "failed to reach target speed" in log
    assert "Dropping 1 queued shots" in log
