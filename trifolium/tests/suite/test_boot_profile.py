"""A profile chosen by a switch held at power-on: the Slot 1-3 boot actions. For this boot only - the
stored profile is untouched - and ahead of the selector, since mapping the action is the explicit
choice. The way a blaster with no screen changes FPS without a host."""

import pytest
from helpers import schema

from trifolium_sim import MENU, POWER_ON_MAGIC

NONE = ["none"] * 8
REV = 2  # bootAction[] index


def boot_actions(by_index):
    actions = list(NONE)
    for index, action in by_index.items():
        actions[index] = action
    return actions


def power_on_holding(b, roles, overrides, settle_ms=500):
    """Powered on with `roles` held until the boot has read them, then let go."""
    b.flash_preset("trifolium_v1_2", overrides)
    for role in roles:
        b.press(role)
    b.power_on()
    b.run_ms(200)
    for role in roles:
        b.release(role)
    assert b.wait_booted(5000)
    b.run_ms(settle_ms)
    return b


@pytest.mark.parametrize("slot", [0, 1, 2])
def test_a_switch_mapped_to_a_slot_boots_that_slot_for_this_power_on_only(blaster, slot):
    b = blaster
    b.flash_put("/active.cfg", "1" if slot != 1 else "0")
    stored = b.flash_get("/active.cfg")
    overrides = {"variableFPS": False, "bootAction": boot_actions({REV: f"profile_{slot}"})}
    power_on_holding(b, ["rev"], overrides)
    assert b.peek("activeProfileIndex") == slot
    assert b.command("DUMP_BOOT")["bootProfile"] == slot
    assert b.flash_get("/active.cfg") == stored

    b.power_cycle()
    assert b.boot(500)
    assert b.peek("activeProfileIndex") == int(stored)
    assert b.command("DUMP_BOOT")["bootProfile"] == -1


def test_the_boot_action_beats_the_selector_position(blaster):
    """The selector on its third position would pick slot 2 with variableFPS on."""
    b = power_on_holding(blaster, ["rev", "select2"],
                         {"variableFPS": True, "bootAction": boot_actions({REV: "profile_0"})})
    assert b.peek("activeProfileIndex") == 0


def test_a_slot_boot_action_is_not_taken_on_a_reboot(blaster):
    b = blaster
    b.set_noinit(MENU, magic=POWER_ON_MAGIC)
    power_on_holding(b, ["rev"], {"variableFPS": False,
                                  "bootAction": boot_actions({REV: "profile_2"})})
    assert b.peek("activeProfileIndex") == 0  # /active.cfg's, absent here
    assert b.command("DUMP_BOOT")["bootProfile"] == -1


def test_on_a_button_build_rev_held_at_power_on_no_longer_picks_slot_2_but_select0_still_picks_1(
        blaster, make_blaster):
    button = {"selectFireType": "button", "variableFPS": True, "bootAction": list(NONE)}
    b = power_on_holding(blaster, ["rev"], button)
    assert b.peek("activeProfileIndex") == 0

    b = power_on_holding(make_blaster(), ["select0"], button)
    assert b.peek("activeProfileIndex") == 1


def test_every_switch_offers_the_three_slots_as_boot_actions(blaster):
    b = blaster
    b.flash_preset("trifolium_v1_2")
    assert b.boot(100)
    nodes = [n for n in walk(schema(b)["tree"]) if (n.get("key") or "").startswith("device:bootAction[")]
    assert len(nodes) == 8
    for node in nodes:
        assert node["optionValues"][-3:] == ["profile_0", "profile_1", "profile_2"], node["key"]
        assert node["options"][-3:] == ["Slot 1", "Slot 2", "Slot 3"], node["key"]


def walk(tree):
    for node in tree:
        yield node
        yield from walk(node.get("children", []))


# The selector at power-on, with Variable FPS: each position boots the slot switchPositionProfile
# names for it, and no position - or one left on Default - boots the Default Profile. The v1.2's
# select lines are select0 and select2, so the switch's positions are 1 and 3.

def selector_boot(b, roles, device):
    return power_on_holding(b, roles, {"variableFPS": True, "bootAction": list(NONE), **device})


@pytest.mark.parametrize("roles, slot", [(["select0"], 2), (["select2"], 1), ([], 0)])
def test_each_switch_position_boots_the_slot_its_table_names(blaster, roles, slot):
    b = selector_boot(blaster, roles, {"defaultProfileIndex": 0,
                                       "switchPositionProfile": [2, 0, 1, -1, -1, -1, -1]})
    assert b.peek("activeProfileIndex") == slot


@pytest.mark.parametrize("roles, slot", [(["select0"], 0), (["select2"], 2), ([], 1)])
def test_a_config_without_the_table_boots_position_n_as_slot_n(blaster, roles, slot):
    b = selector_boot(blaster, roles, {})
    assert b.peek("activeProfileIndex") == slot


@pytest.mark.parametrize("roles, slot", [([], 2), (["select0"], 1), (["select2"], 0),
                                         (["select0", "select2"], 1)])
def test_each_encoder_position_boots_the_slot_its_table_names(blaster, roles, slot):
    b = selector_boot(blaster, roles, {"selectFireType": "encoder", "defaultProfileIndex": 2,
                                       "switchPositionProfile": [1, 0, 1, -1, -1, -1, -1]})
    assert b.peek("activeProfileIndex") == slot


@pytest.mark.parametrize("select_fire", ["switch", "encoder"])
def test_a_position_left_on_default_boots_the_default_profile(blaster, select_fire):
    b = selector_boot(blaster, ["select2"], {"selectFireType": select_fire, "defaultProfileIndex": 2,
                                             "switchPositionProfile": [0] + [-1] * 6})
    assert b.peek("activeProfileIndex") == 2


def test_with_variable_fps_off_the_encoder_leaves_the_profile_alone(blaster):
    b = power_on_holding(blaster, ["select0", "select2"],
                         {"selectFireType": "encoder", "variableFPS": False,
                          "bootAction": list(NONE), "switchPositionProfile": [2, 2, 2]})
    assert b.peek("activeProfileIndex") == 0  # /active.cfg's, absent here


@pytest.mark.parametrize("select_fire, rows", [("switch", [True, False, True]),
                                               ("encoder", [True, True, True])])
def test_the_menu_offers_a_profile_row_for_each_position_the_selector_reaches(
        blaster, select_fire, rows):
    b = blaster
    b.flash_preset("trifolium_v1_2", {"selectFireType": select_fire, "variableFPS": True})
    assert b.boot(100)
    nodes = {n["key"]: n for n in walk(schema(b)["tree"]) if n.get("key")}
    visible = [nodes[f"device:switchPositionProfile[{i}]"].get("visible", True) for i in range(7)]
    assert visible == rows + [False] * 4
