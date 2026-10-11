"""The OLED menu as a person finds it: which rows each list shows, read off the panel, and the rows
that come and go with the setting that governs them. Long rows are cut at the panel's edge, so rows
are matched by how they start."""

import pytest
from helpers import armed_v12, close_menu, enter, open_menu, rows, select


def menu(b, *path):
    open_menu(b)
    enter(b, *path)
    return rows(b)


def shown(listing, name):
    """Whether `name` is among the rows, a long one the panel cut short included."""
    return any(row.startswith(name) or (len(row) >= 12 and name.startswith(row)) for row in listing)


def edit_to_next_option(b, name):
    select(b, name)
    b.tap("menu")
    b.tap("rev")  # down the option list
    b.tap("menu")


def test_the_root_menu_lists_the_shortcuts_then_idle_mode_then_the_long_way_round(blaster):
    b = armed_v12(blaster, settle_ms=3000)
    open_menu(b)
    assert rows(b) == ["Firing Mode", "Burst Length", "Target DPS", "RPM / Timing", "Idle Mode",
                       "Switch Profile", "Reboot", "Advanced", "< Back"]


def test_advanced_holds_the_seven_setting_groups(blaster):
    b = armed_v12(blaster, settle_ms=3000)
    assert menu(b, "Advanced") == ["Flywheel / RPM", "Select-Fire", "Profile", "Motors & PID",
                                   "Solenoid / Pusher", "Battery", "Device", "< Back"]


def test_a_wired_dart_switch_gets_its_own_group_after_the_pusher(blaster):
    b = armed_v12(blaster, {"dartSwitchPin": 20}, settle_ms=3000)
    advanced = menu(b, "Advanced")
    assert advanced[advanced.index("Solenoid / Pusher") + 1] == "Dart Switch"
    enter(b, "Dart Switch")
    dart = rows(b)
    for name in ("Dart Sensing", "Rev Only With Dart", "Dart Debounce"):
        assert shown(dart, name), dart
    for name in ("Dart Wait", "Min Push"):  # Dart Sensing's own, and it is off
        assert not shown(dart, name), dart
    close_menu(b)
    pusher = menu(b, "Advanced", "Solenoid / Pusher")
    assert not shown(pusher, "Dart Sensing"), pusher


def test_wiring_and_what_only_a_host_should_set_have_no_rows_on_the_device(blaster):
    b = armed_v12(blaster, settle_ms=3000)
    device = menu(b, "Advanced", "Device")
    for name in ("Wiring", "Preset", "Display Attached", "Pusher Driver", "Pusher ESC Ch",
                 "RPM Logging", "Capture Samples"):
        assert not shown(device, name), device
    enter(b, "Display")
    assert not shown(rows(b), "Display Attached")


def test_changing_control_type_on_the_device_swaps_the_rows_it_governs_at_once(blaster):
    b = armed_v12(blaster, settle_ms=3000)
    motors = menu(b, "Advanced", "Motors & PID")
    assert shown(motors, "EMA Filter") and shown(motors, "I Threshold")
    assert not shown(motors, "Throttle Cap")

    edit_to_next_option(b, "Control Type")
    assert b.panel().highlighted == "Control Type: TBH"
    motors = rows(b)
    assert not shown(motors, "EMA Filter") and not shown(motors, "I Threshold")
    assert shown(motors, "Throttle Cap")


SOLENOID_ROWS = ("Extend @ High V", "High V Threshold", "Extend @ Low V", "Low V Threshold")


@pytest.mark.parametrize("pusher, timing_rows", [("solenoid_openloop", True), ("none", False)])
def test_the_solenoid_timing_rows_show_only_for_an_open_loop_solenoid(blaster, pusher, timing_rows):
    b = armed_v12(blaster, {"pusherType": pusher}, settle_ms=3000)
    listing = menu(b, "Advanced", "Solenoid / Pusher")
    assert [shown(listing, name) for name in SOLENOID_ROWS] == [timing_rows] * 4, listing
    assert shown(listing, "Retract Time")


@pytest.mark.parametrize("mode, per, idle", [("stage", "Per Stage RPM", "Idle RPM (Stage)"),
                                             ("custom", "Per Motor RPM", "Idle RPM (Custom)")])
def test_rpm_mode_decides_whether_speeds_are_set_per_stage_or_per_motor(blaster, mode, per, idle):
    b = blaster
    b.flash_profile(1, {"schemaVersion": 2, "rpmMode": mode})
    armed_v12(b, settle_ms=3000)
    listing = menu(b, "Advanced", "Flywheel / RPM")
    other = {"stage": ("Per Motor RPM", "Idle RPM (Custom)"),
             "custom": ("Per Stage RPM", "Idle RPM (Stage)")}[mode]
    assert shown(listing, per) and shown(listing, idle), listing
    assert not any(shown(listing, name) for name in other), listing


def test_rpm_logging_can_be_turned_off_on_the_device_and_the_next_rev_does_not_reboot(blaster):
    b = armed_v12(blaster, {"useRpmLogging": True}, settle_ms=3000)
    motors = menu(b, "Advanced", "Motors & PID")
    assert motors[-2] == "RPM Logging"
    assert not shown(motors, "Capture Samples")  # a host setting, logging on or off
    select(b, "RPM Logging")
    assert b.panel().highlighted == "RPM Logging: ON"
    b.tap("menu")
    assert b.panel().highlighted == "RPM Logging: OFF"
    close_menu(b)
    assert b.flash_json("/device.cfg")["useRpmLogging"] is False

    boots = len(b.history)
    b.press("rev")
    b.run_ms(1000)
    b.release("rev")
    b.run_ms(3000)
    assert len(b.history) == boots


SPIN_DIRECTION_1, SPIN_DIRECTION_2, SAVE_SETTINGS = 7, 8, 12


def change_direction(b):
    """Presses Change Direction on the open motor submenu. What it wrote, and whether the panel
    said so while it wrote."""
    before = len(b.escs()[1]["commands"])
    select(b, "Change Direction")
    b.press("menu")
    b.run_ms(60)
    b.release("menu")
    said = b.run_until(lambda: b.panel().shows("Set: "), 200, step_ms=5) and b.panel().text
    assert said, b.panel().text
    b.run_until(lambda: b.panel().highlighted.startswith("Change Direction"), 5000, step_ms=50)
    return b.escs()[1]["commands"][before:], said


def test_change_direction_writes_the_next_absolute_direction_and_a_save_to_that_esc_alone(blaster):
    """7 and 8 are absolute and 12 commits them to the ESC; each needs six in a row to be acted on.
    The panel names what was written, never what the ESC holds - swapped phase wires reverse a
    motor without it knowing."""
    b = armed_v12(blaster, settle_ms=3000)
    stored = b.flash_get("/device.cfg")
    menu(b, "Advanced", "Motors & PID", "Motor 2")
    b.reset_peak(1)
    other = len(b.escs()[3]["commands"])  # the extended telemetry enable, from arming

    sent, said = change_direction(b)
    assert "Set: Normal" in said
    assert sent == [SPIN_DIRECTION_1] * sent.count(SPIN_DIRECTION_1) + \
        [SAVE_SETTINGS] * sent.count(SAVE_SETTINGS)
    assert sent.count(SPIN_DIRECTION_1) >= 6 and sent.count(SAVE_SETTINGS) >= 6
    assert b.wheels()[1]["peak"] > 1000  # the spin afterwards is the readback
    assert b.escs()[3]["commands"][other:] == []

    sent, said = change_direction(b)
    assert "Set: Reversed" in said
    assert set(sent) == {SPIN_DIRECTION_2, SAVE_SETTINGS}
    assert b.flash_get("/device.cfg") == stored
