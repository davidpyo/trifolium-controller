"""The device and profile stores, through the path a host uses: what LOAD_DEVICE and LOAD_PROFILE
write is what the next boot reads back, how an enum is read, which files are refused, and which
fields a factory reset keeps - decided by the schema's own onDevice flags, the rule
checks/check_reset.py states from the source."""

import json

import pytest
from helpers import armed_v12, flatten, keyed_nodes, same, schema

WIRING = {"boardId", "wiringConfigured", "escPins", "i2cSdaPin", "i2cSclPin", "batteryAdcPin",
          "speedPotPin", "escEnablePin", "menuButtonPin", "triggerSwitchPin", "revSwitchPin",
          "cycleSwitchPin", "dartSwitchPin", "idleSwitchPin", "safetySwitchPin", "select0Pin",
          "select1Pin", "select2Pin", "pusherDrive", "pusherFetPin", "pusherEscChannel",
          "ledDataPin"}


# What a dump carries around the config: the reply's framing, and the version the save re-stamps.
FRAMING = {"cmd", "index", "schemaVersion"}


def moved(value, node):
    """A value the store can hold that is not `value`, or None if its row allows no other."""
    if isinstance(value, bool):
        return not value
    if isinstance(value, str):
        if node and node.get("optionValues"):
            ids = node["optionValues"]
            return ids[(ids.index(value) + 1) % len(ids)] if value in ids else None
        if node and node.get("kind") == "text":
            charset = node.get("charset") or "A"
            letter = "Q" if "Q" in charset else charset[-1]
            return value + letter if len(value) < node.get("maxLen", 0) else value[:-1]
        return None
    if isinstance(value, (int, float)):
        if node and node.get("display") == "pin":
            return 29 if value == 255 else (value - 1 if value > 0 else value + 1)
        if node and "lo" in node:
            scale = 10 ** node.get("decimals", 0)
            scaled = round(value * scale)
            other = scaled + node["step"] if scaled + node["step"] <= node["hi"] else scaled - node["step"]
            if other < node["lo"] or other == scaled:
                return None
            return other / scale if node.get("decimals") else other
        return value - 1 if value > 0 else value + 1
    return None


def perturb(doc, nodes, store, skip=()):
    """Every leaf the rules above can move, moved. (payload, how many moved)"""
    out = json.loads(json.dumps(doc))
    count = 0

    def visit(value, path, parent, key):
        nonlocal count
        if isinstance(value, dict):
            for k, v in value.items():
                visit(v, f"{path}.{k}" if path else k, value, k)
        elif isinstance(value, list):
            for i, v in enumerate(value):
                visit(v, f"{path}[{i}]", value, i)
        else:
            top = path.split(".")[0].split("[")[0]
            if top in skip or path in FRAMING:
                return
            new = moved(value, nodes.get(f"{store}:{path}"))
            if new is not None:
                parent[key] = new
                count += 1

    visit(out, "", None, None)
    for key in ("cmd", "index"):
        out.pop(key, None)
    return out, count


def explain(store, nodes, sent, now):
    """The leaves that did not come back as sent and are not a clamp into the new bounds."""
    lost = []
    for path, want in flatten(sent).items():
        got = flatten(now).get(path)
        if same(want, got):
            continue
        node = nodes.get(f"{store}:{path}", {})
        if "lo" in node and isinstance(want, (int, float)) and isinstance(got, (int, float)):
            scale = 10 ** node.get("decimals", 0)
            if same(min(node["hi"] / scale, max(node["lo"] / scale, want)), got):
                continue
        lost.append(f"{path}: sent {want!r}, read back {got!r}")
    return lost


def load_device(b, payload):
    ack = b.command("LOAD_DEVICE\n" + json.dumps(payload))
    assert ack and ack["ok"], ack
    assert b.run_until_reboot(2000) and b.wait_booted()


# ---- round trips -----------------------------------------------------------------------------------


def test_every_device_setting_load_device_writes_the_next_boot_reads_back(blaster):
    b = armed_v12(blaster, settle_ms=500)
    nodes = keyed_nodes(schema(b)["tree"])
    sent, count = perturb(b.command("DUMP_DEVICE"), nodes, "device")
    assert count > 60
    load_device(b, sent)
    after = keyed_nodes(schema(b)["tree"])
    lost = explain("device", after, sent, b.command("DUMP_DEVICE"))
    assert not lost, "\n".join(lost)


def test_every_profile_setting_load_profile_writes_the_next_boot_reads_back(blaster):
    b = armed_v12(blaster, settle_ms=500)
    nodes = keyed_nodes(schema(b)["tree"])
    # Fewer modes would drop the last one's fields, which is the count doing its job.
    sent, count = perturb(b.command("DUMP_PROFILE"), nodes, "profile", skip={"activeModeCount"})
    assert count > 20
    slot = b.peek("activeProfileIndex")
    ack = b.command(f"LOAD_PROFILE {slot}\n" + json.dumps(sent))
    assert ack and ack["ok"], ack
    if ack["rebooting"]:
        assert b.run_until_reboot(2000) and b.wait_booted()
    after = keyed_nodes(schema(b)["tree"])
    lost = explain("profile", after, sent, b.command(f"DUMP_PROFILE {slot}"))
    assert not lost, "\n".join(lost)


def test_a_value_past_its_bounds_is_stored_at_the_bound(blaster):
    b = armed_v12(blaster, display=False, settle_ms=100)
    nodes = keyed_nodes(schema(b)["tree"])
    load_device(b, {"schemaVersion": 3, "iThreshold": 9999, "EMAFilter": 99, "rampupTimeout_ms": 1})
    settings = b.command("DUMP_DEVICE")
    assert settings["iThreshold"] == nodes["device:iThreshold"]["hi"]
    assert settings["EMAFilter"] == nodes["device:EMAFilter"]["hi"]
    assert settings["rampupTimeout_ms"] == nodes["device:rampupTimeout_ms"]["lo"]


@pytest.mark.parametrize("change, clamped", [({}, False), ({"iThreshold": 9999}, True)])
def test_load_device_says_clamped_only_when_a_value_was_moved_into_its_bounds(blaster, change,
                                                                               clamped):
    b = armed_v12(blaster, display=False, settle_ms=100)
    doc = {k: v for k, v in b.command("DUMP_DEVICE").items() if k != "cmd"}
    ack = b.command("LOAD_DEVICE\n" + json.dumps({**doc, **change}))
    assert ack["ok"] is True and ack["clamped"] is clamped, ack


@pytest.mark.parametrize("change, clamped", [({}, False), ({"dwellTime_ms": 999999}, True)])
def test_load_profile_to_the_running_slot_says_clamped_only_when_a_value_was_moved(blaster, change,
                                                                                    clamped):
    b = armed_v12(blaster, display=False, settle_ms=100)
    slot = b.peek("activeProfileIndex")
    doc = {k: v for k, v in b.command(f"DUMP_PROFILE {slot}").items() if k not in ("cmd", "index")}
    ack = b.command(f"LOAD_PROFILE {slot}\n" + json.dumps({**doc, **change}))
    assert ack["ok"] is True and ack["clamped"] is clamped, ack


def test_a_body_that_is_not_json_is_refused_as_invalid_json(blaster):
    b = armed_v12(blaster, display=False, settle_ms=100)
    ack = b.command('LOAD_DEVICE\n{"schemaVersion": 3,,}')
    assert ack == {"cmd": "LOAD_DEVICE", "ok": False, "err": "invalid JSON"}


def test_a_blaster_name_is_cut_to_what_the_on_device_editor_can_show(blaster):
    b = armed_v12(blaster, display=False, settle_ms=100)
    node = keyed_nodes(schema(b)["tree"])["device:blasterName"]
    assert "!" not in node["charset"]
    load_device(b, {"schemaVersion": 3, "blasterName": "ABCDEFGHIJKLMNOPQRST!!!"})
    assert b.command("DUMP_DEVICE")["blasterName"] == "ABCDEFGHIJKLMNOPQRST"[:node["maxLen"]]


@pytest.mark.parametrize("stored", [{"/active.cfg": "1"}, {"/mode0.cfg": "2"}])
def test_a_stored_slot_or_firing_mode_does_not_hold_up_the_boot(make_blaster, stored):
    """Read with a timeout of their own: Stream's default waits a second at the end of each file
    for another digit. Firing modes persist on a button build."""
    def booted_at(files):
        b = make_blaster()
        b.flash_preset("trifolium_v1_2", {"selectFireType": "button"})
        for path, data in files.items():
            b.flash_put(path, data)
        b.power_on()
        assert b.wait_booted(10000)
        return b.uptime_ms

    assert booted_at(stored) - booted_at({}) < 50


def test_a_key_the_payload_does_not_carry_keeps_what_the_device_held(blaster):
    b = armed_v12(blaster, {"debounceTime_ms": 35}, display=False, settle_ms=100)
    load_device(b, {"schemaVersion": 3, "rpmDropThreshold": 321})
    settings = b.command("DUMP_DEVICE")
    assert settings["debounceTime_ms"] == 35
    assert settings["rpmDropThreshold"] == 321


def test_rpm_log_length_is_capped_at_what_a_capture_can_allocate(blaster):
    b = armed_v12(blaster, display=False, settle_ms=100)
    load_device(b, {"schemaVersion": 3, "rpmLogLength": 999999})
    assert b.command("DUMP_DEVICE")["rpmLogLength"] == 2000


def test_a_load_profile_to_the_running_slot_takes_effect(blaster):
    """With variableFPS the running slot is the selector's, which need not be /active.cfg's."""
    b = armed_v12(blaster, display=False, settle_ms=100)
    slot = b.peek("activeProfileIndex")
    ack = b.command(f"LOAD_PROFILE {slot}\n" + json.dumps({"schemaVersion": 2, "dwellTime_ms": 2500}))
    assert ack["ok"] and ack["rebooting"] is True
    assert b.run_until_reboot(2000) and b.wait_booted()
    assert b.command("DUMP_PROFILE")["dwellTime_ms"] == 2500


# ---- enums -------------------------------------------------------------------------------------


def test_an_enum_reads_its_id_and_a_bare_ordinal_and_nothing_else(blaster):
    b = armed_v12(blaster, display=False, settle_ms=100)
    for sent, expected in [("6s", "6s"), (0, "3s"), ("7s", "3s"), (4, "3s"), (-1, "3s"), (True, "3s")]:
        load_device(b, {"schemaVersion": 3, "batteryType": sent})
        assert b.command("DUMP_DEVICE")["batteryType"] == expected, sent


def test_dshot_mode_reads_a_bit_rate_as_well_as_an_id_or_an_ordinal(blaster):
    b = armed_v12(blaster, display=False, settle_ms=100)
    for sent, expected in [(600, "dshot600"), (1200, "dshot1200"), ("dshot300", "dshot300"),
                           (1, "dshot600"), (2400, "dshot600")]:
        load_device(b, {"schemaVersion": 3, "dshotMode": sent})
        assert b.command("DUMP_DEVICE")["dshotMode"] == expected, sent


def test_every_enums_stored_ids_are_unique(blaster):
    b = armed_v12(blaster, settle_ms=100)
    for key, node in keyed_nodes(schema(b)["tree"]).items():
        ids = node.get("optionValues")
        if ids:
            assert len(set(ids)) == len(ids), key


# ---- refusals ----------------------------------------------------------------------------------


def test_an_upload_of_another_schema_version_is_refused_and_nothing_changes(blaster):
    b = armed_v12(blaster, display=False, settle_ms=100)
    for version in (2, 4):
        reply = b.command("LOAD_DEVICE\n" + json.dumps({"schemaVersion": version, "blasterName": "x"}))
        assert reply == {"cmd": "LOAD_DEVICE", "ok": False, "err": f"schemaVersion {version} != 3",
                         "applied": False}
    assert b.run_ms(500)
    assert len(b.history) == 0  # no reboot
    assert b.command("DUMP_DEVICE")["blasterName"] == "example"


def test_a_v2_device_file_comes_up_unwired_even_if_it_names_a_board(blaster):
    b = blaster
    b.flash_device({"schemaVersion": 2, "boardId": "trifolium_v1_2", "triggerSwitchPin": 21})
    assert b.boot(100)
    settings = b.command("DUMP_DEVICE")
    assert b.peek("wiringLive") is False
    assert settings["boardId"] == "trifolium_v1_2"
    assert settings["triggerSwitchPin"] == 21
    assert b.pin_mode_calls() == 0


# ---- flash -------------------------------------------------------------------------------------


def test_a_saved_device_file_leaves_no_temp_file_behind(blaster):
    b = armed_v12(blaster, display=False, settle_ms=100)
    load_device(b, {"schemaVersion": 3, "blasterName": "saved"})
    files = b.flash_files()
    assert "/device.cfg" in files
    assert not any(path.endswith(".tmp") for path in files)
    assert b.command("DUMP_DEVICE")["blasterName"] == "saved"


def test_a_corrupt_device_file_boots_on_defaults(make_blaster):
    b = make_blaster()
    b.flash_put("/device.cfg", '{"schemaVersion":3,')
    assert b.boot(100)
    fresh = make_blaster()
    assert fresh.boot(100)
    assert b.command("DUMP_DEVICE") == fresh.command("DUMP_DEVICE")


# ---- factory reset -----------------------------------------------------------------------------


def test_a_factory_reset_clears_exactly_the_settings_the_oled_menu_can_set(make_blaster):
    defaults_board = make_blaster()
    assert defaults_board.boot(100)
    defaults = flatten(defaults_board.command("DUMP_DEVICE"))

    b = armed_v12(make_blaster(), settle_ms=100)
    nodes = keyed_nodes(schema(b)["tree"])
    # The wiring is the preset's, already far from the defaults; moving it too would bring the
    # wiring's own capability limits into the answer.
    sent, _ = perturb(b.command("DUMP_DEVICE"), nodes, "device", skip=WIRING)
    load_device(b, sent)
    live = flatten(b.command("DUMP_DEVICE"))

    ack = b.command("FACTORY_RESET_DEVICE")
    assert ack["ok"] and ack["rebooting"]
    assert b.run_until_reboot(2000) and b.wait_booted()
    reset = flatten(b.command("DUMP_DEVICE"))

    wrong, cleared = [], []
    for path, value in live.items():
        if path in FRAMING:
            continue
        node = nodes.get(f"device:{path}")
        has_row = node is not None and node.get("onDevice", True)
        expected = defaults[path] if has_row else value
        if has_row:
            cleared.append(path)
        if not same(expected, reset.get(path)):
            wrong.append(f"{path} ({'OLED row' if has_row else 'no OLED row'}): expected "
                         f"{expected!r}, reset gave {reset.get(path)!r}")
    print("reset to default:", " ".join(cleared))
    assert len(cleared) > 40
    assert not wrong, "\n".join(wrong)
