"""The factory image: `tools/release.py --board <id> --blaster <file>`.

It is the universal firmware plus a whole settings area, and it is read back out of the .uf2 here
rather than trusted. The program has to be the universal build's. The settings area has to cover
the LittleFS region whole, so that a flash leaves nothing of what the blaster held. And the files in
it have to be what the firmware boots as that board with that config.

Builds [env:pico] once for the module, which takes a minute.
"""

import json
import os
import re
import struct
import subprocess
import sys
from pathlib import Path

import pytest
from helpers import differences

from trifolium_sim import PROJECT

sys.path.insert(0, str(PROJECT / "tools"))
import release  # noqa: E402 - the build's own composition, so the image is held to it

# One worker for the module, so the image is built once and never read while another build writes it.
pytestmark = pytest.mark.xdist_group("factory_build")

BOARD = "trifolium_v1_4"
CONFIG = PROJECT / "blasters" / "fencer.json"
MKLITTLEFS = (Path.home() / ".platformio" / "packages" / "tool-mklittlefs-rp2040-earlephilhower"
              / ("mklittlefs.exe" if os.name == "nt" else "mklittlefs"))

# The platform's own arithmetic (FS_START in its builder): platformio.ini's filesystem_size at the
# top of the Pico's 2 MB, below the 4 KB sector the core keeps for EEPROM. LittleFS's geometry is the
# core's, 4 KB blocks of 256-byte pages.
FLASH = 0x10000000
FS_END = FLASH + 2 * 1024 * 1024 - 4096
FS_SIZE = 512 * 1024
FS_START = FS_END - FS_SIZE

UF2_MAGIC = (0x0A324655, 0x9E5D5157, 0x0AB16F30)
UF2_FLAG_FAMILY = 0x00002000


def uf2_blocks(path):
    data = path.read_bytes()
    assert len(data) % 512 == 0, "not whole UF2 blocks"
    blocks = []
    for at in range(0, len(data), 512):
        block = data[at:at + 512]
        magic0, magic1, flags, addr, size, number, count, family = struct.unpack_from("<8I", block)
        assert (magic0, magic1, struct.unpack_from("<I", block, 508)[0]) == UF2_MAGIC
        blocks.append({"flags": flags, "addr": addr, "number": number, "count": count,
                       "family": family if flags & UF2_FLAG_FAMILY else None,
                       "payload": block[32:32 + size]})
    return blocks


@pytest.fixture(scope="module")
def image():
    build = subprocess.run([sys.executable, str(PROJECT / "tools" / "release.py"), "--board", BOARD,
                            "--blaster", str(CONFIG)], cwd=PROJECT, capture_output=True, text=True,
                           encoding="utf-8", errors="replace")
    assert build.returncode == 0, (build.stdout + build.stderr)[-3000:]
    version = release.firmware_version((PROJECT / "src" / "global.h").read_text(encoding="utf-8"))
    return uf2_blocks(PROJECT / "release" / release.factory_name(version, str(CONFIG), BOARD))


@pytest.fixture(scope="module")
def settings_area(image, tmp_path_factory):
    """The files in the image's settings area, by name, unpacked the way the core would mount it."""
    work = tmp_path_factory.mktemp("settings")
    region = b"".join(b["payload"] for b in sorted(image, key=lambda b: b["addr"])
                      if b["addr"] >= FS_START)
    (work / "littlefs.bin").write_bytes(region)
    # Relative paths: mklittlefs puts "./" in front of the directory it unpacks into.
    unpack = subprocess.run([str(MKLITTLEFS), "-u", "files", "-b", "4096", "-p", "256",
                             "-s", str(FS_SIZE), "littlefs.bin"],
                            cwd=work, capture_output=True, text=True)
    assert unpack.returncode == 0, unpack.stdout + unpack.stderr
    return {p.name: json.loads(p.read_text(encoding="utf-8")) for p in (work / "files").iterdir()}


def expected_files():
    bundle = json.loads(CONFIG.read_text(encoding="utf-8"))
    preset = json.loads((PROJECT / "boards" / BOARD / "board.json").read_text(encoding="utf-8"))
    schema = json.loads(Path(release.SCHEMA_CAPTURE).read_text(encoding="utf-8"))
    return release.factory_files(
        bundle, preset, release.pin_keys(schema),
        release.store_constant(release.DEVICE_STORE_H, "CURRENT_SCHEMA_VERSION"),
        release.store_constant(release.PROFILE_STORE_H, "CURRENT_SCHEMA_VERSION"))


def test_the_image_is_the_universal_program_and_a_settings_area_covering_the_whole_region(image):
    assert [b["number"] for b in image] == list(range(len(image)))
    assert {b["count"] for b in image} == {len(image)}
    # One family for every block, the program's: the console refuses a family it does not know.
    assert {b["family"] for b in image} == {0xE48BFF56}

    program = [(b["addr"], b["payload"]) for b in image if b["addr"] < FS_START]
    universal = [(b["addr"], b["payload"]) for b in
                 uf2_blocks(PROJECT / ".pio" / "build" / release.BUILD_ENV / "firmware.uf2")]
    assert program[:len(universal)] == universal
    # The platform's merge fills out the program's last 4 KB sector with zeros, for the RP2040's
    # trouble with a sector a multi-part image writes only some of. Nothing past that sector.
    last_sector = universal[-1][0] & ~0xFFF
    for addr, payload in program[len(universal):]:
        assert addr < last_sector + 0x1000 and payload == bytes(len(payload)), hex(addr)

    area = sorted(b["addr"] for b in image if b["addr"] >= FS_START)
    assert area == list(range(FS_START, FS_END, 256)), "the settings area must be written whole"


def test_the_console_knows_a_factory_image_by_where_this_build_puts_the_settings_area(image):
    # The console warns that a factory image replaces the blaster's config when an image reaches
    # SETTINGS_AREA_START. Held to the first page after the gap in a real image, so a change to the
    # flash layout fails here rather than silently dropping the warning.
    addrs = sorted(b["addr"] for b in image)
    start = next(after for before, after in zip(addrs, addrs[1:]) if after - before > 0x1000)
    uf2_ts = (PROJECT / "tools" / "console" / "src" / "flash" / "uf2.ts").read_text(encoding="utf-8")
    declared = re.search(r"SETTINGS_AREA_START = (0x[0-9a-fA-F_]+)", uf2_ts)
    assert declared and int(declared.group(1).replace("_", ""), 16) == start == FS_START


def test_the_settings_area_holds_the_boards_pins_and_the_configs_settings(settings_area):
    assert settings_area == expected_files()
    device = settings_area["device.cfg"]
    assert device["boardId"] == BOARD and device["wiringConfigured"] is True
    assert device["pusherFetPin"] == 24, "the pins are the board's - v1.1's is 27"
    assert device["pusherDrive"] == "esc", "how the pusher is driven is the config's"
    assert device["blasterName"] == "Fencer"


def test_the_firmware_boots_the_settings_area_as_that_board_with_that_config(settings_area, blaster):
    for name, content in settings_area.items():
        blaster.flash_put(f"/{name}", content)
    assert blaster.boot()
    schema = blaster.command("DUMP_SCHEMA", timeout_ms=15000)
    assert (schema["boardId"], schema["wiringConfigured"], schema["pinConflicts"]) == (BOARD, True, [])

    stored = {"device.cfg": blaster.command("DUMP_DEVICE")}
    stored.update({f"profile{slot}.cfg": blaster.command(f"DUMP_PROFILE {slot}") for slot in range(3)})
    assert [d for name, want in settings_area.items()
            for d in differences(stored[name], want, name)] == []
