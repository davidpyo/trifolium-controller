"""Validates a config bundle against the schema, before anyone loads one onto a blaster.

    python tests/checks/check_bundle.py                    # every blaster in blasters/
    python tests/checks/check_bundle.py path/to/backup.json
    python tests/checks/check_bundle.py --presets          # the wiring presets, against the firmware source
    python tests/checks/check_bundle.py --self-test        # check the checker; reads no bundle

The bundles in blasters/ are what the console loads onto a blank board when someone picks a
blaster config, and some were **transcribed from the old CONFIGURATION.*.h files rather than
captured from hardware**. That is exactly the situation where a silent mistake is easy - a renamed
key lands nowhere, a mistyped enum id reads as the first option, an out-of-range number gets
clamped to something else on arrival - and none of it is visible in a file that parses as JSON.

So every value is checked against the node that owns it. What fails, and what only warns, is the
distinction worth understanding:

**Hard failures** - things that cannot be right for any device running this firmware:

- an enum value absent from that node's `optionValues`, because an id the firmware does not know
  falls back to whatever the field already held rather than being refused;
- a value of the wrong type for its node's `kind`;
- text past `maxLen` or outside the node's charset;
- a schema version the device's `schemaVersionOk()` would reject outright;
- `activeModeCount` disagreeing with the length of `fireModes`, since the shorter of the two wins.

**Warnings** - out-of-range numbers. Range is advisory because some bounds are computed from other
settings rather than fixed: the reference capture reports a `targetDPS` of 15 alongside bounds of
1..9 for that same field, because achievable DPS follows the solenoid timings. A bundle written for
different timings is being measured against the wrong numbers, so a range complaint is a prompt to
look, not a verdict.

Two things that are easy to get wrong and are handled here rather than left to the reader: bounds on
float nodes are scaled integers (10^decimals) while the JSON value is a real float (CLAUDE.md), and
`fireModes[*]` bounds are per-mode via `fireModeCaps` rather than the single copy in the tree.

The schema it checks against is the checked-in fixture, so this needs no device. That is also its
limit: it proves a bundle is well-formed for the firmware the fixture came from, not that the
values suit anyone's hardware.

**Presets are checked against the source, not the fixture** (`--presets`). They are the one genuine
cost of the board table leaving the firmware: a compiled-in table could not go stale, and a file
can. `LOAD_DEVICE` gates on an exact schema version, so a preset written for an older firmware is
refused outright - the right failure, but a failure the table never had. What stops that reaching a
user is this check, and it reads `DeviceStore::CURRENT_SCHEMA_VERSION` and `fromJson()` out of
`src/` rather than a capture, so a schema bump that forgot the presets fails at once instead of
waiting for someone to re-dump a fixture.
"""

import argparse
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCHEMA = os.path.join(ROOT, "tools", "console", "src", "fixtures", "schema.json")

BUNDLE_TS = os.path.join(ROOT, "tools", "console", "src", "config", "bundle.ts")

BOARDS = os.path.join(ROOT, "boards")
DEVICE_STORE_H = os.path.join(ROOT, "src", "deviceStore.h")
DEVICE_STORE_CPP = os.path.join(ROOT, "src", "deviceStore.cpp")
ENUM_IDS_H = os.path.join(ROOT, "src", "enumIds.h")

PRESET_KIND = "trifolium-wiring-preset"

# Keys in a preset file that describe the preset rather than the device. The file doubles as a
# LOAD_DEVICE payload - `send_serial.py COM8 LOAD_DEVICE boards/<id>/board.json` works as it stands - so
# this is the line between its two halves, and check_preset() below is what keeps the line still:
# every key outside this set has to be a known wiring field, so a new descriptive key cannot be
# added without someone noticing it is now being sent to a blaster.
PRESET_DESCRIPTIVE_KEYS = {"kind", "presetVersion", "id", "name", "notes", "unread",
                           "aliases", "diagram", "retired"}

# Keys a preset may carry: the wiring, and the two fields that say where it came from and whether
# it is live. Anything else is a hard failure rather than a note - a preset that carried a tuning
# value would silently reset somebody's solenoid timings when they loaded it to fix a pin, and the
# whole point of a board being separate from a blaster is that it cannot.
PRESET_ALLOWED_KEYS = {
    "boardId", "wiringConfigured",
    "escPins", "i2cSdaPin", "i2cSclPin", "batteryAdcPin", "escEnablePin",
    "menuButtonPin", "triggerSwitchPin", "revSwitchPin", "cycleSwitchPin", "idleSwitchPin",
    "safetySwitchPin", "select0Pin", "select1Pin", "select2Pin",
    "pusherDrive", "pusherFetPin", "ledDataPin",
}

# GPIO 0-29, or PIN_NOT_USED. The chip's range, from types.h - not a board's.
MAX_GPIO_PIN = 29
PIN_NOT_USED = 255


def _console_const(name, fallback):
    """Read a constant out of the console's bundle.ts rather than restating it here.

    Written this way after the first version guessed the value: a checker that disagrees with the
    thing it checks rejects every good file and accepts nothing, which is worse than no checker.
    """
    try:
        with open(BUNDLE_TS, encoding="utf-8") as f:
            m = re.search(rf"export const {name}\s*=\s*(\"[^\"]*\"|\d+)", f.read())
        if m:
            return json.loads(m.group(1))
    except OSError:
        pass
    return fallback


BUNDLE_KIND = _console_const("BUNDLE_KIND", "trifolium-config")
BUNDLE_VERSION = _console_const("BUNDLE_VERSION", 1)

# Stored keys with no menu item, so no schema node describes them. Not errors: ItemStorage marks an
# intentionally keyless row, and these are the mirror case - a stored field the OLED never edits.
# profile:name is no longer among them: it has a TextEditItem now, so it arrives with a maxLen and a
# charset, and a bundle carrying a name the on-device editor could not reproduce should be caught.
KEYLESS = {"device:schemaVersion", "profile:schemaVersion"}


def current_schema_version():
    """DeviceStore::CURRENT_SCHEMA_VERSION, read out of the header rather than restated here."""
    with open(DEVICE_STORE_H, encoding="utf-8") as f:
        m = re.search(r"CURRENT_SCHEMA_VERSION\s*=\s*(\d+)", f.read())
    return int(m.group(1)) if m else None


def store_read_keys():
    """Every key DeviceStore::fromJson() actually reads.

    The mirror of check_keys.py, which proves a schema key resolves to something its store reads.
    A preset key that resolves to nothing is worse than a schema one: it lands nowhere, silently,
    and the user sees a pin that did not move with no error anywhere.
    """
    with open(DEVICE_STORE_CPP, encoding="utf-8") as f:
        src = f.read()
    body = src[src.index("void fromJson("):] if "void fromJson(" in src else src
    return set(re.findall(r'doc\["(\w+)"\]', body))


def enum_ids(name):
    """One id table out of enumIds.h, e.g. kPusherDriveIds -> ["fet", "esc"]."""
    with open(ENUM_IDS_H, encoding="utf-8") as f:
        m = re.search(rf"{name}\[\]\s*=\s*{{([^}}]*)}}", f.read())
    return re.findall(r'"([^"]*)"', m.group(1)) if m else []


def check_preset(preset, path, version, read_keys, drives):
    """(problems, notes) for one wiring preset. Everything here is a hard failure by design."""
    problems, notes = [], []
    name = os.path.basename(path)
    folder = os.path.basename(os.path.dirname(path))

    if preset.get("kind") != PRESET_KIND:
        problems.append(f"kind is {preset.get('kind')!r}, expected {PRESET_KIND!r}")
        return problems, notes
    # The id is the folder's name now, not the file's: every board's file is called board.json.
    if preset.get("id") != folder:
        problems.append(f"id is {preset.get('id')!r} but the folder is {folder}"
                        " - the console offers the id, so the two must agree")
    # The file is sent to the device verbatim, so this is the version the device gates on, not a
    # separate claim about it. A mismatch means LOAD_DEVICE would refuse the preset outright.
    if version is not None and preset.get("schemaVersion") != version:
        problems.append(f"schemaVersion is {preset.get('schemaVersion')}, the firmware speaks "
                        f"{version} - LOAD_DEVICE would refuse this preset outright")

    device = {k: v for k, v in preset.items()
              if k not in PRESET_DESCRIPTIVE_KEYS and k != "schemaVersion"}
    if not device:
        problems.append("no wiring keys - a preset is the wiring, and nothing else")
        return problems, notes

    if device.get("boardId") != preset.get("id"):
        problems.append(f"device.boardId is {device.get('boardId')!r}, not the preset id "
                        f"{preset.get('id')!r} - the stored provenance would name the wrong preset")
    if device.get("wiringConfigured") is not True:
        problems.append("device.wiringConfigured is not true - applying this preset would leave "
                        "the device inert, which is not what a picker offering it promises")

    for key, value in sorted(device.items()):
        if key not in PRESET_ALLOWED_KEYS:
            problems.append(f"device.{key} is not wiring - a preset must not carry it, or loading "
                            "one to fix a pin would quietly change something else")
            continue
        if key not in read_keys:
            problems.append(f"device.{key} is not a key DeviceStore::fromJson() reads"
                            " - it would land nowhere, with nothing to say so")
        if key == "escPins":
            if not isinstance(value, list) or len(value) != 4:
                problems.append(f"device.escPins is {value!r}, expected four channels")
                continue
            for i, pin in enumerate(value):
                problems += pin_problem(f"device.escPins[{i}]", pin)
        elif key == "pusherDrive":
            if value not in drives:
                problems.append(f"device.pusherDrive is {value!r}, not one of {drives}")
        elif key.endswith("Pin"):
            problems += pin_problem(f"device.{key}", value)

    if not PRESET_DESCRIPTIVE_KEYS.isdisjoint(PRESET_ALLOWED_KEYS):
        problems.append("a descriptive key name is also a wiring key name - one of the two would "
                        "be read as the other")

    unread = preset.get("unread")
    if unread:
        # Recorded so the information is not lost, and deliberately outside `device`: no code reads
        # either, on the device or in the console, so they are not config keys.
        for key in unread:
            if key in read_keys:
                problems.append(f"unread.{key} is a key the store now reads - it belongs in "
                                "device, or it will silently do nothing")
        notes.append(f"{len(unread)} value(s) recorded but read by nothing: "
                     + ", ".join(sorted(unread)))
    return problems, notes


def pin_problem(label, value):
    """A GPIO number or PIN_NOT_USED. The chip's range, checked because nobody checked these once
    the schematic stopped being the thing that did."""
    if isinstance(value, bool) or not isinstance(value, int):
        return [f"{label} is {value!r}, not a pin number"]
    if value != PIN_NOT_USED and not (0 <= value <= MAX_GPIO_PIN):
        return [f"{label} is {value}, which is neither GPIO 0-{MAX_GPIO_PIN} nor "
                f"{PIN_NOT_USED} (unused)"]
    return []


def check_board_layout(loaded):
    """The folders have to agree with themselves, now that nothing indexes them.

    Dropping index.json dropped two whole classes of mistake - an order naming a file that does not
    exist, an alias pointing at nothing - because a board's ids now live in the board's own file.
    What it cannot prevent is two boards claiming one id, and that is what this is for: with no
    index, whichever the glob reached first would silently win.

    `loaded` is [(board_id, wiring file)], board_id being the folder's name.
    """
    problems = []
    if not os.path.isdir(BOARDS):
        return [f"no {BOARDS}"]

    ids = {board_id for board_id, _ in loaded}
    claimed = {}
    for board_id, board in loaded:
        # The folder name is the id. Two spellings of it is how a board half-renames itself into
        # one the console offers under a name nothing else uses.
        if board.get("id") != board_id:
            problems.append(f"{board_id}/board.json says id {board.get('id')!r}, "
                            f"which is not its folder's name")
        for old in board.get("aliases") or []:
            if old in ids:
                problems.append(f"{board_id} claims {old!r}, which is also a board's own id")
            if old in claimed:
                problems.append(f"{board_id} and {claimed[old]} both claim {old!r}")
            claimed[old] = board_id

        # Both drawings or neither: the console skips a marker sheet with no art to sit on, so a
        # lone sheet is a day of pad placing that renders nothing and says nothing about why.
        art = os.path.isfile(os.path.join(BOARDS, board_id, "board.svg"))
        pins = os.path.isfile(os.path.join(BOARDS, board_id, "pins.svg"))
        if art != pins:
            have, missing = ("board.svg", "pins.svg") if art else ("pins.svg", "board.svg")
            problems.append(f"{board_id} has {have} but no {missing}, so neither is drawn")

        # A board that is the same design as another names it to use its drawing. The name has to
        # reach a board with both halves, or the Wiring tab quietly falls back to the table; and a
        # board with a drawing of its own draws that, so naming another as well is a dead line.
        shared = board.get("diagram")
        if shared is not None:
            if shared == board_id:
                problems.append(f"{board_id} names itself as the board whose drawing it uses")
            elif not (os.path.isfile(os.path.join(BOARDS, shared, "board.svg"))
                      and os.path.isfile(os.path.join(BOARDS, shared, "pins.svg"))):
                problems.append(f"{board_id} uses the drawing of {shared!r}, which has none")
            if art or pins:
                problems.append(f"{board_id} has a drawing of its own and also names {shared!r}'s"
                                " - its own is the one drawn")
    return problems


def run_presets(paths):
    """The preset mode. Source-derived throughout, so it needs neither a device nor a fixture."""
    version = current_schema_version()
    read_keys = store_read_keys()
    drives = enum_ids("kPusherDriveIds")
    print(f"firmware speaks device schema v{version}; "
          f"DeviceStore::fromJson reads {len(read_keys)} keys\n")

    loaded, failed = [], 0
    for path in paths:
        print(os.path.relpath(path, ROOT))
        with open(path, encoding="utf-8") as f:
            preset = json.load(f)
        loaded.append((os.path.basename(os.path.dirname(path)), preset))
        problems, notes = check_preset(preset, path, version, read_keys, drives)
        for note in notes:
            print(f"  [note] {note}")
        for problem in problems:
            print(f"  [FAIL] {problem}")
        if not problems:
            wiring = [k for k in preset
                      if k not in PRESET_DESCRIPTIVE_KEYS and k != "schemaVersion"]
            print(f"  [OK] {preset.get('name')!r}, {len(wiring)} wiring key(s)")
        failed += len(problems)

    print("\nboards/")
    layout_problems = check_board_layout(loaded)
    for problem in layout_problems:
        print(f"  [FAIL] {problem}")
    if not layout_problems:
        print(f"  [OK] {len(loaded)} board folder(s), ids match their folders, no id claimed twice")
    failed += len(layout_problems)

    print("\n" + ("FAILED" if failed else "OK") + f" - {failed} problem(s)")
    sys.exit(1 if failed else 0)


def load_schema(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def key_map(schema):
    """key -> node, for every node in the tree that carries one."""
    out = {}

    def walk(nodes):
        for node in nodes:
            if node.get("key"):
                out[node["key"]] = node
            walk(node.get("children") or [])

    walk(schema.get("tree") or [])
    return out


def template_key(key):
    """A concrete key reduced to the templated one the schema publishes.

    The shared fire-mode editor is emitted once as `fireModes[*].burstMode`; a bundle carries
    `fireModes[3].burstMode`. Per-motor rows are the other way round - the schema holds each index
    - so this is tried only after an exact match fails.
    """
    return re.sub(r"\[\d+\]", "[*]", key)


def node_for(nodes, key):
    return nodes.get(key) or nodes.get(template_key(key))


FIRE_MODE_RE = re.compile(r"^profile:fireModes\[(\d+)\]\.(\w+)$")


def fire_mode_node(schema, profile, key, node):
    """The bounds that actually apply to one fire mode's field, or None to skip the check.

    The tree publishes `fireModes[*]` once, with whatever mode the walker happened to be in, so
    checking every mode against it is wrong in both directions - it rejects legal values and
    accepts illegal ones. `fireModeCaps` is the per-mode resolution, keyed by burstMode, and a
    field it marks invisible for that mode holds a value nothing reads, so it is not checked at all.
    """
    m = FIRE_MODE_RE.match(key)
    if not m:
        return node
    index, field = int(m.group(1)), m.group(2)
    modes = profile.get("fireModes") or []
    if index >= len(modes):
        return node
    burst = modes[index].get("burstMode")
    for cap in schema.get("fireModeCaps") or []:
        if cap.get("burstMode") != burst:
            continue
        for entry in cap.get("fields") or []:
            if entry.get("key") != f"profile:fireModes[*].{field}":
                continue
            if not entry.get("visible", True):
                return None  # this mode does not use the field; its value is inert
            return dict(node, lo=entry.get("lo", node.get("lo")),
                        hi=entry.get("hi", node.get("hi")))
    return node


def flatten(prefix, value, out):
    """Every leaf of a stored object, as store-qualified keys."""
    if isinstance(value, dict):
        for k, v in value.items():
            flatten(f"{prefix}.{k}" if not prefix.endswith(":") else f"{prefix}{k}", v, out)
    elif isinstance(value, list):
        if value and isinstance(value[0], (dict, list)):
            for i, v in enumerate(value):
                flatten(f"{prefix}[{i}]", v, out)
        else:
            out[prefix] = value  # a scalar array is one field, e.g. revRPM
    else:
        out[prefix] = value
    return out


def real_bounds(node):
    """(lo, hi) in the unit the JSON value is written in."""
    lo, hi = node.get("lo"), node.get("hi")
    if lo is None or hi is None:
        return None, None
    scale = 10 ** (node.get("decimals") or 0)
    if node.get("kind") == "float":
        return lo / scale, hi / scale
    return lo, hi


def check_value(key, value, node, soft=None):
    """Problems with one value. `soft` collects range complaints, which are advisory.

    Range is advisory because some bounds are computed from other settings rather than fixed: the
    fixture this checks against reports `targetDPS` of 15 alongside bounds of 1..9 for the same
    field, because the achievable DPS follows the solenoid timings. A bundle written for different
    timings is measured against the wrong numbers. Type and vocabulary do not move that way, so
    those stay hard failures.
    """
    kind = node.get("kind")
    bad = []
    if soft is None:
        soft = bad

    if kind == "enum" and node.get("optionValues") is not None:
        allowed = node["optionValues"]
        if value not in allowed:
            bad.append(f"{key}: {value!r} is not one of {allowed}")
        return bad

    if kind == "bool":
        if not isinstance(value, bool):
            bad.append(f"{key}: {value!r} is not a boolean")
        return bad

    if kind == "text":
        if not isinstance(value, str):
            bad.append(f"{key}: {value!r} is not a string")
            return bad
        if node.get("maxLen") is not None and len(value) > node["maxLen"]:
            bad.append(f"{key}: {len(value)} chars, max {node['maxLen']}")
        charset = node.get("charset")
        if charset:
            stray = sorted({c for c in value if c not in charset})
            if stray:
                bad.append(f"{key}: characters not in this field's charset: {stray}")
        return bad

    if kind in ("int", "float", "enum"):
        values = value if isinstance(value, list) else [value]
        for v in values:
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                bad.append(f"{key}: {v!r} is not a number")
                continue
            lo, hi = real_bounds(node)
            if lo is not None and not (lo <= v <= hi):
                soft.append(f"{key}: {v} is outside {lo}..{hi} on the reference schema")
    return bad


def check_bundle(bundle, schema, device_version=None):
    """(problems, warnings, notes). Only problems fail: see check_value() on why range is soft.

    `device_version` is what schemaVersionOk() on the device would compare against. It is passed in
    rather than read here so this stays a function of its arguments - main() hands it the version
    grepped out of the firmware source, and the self-test hands it whatever it is testing. Defaults
    to the schema's own, which is right when the capture and the build agree.
    """
    problems, warnings, notes = [], [], []
    nodes = key_map(schema)

    if bundle.get("kind") != BUNDLE_KIND:
        problems.append(f"kind is {bundle.get('kind')!r}, expected {BUNDLE_KIND!r}"
                        " - the console would refuse this file")
    version = bundle.get("bundleVersion")
    if not isinstance(version, int) or version > BUNDLE_VERSION:
        problems.append(f"bundleVersion is {version!r}; this console understands up to "
                        f"{BUNDLE_VERSION}")
    # The build's version, not the capture's: schemaVersionOk() is a fact about the firmware, and
    # a fixture that lags a bump would otherwise fail a bundle the device would happily accept.
    if device_version is None:
        device_version = schema.get("deviceSchemaVersion")
    for field, want in (("deviceSchemaVersion", device_version),
                        ("profileSchemaVersion", schema.get("profileSchemaVersion"))):
        if bundle.get(field) != want:
            problems.append(f"{field} is {bundle.get(field)}, schema says {want}"
                            " - this bundle would be refused by schemaVersionOk()")

    if not isinstance(bundle.get("device"), dict):
        problems.append("no device object")
    if not isinstance(bundle.get("profiles"), list) or not bundle["profiles"]:
        problems.append("no profiles")
    if problems:
        return problems, warnings, notes

    # Per-value checks need a schema that describes this firmware. When the capture predates it,
    # every enum vocabulary and bound in it belongs to a build that no longer exists - judging a
    # correct bundle against it produces confident nonsense, which is worse than no answer. The
    # structural rules below and above do not depend on the capture, so those still run.
    stale_reference = (device_version is not None
                       and schema.get("deviceSchemaVersion") != device_version)
    if stale_reference:
        notes.append("__stale__")

    stores = [] if stale_reference else [("device:", bundle["device"])]
    stores += [] if stale_reference else [("profile:", p) for p in bundle["profiles"]]

    for prefix, payload in stores:
        for key, value in flatten(prefix, payload, {}).items():
            if key in KEYLESS:
                continue
            # A scalar array is one stored field but several schema rows - revRPM is published as
            # revRPM[0..3], bootAction as bootAction[0..7]. Checking the bare key would skip them,
            # and bootAction's elements are enum ids worth validating.
            pairs = [(key, value)]
            if node_for(nodes, key) is None and isinstance(value, list):
                pairs = [(f"{key}[{i}]", v) for i, v in enumerate(value)]

            for subkey, subvalue in pairs:
                node = node_for(nodes, subkey)
                if node is None:
                    notes.append(subkey)
                    continue
                if prefix == "profile:":
                    node = fire_mode_node(schema, payload, subkey, node)
                    if node is None:
                        continue  # the mode does not use this field
                problems.extend(check_value(subkey, subvalue, node, soft=warnings))

    # A fire-mode array longer than activeModeCount is silently truncated by ProfileStore::toJson,
    # so a bundle whose two disagree does not load as written.
    for i, p in enumerate(bundle["profiles"]):
        modes, count = p.get("fireModes"), p.get("activeModeCount")
        if isinstance(modes, list) and isinstance(count, int) and count != len(modes):
            problems.append(f"profiles[{i}]: activeModeCount {count} but {len(modes)} fireModes"
                            " - the shorter of the two is what loads")
    return problems, warnings, sorted(set(notes))


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("bundles", nargs="*", help="bundle JSON files to check")
    parser.add_argument("--presets", action="store_true",
                        help="check trifolium/presets/ against the firmware source instead")
    parser.add_argument("--schema", default=SCHEMA, help="schema capture to check against")
    parser.add_argument("--verbose", action="store_true", help="list the keyless keys")
    parser.add_argument("--self-test", action="store_true",
                        help="check this script's own logic; reads no bundle")
    opts = parser.parse_args()

    if opts.self_test:
        self_test()

    if opts.presets:
        paths = sorted(glob.glob(os.path.join(BOARDS, "*", "board.json")))
        if not paths:
            sys.exit(f"no board folders in {BOARDS}")
        run_presets(paths)

    paths = []
    for pattern in opts.bundles:
        paths.extend(sorted(glob.glob(pattern)) or [pattern])
    if not paths:
        paths = sorted(glob.glob(os.path.join(ROOT, "blasters", "*.json")))
    if not paths:
        sys.exit("no bundles to check")

    schema = load_schema(opts.schema)
    # The fixture is a device capture, so it lags a schema bump until a bench walk re-dumps it -
    # and while it does, every bundle it validates is being measured against the old vocabulary.
    # Said out loud rather than assumed away: a silent pass here is exactly the wrong reassurance.
    firmware_version = current_schema_version()
    if firmware_version is not None and schema.get("deviceSchemaVersion") != firmware_version:
        print(f"[stale] {os.path.relpath(opts.schema, ROOT)} is a v"
              f"{schema.get('deviceSchemaVersion')} capture and the firmware speaks v"
              f"{firmware_version}.\n        Re-dump the fixtures from a device before trusting "
              f"anything below.\n")
    failed = 0
    for path in paths:
        print(os.path.relpath(path, ROOT))
        try:
            with open(path, encoding="utf-8") as f:
                bundle = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            print(f"  [FAIL] unreadable: {e}")
            failed += 1
            continue
        problems, warnings, notes = check_bundle(bundle, schema, firmware_version)
        if "__stale__" in notes:
            notes = [n for n in notes if n != "__stale__"]
            print("  [SKIP] value checks need a current fixture - only the structural rules ran")
        if notes:
            # Stored fields with no menu item, so no schema row describes them. Expected, not a
            # defect - the mirror of ItemStorage's intentionally keyless rows.
            print(f"  [note] {len(notes)} key(s) no schema node describes"
                  + (f": {', '.join(notes)}" if opts.verbose else " (--verbose to list)"))
        for warning in dict.fromkeys(warnings):
            print(f"  [warn] {warning}")
        for problem in problems:
            print(f"  [FAIL] {problem}")
        if not problems:
            print(f"  [OK] board {bundle.get('board')!r}, "
                  f"{len(bundle.get('profiles') or [])} profile(s)"
                  + (f", {len(set(warnings))} value(s) to look at" if warnings else
                     ", nothing to flag"))
        failed += len(problems)

    print("\n" + ("FAILED" if failed else "OK") + f" - {failed} problem(s)")
    sys.exit(1 if failed else 0)


# -------------------------------------------------------------------------------------------


def self_test():
    ok = True

    def expect(label, condition, detail=""):
        nonlocal ok
        if not condition:
            ok = False
        print(f"  [{'PASS' if condition else 'FAIL'}] {label}" + (f" - {detail}" if detail else ""))

    enum_node = {"kind": "enum", "key": "device:batteryType", "options": ["3S", "4S"],
                 "optionValues": ["3s", "4s"], "lo": 0, "hi": 1, "step": 1}
    int_node = {"kind": "int", "key": "device:solenoidExtendTimeHigh_ms", "lo": 5, "hi": 100,
                "step": 1}
    float_node = {"kind": "float", "key": "device:motorConfig[0].kp", "lo": 1, "hi": 200,
                  "step": 1, "decimals": 2}
    bool_node = {"kind": "bool", "key": "device:hasDisplay"}
    text_node = {"kind": "text", "key": "device:blasterName", "maxLen": 14,
                 "charset": "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz "}

    # --- enums: the id has to be one the firmware knows ---
    expect("a known enum id passes", check_value("k", "4s", enum_node) == [])
    expect("an unknown enum id is caught - it would silently keep the old value",
           check_value("k", "7s", enum_node) != [])
    expect("an ordinal where an id belongs is caught", check_value("k", 1, enum_node) != [])
    expect("an empty string is not a free pass", check_value("k", "", enum_node) != [])

    # --- numbers: out of bounds means clamped on arrival, not refused ---
    expect("an in-range int passes", check_value("k", 25, int_node) == [])
    expect("the bounds are inclusive", check_value("k", 5, int_node) == []
           and check_value("k", 100, int_node) == [])
    expect("an over-range int is caught", check_value("k", 101, int_node) != [])
    expect("an under-range int is caught", check_value("k", 4, int_node) != [])
    expect("a string where a number belongs is caught", check_value("k", "25", int_node) != [])
    expect("a bool is not accepted as a number", check_value("k", True, int_node) != [])

    # Float bounds are scaled by 10^decimals while the value stays real - conflating the two would
    # reject every legal float and accept absurd ones.
    expect("a real float inside the scaled bounds passes",
           check_value("k", 0.2, float_node) == [], str(check_value("k", 0.2, float_node)))
    expect("the scaled upper bound is 2.00, not 200",
           check_value("k", 2.0, float_node) == [] and check_value("k", 50.0, float_node) != [])
    expect("a float below the scaled lower bound is caught",
           check_value("k", 0.001, float_node) != [])

    # --- arrays of scalars are checked element by element ---
    rpm = {"kind": "int", "key": "profile:revRPM", "lo": 0, "hi": 60000, "step": 100}
    expect("every element of a scalar array is checked",
           check_value("k", [30000, 30000, 0, 0], rpm) == [])
    expect("one bad element in an array is caught",
           len(check_value("k", [30000, 99999, 0, 0], rpm)) == 1)

    # --- bool and text ---
    expect("a bool passes", check_value("k", False, bool_node) == [])
    expect("a number where a bool belongs is caught", check_value("k", 0, bool_node) != [])
    expect("a short name passes", check_value("k", "Diana", text_node) == [])
    expect("an over-long name is caught",
           check_value("k", "a" * 20, text_node) != [])
    expect("a character outside the charset is caught",
           check_value("k", "Diana!", text_node) != [])

    # --- flattening ---
    flat = flatten("device:", {"a": 1, "m": [{"kp": 2}, {"kp": 3}], "r": [1, 2]}, {})
    expect("nested objects flatten to indexed keys",
           flat.get("device:m[0].kp") == 2 and flat.get("device:m[1].kp") == 3, str(flat))
    expect("a scalar array stays one field", flat.get("device:r") == [1, 2])
    expect("a top-level scalar keeps its bare key", flat.get("device:a") == 1)

    expect("a concrete fire-mode index maps onto the templated key",
           template_key("profile:fireModes[3].burstMode") == "profile:fireModes[*].burstMode")
    expect("a key with no index is unchanged",
           template_key("device:hasDisplay") == "device:hasDisplay")

    # --- per-mode fire-mode bounds ---
    dps = {"kind": "int", "key": "profile:fireModes[*].targetDPS", "lo": 1, "hi": 9, "step": 1}
    caps = {"fireModeCaps": [
        {"burstMode": "auto", "name": "AUTO", "fields": [
            {"key": "profile:fireModes[*].targetDPS", "visible": True, "lo": 1, "hi": 9},
            {"key": "profile:fireModes[*].burstLength", "visible": True, "lo": 1, "hi": 500}]},
        {"burstMode": "safe", "name": "SAFE", "fields": [
            {"key": "profile:fireModes[*].targetDPS", "visible": False, "lo": 1, "hi": 9},
            {"key": "profile:fireModes[*].burstLength", "visible": False, "lo": 2, "hi": 10}]},
        {"burstMode": "devotion", "name": "DEVOTION", "fields": [
            {"key": "profile:fireModes[*].targetDPS", "visible": True, "lo": 2, "hi": 30}]},
    ]}
    prof = {"fireModes": [{"burstMode": "auto"}, {"burstMode": "safe"},
                          {"burstMode": "devotion"}]}

    expect("a field this mode does not use is skipped, not judged",
           fire_mode_node(caps, prof, "profile:fireModes[1].targetDPS", dps) is None)
    expect("a field this mode does use keeps its own bounds",
           fire_mode_node(caps, prof, "profile:fireModes[0].targetDPS", dps)["hi"] == 9)
    expect("per-mode bounds win over the tree's single published copy - the whole point",
           fire_mode_node(caps, prof, "profile:fireModes[2].targetDPS", dps)["hi"] == 30)
    expect("a value legal for this mode but not the tree's copy is accepted",
           check_value("k", 30, fire_mode_node(caps, prof,
                                               "profile:fireModes[2].targetDPS", dps)) == [])
    expect("a value illegal for this mode is still caught",
           check_value("k", 0, fire_mode_node(caps, prof,
                                              "profile:fireModes[0].targetDPS", dps)) != [])
    expect("a mode index past the end of the list falls back to the tree node",
           fire_mode_node(caps, {"fireModes": []}, "profile:fireModes[9].targetDPS", dps) is dps)
    expect("a non-fire-mode key is passed through untouched",
           fire_mode_node(caps, prof, "device:hasDisplay", dps) is dps)

    # --- whole-bundle rules ---
    schema = {"deviceSchemaVersion": 4, "profileSchemaVersion": 2,
              "tree": [{"label": "Battery", "kind": "group", "children": [enum_node]}]}
    good = {"kind": BUNDLE_KIND, "bundleVersion": BUNDLE_VERSION,
            "deviceSchemaVersion": 4, "profileSchemaVersion": 2,
            "device": {"batteryType": "4s"},
            "profiles": [{"fireModes": [{"burstMode": "auto"}], "activeModeCount": 1}]}
    problems, warnings, notes = check_bundle(good, schema)
    expect("a well-formed bundle passes", problems == [], str(problems))
    expect("keys with no schema node are notes, not failures", "profile:fireModes[0].burstMode"
           in notes, str(notes))

    bad_version = dict(good, deviceSchemaVersion=3)
    expect("a schema version the firmware would refuse is caught",
           check_bundle(bad_version, schema)[0] != [])
    expect("a bundle of the wrong kind is caught",
           check_bundle(dict(good, kind="something-else"), schema)[0] != [])
    expect("a bundleVersion newer than the console understands is caught",
           check_bundle(dict(good, bundleVersion=BUNDLE_VERSION + 1), schema)[0] != [])
    expect("a missing bundleVersion is caught",
           check_bundle({k: v for k, v in good.items() if k != "bundleVersion"}, schema)[0] != [])

    # The constants are read from the console rather than restated. The first version of this file
    # guessed "trifolium-config-bundle" and rejected every real save, so the agreement is asserted.
    if os.path.exists(BUNDLE_TS):
        with open(BUNDLE_TS, encoding="utf-8") as f:
            ts = f.read()
        expect("BUNDLE_KIND matches the console's own constant",
               f'export const BUNDLE_KIND = "{BUNDLE_KIND}"' in ts, BUNDLE_KIND)
        expect("BUNDLE_VERSION matches the console's own constant",
               f"export const BUNDLE_VERSION = {BUNDLE_VERSION}" in ts, str(BUNDLE_VERSION))
    expect("a missing device object is caught",
           check_bundle({k: v for k, v in good.items() if k != "device"}, schema)[0] != [])
    expect("a bad enum inside the device object is caught",
           check_bundle(dict(good, device={"batteryType": "9s"}), schema)[0] != [])

    mismatched = dict(good, profiles=[{"fireModes": [{"burstMode": "auto"}], "activeModeCount": 3}])
    expect("activeModeCount disagreeing with the list length is caught",
           check_bundle(mismatched, schema)[0] != [])

    # --- against the repo's own schema and bundles ---
    #
    # Only when the fixture agrees with the firmware. It is a device capture, so it lags a schema
    # bump until a bench walk re-dumps it - and measuring the bundles against a reference the
    # firmware itself would refuse proves nothing in either direction. Skipped loudly: a silent
    # pass here is exactly the wrong reassurance.
    firmware = current_schema_version()
    if os.path.exists(SCHEMA) and firmware is not None:
        captured = load_schema(SCHEMA).get("deviceSchemaVersion")
        if captured != firmware:
            print(f"  [SKIP] the bundle checks below need a current fixture - "
                  f"{os.path.relpath(SCHEMA, ROOT)} is a v{captured} capture and the firmware "
                  f"speaks v{firmware}. Regenerate it: TRIFOLIUM_UPDATE_FIXTURES=1 python -m pytest "
                  f"suite/test_fixtures.py, from tests/.")
    if os.path.exists(SCHEMA):
        real = load_schema(SCHEMA)
        nodes = key_map(real)
        expect("the real schema yields a key map", len(nodes) > 50, f"{len(nodes)} keys")
        expect("the board row is among them", "device:boardId" in nodes)
        stale = firmware is not None and real.get("deviceSchemaVersion") != firmware
        for path in sorted(glob.glob(os.path.join(ROOT, "blasters", "*.json"))):
            if stale:
                continue
            with open(path, encoding="utf-8") as f:
                bundle = json.load(f)
            problems, _, _ = check_bundle(bundle, real, firmware)
            expect(f"{os.path.basename(path)} validates", problems == [], str(problems[:3]))

    # --- the preset mode ---
    good_preset = {
        "kind": PRESET_KIND, "presetVersion": 1, "id": "board_x", "name": "Board X",
        "unread": {"telem": 4},
        "schemaVersion": 3,
        "boardId": "board_x", "wiringConfigured": True, "escPins": [0, 1, 2, 3],
        "i2cSdaPin": 14, "i2cSclPin": 15, "pusherDrive": "fet", "pusherFetPin": 24,
        "ledDataPin": 255,
    }
    read = {"boardId", "wiringConfigured", "escPins", "i2cSdaPin", "i2cSclPin", "pusherDrive",
            "pusherFetPin", "ledDataPin", "solenoidRetractTime_ms", "blasterName"}
    drives = ["fet", "esc"]

    def preset_problems(mutate=None, path="board_x/board.json", version=3):
        p = json.loads(json.dumps(good_preset))
        if mutate:
            mutate(p)
        return check_preset(p, path, version, read, drives)[0]

    expect("a well-formed preset passes", preset_problems() == [], str(preset_problems()))

    # The staleness this mode exists for: a schema bump that forgot the presets. LOAD_DEVICE would
    # refuse the file outright, and the first person to find out would be a user with a bare board.
    expect("a preset written for an older schema is caught",
           preset_problems(version=4) != [])
    expect("a preset whose id disagrees with its filename is caught",
           preset_problems(path="something_else.json") != [])
    expect("a preset whose stored boardId is not its own id is caught",
           preset_problems(lambda p: p.update(boardId="other")) != [])
    expect("a preset that would leave the device inert is caught",
           preset_problems(lambda p: p.update(wiringConfigured=False)) != [])

    # The separation presets/ exists to make structural. A tuning value in a wiring preset would
    # reset somebody's solenoid timings when they loaded it to fix a pin.
    expect("a tuning key in a preset is caught",
           preset_problems(lambda p: p.update(solenoidRetractTime_ms=30)) != [])
    # The mirror of check_keys.py. A preset key the store does not read lands nowhere, silently,
    # and the user sees a pin that did not move with nothing anywhere saying why.
    expect("a key the store does not read is caught",
           check_preset(good_preset, "board_x/board.json", 5, read - {"ledDataPin"}, drives)[0] != [])
    expect("a pin outside the chip's range is caught",
           preset_problems(lambda p: p.update(pusherFetPin=30)) != [])
    expect("PIN_NOT_USED is accepted",
           preset_problems(lambda p: p.update(pusherFetPin=255)) == [])
    expect("a bad pin inside the ESC array is caught",
           preset_problems(lambda p: p.update(escPins=[0, 1, 2, 99])) != [])
    expect("an ESC array of the wrong length is caught",
           preset_problems(lambda p: p.update(escPins=[0, 1])) != [])
    expect("an unknown pusherDrive id is caught",
           preset_problems(lambda p: p.update(pusherDrive="drv")) != [])
    # The file is a payload, so a missing version is not a formatting slip: the device would read
    # it as 0 and refuse the load.
    expect("a preset with no schemaVersion at all is caught",
           preset_problems(lambda p: p.pop("schemaVersion")) != [])
    expect("the descriptive keys and the wiring keys cannot collide",
           PRESET_DESCRIPTIVE_KEYS.isdisjoint(PRESET_ALLOWED_KEYS))
    expect("a file that is not a preset at all is caught",
           preset_problems(lambda p: p.update(kind="trifolium-config")) != [])
    # `unread` is for values nothing reads. One the store has started reading is a field that
    # should have been promoted, and leaving it there means it silently does nothing.
    expect("an unread value the store now reads is caught",
           check_preset(dict(good_preset, unread={"blasterName": 1}), "board_x/board.json", 5,
                        read, drives)[0] != [])

    # The layout check, against made-up folders. What it is for is the mistake the folders cannot
    # rule out on their own: two boards answering to one stored id, where whichever the glob
    # reached first would quietly win.
    twins = [("board_a", {"id": "board_a", "aliases": ["old_one"]}),
             ("board_b", {"id": "board_b", "aliases": ["old_one"]})]
    expect("two boards claiming one old id is caught",
           any("both claim" in p for p in check_board_layout(twins)),
           str(check_board_layout(twins)))
    shadow = [("board_a", {"id": "board_a"}),
              ("board_b", {"id": "board_b", "aliases": ["board_a"]})]
    expect("an alias shadowing a real board id is caught",
           any("also a board" in p for p in check_board_layout(shadow)),
           str(check_board_layout(shadow)))
    renamed = [("board_a", {"id": "board_b"})]
    expect("a board.json whose id is not its folder is caught",
           any("not its folder" in p for p in check_board_layout(renamed)),
           str(check_board_layout(renamed)))
    expect("boards that agree with themselves pass",
           check_board_layout([("board_a", {"id": "board_a", "aliases": ["old_a"]})]) == [],
           str(check_board_layout([("board_a", {"id": "board_a", "aliases": ["old_a"]})])))

    # --- against the repo's own presets and firmware ---
    if os.path.isdir(BOARDS) and os.path.exists(DEVICE_STORE_H):
        version = current_schema_version()
        read_keys = store_read_keys()
        real_drives = enum_ids("kPusherDriveIds")
        expect("the firmware's schema version is readable", version is not None, str(version))
        expect("fromJson's key set is readable", len(read_keys) > 30, f"{len(read_keys)} keys")
        expect("the pusherDrive ids are readable", real_drives == ["fet", "esc"], str(real_drives))
        real = []
        for path in sorted(glob.glob(os.path.join(BOARDS, "*", "board.json"))):
            board_id = os.path.basename(os.path.dirname(path))
            with open(path, encoding="utf-8") as f:
                preset = json.load(f)
            real.append((board_id, preset))
            problems, _ = check_preset(preset, path, version, read_keys, real_drives)
            expect(f"{board_id} validates", problems == [], str(problems[:3]))
        expect("the board folders agree with themselves",
               check_board_layout(real) == [], str(check_board_layout(real)[:3]))

    print("\nself-test " + ("passed" if ok else "FAILED"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
