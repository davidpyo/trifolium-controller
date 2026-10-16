"""Boot rules: switches held together at power-on, and the action the first matching rule takes.

A rule fires when every switch it names is held, whatever else is held, so the list order is what
decides between two rules that both match. The Slot actions are used throughout because the slot
that booted is readable afterwards; the actions themselves have their own tests."""

import json

from trifolium_sim import TO_ESC_PASSTHROUGH

SWITCHES = ["menu", "trigger", "rev", "idle", "select0", "select1", "select2"]


def rule(action, *on):
    return {"action": action, **{s: s in on for s in SWITCHES}}


def rules(*given):
    """Eight slots, the given rules first and the rest empty."""
    return list(given) + [rule("none")] * (8 - len(given))


def booted_slot(b, roles, overrides, board="trifolium_v1_2"):
    """The slot a boot rule picked, with `roles` held through the boot's read, or -1 for none."""
    b.flash_preset(board, {"variableFPS": False, **overrides})
    for role in roles:
        b.press(role)
    b.power_on()
    b.run_ms(200)
    for role in roles:
        b.release(role)
    assert b.wait_booted(5000)
    return b.command("DUMP_BOOT")["bootProfile"]


def test_a_two_switch_rule_needs_both_held(make_blaster):
    given = {"bootRules": rules(rule("profile_1", "menu", "trigger"))}
    assert booted_slot(make_blaster(), ["menu", "trigger"], given) == 1
    assert booted_slot(make_blaster(), ["menu"], given) == -1
    assert booted_slot(make_blaster(), ["trigger"], given) == -1


def test_the_first_matching_rule_wins_so_the_order_decides(make_blaster):
    narrow, wide = rule("profile_0", "menu"), rule("profile_1", "menu", "trigger")
    assert booted_slot(make_blaster(), ["menu", "trigger"], {"bootRules": rules(narrow, wide)}) == 0
    assert booted_slot(make_blaster(), ["menu", "trigger"], {"bootRules": rules(wide, narrow)}) == 1
    assert booted_slot(make_blaster(), ["menu"], {"bootRules": rules(wide, narrow)}) == 0


def test_an_empty_slot_ahead_of_a_rule_is_skipped(blaster):
    given = {"bootRules": rules(rule("none", "menu"), rule("profile_2", "menu"))}
    assert booted_slot(blaster, ["menu"], given) == 2


def test_a_selector_position_held_anyway_does_not_stop_a_rule_that_ignores_it(blaster):
    """A switch selector grounds a select line in most positions, so every ordinary boot holds one."""
    given = {"selectFireType": "switch", "bootRules": rules(rule("profile_2", "menu"))}
    assert booted_slot(blaster, ["menu", "select0"], given) == 2


def test_an_encoder_position_is_a_rule_on_both_its_lines(make_blaster):
    given = {"selectFireType": "encoder", "select1Pin": 5,
             "bootRules": rules(rule("profile_2", "select0", "select1"))}
    assert booted_slot(make_blaster(), ["select0", "select1"], given) == 2
    assert booted_slot(make_blaster(), ["select0"], given) == -1


def test_with_a_dual_stage_trigger_rev_is_not_a_boot_input(make_blaster):
    """Every full pull holds rev too, so a rule on rev would fire on the trigger's account."""
    given = {"dualStageTrigger": True,
             "bootRules": rules(rule("profile_1", "rev"), rule("profile_2", "trigger"))}
    assert booted_slot(make_blaster(), ["rev", "trigger"], given) == 2
    assert booted_slot(make_blaster(), ["rev"], given) == -1


def test_with_select_fire_off_a_select_line_is_never_read(blaster):
    """The conflict engine skips select lines then, so the pin may belong to something else."""
    b = blaster
    given = {"selectFireType": "off", "select0Pin": 5,
             "bootRules": rules(rule("profile_1", "select0"))}
    assert booted_slot(b, ["select0"], given) == -1
    assert b.pin(5)["modeSet"] is False


def test_select0_on_the_menu_buttons_pin_is_the_menu_button(blaster):
    given = {"selectFireType": "button", "select0Pin": 19,
             "bootRules": rules(rule("profile_1", "select0"), rule("profile_2", "menu"))}
    assert booted_slot(blaster, ["menu"], given) == 2


def test_the_cycle_switch_cannot_be_in_a_rule(blaster):
    """The pusher rests on it, so a rule naming it would fire at an ordinary power-on."""
    b = blaster
    given = {"cycleSwitchPin": 20, "bootRules": rules({**rule("bootloader"), "cycle": True})}
    assert booted_slot(b, ["cycle"], given) == -1
    assert b.state == "running"
    assert all("cycle" not in r for r in b.command("DUMP_DEVICE")["bootRules"])


def test_a_combination_entering_esc_passthrough_is_ended_by_its_first_switch(blaster):
    b = blaster
    b.flash_preset("trifolium_v1_2",
                   {"bootRules": rules(rule("esc_passthrough", "trigger", "menu"))})
    b.attach_display()
    b.passthrough_session(10 * 60 * 1000)
    b.press("menu")
    b.press("trigger")
    b.power_on()
    assert b.run_until(lambda: b.state == "running" and b.passthrough()["active"], 5000,
                       step_ms=10)
    assert b.peek("bootReason") == TO_ESC_PASSTHROUGH
    b.run_ms(50)
    assert b.panel().shows("MENU to exit"), b.panel().text


def test_a_rule_naming_no_switch_never_fires(blaster):
    assert booted_slot(blaster, ["menu"], {"bootRules": rules(rule("profile_1"))}) == -1


# A config written before boot rules carries one action per switch instead. It is converted as it
# loads, into one-switch rules in the order those actions were checked in, so it boots as it did.

LEGACY = ["bootloader", "esc_passthrough", "profile_1", "none", "none", "none", "none", "none"]


def test_a_stored_per_switch_config_loads_as_the_equivalent_rules(blaster):
    b = blaster
    b.flash_preset("trifolium_v1_2", {"bootAction": LEGACY})
    assert b.boot(100)
    device = b.command("DUMP_DEVICE")
    assert "bootAction" not in device
    assert device["bootRules"][:4] == [rule("bootloader", "menu"), rule("esc_passthrough", "trigger"),
                                       rule("profile_1", "rev"), rule("none")]


def test_a_per_switch_config_drops_rev_on_a_dual_stage_trigger_as_it_always_ignored_it(blaster):
    b = blaster
    b.flash_preset("trifolium_v1_2", {"dualStageTrigger": True, "bootAction": LEGACY})
    assert b.boot(100)
    assert b.command("DUMP_DEVICE")["bootRules"][:3] == [
        rule("bootloader", "menu"), rule("esc_passthrough", "trigger"), rule("none")]


def test_an_uploaded_per_switch_backup_is_converted_too(blaster):
    b = blaster
    b.flash_preset("trifolium_v1_2")
    assert b.boot(100)
    reply = b.command("LOAD_DEVICE\n" + json.dumps(
        {"schemaVersion": 3, "bootAction": ["none", "none", "idle_hold"] + ["none"] * 5}))
    assert reply["ok"], reply
    assert b.run_until_reboot()
    assert b.wait_booted()
    assert b.command("DUMP_DEVICE")["bootRules"][:2] == [rule("idle_hold", "rev"), rule("none")]
