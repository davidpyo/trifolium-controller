"""A speed pot on an ADC pin sets the rev RPM in place of the profile's own: stage 1 between Pot Min
and Pot Max RPM across its travel, stage 2 at the profile's ratio of that, each kept between what
the at-speed check can pass and what the motor can reach. What it sets is stored with the profile
once the pot has held still for a second and the wheels have stopped."""

import json

import pytest

from helpers import keyed_nodes, schema

from trifolium_sim import FULLSPEED

POT = 27  # free on a v1.2: the pusher gate moved to 24
PROFILE = {"schemaVersion": 2, "revRPM": [30000, 30000, 30000, 20000]}  # motors 2 and 4 are on
STAGE2_MOTOR4 = {"motorConfig": [{}, {}, {}, {"stage": "stage2"}]}
CEILING = 3200 * 16800 // 1000 - 4 * 3200 // 2  # a 3200 Kv motor on the v1.2's default 4S


def potted(b, fraction, device=None, profile=None):
    """A v1.2 with a pot on GPIO 27 turned `fraction` of its travel, stage 1 running 10000 to 30000
    RPM across it, booted and armed. Motors 2 and 4 are the enabled ones."""
    wiring = {"speedPotPin": POT, "variableFPS": False, "speedPotMinRPM": 10000,
              "speedPotMaxRPM": 30000, "minFiringRPM": 5000, "firingRPMTolerance": 500}
    wiring.update(device or {})
    b.flash_preset("trifolium_v1_2", wiring)
    b.flash_profile(0, {**PROFILE, **(profile or {})})
    if fraction is not None:
        b.pot(fraction)
    assert b.boot(2500)
    return b


def revs(b):
    """Motors 2 and 4's rev targets."""
    motors = b.command("DUMP_MOTORS")["motors"]
    return [motors[1]["revRPM"], motors[3]["revRPM"]]


def stored_revs(b):
    stored = b.flash_json("/profile0.cfg")["revRPM"]
    return [stored[1], stored[3]]


def test_with_no_pot_wired_the_rev_targets_are_the_profile_rpm(blaster):
    b = potted(blaster, None, {"speedPotPin": 255})
    assert b.command("DUMP_MOTORS")["speedPot"] is None
    assert revs(b) == [30000, 20000]


@pytest.mark.parametrize("fraction, rpm", [(1.0, 30000), (0.0, 10000)])
def test_the_pot_at_each_end_of_its_travel_revs_stage_1_at_pot_max_and_pot_min(
        blaster, fraction, rpm):
    b = potted(blaster, fraction)
    assert b.command("DUMP_MOTORS")["speedPot"] == rpm
    assert revs(b) == [rpm, rpm]


def test_the_pot_between_its_ends_sets_an_rpm_in_proportion(blaster):
    b = potted(blaster, 0.5)
    assert revs(b)[0] == pytest.approx(20000, rel=0.01)


def test_stage_2_runs_at_the_profile_ratio_of_stage_1(blaster):
    b = potted(blaster, 0.0, STAGE2_MOTOR4, {"speedPotStage2Ratio": 1.2})
    assert revs(b) == [10000, 12000]


def test_a_reversed_pot_revs_fastest_at_its_grounded_end(blaster):
    b = potted(blaster, 0.0, {"speedPotReversed": True})
    assert revs(b) == [30000, 30000]


def test_the_pot_never_takes_a_target_below_what_can_fire_and_the_wheels_reach_speed(blaster):
    b = potted(blaster, 0.0, {"minFiringRPM": 18000})
    assert revs(b) == [18500, 18500]
    b.press("rev")
    assert b.run_until_peek("flywheelState", FULLSPEED, limit_ms=2000)


@pytest.mark.parametrize("fraction, rpm", [(0.0, 19000), (1.0, 30000)])
def test_a_wide_tolerance_keeps_the_pot_floor_only_1000_above_min_firing_rpm(blaster, fraction, rpm):
    b = potted(blaster, fraction, {"minFiringRPM": 18000, "firingRPMTolerance": 15000})
    assert revs(b) == [rpm, rpm]
    b.press("rev")
    assert b.run_until_peek("flywheelState", FULLSPEED, limit_ms=2000)


def test_a_stage_2_ratio_never_takes_a_target_past_what_the_motor_can_reach(blaster):
    b = potted(blaster, 1.0, {**STAGE2_MOTOR4, "speedPotMaxRPM": 40000},
               {"speedPotStage2Ratio": 2.0})
    assert revs(b) == [40000, CEILING]


def test_turning_the_pot_while_revved_moves_the_target_the_wheels_hold(blaster):
    b = potted(blaster, 1.0)
    b.press("rev")
    assert b.run_until_peek("flywheelState", FULLSPEED, limit_ms=2000)
    assert b.peek("motors")[1]["targetRPM"] == 30000
    b.pot(0.0)
    b.run_ms(100)
    assert b.peek("motors")[1]["targetRPM"] == 10000


def test_a_reading_jittering_by_a_few_counts_leaves_the_target_where_it_is(blaster):
    b = potted(blaster, None)
    b.analog(POT, 600)
    b.run_ms(200)
    seen = set()
    for i in range(60):
        b.analog(POT, 600 + (4, -4, 2, -3)[i % 4])
        b.run_ms(3)
        seen.add(tuple(revs(b)))
    assert len(seen) == 1


def test_idle_rpm_is_not_set_by_the_pot(blaster):
    b = potted(blaster, 0.0, profile={"idleRPM": [8000] * 4, "dwellTime_ms": 0,
                                      "idleTime_ms": 5000})
    b.press("rev")
    assert b.run_until_peek("flywheelState", FULLSPEED, limit_ms=2000)
    b.release("rev")
    b.run_ms(2000)
    assert b.peek("motors")[1]["targetRPM"] == 8000


def test_plasma_charges_toward_the_rev_rpm_the_pot_sets(blaster):
    fire = {"burstMode": "plasma", "burstLength": 1, "targetDPS": 15, "reversible": False,
            "binaryTriggerTimeout_ms": 2000, "includeInCycle": True}
    b = potted(blaster, 0.5, profile={"activeModeCount": 1, "defaultFiringMode": 0,
                                      "fireModes": [fire]})
    b.press("trigger")
    b.run_ms(200)
    motor = b.peek("motors")[1]
    scale = b.peek("rpmScale")
    assert 0 < scale < 1
    assert motor["revRPM"] == pytest.approx(20000, rel=0.01)
    assert motor["targetRPM"] == pytest.approx(motor["revRPM"] * scale, abs=2)


def test_what_the_pot_sets_is_stored_a_second_after_it_settles(blaster):
    b = potted(blaster, 1.0)
    assert stored_revs(b) == [30000, 30000]
    b.pot(0.0)
    b.run_ms(600)
    assert stored_revs(b) == [30000, 30000]
    b.run_ms(1000)
    assert stored_revs(b) == [10000, 10000]


def test_what_the_pot_sets_while_the_wheels_spin_is_stored_once_they_stop(blaster):
    b = potted(blaster, 1.0, profile={"dwellTime_ms": 0})
    b.press("rev")
    assert b.run_until_peek("flywheelState", FULLSPEED, limit_ms=2000)
    b.pot(0.0)
    b.run_ms(2000)
    assert stored_revs(b) == [30000, 30000]
    b.release("rev")
    b.run_ms(3000)
    assert stored_revs(b) == [10000, 10000]


def rewire(b, pin):
    ack = b.command("LOAD_DEVICE\n" + json.dumps({"schemaVersion": 3, "speedPotPin": pin}))
    assert ack and ack["ok"], ack
    assert b.run_until_reboot(2000) and b.wait_booted()
    b.run_ms(500)


def test_unwiring_the_pot_keeps_what_it_last_stored_and_wiring_it_again_follows_it(blaster):
    b = potted(blaster, 0.0)
    assert stored_revs(b) == [10000, 10000]
    rewire(b, 255)
    assert b.command("DUMP_MOTORS")["speedPot"] is None
    assert revs(b) == [10000, 10000]
    b.pot(1.0)  # turned while nothing reads it
    rewire(b, POT)
    assert revs(b) == [30000, 30000]


def test_the_pack_voltage_leaves_the_pot_where_it_is(blaster):
    b = potted(blaster, 1.0)
    b.set_pack(14000)
    b.run_ms(200)
    assert revs(b) == [30000, 30000]


def test_a_pot_left_alone_reads_its_lowest_on_a_pin_that_read_the_pack_before_it_was_wired(blaster):
    """Until the wiring names a pot, every ADC pin carries the pack's reading. None of it is left on
    the pot's pin once one does - at the first boot, or after a reboot that wires it."""
    b = blaster
    b.set_pack(14000)  # nothing on flash yet, so on GPIO 27 too
    potted(b, None)
    assert revs(b) == [10000, 10000]
    rewire(b, 255)
    rewire(b, POT)
    assert revs(b) == [10000, 10000]


def test_a_pot_on_a_pin_with_no_adc_channel_is_cleared_and_reported(blaster):
    b = potted(blaster, None, {"speedPotPin": 11})
    assert b.peek("pins")["speedPot"] == 255
    assert schema(b)["pinConflicts"] == [{"field": "speedPotPin", "pin": 11,
                                          "against": "notAnAdcPin", "action": "pinCleared"}]
    assert revs(b) == [30000, 20000]
    assert b.flash_json("/device.cfg")["speedPotPin"] == 11


def test_a_pot_on_the_battery_divider_pin_gives_way_to_the_battery(blaster):
    b = potted(blaster, None, {"speedPotPin": 28})
    assert b.peek("pins")["speedPot"] == 255
    assert b.peek("pins")["batteryAdc"] == 28
    assert schema(b)["pinConflicts"] == [{"field": "speedPotPin", "pin": 28,
                                          "against": "batteryAdcPin", "action": "pinCleared"}]


def groups(tree, found=None):
    """Every group node, by its label."""
    found = {} if found is None else found
    for node in tree:
        if node.get("kind") == "group":
            found.setdefault(node["label"], node)
        groups(node.get("children", []), found)
    return found


@pytest.mark.parametrize("pin, wired", [(POT, True), (255, False)])
def test_a_wired_pot_shows_its_settings_in_place_of_the_rev_rpm_rows(blaster, pin, wired):
    b = potted(blaster, None, {"speedPotPin": pin})
    tree = schema(b)["tree"]
    nodes = keyed_nodes(tree)
    for key in ("device:speedPotMinRPM", "device:speedPotMaxRPM", "device:speedPotReversed",
                "profile:speedPotStage2Ratio"):
        assert nodes[key].get("visible", True) is wired, key
    assert groups(tree)["Per Stage RPM"].get("visible", True) is not wired
    assert "device:speedPotReversed" in keyed_nodes(groups(tree)["Wiring"]["children"])
    assert groups(tree)["Idle RPM (Stage)"].get("visible", True) is True
