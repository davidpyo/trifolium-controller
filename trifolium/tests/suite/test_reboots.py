"""Flows that only finish after a reboot. What a serial command promises the host is only kept if the
next boot sees it."""

import json

import pytest

from trifolium_sim import FROM_ESC_PASSTHROUGH, MENU, TO_ESC_PASSTHROUGH, preset

NO_BOOT_BUTTON = 8


def command_then_reboot(b, line):
    """Sends a command that ends in a reboot: acked, then really rebooted, then booted again."""
    ack = b.command(line)
    assert ack and ack["ok"] is True, ack
    assert ack["rebooting"] is True
    assert b.run_until_reboot(2000)
    assert b.wait_booted()


def test_load_device_of_a_preset_arms_an_unwired_board_across_the_reboot(blaster):
    b = blaster
    b.attach_display()
    assert b.boot()
    assert b.peek("wiringLive") is False

    command_then_reboot(b, "LOAD_DEVICE\n" + json.dumps(preset("trifolium_v1_2")))
    b.run_ms(2500)
    assert b.peek("bootReason") == MENU
    assert b.peek("wiringLive") is True
    wheels = b.wheels()
    assert wheels[1]["attached"] and wheels[3]["attached"]
    boot = b.command("DUMP_BOOT")
    assert boot["wiring"] == {"boardId": "trifolium_v1_2", "configured": True}


def test_factory_reset_device_clears_what_the_menu_can_set_and_keeps_the_wiring(blaster):
    b = blaster
    # displayBrightness has an OLED row, so the reset clears it; printTelemetry has none, so the
    # reset has to leave it where the host put it.
    b.flash_preset("trifolium_v1_2", {"displayBrightness": 40, "printTelemetry": True,
                                      "safetySwitchPin": 11, "safetySwitchNormallyClosed": True})
    b.attach_display()
    assert b.boot()
    command_then_reboot(b, "FACTORY_RESET_DEVICE")

    settings = b.wiring()
    assert b.peek("wiringLive") is True
    assert settings["boardId"] == "trifolium_v1_2"
    assert settings["escPins"][1] == 1
    assert settings["triggerSwitchPin"] == 21
    assert settings["displayBrightness"] == 255
    assert settings["printTelemetry"] is True
    assert settings["safetySwitchPin"] == 11
    assert settings["safetySwitchNormallyClosed"] is True


def test_reset_pins_returns_the_board_to_unwired_and_keeps_everything_else(blaster):
    b = blaster
    b.flash_preset("trifolium_v1_2", {"blasterName": "keepme"})
    assert b.boot()
    command_then_reboot(b, "RESET_PINS")
    b.run_ms(100)

    settings = b.wiring()
    assert b.peek("wiringLive") is False
    assert b.pin_mode_calls() == 0
    assert settings["boardId"] == ""
    assert settings["triggerSwitchPin"] == 255
    assert settings["blasterName"] == "keepme"


def test_esc_passthrough_reboots_into_a_session_that_falls_through_to_a_normal_boot(blaster):
    b = blaster
    b.flash_preset("trifolium_v1_2")
    b.passthrough_session(3000)  # the configurator talks for three seconds, then closes
    assert b.boot(2500)

    ack = b.command("ESC_PASSTHROUGH")
    assert ack["ok"] is True and ack["rebooting"] is True
    assert b.run_until_stopped(2000)
    assert b.last_stop == "reboot"
    ram = b.noinit()
    assert ram["rebootReason"] == TO_ESC_PASSTHROUGH
    assert ram["passthroughExit"] == NO_BOOT_BUTTON

    b.resume()
    assert b.wait_booted()

    session = b.passthrough()
    assert session["sessions"] == 1
    assert session["pins"] == [1, 3]
    assert session["active"] is False
    assert b.peek("bootReason") == FROM_ESC_PASSTHROUGH
    # Serial is the configurator's for the session and the firmware's again after it.
    assert b.command("DUMP_BOOT")["passthroughExited"] is True
    assert b.peek("wiringLive") is True


def test_an_unwired_board_refuses_esc_passthrough_and_stays_up(blaster):
    b = blaster
    assert b.boot()
    reply = b.command("ESC_PASSTHROUGH")
    assert reply["ok"] is False
    assert reply["err"] == "no wiring configured"
    assert b.run_ms(500)


def test_a_passthrough_session_runs_at_132_mhz_and_the_boot_after_it_is_back_at_133(blaster):
    b = blaster
    b.flash_preset("trifolium_v1_2")
    b.passthrough_session(1000)
    assert b.boot(2500)
    assert b.command("DUMP_BOOT")["sysClockHz"] == 133_000_000

    command_then_reboot(b, "ESC_PASSTHROUGH")
    session = b.passthrough()
    assert session["sessions"] == 1
    assert session["clockDuring_hz"] == 132_000_000
    boot = b.command("DUMP_BOOT")
    assert boot["passthroughExited"] is True
    assert boot["sysClockHz"] == 133_000_000


def test_serial_belongs_to_the_configurator_for_the_whole_session(blaster):
    b = blaster
    b.flash_preset("trifolium_v1_2")
    b.passthrough_session(2000)
    assert b.boot(2500)
    b.command("ESC_PASSTHROUGH")
    assert b.run_until(lambda: b.passthrough()["active"], 3000, step_ms=10)
    assert b.command("DUMP_DEVICE", timeout_ms=1500) is None
    assert b.passthrough()["active"]
    assert b.wait_booted()
    assert b.command("DUMP_DEVICE")["wiringConfigured"] is True


def test_a_session_that_leaves_the_clock_changed_reboots_rather_than_boot_on_it(blaster):
    """DShot, I2C and SPI would all run 5.6% fast on the session's clock."""
    b = blaster
    b.flash_preset("trifolium_v1_2")
    b.passthrough_session(500, restore_fails=True)
    assert b.boot(2500)
    boots = len(b.history)
    assert b.command("ESC_PASSTHROUGH")["rebooting"] is True
    assert b.run_until(lambda: len(b.history) == boots + 2, 5000, step_ms=10)
    assert b.wait_booted()
    assert b.peek("bootReason") == FROM_ESC_PASSTHROUGH
    boot = b.command("DUMP_BOOT")
    assert boot["sysClockHz"] == 133_000_000
    assert boot["passthroughExited"] is False
    assert b.passthrough()["sessions"] == 0


def test_passthrough_needs_no_trigger_and_ends_when_the_host_closes_the_port(blaster):
    b = blaster
    b.flash_preset("trifolium_v1_2", {"triggerSwitchPin": 255})
    b.attach_display()
    b.passthrough_session(2000)
    assert b.boot(2500)
    stored = b.flash_get("/device.cfg")

    b.command("ESC_PASSTHROUGH")
    assert b.run_until(lambda: b.passthrough()["active"], 3000, step_ms=10)
    b.run_ms(50)
    assert b.panel().shows("ESC Passthrough, disc"), b.panel().text
    assert b.wait_booted()
    assert b.passthrough()["sessions"] == 1
    assert b.command("DUMP_BOOT")["passthroughExited"] is True
    assert b.peek("wiringLive") is True
    assert b.flash_get("/device.cfg") == stored


def test_with_no_motor_enabled_there_is_nothing_to_hand_over_and_the_boot_carries_on(blaster):
    b = blaster
    b.flash_preset("trifolium_v1_2", {"motorConfig": [{"enabled": False}] * 4})
    b.passthrough_session(2000)
    assert b.boot(100)
    stored = b.flash_get("/device.cfg")

    command_then_reboot(b, "ESC_PASSTHROUGH")
    assert b.passthrough()["sessions"] == 0
    assert b.peek("bootReason") == FROM_ESC_PASSTHROUGH
    assert b.command("DUMP_BOOT")["passthroughExited"] is False
    assert b.peek("wiringLive") is True
    assert b.flash_get("/device.cfg") == stored


def test_a_session_entered_from_a_boot_switch_ends_on_that_switch_held_after_a_release(blaster):
    """The switch is still held from power-on as the session opens, which must not count."""
    b = blaster
    b.flash_preset("trifolium_v1_2", {"bootAction": ["none", "none", "esc_passthrough", "none",
                                                     "none", "none", "none", "none"]})
    b.attach_display()
    b.passthrough_session(10 * 60 * 1000)  # a configurator that never lets go
    b.press("rev")
    b.power_on()
    assert b.run_until(lambda: b.state == "running" and b.passthrough()["active"], 5000,
                       step_ms=10)
    assert b.peek("bootReason") == TO_ESC_PASSTHROUGH
    b.run_ms(50)
    assert b.panel().shows("REV to exit"), b.panel().text
    boots = len(b.history)

    b.run_ms(5000)
    assert b.passthrough()["active"]

    b.release("rev")
    b.run_ms(500)
    b.press("rev")
    b.run_ms(2900)
    assert b.passthrough()["active"]
    assert b.run_until(lambda: not b.passthrough()["active"], 300, step_ms=10)
    b.release("rev")
    assert b.wait_booted()
    assert len(b.history) == boots  # fell through into this boot rather than rebooting
    assert b.peek("bootReason") == FROM_ESC_PASSTHROUGH
    assert b.command("DUMP_BOOT")["passthroughExited"] is True
    assert b.peek("wiringLive") is True


def names(b):
    return [b.command(f"DUMP_PROFILE {slot}")["name"] for slot in range(3)]


def test_factory_reset_profile_resets_only_the_slot_it_names(blaster, make_blaster):
    fresh = make_blaster()
    assert fresh.boot(100)
    defaults = names(fresh)

    b = blaster
    b.flash_preset("trifolium_v1_2")
    for slot, name in enumerate(["zero", "one", "two"]):
        b.flash_profile(slot, {"schemaVersion": 2, "name": name})
    assert b.boot(100)
    assert names(b) == ["zero", "one", "two"]

    for bad in ("FACTORY_RESET_PROFILE", "FACTORY_RESET_PROFILE 3"):
        assert b.command(bad) == {"cmd": "FACTORY_RESET_PROFILE", "ok": False,
                                  "err": "needs a slot index"}
    command_then_reboot(b, "FACTORY_RESET_PROFILE 2")
    assert names(b) == ["zero", "one", defaults[2]]


def test_factory_reset_all_clears_every_slot_and_the_settings_and_keeps_the_wiring(blaster,
                                                                                   make_blaster):
    fresh = make_blaster()
    assert fresh.boot(100)
    defaults = names(fresh)

    b = blaster
    b.flash_preset("trifolium_v1_2", {"blasterName": "marked", "safetySwitchPin": 11})
    for slot, name in enumerate(["zero", "one", "two"]):
        b.flash_profile(slot, {"schemaVersion": 2, "name": name})
    assert b.boot(100)
    command_then_reboot(b, "FACTORY_RESET_ALL")

    assert names(b) == defaults
    settings = b.wiring()
    assert settings["blasterName"] == fresh.wiring()["blasterName"]
    assert b.peek("wiringLive") is True
    assert settings["boardId"] == "trifolium_v1_2"
    assert settings["escPins"] == [0, 1, 2, 3]
    assert settings["safetySwitchPin"] == 11


SPLASH_BEFORE, SPLASH_AFTER = bytes([0x0F]) * 1024, bytes([0xF0]) * 1024


def cut_before_each_write(make_blaster, save, check, limit=8):
    """Saves once per flash write the save makes, with the power cut as that write is about to land,
    and checks the boot after each. How many writes the save made."""
    for n in range(1, limit):
        b = make_blaster()
        b.flash_preset("trifolium_v1_2")
        b.flash_profile(0, {"schemaVersion": 2, "name": "before"})
        b.flash_put("/splash.bin", SPLASH_BEFORE)
        assert b.boot()
        b.cut_power_before_write(n)
        save(b)
        b.run_until_stopped(2000)
        cut = b.last_stop == "powerloss"
        b.power_cycle()
        assert b.boot()
        check(b, n)
        if not cut:
            return n - 1
    pytest.fail(f"a save that still wrote after {limit} writes")


def test_a_power_cut_anywhere_in_a_device_save_leaves_the_old_settings_or_the_new(make_blaster):
    def check(b, n):
        settings = b.wiring()
        assert b.peek("wiringLive") is True, f"cut before write {n}: {sorted(b.flash_files())}"
        assert settings["boardId"] == "trifolium_v1_2"
        assert settings["blasterName"] in ("renamed", "example")

    save = lambda b: b.command('LOAD_DEVICE\n{"schemaVersion":3,"blasterName":"renamed"}')
    assert cut_before_each_write(make_blaster, save, check) == 2  # the temp file, then the rename


def test_a_power_cut_anywhere_in_a_profile_save_leaves_the_old_slot_or_the_new(make_blaster):
    def check(b, n):
        name = b.command("DUMP_PROFILE 0")["name"]
        assert name in ("before", "renamed"), f"cut before write {n}: slot 0 is {name!r}"

    save = lambda b: b.command('LOAD_PROFILE 0\n{"schemaVersion":2,"name":"renamed"}')
    assert cut_before_each_write(make_blaster, save, check) == 2


def test_a_power_cut_anywhere_in_a_splash_upload_leaves_the_old_image_or_the_new(make_blaster):
    def check(b, n):
        stored = b.flash_get("/splash.bin")
        assert stored in (SPLASH_BEFORE, SPLASH_AFTER), f"cut before write {n}: {sorted(b.flash_files())}"

    def save(b):
        b.send(b"LOAD_SPLASH\n" + SPLASH_AFTER)
        b.run_ms(500)

    assert cut_before_each_write(make_blaster, save, check) == 2
