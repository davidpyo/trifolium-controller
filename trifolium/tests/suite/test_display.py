"""The OLED as the user sees it, rebuilt from the I2C bytes, and the menu driven the way a person
drives it - the menu button, the trigger and rev - reading the screen to find the way.

Golden images live in suite/golden/ as PBM. After an intended change to a screen, run with
TRIFOLIUM_UPDATE_GOLDEN=1 set and review the new image before keeping it.
"""

import os

import pytest
from helpers import SUITE, armed_v12, close_menu, open_menu, select

from trifolium_sim import PROJECT


def check_golden(name, panel):
    path = SUITE / "golden" / f"{name}.pbm"
    actual = panel.pbm()
    if os.environ.get("TRIFOLIUM_UPDATE_GOLDEN"):
        path.write_text(actual, encoding="ascii", newline="\n")
        return
    assert path.is_file(), f"no golden image {path} - run once with TRIFOLIUM_UPDATE_GOLDEN=1 and review it"
    if path.read_text(encoding="ascii") != actual:
        failed = PROJECT / ".pio" / "native" / f"{name}.actual.pbm"
        failed.parent.mkdir(parents=True, exist_ok=True)
        failed.write_text(actual, encoding="ascii", newline="\n")
        pytest.fail(f"{name} differs from its golden image; this run's is at {failed}\n{panel.ascii()}")


def test_the_home_screen_shows_the_name_profile_battery_mode_and_rev_speed(blaster):
    b = armed_v12(blaster, settle_ms=3000)
    panel = b.panel()
    assert panel.on
    for text in ("example|Medium", "16.4V", "BINARY", "30K"):
        assert panel.shows(text), panel.text


def test_the_home_screen_matches_its_golden_image(blaster):
    b = armed_v12(blaster, settle_ms=3000)
    check_golden("home_v1_2", b.panel(pixels=True))


def test_the_menu_opens_on_a_hold_of_menu_button_hold_time_and_not_a_moment_before(blaster):
    b = armed_v12(blaster, settle_ms=3000)
    hold_ms = b.wiring()["menuButtonHoldTime_ms"]
    b.hold("menu", hold_ms - 200)
    assert not b.peek("menuOpen")

    b.hold("menu", hold_ms + 100)
    assert b.peek("menuOpen")
    panel = b.panel()
    assert panel.shows("MENU")
    assert panel.highlighted.startswith("Firing Mode")


def test_the_trigger_cannot_fire_while_the_menu_is_open(blaster):
    b = armed_v12(blaster, settle_ms=3000)
    b.press("select0")  # AUTO
    b.run_ms(100)
    open_menu(b)
    b.press("trigger")
    b.run_ms(1000)
    b.release("trigger")
    b.run_ms(200)
    assert b.extends() == []
    assert b.wheels()[1]["rpm"] < 100


def test_a_setting_edited_on_the_oled_is_saved_to_flash_and_live_when_the_menu_closes(blaster):
    b = armed_v12(blaster, settle_ms=3000)
    mode = b.peek("firingMode")
    slot = b.peek("activeProfileIndex")
    before = b.command("DUMP_PROFILE")["fireModes"][mode]["targetDPS"]

    open_menu(b)
    select(b, "Target DPS")
    b.tap("menu")  # edit
    assert b.panel().lines[-1].text == "short=set long=cancel"
    b.tap("trigger")
    b.tap("trigger")
    b.tap("menu")  # keep
    assert b.panel().highlighted.startswith("Target DPS")
    close_menu(b)
    assert not b.peek("menuOpen")

    assert b.command("DUMP_PROFILE")["fireModes"][mode]["targetDPS"] == pytest.approx(before + 2)
    saved = b.flash_json(f"/profile{slot}.cfg")
    assert saved["fireModes"][mode]["targetDPS"] == pytest.approx(before + 2)


def test_a_long_press_in_an_edit_puts_the_value_back(blaster):
    b = armed_v12(blaster, settle_ms=3000)
    mode = b.peek("firingMode")
    before = b.command("DUMP_PROFILE")["fireModes"][mode]["targetDPS"]

    open_menu(b)
    select(b, "Target DPS")
    b.tap("menu")
    b.tap("trigger")
    b.tap("trigger")
    b.hold("menu", b.wiring()["menuButtonHoldTime_ms"] + 100)  # cancel
    assert b.command("DUMP_PROFILE")["fireModes"][mode]["targetDPS"] == pytest.approx(before)


def test_the_stored_display_brightness_reaches_the_panel_at_boot(blaster):
    b = armed_v12(blaster, {"displayBrightness": 40}, settle_ms=3000)
    assert b.panel().contrast == 40


def test_with_no_panel_on_the_bus_the_blaster_runs_headless_and_still_fires(blaster):
    b = armed_v12(blaster, display=False)
    boot = b.command("DUMP_BOOT")
    assert boot["display"]["probed"] is True
    assert boot["display"]["ok"] is False

    b.press("select2")
    b.run_ms(100)
    b.tap("trigger")
    b.run_ms(1000)
    assert len(b.extends()) == 1
