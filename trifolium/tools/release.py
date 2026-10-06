"""Builds the publishable artifacts: the universal .uf2, its checksums, and a manifest.

    python tools/release.py                 # build [env:pico], stage release/
    python tools/release.py --allow-dirty   # ... from a tree with uncommitted changes
    python tools/release.py --version       # print the version global.h declares, and stop
    python tools/release.py --self-test     # check the checker; builds nothing

    python tools/release.py --board trifolium_v1_4 --blaster blasters/fencer.json
                                            # a factory image for one board and config

What lands in `release/`:

    trifolium-<version>-universal.uf2   the published firmware - ships with NO wiring at all
    SHA256SUMS.txt                      checksums for everything alongside it
    MANIFEST.txt                        version, git commit, and every dependency pin

There is one environment and this is it. No build carries a wiring - `kDefaultDeviceSettings` has
every pin unused and `wiringConfigured` false - so a device flashed with this drives no GPIO until a
preset is loaded, and there is no published-versus-contributor distinction left to police. What the
image does carry from CONFIGURATION.h is the *tuning* defaults, which is fine: they are values a
user can see and change, unlike a pinout they could not discover.

Two things are refused rather than warned about, because each one produces an artifact that cannot
be reproduced later from the tag it claims to come from:

- a floating dependency (tools/check_deps.py),
- a dirty working tree (--allow-dirty to override deliberately).

Publishing is the release workflow's (.github/workflows/release-and-site.yml): when global.h's version
has no release yet, it runs this in a clean checkout and makes a release of the .uf2 alone - the
checksums and manifest stay with whoever built it. A release carries firmware only. The console is published on the site, built by the same workflow,
and tests/bench/bench_acceptance.py is what qualifies an image on hardware.

A factory image (--board with --blaster) is for bringing a batch of blasters to one config by
flashing alone. It is the same firmware plus a whole settings area - the LittleFS region - holding
that board's pins and the config's other settings and three profiles, combined as the console's
new-blaster wizard combines them. Flashing it replaces everything the blaster held, every time, as
though it were a bare board; flashing the universal image afterwards leaves the settings alone, as
it always does. The config is any Full Backup. Factory images are not published, so a dirty tree
is no reason to refuse one.
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile

TOOLS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS)
RELEASE_DIR = os.path.join(ROOT, "release")
GLOBAL_H = os.path.join(ROOT, "src", "global.h")
DEVICE_STORE_H = os.path.join(ROOT, "src", "deviceStore.h")
PROFILE_STORE_H = os.path.join(ROOT, "src", "profileStore.h")
BOARDS = os.path.join(ROOT, "boards")
# The firmware's schema as the console's tests capture it, kept current by tests/suite. It is what
# says which settings are pins.
SCHEMA_CAPTURE = os.path.join(ROOT, "tools", "console", "src", "fixtures", "schema.json")
MKLITTLEFS = os.path.join(os.path.expanduser("~"), ".platformio", "packages",
                          "tool-mklittlefs-rp2040-earlephilhower",
                          "mklittlefs.exe" if os.name == "nt" else "mklittlefs")
# The platform installs mklittlefs only for a filesystem build, so a machine that has never made one
# lacks it. This is the range the pinned platform's platform.json gives it; a new platform pin may
# move it.
MKLITTLEFS_SPEC = "earlephilhower/tool-mklittlefs-rp2040-earlephilhower@~5.100300.0"

BUILD_ENV = "pico"
BUNDLE_KIND = "trifolium-config"
PIN_NOT_USED = 255
# LittleFS as the core mounts it: 256-byte pages in 4 KB blocks, the platform's FS_PAGE and FS_BLOCK.
FS_PAGE = 256
FS_BLOCK = 4096
UF2_MAGIC = (0x0A324655, 0x9E5D5157, 0x0AB16F30)
UF2_FLAG_FAMILY = 0x00002000
# Keys in a board.json that describe the board rather than set anything on the device.
PRESET_DESCRIPTIVE_KEYS = {"kind", "presetVersion", "id", "name", "notes", "unread", "schemaVersion",
                           "aliases", "diagram", "retired"}


def firmware_version(text):
    """Reads MAJOR/MINOR/PATCH out of global.h, which is the version DUMP_SCHEMA reports as `fw`."""
    parts = []
    for name in ("MAJOR_VERSION", "MINOR_VERSION", "PATCH_VERSION"):
        m = re.search(rf"^#define\s+{name}\s+(\d+)\s*$", text, re.M)
        if not m:
            return None
        parts.append(m.group(1))
    return ".".join(parts)


def artifact_name(version):
    return f"trifolium-{version}-universal.uf2"


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(65536), b""):
            h.update(block)
    return h.hexdigest()


def find_pio():
    exe = "pio.exe" if os.name == "nt" else "pio"
    candidate = os.path.join(os.path.expanduser("~"), ".platformio", "penv",
                             "Scripts" if os.name == "nt" else "bin", exe)
    return candidate if os.path.isfile(candidate) else "pio"


def run(args, cwd=ROOT, env=None):
    env_vars = dict(os.environ, PYTHONIOENCODING="utf-8", **(env or {}))
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", env=env_vars)


def git_state():
    head = run(["git", "rev-parse", "HEAD"])
    status = run(["git", "status", "--porcelain"])
    if head.returncode != 0:
        return None, None
    dirty = [line for line in (status.stdout or "").splitlines() if line.strip()]
    return head.stdout.strip(), dirty


def build(env):
    """The built .uf2 and the build's log, or (None, log)."""
    print(f"  building [env:{env}] ...")
    proc = run([find_pio(), "run", "-e", env])
    log = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode != 0:
        print("\n".join(log.strip().splitlines()[-25:]))
        return None, log
    uf2 = os.path.join(ROOT, ".pio", "build", env, "firmware.uf2")
    return (uf2 if os.path.isfile(uf2) else None), log


def settings_region(build_log):
    """Where the settings area (the LittleFS region) sits in flash, as the platform's build prints it."""
    m = re.search(r"Filesystem start: (0x[0-9a-fA-F]+) Filesystem end: (0x[0-9a-fA-F]+)", build_log)
    return (int(m.group(1), 16), int(m.group(2), 16)) if m else None


def read_uf2(data):
    """[(address, payload, family)] for each block of a .uf2."""
    blocks = []
    for at in range(0, len(data), 512):
        block = data[at:at + 512]
        magic0, magic1, flags, addr, size, _, _, family = struct.unpack_from("<8I", block)
        if (magic0, magic1, struct.unpack_from("<I", block, 508)[0]) != UF2_MAGIC:
            raise ValueError(f"not a UF2 block at byte {at}")
        blocks.append((addr, block[32:32 + size], family if flags & UF2_FLAG_FAMILY else None))
    return blocks


def factory_uf2(program, settings, region_start, family):
    """One .uf2 of a program's blocks and a whole settings-area image, numbered as one file.

    Every 4 KB sector the program touches is filled out with zeros, as the platform's own merge
    does: the RP2040 mishandles an image of several parts that writes only some of a sector.
    """
    pages = {addr: payload for addr, payload, _ in program}
    for sector in {addr & ~(FS_BLOCK - 1) for addr in pages}:
        for addr in range(sector, sector + FS_BLOCK, FS_PAGE):
            pages.setdefault(addr, bytes(FS_PAGE))
    for offset in range(0, len(settings), FS_PAGE):
        pages[region_start + offset] = settings[offset:offset + FS_PAGE]
    ordered = sorted(pages.items())
    return b"".join(
        struct.pack("<8I", UF2_MAGIC[0], UF2_MAGIC[1], UF2_FLAG_FAMILY, addr, len(payload), number,
                    len(ordered), family) + payload.ljust(476, b"\0") + struct.pack("<I", UF2_MAGIC[2])
        for number, (addr, payload) in enumerate(ordered))


def store_constant(header, name):
    """A `constexpr` integer out of a store header, rather than restated here."""
    with open(header, encoding="utf-8") as f:
        m = re.search(rf"\b{name}\s*=\s*(\d+)", f.read())
    return int(m.group(1)) if m else None


def pin_keys(schema):
    """The device settings the schema shows as pins, by their name in the device config."""
    keys = set()

    def walk(nodes):
        for node in nodes:
            key = node.get("key") or ""
            if node.get("display") == "pin" and key.startswith("device:"):
                keys.add(re.sub(r"\[\d+\]$", "", key[len("device:"):]))
            walk(node.get("children") or [])

    walk(schema.get("tree") or [])
    return keys


def factory_problems(bundle, preset, device_version, profile_version, slots):
    """Why a config and board cannot make a factory image, or [] when they can."""
    problems = []
    if bundle.get("kind") != BUNDLE_KIND:
        problems.append("the config is not a Full Backup")
        return problems
    if bundle.get("deviceSchemaVersion") != device_version:
        problems.append(f"the config's device settings are schema v{bundle.get('deviceSchemaVersion')}, "
                        f"and this firmware speaks v{device_version}")
    if bundle.get("profileSchemaVersion") != profile_version:
        problems.append(f"the config's profiles are schema v{bundle.get('profileSchemaVersion')}, "
                        f"and this firmware speaks v{profile_version}")
    if not isinstance(bundle.get("device"), dict):
        problems.append("the config has no device settings")
    if not isinstance(bundle.get("profiles"), list) or len(bundle["profiles"]) != slots:
        problems.append(f"the config does not hold {slots} profiles")
    if preset.get("schemaVersion") != device_version:
        problems.append(f"the board was written for device schema v{preset.get('schemaVersion')}, "
                        f"and this firmware speaks v{device_version}")
    return problems


def fill_unused(board_value, config_value):
    """The config's pin where the board leaves the slot unused, unnamed or named as unused, and the
    board's otherwise. ESC channels go one by one."""
    if isinstance(config_value, list):
        ours = board_value if isinstance(board_value, list) else []
        return [fill_unused(ours[i] if i < len(ours) else None, pin)
                for i, pin in enumerate(config_value)]
    return config_value if board_value is None or board_value == PIN_NOT_USED else board_value


def saved_on(bundle, preset):
    """Whether the config was saved on this board, under its id or one it used to have."""
    board = bundle.get("board")
    return board == preset.get("id") or board in (preset.get("aliases") or [])


def factory_device(bundle, preset, pins, device_version):
    """The board's pins and the config's every other setting - the console wizard's rule. On the
    board the config was saved on, a pin the board leaves unused is the config's, since that is the
    blaster's own wiring - on a bare module, which claims no pins, all of it.

    A pin neither names is left out, so the firmware's default stands.
    """
    wiring = {k: v for k, v in preset.items() if k not in PRESET_DESCRIPTIVE_KEYS}
    settings = {k: v for k, v in bundle["device"].items() if k not in pins}
    own = ({k: fill_unused(wiring.get(k), v) for k, v in bundle["device"].items() if k in pins}
           if saved_on(bundle, preset) else {})
    return {**wiring, **settings, **own, "boardId": preset["id"], "wiringConfigured": True,
            "schemaVersion": device_version}


def factory_files(bundle, preset, pins, device_version, profile_version):
    """The settings area's files, by name: what DeviceStore and ProfileStore read at boot."""
    files = {"device.cfg": factory_device(bundle, preset, pins, device_version)}
    for slot, profile in enumerate(bundle["profiles"]):
        files[f"profile{slot}.cfg"] = dict(profile, schemaVersion=profile_version)
    return files


def factory_name(version, blaster_path, board):
    blaster = re.sub(r"[^A-Za-z0-9_-]+", "-", os.path.splitext(os.path.basename(blaster_path))[0])
    return f"trifolium-{version}-{blaster.strip('-') or 'blaster'}-{board}.uf2"


def ensure_mklittlefs():
    """Installs mklittlefs if it is not there yet. False if it still is not."""
    if os.path.isfile(MKLITTLEFS):
        return True
    print(f"    installing {MKLITTLEFS_SPEC} ...")
    proc = run([find_pio(), "pkg", "install", "--global", "--tool", MKLITTLEFS_SPEC])
    if proc.returncode != 0 or not os.path.isfile(MKLITTLEFS):
        print((proc.stdout or "") + (proc.stderr or ""))
        return False
    return True


def settings_image(files, size):
    """A LittleFS image of `size` bytes holding `files`, made as the platform's buildfs makes one."""
    if not ensure_mklittlefs():
        return None
    with tempfile.TemporaryDirectory() as work:
        os.mkdir(os.path.join(work, "data"))
        for filename, content in files.items():
            with open(os.path.join(work, "data", filename), "w", encoding="utf-8") as f:
                json.dump(content, f)
        # Relative paths: mklittlefs puts "./" in front of a directory it is given.
        proc = run([MKLITTLEFS, "-c", "data", "-p", str(FS_PAGE), "-b", str(FS_BLOCK),
                    "-s", str(size), "settings.bin"], cwd=work)
        if proc.returncode != 0:
            print((proc.stdout or "") + (proc.stderr or ""))
            return None
        with open(os.path.join(work, "settings.bin"), "rb") as f:
            return f.read()


def factory(version, blaster_path, board):
    preset_path = os.path.join(BOARDS, board, "board.json")
    if not os.path.isfile(preset_path):
        boards = sorted(d for d in os.listdir(BOARDS) if os.path.isfile(os.path.join(BOARDS, d, "board.json")))
        sys.exit(f"no board '{board}' in boards/ - one of: {', '.join(boards)}")
    try:
        with open(blaster_path, encoding="utf-8") as f:
            bundle = json.load(f)
    except (OSError, ValueError) as e:
        sys.exit(f"cannot read {blaster_path}: {e}")
    with open(preset_path, encoding="utf-8") as f:
        preset = json.load(f)
    with open(SCHEMA_CAPTURE, encoding="utf-8") as f:
        schema = json.load(f)

    device_version = store_constant(DEVICE_STORE_H, "CURRENT_SCHEMA_VERSION")
    profile_version = store_constant(PROFILE_STORE_H, "CURRENT_SCHEMA_VERSION")
    slots = store_constant(PROFILE_STORE_H, "MAX_PROFILE_COUNT")
    problems = factory_problems(bundle, preset, device_version, profile_version, slots)
    if schema.get("deviceSchemaVersion") != device_version:
        problems.append(f"{os.path.relpath(SCHEMA_CAPTURE, ROOT)}, which names the pins, is a "
                        f"v{schema.get('deviceSchemaVersion')} capture - regenerate it")
    if problems:
        for problem in problems:
            print(f"  [REFUSED] {problem}")
        sys.exit("\nrefusing to build the factory image")

    # The universal build as it stands. Anything PlatformIO took for a change of configuration -
    # a data_dir, say - would have it clean every environment's build, the simulator's included.
    uf2, log = build(BUILD_ENV)
    if not uf2:
        sys.exit(f"[env:{BUILD_ENV}] did not build")
    region = settings_region(log)
    if not region:
        sys.exit("the build did not say where the settings area is (\"Filesystem start: ...\")")
    files = factory_files(bundle, preset, pin_keys(schema), device_version, profile_version)
    settings = settings_image(files, region[1] - region[0])
    if settings is None or len(settings) != region[1] - region[0]:
        sys.exit("mklittlefs did not make the settings area")
    with open(uf2, "rb") as f:
        program = read_uf2(f.read())

    name = factory_name(version, blaster_path, board)
    os.makedirs(RELEASE_DIR, exist_ok=True)
    with open(os.path.join(RELEASE_DIR, name), "wb") as f:
        f.write(factory_uf2(program, settings, region[0], program[0][2]))
    blaster_name = bundle["device"].get("blasterName") or os.path.basename(blaster_path)
    pins_from = f"{preset.get('name', board)}'s pins"
    if saved_on(bundle, preset):
        pins_from += ", and the config's wherever the board leaves one unused"
    print(f"\n  {name}\n    {blaster_name}'s settings and profiles, with {pins_from}")
    print(f"\nflashing it replaces everything the blaster holds, every time:\n  {RELEASE_DIR}")


def dependency_pins():
    sys.path.insert(0, TOOLS)
    import check_deps  # noqa: PLC0415 - imported here so --self-test needs no platformio.ini read

    with open(check_deps.INI, encoding="utf-8") as f:
        specs = check_deps.wanted_specs(f.read())
    return specs, check_deps.unpinned(specs)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--allow-dirty", action="store_true",
                        help="build from a tree with uncommitted changes")
    parser.add_argument("--version", action="store_true",
                        help="print the version global.h declares, and stop")
    parser.add_argument("--self-test", action="store_true",
                        help="check this script's own logic; builds nothing")
    parser.add_argument("--board", help="the board a factory image is for, a folder in boards/")
    parser.add_argument("--blaster", help="the Full Backup a factory image carries")
    opts = parser.parse_args()
    if bool(opts.board) != bool(opts.blaster):
        parser.error("a factory image needs both --board and --blaster")

    if opts.self_test:
        self_test()

    with open(GLOBAL_H, encoding="utf-8") as f:
        version = firmware_version(f.read())
    if not version:
        sys.exit("could not read the version out of src/global.h")
    if opts.version:
        print(version)
        return
    print(f"trifolium {version}")

    specs, floating = dependency_pins()
    if floating:
        for spec in floating:
            print(f"  [FLOAT] {spec['name']} - {spec['why']}")
        sys.exit("\nrefusing to build: a release from a floating dependency cannot be rebuilt "
                 "later from the same source. See tools/check_deps.py")
    print(f"  {len(specs)} dependencies, all pinned")

    if opts.blaster:
        factory(version, opts.blaster, opts.board)
        return

    commit, dirty = git_state()
    if dirty:
        for line in dirty[:10]:
            print(f"  [DIRTY] {line}")
        if not opts.allow_dirty:
            sys.exit("\nrefusing to build: the working tree has uncommitted changes, so the "
                     "artifact could not be rebuilt from its commit. Pass --allow-dirty to "
                     "override deliberately.")
        print("  building dirty anyway, as asked")

    uf2, _ = build(BUILD_ENV)
    if not uf2:
        sys.exit(f"[env:{BUILD_ENV}] did not build")

    os.makedirs(RELEASE_DIR, exist_ok=True)
    name = artifact_name(version)
    staged = os.path.join(RELEASE_DIR, name)
    shutil.copy2(uf2, staged)
    print(f"  staged {name}")

    lines = [f"trifolium {version}",
             f"commit      {commit or 'unknown'}{' (dirty)' if dirty else ''}",
             f"environment {BUILD_ENV}",
             "wiring      none - loaded by the user from a preset on first connect",
             "",
             "dependency pins:"]
    lines += [f"  {s['name']} @ {s['pin']}" for s in specs]
    with open(os.path.join(RELEASE_DIR, "MANIFEST.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    sums = [name, "MANIFEST.txt"]
    with open(os.path.join(RELEASE_DIR, "SHA256SUMS.txt"), "w", encoding="utf-8") as f:
        for entry in sums:
            f.write(f"{sha256_of(os.path.join(RELEASE_DIR, entry))}  {entry}\n")

    print(f"\nrelease/ is ready:\n  {RELEASE_DIR}")
    print("\nbefore publishing, qualify the image on hardware:")
    print("  python tests/bench/bench_acceptance.py COM8 baseline   # BEFORE flashing the image")
    print("  python tests/bench/bench_acceptance.py COM8 verify")


# -------------------------------------------------------------------------------------------


def self_test():
    ok = True

    def expect(label, condition, detail=""):
        nonlocal ok
        if not condition:
            ok = False
        print(f"  [{'PASS' if condition else 'FAIL'}] {label}" + (f" - {detail}" if detail else ""))

    header = "#pragma once\n#define MAJOR_VERSION 2\n#define MINOR_VERSION 0\n#define PATCH_VERSION 1\n"
    expect("the version is read out of global.h", firmware_version(header) == "2.0.1",
           str(firmware_version(header)))
    expect("a missing component is caught rather than defaulted",
           firmware_version("#define MAJOR_VERSION 2\n") is None)
    expect("a commented-out define is not read",
           firmware_version(header.replace("#define MINOR_VERSION 0",
                                           "// #define MINOR_VERSION 0")) is None)
    expect("the artifact says what it is", artifact_name("2.0.1") ==
           "trifolium-2.0.1-universal.uf2", artifact_name("2.0.1"))

    # The real global.h, so a renamed constant fails here rather than at release time.
    if os.path.exists(GLOBAL_H):
        with open(GLOBAL_H, encoding="utf-8") as f:
            real = firmware_version(f.read())
        expect("the repo's own global.h still parses", real is not None, str(real))

    specs, floating = dependency_pins()
    expect("the repo's dependencies are all pinned", not floating,
           str([s["raw"] for s in floating]))
    expect("the platform is one of the pins checked",
           any(s["option"] == "platform" for s in specs))

    # --- the factory image ---
    preset = {"kind": "trifolium-wiring-preset", "id": "board_x", "name": "Board X", "schemaVersion": 3,
              "boardId": "board_x", "wiringConfigured": True, "menuButtonPin": 19,
              "pusherFetPin": 24, "pusherDrive": "fet", "notes": ["n"]}
    bundle = {"kind": BUNDLE_KIND, "deviceSchemaVersion": 3, "profileSchemaVersion": 2,
              "device": {"menuButtonPin": 8, "safetySwitchPin": 5, "pusherDrive": "esc",
                         "blasterName": "Kit", "boardId": "board_y", "wiringConfigured": False},
              "profiles": [{"name": "Low"}, {"name": "Medium"}, {"name": "High"}]}
    pins = {"menuButtonPin", "pusherFetPin", "safetySwitchPin"}
    device = factory_device(bundle, preset, pins, 3)
    expect("the pins are the board's", device["menuButtonPin"] == 19 and device["pusherFetPin"] == 24,
           str(device))
    expect("every other setting is the config's",
           device["pusherDrive"] == "esc" and device["blasterName"] == "Kit", str(device))
    expect("a pin the board does not name is left to the firmware's default",
           "safetySwitchPin" not in device, str(device))
    own_board = dict(preset, cycleSwitchPin=255, escPins=[0, 1, 255, 255], aliases=["board_x_old"])
    on_it = dict(bundle, board="board_x", device=dict(bundle["device"], cycleSwitchPin=5,
                                                       escPins=[0, 1, 2, 3]))
    pins_too = pins | {"cycleSwitchPin", "escPins"}
    device = factory_device(on_it, own_board, pins_too, 3)
    expect("on the board it was saved on, the config fills the pins the board leaves unused",
           device["cycleSwitchPin"] == 5 and device["safetySwitchPin"] == 5
           and device["escPins"] == [0, 1, 2, 3], str(device))
    expect("and the pins the board names are still the board's",
           device["menuButtonPin"] == 19 and device["pusherFetPin"] == 24, str(device))
    expect("a config saved under one of the board's old ids counts as saved on it",
           factory_device(dict(on_it, board="board_x_old"), own_board, pins_too, 3)
           ["cycleSwitchPin"] == 5)
    expect("the device is the board, wired", device["boardId"] == "board_x"
           and device["wiringConfigured"] is True and device["schemaVersion"] == 3, str(device))
    expect("the board's description is not written to the device",
           "notes" not in device and "kind" not in device, str(device))
    files = factory_files(bundle, preset, pins, 3, 2)
    expect("the settings area holds the device and each slot",
           sorted(files) == ["device.cfg", "profile0.cfg", "profile1.cfg", "profile2.cfg"], str(sorted(files)))
    expect("each profile is stamped with the profile schema", files["profile1.cfg"] ==
           {"name": "Medium", "schemaVersion": 2}, str(files["profile1.cfg"]))
    expect("a good config and board make an image", factory_problems(bundle, preset, 3, 2, 3) == [])
    expect("a config for another device schema is refused",
           factory_problems(dict(bundle, deviceSchemaVersion=2), preset, 3, 2, 3) != [])
    expect("a config for another profile schema is refused",
           factory_problems(dict(bundle, profileSchemaVersion=1), preset, 3, 2, 3) != [])
    expect("a board for another schema is refused",
           factory_problems(bundle, dict(preset, schemaVersion=2), 3, 2, 3) != [])
    expect("a config short of a slot is refused",
           factory_problems(dict(bundle, profiles=[{}, {}]), preset, 3, 2, 3) != [])
    expect("a preset is not taken for a config",
           factory_problems(preset, preset, 3, 2, 3) != [])
    expect("the image is named for the config and the board",
           factory_name("2.1.0", "blasters/fencer.json", "trifolium_v1_4") ==
           "trifolium-2.1.0-fencer-trifolium_v1_4.uf2")
    expect("a backup's name is made safe for a file name",
           factory_name("2.1.0", "C:/x/Ophid 2 (mine).json", "b") == "trifolium-2.1.0-Ophid-2-mine-b.uf2",
           factory_name("2.1.0", "C:/x/Ophid 2 (mine).json", "b"))

    log = "Maximium Sketch size: 1 EEPROM start: 0x101ff000 Filesystem start: 0x1017f000 Filesystem end: 0x101ff000"
    expect("the settings area is read out of the build's log",
           settings_region(log) == (0x1017F000, 0x101FF000), str(settings_region(log)))
    expect("a log that does not say is caught", settings_region("SUCCESS") is None)

    program = [(0x10000000, bytes([1]) * 256, 0xE48BFF56), (0x10000100, bytes([2]) * 256, 0xE48BFF56)]
    merged = read_uf2(factory_uf2(program, bytes([3]) * 8192, 0x10100000, 0xE48BFF56))
    addrs = [addr for addr, _, _ in merged]
    expect("the program's sector is filled out and the settings area follows it, in order",
           addrs == list(range(0x10000000, 0x10001000, 256)) + list(range(0x10100000, 0x10102000, 256)))
    expect("the program's pages are kept and the filling is zeros",
           merged[0][1] == bytes([1]) * 256 and merged[1][1] == bytes([2]) * 256
           and merged[2][1] == bytes(256))
    expect("the settings area is written whole", [p for a, p, _ in merged if a >= 0x10100000] ==
           [bytes([3]) * 256] * 32)
    expect("every block carries the program's family", {f for _, _, f in merged} == {0xE48BFF56})
    raw = factory_uf2(program, bytes(4096), 0x10100000, 0xE48BFF56)
    numbers = [struct.unpack_from("<2I", raw, at + 20) for at in range(0, len(raw), 512)]
    expect("the blocks are numbered as one file",
           numbers == [(n, len(numbers)) for n in range(len(numbers))], str(numbers[:3]))

    # The real headers and capture, so a renamed constant fails here rather than at build time.
    expect("the device schema version is read out of deviceStore.h",
           store_constant(DEVICE_STORE_H, "CURRENT_SCHEMA_VERSION") is not None)
    expect("the profile schema version and slot count are read out of profileStore.h",
           store_constant(PROFILE_STORE_H, "CURRENT_SCHEMA_VERSION") is not None
           and store_constant(PROFILE_STORE_H, "MAX_PROFILE_COUNT") is not None)
    if os.path.exists(SCHEMA_CAPTURE):
        with open(SCHEMA_CAPTURE, encoding="utf-8") as f:
            real_pins = pin_keys(json.load(f))
        expect("the schema capture names the pins", {"escPins", "menuButtonPin"} <= real_pins
               and "pusherDrive" not in real_pins, str(sorted(real_pins)))

    print("\nself-test " + ("passed" if ok else "FAILED"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
