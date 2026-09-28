"""What the board does with the pins a wiring names: a pin the chip cannot use that way is dropped for
the boot and reported rather than half-used, a contested pin goes to the input that matters more,
and none of it touches what is stored - the console shows the user what they typed until they change
it."""

from helpers import armed_v12, open_menu, schema

GPIO_FUNC_I2C = 3


def stored(b):
    return b.flash_json("/device.cfg")


def test_a_healthy_board_reports_no_conflicts_and_no_config_faults(blaster):
    b = armed_v12(blaster)
    assert schema(b)["pinConflicts"] == []
    assert b.command("DUMP_BOOT")["configFaults"] == []


def test_a_battery_pin_with_no_adc_channel_turns_battery_monitoring_off(blaster):
    """Not folded to the nearest ADC pin: a reading from a pin nobody wired would be noise the
    low-voltage cutoff acts on."""
    b = armed_v12(blaster, {"batteryAdcPin": 5})
    assert b.peek("pins")["batteryAdc"] == 255
    assert schema(b)["pinConflicts"] == [{"field": "batteryAdcPin", "pin": 5,
                                          "against": "notAnAdcPin", "action": "pinCleared"}]
    assert not b.panel().shows("16.4V")
    assert stored(b)["batteryAdcPin"] == 5


def test_an_i2c_pair_no_block_can_serve_leaves_the_display_off_instead_of_panicking(blaster):
    """SDA 14 is I2C1's and SCL 17 is I2C0's: each is legal alone, and setSDA/setSCL on a pin its
    block cannot use panics - a boot loop, not a blank screen."""
    b = armed_v12(blaster, {"i2cSclPin": 17})
    assert b.peek("displayAllowed") is False
    assert schema(b)["pinConflicts"] == [{"field": "i2cSdaPin", "pin": 14, "against": "i2cPair",
                                          "action": "displayOff"}]
    assert not b.panel().on
    assert not [p["n"] for p in b.pins() if p["fn"] == GPIO_FUNC_I2C]
    assert b.peek("wiringLive") is True
    assert stored(b)["i2cSclPin"] == 17


def test_with_the_display_turned_off_the_i2c_pins_are_never_claimed(blaster):
    b = armed_v12(blaster, {"hasDisplay": False})
    assert not b.panel().on
    for n in (14, 15):
        assert not b.pin(n)["modeSet"] and b.pin(n)["fn"] != GPIO_FUNC_I2C
    assert schema(b)["pinConflicts"] == []
    assert b.command("DUMP_DEVICE")["hasDisplay"] is False


def test_a_pin_number_the_chip_does_not_have_is_read_as_unused(blaster):
    b = armed_v12(blaster, {"idleSwitchPin": 200})
    assert b.wiring()["idleSwitchPin"] == 255
    assert schema(b)["pinConflicts"] == []


def test_of_two_inputs_on_one_pin_the_lower_priority_one_is_detached(blaster):
    b = armed_v12(blaster, {"revSwitchPin": 21})  # the trigger's pin
    pins = b.peek("pins")
    assert pins["trigger"] == 21 and pins["rev"] == 255
    assert schema(b)["pinConflicts"] == [{"field": "revSwitchPin", "pin": 21,
                                          "against": "triggerSwitchPin", "action": "pinCleared"}]
    assert stored(b)["revSwitchPin"] == 21


def test_a_menu_button_on_select0_cycles_the_mode_on_a_press_and_opens_the_menu_on_a_hold(blaster):
    b = armed_v12(blaster, {"selectFireType": "button", "menuButtonPin": 9}, settle_ms=3000)
    assert schema(b)["pinConflicts"] == []
    assert b.peek("pins")["menuButton"] == 9

    mode = b.peek("firingMode")
    b.tap("menu")
    b.run_ms(200)
    assert b.peek("firingMode") != mode
    assert not b.peek("menuOpen")
    open_menu(b)


def test_esc_enable_is_active_high_from_early_in_the_boot_and_stays_high(blaster):
    """Before arming, which needs the ESCs powered. Until the firmware drives the pin it floats, so a
    board wiring it pulls it down."""
    b = armed_v12(blaster, {"escEnablePin": 22})
    b.press("rev")
    b.run_ms(1000)
    b.release("rev")
    assert b.pin(22)["output"] is True
    assert b.pin(22)["outputLevel"] is True
    edges = b.edges(22)
    assert [level for _, level in edges] == [True]
    assert edges[0][0] < 1_000_000  # inside setup(), ahead of the arming loop


def test_esc_enable_is_high_through_an_esc_passthrough_session(blaster):
    b = blaster
    b.flash_preset("trifolium_v1_2", {"escEnablePin": 22})
    b.passthrough_session(2000)
    assert b.boot(2500)
    b.command("ESC_PASSTHROUGH")
    assert b.run_until(lambda: b.passthrough()["active"], 3000, step_ms=10)
    assert b.pin(22)["outputLevel"] is True


def test_the_low_voltage_cutoff_drops_esc_enable_until_the_next_boot(blaster):
    b = armed_v12(blaster, {"escEnablePin": 22})
    b.set_pack(12400)  # 3.1 V per cell, under the 3.3 V cutoff
    b.run_ms(3000)
    assert b.pin(22)["outputLevel"] is False
    b.set_pack(16400)
    b.run_ms(1000)
    assert b.pin(22)["outputLevel"] is False


def test_the_schema_header_is_right_in_the_first_reply_after_a_reboot(blaster):
    """The console reads the header as soon as the port comes back, not a few seconds later."""
    b = blaster
    b.flash_profile(1, {"schemaVersion": 2, "activeModeCount": 2})
    armed_v12(b)
    assert b.command("REBOOT")["rebooting"] is True
    assert b.run_until_reboot(2000)
    early = b.command("DUMP_SCHEMA", timeout_ms=5000)
    assert early["activeProfileIndex"] == 1
    assert early["activeModeCount"] == 2
    b.run_ms(3000)
    late = b.command("DUMP_SCHEMA", timeout_ms=5000)
    assert (late["activeProfileIndex"], late["activeModeCount"]) == (1, 2)



def test_a_config_that_names_a_board_with_the_gate_off_claims_no_pin(blaster):
    b = blaster
    b.flash_preset("trifolium_v1_2", {"wiringConfigured": False})
    assert b.boot(3000)
    assert b.peek("wiringLive") is False
    assert b.pin_mode_calls() == 0
    assert not [p["n"] for p in b.pins() if p["output"]]
    assert b.command("DUMP_BOOT")["wiring"] == {"boardId": "trifolium_v1_2", "configured": False}
