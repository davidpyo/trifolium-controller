"""DUMP_SCHEMA from a booted blaster, checked node by node against DUMP_DEVICE and DUMP_PROFILE. The
schema is what the console renders and clamps against, so every key it names has to be a key the
stores hold, and every visible value has to sit inside the bounds it advertises.

Each run leaves the capture at .pio/native/schema.json, so checks/check_schema.py can audit the
schema of the source as it stands without a device.
"""

import re
import subprocess
import sys

import pytest
from helpers import armed_v12, schema

from trifolium_sim import PROJECT

sys.path.insert(0, str(PROJECT / "tools"))
import release  # noqa: E402 - the version the release is named for is the one the schema reports

KINDS = {"group", "action", "bool", "int", "float", "enum", "text"}


@pytest.fixture
def captured(blaster):
    b = armed_v12(blaster, settle_ms=500)
    return schema(b), b.command("DUMP_DEVICE"), b.command("DUMP_PROFILE")


def resolve(device, profile, key):
    """"device:motorConfig[1].kp" -> that value in the store's own dump, or KeyError."""
    store, _, path = key.partition(":")
    value = {"device": device, "profile": profile}[store]
    for name, index in re.findall(r"([^.\[\]]+)|\[(\d+)\]", path):
        value = value[name] if name else value[int(index)]
    return value


def walk(tree, device, profile):
    problems, nodes, keyed = [], 0, 0

    def node(n, parent, hidden_above):
        nonlocal nodes, keyed
        nodes += 1
        path = f"{parent}/{n.get('label', '')}"
        # A row under a hidden group is hidden too - Mode 7's fields when three modes are in use,
        # whose keys name slots the profile does not write.
        hidden = hidden_above or n.get("visible") is False
        kind = n.get("kind")
        if kind not in KINDS:
            problems.append(f"{path}: kind {kind!r}")
        config = "storage" not in n
        if kind not in ("group", "action") and config and "key" not in n:
            problems.append(f"{path}: a stored value with no key")
        if "lo" in n:
            if n["lo"] > n["hi"]:
                problems.append(f"{path}: lo > hi")
            if n["step"] <= 0:
                problems.append(f"{path}: step {n['step']}")
        if kind == "enum":
            options = n.get("options") or []
            if not options:
                problems.append(f"{path}: an enum with no options")
            elif "hi" in n and len(options) != n["hi"] - n["lo"] + 1:
                problems.append(f"{path}: options do not match lo..hi")
            if "optionValues" in n and len(n["optionValues"]) != len(options):
                problems.append(f"{path}: optionValues not parallel to options")

        # clampAllSettings() skips hidden rows, so their values carry no promise either.
        if n.get("key") and config and not hidden:
            keyed += 1
            try:
                value = resolve(device, profile, n["key"])
            except (KeyError, IndexError, TypeError):
                problems.append(f"{path}: key {n['key']} is not in the store's dump")
            else:
                problems.extend(check_value(path, n, value))

        for child in n.get("children", []):
            node(child, path, hidden)

    for n in tree:
        node(n, "", False)
    return problems, nodes, keyed


def check_value(path, n, value):
    kind, where = n["kind"], f" ({n['key']})"
    if kind == "bool" and not isinstance(value, bool):
        return [f"{path}: not a bool{where}"]
    if kind == "text":
        if not isinstance(value, str):
            return [f"{path}: not a string{where}"]
        if len(value) > n.get("maxLen", 0):
            return [f"{path}: longer than maxLen{where}"]
    if kind == "enum" and "optionValues" in n:
        if value not in n["optionValues"]:
            return [f"{path}: stored id {value!r} is not among optionValues{where}"]
    elif kind in ("int", "enum", "float") and "lo" in n:
        scaled = round(value * 10 ** n.get("decimals", 0))
        if not n["lo"] <= scaled <= n["hi"]:
            return [f"{path}: value {value} outside [{n['lo']}, {n['hi']}]{where}"]
    return []


def test_the_schemas_header_describes_this_build_and_this_boot(captured):
    s, device, profile = captured
    assert s["fw"] == release.firmware_version((PROJECT / "src" / "global.h").read_text(encoding="utf-8"))
    assert s["boardId"] == "trifolium_v1_2"
    assert s["wiringConfigured"] is True
    assert s["deviceSchemaVersion"] == device["schemaVersion"] == 3
    assert s["profileSchemaVersion"] == profile["schemaVersion"] == 2
    assert s["profileCount"] == 3
    assert s["pinConflicts"] == []
    assert s["activeModeCount"] == profile["activeModeCount"]


def test_every_schema_node_names_a_stored_key_and_sits_inside_its_own_bounds(captured):
    s, device, profile = captured
    problems, nodes, keyed = walk(s["tree"], device, profile)
    print(f"{nodes} nodes, {keyed} keyed to a stored value")
    assert nodes > 50
    assert not problems, "\n".join(problems)


def test_every_burst_modes_capabilities_name_fields_the_fire_mode_editor_has(captured):
    s, _, _ = captured
    caps = s["fireModeCaps"]
    assert {c["burstMode"] for c in caps} >= {"auto", "burst", "binary", "safe", "semi", "devotion",
                                              "plasma"}
    for mode in caps:
        assert mode["name"] == mode["burstMode"].upper()
        for field in mode["fields"]:
            assert field["key"].startswith("profile:fireModes[*].")


# Which fields each mode uses - the console and the OLED hide the rest.
USES = {  # burstLength, targetDPS, reversible
    "auto": (True, True, False), "burst": (True, True, True), "binary": (True, True, False),
    "safe": (False, False, False), "semi": (False, True, True), "devotion": (False, False, False),
    "plasma": (False, False, False),
}


def test_each_burst_mode_shows_exactly_the_settings_it_uses(captured):
    s, _, _ = captured
    for mode in s["fireModeCaps"]:
        visible = {f["key"].rsplit(".", 1)[1]: f["visible"] for f in mode["fields"]}
        uses = USES[mode["burstMode"]]
        assert (visible["burstLength"], visible["targetDPS"], visible["reversible"]) == uses, \
            mode["burstMode"]


def as_rule_value(value):
    """A stored value as a visibleWhen term writes it: "true", "255", "stage"."""
    return ("true" if value else "false") if isinstance(value, bool) else str(value)


def rule_disagreements(tree, device, profile):
    """Nodes whose visibleWhen, evaluated against the stores, says other than their visible flag.
    Also how many rules there were."""
    wrong, rules = [], 0

    def node(n, parent):
        nonlocal rules
        path = f"{parent}/{n.get('label', '')}"
        terms = n.get("visibleWhen")
        if terms:
            rules += 1
            holds = all((as_rule_value(resolve(device, profile, t["key"])) == t["value"])
                        == (t["op"] == "eq") for t in terms)
            if holds != (n.get("visible") is not False):
                wrong.append(f"{path}: rule {terms} gives {holds}, visible is {n.get('visible')}")
        for child in n.get("children", []):
            node(child, path)

    for n in tree:
        node(n, "")
    return wrong, rules


def visibility(tree):
    seen = {}

    def node(n, parent):
        path = f"{parent}/{n.get('label', '')}"
        seen[path] = n.get("visible") is not False
        for child in n.get("children", []):
            node(child, path)

    for n in tree:
        node(n, "")
    return seen


def test_every_visibility_rule_gives_the_devices_own_answer_before_and_after_its_field_moves(blaster):
    """The console re-evaluates visibleWhen as the user edits, so each rule has to agree with the
    predicate the device used for the visible flag beside it."""
    b = armed_v12(blaster, settle_ms=500)
    before = schema(b)
    wrong, rules = rule_disagreements(before["tree"], b.command("DUMP_DEVICE"),
                                      b.command("DUMP_PROFILE"))
    assert rules > 10
    assert not wrong, "\n".join(wrong)

    ack = b.command('LOAD_DEVICE\n{"schemaVersion":3,"flywheelControl":"tbh","pusherType":"none",'
                    '"selectFireType":"button"}')
    assert ack["ok"], ack
    if ack.get("rebooting"):
        assert b.run_until_reboot(2000) and b.wait_booted()
    after = schema(b)
    wrong, _ = rule_disagreements(after["tree"], b.command("DUMP_DEVICE"), b.command("DUMP_PROFILE"))
    assert not wrong, "\n".join(wrong)

    old, new = visibility(before["tree"]), visibility(after["tree"])
    moved = sorted(path for path in old.keys() & new.keys() if old[path] != new[path])
    for row in ("EMA Filter", "Throttle Cap", "Extend @ High V (ms)", "Default Mode"):
        assert any(path.endswith("/" + row) for path in moved), moved


def test_check_schema_passes_on_the_capture(captured):
    tool = PROJECT / "tests" / "checks" / "check_schema.py"
    result = subprocess.run([sys.executable, str(tool), str(PROJECT / ".pio" / "native" / "schema.json")],
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stdout[-3000:] + result.stderr[-2000:]
