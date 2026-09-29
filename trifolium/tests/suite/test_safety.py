"""The safety switch: SAFE for as long as it is engaged, whatever is selected, and the pin it sits on
treated as the most important input the board has."""

import json

from helpers import armed_v12, enter, open_menu, schema

from trifolium_sim import IDLE

SAFETY = {"safetySwitchPin": 11}


def engaged(b):
    b.press("safety")
    b.run_ms(100)
    assert b.peek("safetyEngaged") is True


def test_the_safety_switch_holds_the_blaster_in_safe_with_no_rev_and_no_fire(blaster):
    b = armed_v12(blaster, SAFETY)
    b.press("select0")
    engaged(b)
    motors = b.command("DUMP_MOTORS")
    assert motors["burstMode"] == "safe"
    assert motors["safetyEngaged"] is True

    b.press("rev")
    b.press("trigger")
    b.run_ms(1000)
    assert b.extends() == []
    assert b.peek("flywheelState") == IDLE
    assert b.wheels()[1]["rpm"] < 100

    # Releasing the switch hands the selected mode back with nothing to re-select.
    b.release("trigger")
    b.release("rev")
    b.release("safety")
    b.run_ms(100)
    b.press("trigger")
    b.run_ms(1000)
    b.release("trigger")
    assert b.extends()


def test_the_firing_mode_row_names_the_switch_and_will_not_open_while_it_is_engaged(blaster):
    b = armed_v12(blaster, SAFETY, settle_ms=3000)
    mode = b.peek("firingMode")
    engaged(b)
    open_menu(b)
    assert b.panel().highlighted.endswith(": SAFE (switch)")

    b.tap("menu")
    lines = [line.text for line in b.panel().lines]
    assert lines == ["Safety switch is on.", "Release it to choose", "a firing mode."], lines
    b.tap("menu")
    assert b.peek("menuOpen")
    assert b.panel().highlighted.endswith(": SAFE (switch)")
    assert b.peek("firingMode") == mode

    b.release("safety")
    b.run_ms(100)
    assert b.panel().highlighted == "Firing Mode: BINARY"


def test_the_active_firing_mode_row_under_select_fire_is_locked_the_same_way(blaster):
    b = armed_v12(blaster, SAFETY, settle_ms=3000)
    engaged(b)
    open_menu(b)
    enter(b, "Advanced", "Select-Fire", "Active")
    assert b.panel().shows("Safety switch is on."), b.panel().text


def test_a_safety_pin_is_attached_as_a_pulled_up_input_and_reported_under_its_role(blaster):
    b = armed_v12(blaster, SAFETY)
    assert b.peek("pins")["safety"] == 11
    assert b.pin(11)["mode"] == "input_pullup"
    gpio = b.command("DUMP_GPIO")
    assert "safety" in [p.get("role") for p in gpio["gpio"] if p["n"] == 11], gpio["gpio"][11]
    assert schema(b)["pinConflicts"] == []


def test_a_pin_the_safety_and_the_trigger_both_claim_goes_to_the_safety(blaster):
    """A detached safety switch reads as disengaged, so losing it would be the unsafe outcome."""
    b = armed_v12(blaster, {"safetySwitchPin": 21})  # the trigger's pin
    pins = b.peek("pins")
    assert pins["safety"] == 21
    assert pins["trigger"] == 255
    assert schema(b)["pinConflicts"] == [{"field": "triggerSwitchPin", "pin": 21,
                                          "against": "safetySwitchPin", "action": "pinCleared"}]
    stored = json.loads(b.flash_get("/device.cfg"))
    assert stored["triggerSwitchPin"] == 21 and stored["safetySwitchPin"] == 21
