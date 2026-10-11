"""Encoder select fire: the wired select lines read as the bits of a position number, select0 the
lowest. Position 0, no line grounded, is the Default Mode; every other position picks its mode from
the same table the switch's positions use."""

import pytest

from helpers import close_menu, keyed_nodes, open_menu, schema

MODES = ["safe", "semi", "binary", "auto"]
POSITIONS = [1, 2, 3, -1, -1, -1, -1]  # 1 SEMI, 2 BINARY, 3 AUTO; none is SAFE
DEBOUNCE_MS = 20


def encoder(b, modes=MODES, assigned=POSITIONS, default=0, display=False, **device):
    """A v1.2 with an encoder on the select lines it is given (the preset's own are 9 and 10) and a
    profile listing `modes`, booted and armed."""
    wiring = {"selectFireType": "encoder", "variableFPS": False}
    wiring.update(device)
    fire = [{"burstMode": m, "burstLength": 1, "targetDPS": 15, "reversible": False,
             "binaryTriggerTimeout_ms": 2000, "includeInCycle": True} for m in modes]
    b.flash_preset("trifolium_v1_2", wiring)
    b.flash_profile(0, {"schemaVersion": 2, "activeModeCount": len(modes),
                        "defaultFiringMode": default, "switchPositionAssignment": assigned,
                        "fireModes": fire})
    if display:
        b.attach_display()
    assert b.boot(2500)
    return b


def ground(b, lines, position):
    """Sets the select lines, `lines` lowest bit first, to spell `position`."""
    for bit, role in enumerate(lines):
        if position >> bit & 1:
            b.press(role)
        else:
            b.release(role)


def settle(b):
    b.run_ms(DEBOUNCE_MS * 3)


TWO_LINES = ["select0", "select2"]  # select1 is unwired, so select2 is the second bit
THREE_LINES = ["select0", "select1", "select2"]


def test_each_position_of_a_two_line_encoder_selects_its_own_mode(blaster):
    b = encoder(blaster)
    for position, mode in enumerate(MODES):
        ground(b, TWO_LINES, position)
        settle(b)
        assert b.command("DUMP_MOTORS")["burstMode"] == mode


@pytest.mark.parametrize("lines", [["select0"], TWO_LINES, THREE_LINES])
def test_one_two_and_three_lines_give_two_four_and_eight_positions(blaster, lines):
    modes = ["semi", "auto", "binary", "burst", "safe", "devotion", "semi", "auto"]
    wired = {"select0": 9, "select1": 8, "select2": 10}
    device = {f"{role}Pin": wired[role] if role in lines else 255 for role in wired}
    b = encoder(blaster, modes, assigned=[1, 2, 3, 4, 5, 6, 7], **device)
    for position in range(2 ** len(lines)):
        ground(b, lines, position)
        settle(b)
        assert b.peek("firingMode") == position


def test_a_position_left_on_default_uses_the_default_mode(blaster):
    b = encoder(blaster, assigned=[3, -1, 3, -1, -1, -1, -1], default=1)
    ground(b, TWO_LINES, 2)
    settle(b)
    assert b.peek("firingMode") == 1
    ground(b, TWO_LINES, 3)
    settle(b)
    assert b.peek("firingMode") == 3


def test_a_profile_stored_with_three_positions_leaves_the_rest_on_default(blaster):
    b = encoder(blaster, assigned=[1, 2, 3], select1Pin=8)
    ground(b, THREE_LINES, 3)
    settle(b)
    assert b.peek("firingMode") == 3
    ground(b, THREE_LINES, 6)
    settle(b)
    assert b.peek("firingMode") == 0
    stored = b.command("DUMP_PROFILE 0")["switchPositionAssignment"]
    assert stored == [1, 2, 3, -1, -1, -1, -1]


def test_a_turn_through_the_position_between_two_detents_never_selects_it(blaster):
    b = encoder(blaster)
    ground(b, TWO_LINES, 1)
    settle(b)
    assert b.peek("firingMode") == 1

    # From 1 to 2 the lines change one at a time, passing through 3 for a few milliseconds.
    seen = set()
    b.press("select2")
    for _ in range(8):
        b.run_ms(1)
        seen.add(b.peek("firingMode"))
    b.release("select0")
    for _ in range(DEBOUNCE_MS * 3):
        b.run_ms(1)
        seen.add(b.peek("firingMode"))
    assert 3 not in seen
    assert b.peek("firingMode") == 2


def test_a_position_held_past_the_debounce_is_selected(blaster):
    b = encoder(blaster)
    ground(b, TWO_LINES, 1)
    settle(b)
    b.press("select2")
    settle(b)
    assert b.peek("firingMode") == 3


def test_a_mode_picked_on_the_screen_holds_until_the_encoder_moves(blaster):
    b = encoder(blaster, display=True)
    settle(b)
    assert b.peek("firingMode") == 0
    open_menu(b)
    b.tap("menu")  # Firing Mode, highlighted as the menu opens
    b.tap("rev")
    b.tap("menu")
    assert b.panel().highlighted == "Firing Mode: SEMI"
    close_menu(b)
    b.run_ms(500)
    assert b.peek("firingMode") == 1

    ground(b, TWO_LINES, 2)
    settle(b)
    assert b.peek("firingMode") == 2


@pytest.mark.parametrize("lines, rows", [(TWO_LINES, 3), (THREE_LINES, 7)])
def test_the_menu_offers_a_mode_row_for_each_position_the_encoder_reaches(blaster, lines, rows):
    wired = {"select0": 9, "select1": 8, "select2": 10}
    device = {f"{role}Pin": wired[role] if role in lines else 255 for role in wired}
    b = encoder(blaster, **device)
    nodes = keyed_nodes(schema(b)["tree"])
    visible = [nodes[f"profile:switchPositionAssignment[{i}]"].get("visible", True)
               for i in range(7)]
    assert visible == [i < rows for i in range(7)]


def test_a_switch_with_two_lines_grounded_still_reads_the_lower_one(blaster):
    b = blaster
    b.flash_preset("trifolium_v1_2", {"variableFPS": False})
    b.flash_profile(0, {"schemaVersion": 2, "activeModeCount": 4, "defaultFiringMode": 0,
                        "switchPositionAssignment": [1, -1, 2],
                        "fireModes": [{"burstMode": m} for m in MODES]})
    assert b.boot(2500)
    b.press("select0")
    b.press("select2")
    settle(b)
    assert b.peek("firingMode") == 1
