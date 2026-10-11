"""The console as built, tools/console/dist/index.html, in Chromium against a simulated blaster.

webserial_shim.js stands in for navigator.serial and bridges to serve.py's WebSocket, so the page
runs its own transport - reads, writes, reboots and reconnects - unchanged. The blaster runs in wall
clock time, as the console's timeouts assume. What the device ended up holding is read from the
bench port, since the console is the one host its serial allows.

Needs `pip install -r requirements.txt` and `python -m playwright install chromium`. Tests the
console as last built: after a change under tools/console/, `npm run build` there first.
"""

import base64
import contextlib
import json
import re
import socket
import struct
import subprocess
import sys
import time
import zlib

import pytest

pytest.importorskip("playwright")

from helpers import SIM, differences  # noqa: E402
from playwright.sync_api import expect  # noqa: E402

from trifolium_sim import PROJECT  # noqa: E402

sys.path.insert(0, str(PROJECT / "tools"))
import build_site  # noqa: E402 - the site's own list entries, so the console is held to their format

CONSOLE = PROJECT / "tools" / "console" / "dist" / "index.html"
SHIM = (SIM / "trifolium_sim" / "webserial_shim.js").read_text(encoding="utf-8")
USB_SHIM = (SIM / "trifolium_sim" / "webusb_shim.js").read_text(encoding="utf-8")
REBOOT_MS = 15000  # a reboot, the ESC arming after it, and the console's reconnect


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Served:
    """serve.py in its own process: the WebSocket the page talks to, and the bench port."""

    def __init__(self, preset=None, device=None, profiles=None, instant_escs=True):
        self.serial, self.control, self.ws, self.http = free_port(), free_port(), free_port(), free_port()
        args = [sys.executable, "-m", "trifolium_sim.serve", "--display", "--port", str(self.serial),
                "--control-port", str(self.control), "--ws-port", str(self.ws),
                "--http-port", str(self.http)]
        if instant_escs:
            args += ["--instant-escs"]
        if preset:
            args += ["--preset", preset]
        if device:
            args += ["--device", json.dumps(device)]
        for slot, doc in (profiles or {}).items():
            args += ["--profile", f"{slot}={json.dumps(doc)}"]
        self.proc = subprocess.Popen(args, cwd=str(SIM), stdout=subprocess.PIPE,
                                     stderr=subprocess.STDOUT)
        assert b"serial on socket://" in self.proc.stdout.readline()

    def bench(self, op, **params):
        with socket.create_connection(("127.0.0.1", self.control), timeout=10) as s:
            s.sendall((json.dumps({"op": op, **params}) + "\n").encode())
            reply = json.loads(s.makefile().readline())
        assert reply.pop("ok"), reply
        return reply

    def settings(self):
        return self.bench("wiring")["settings"]

    def flash(self, path):
        """A file off the blaster's flash, or None."""
        reply = self.bench("flash", path=path)
        return base64.b64decode(reply["b64"]) if reply["exists"] else None

    def flash_json(self, path):
        data = self.flash(path)
        return json.loads(data) if data is not None else None

    def until(self, done, timeout_s=15):
        """Waits for `done()` in wall-clock time, which is what the console's own timeouts run on."""
        deadline = time.monotonic() + timeout_s
        while not done():
            assert time.monotonic() < deadline, "timed out"
            time.sleep(0.1)

    def wait_armed(self, timeout_s=30):
        """Past setup(), then the 2.5 s of ESC arming after it - a rev before that is ignored."""
        deadline = time.monotonic() + timeout_s
        while not self.bench("peek", names=["booted"])["values"]["booted"]:
            assert time.monotonic() < deadline, "the blaster never finished booting"
            time.sleep(0.1)
        self.run_for(2500)

    def run_for(self, ms):
        """Waits out `ms` of the blaster's own time, which a busy machine stretches."""
        until = self.bench("state")["uptime_ms"] + ms
        while self.bench("state")["uptime_ms"] < until:
            time.sleep(0.05)

    def close(self):
        self.proc.terminate()
        self.proc.wait(timeout=10)


@pytest.fixture
def serve():
    started = []

    def start(preset="trifolium_v1_2", device=None, profiles=None, instant_escs=True):
        started.append(Served(preset, device, profiles, instant_escs))
        return started[-1]

    yield start
    for served in started:
        served.close()


def open_console(page, served, shim=SHIM):
    page.add_init_script(f"window.__SIM_SERIAL_URL = 'ws://127.0.0.1:{served.ws}';\n{shim}")
    page.goto(CONSOLE.as_uri())
    return page


def connect(page):
    page.get_by_role("button", name="Connect", exact=True).click()
    expect(page.get_by_text(re.compile(r"Connected · fw \d"))).to_be_visible(timeout=REBOOT_MS)


def choose(page, menu, item):
    """A top-bar menu button, then one of its entries."""
    page.get_by_role("button", name=re.compile(rf"^{re.escape(menu)}")).click()
    page.get_by_role("menuitem", name=re.compile(rf"^{re.escape(item)}")).click()


def test_an_unwired_blaster_is_offered_presets_and_one_arms_it_across_the_reboot(page, serve):
    served = serve(preset=None)
    connect(open_console(page, served))
    expect(page.get_by_text("Which board is this wired as?")).to_be_visible()
    load = page.get_by_role("button", name="Load this wiring and restart")
    expect(load).to_be_disabled()

    page.get_by_role("combobox", name="Board").click()
    page.get_by_role("option", name="Trifolium v1.2").click()
    load.click()  # no confirm: an unwired blaster has nothing to lose

    expect(page.get_by_text("Which board is this wired as?")).to_be_hidden(timeout=REBOOT_MS)
    expect(page.get_by_text(re.compile(r"Connected · fw \d"))).to_be_visible(timeout=REBOOT_MS)
    settings = served.settings()
    assert settings["wiringConfigured"] is True
    assert settings["boardId"] == "trifolium_v1_2"


def blaster_cases():
    """Each blaster config on the board it was built on, and the Fencer on a later Trifolium."""
    paths = sorted((PROJECT / "blasters").glob("*.json"))
    cases = [(p, json.loads(p.read_text(encoding="utf-8"))["board"]) for p in paths]
    cases.append((PROJECT / "blasters" / "fencer.json", "trifolium_v1_4"))
    return [pytest.param(p, board, id=f"{p.stem}-{board}") for p, board in cases]


def board_file(board):
    return json.loads((PROJECT / "boards" / board / "board.json").read_text(encoding="utf-8"))


def board_name(board):
    return board_file(board)["name"]


def fill_unused(board_value, config_value):
    """The config's pin where the board leaves the slot unused, the board's otherwise."""
    if isinstance(config_value, list):
        ours = board_value if isinstance(board_value, list) else []
        return [fill_unused(ours[i] if i < len(ours) else None, pin)
                for i, pin in enumerate(config_value)]
    return config_value if board_value in (None, 255) else board_value


def pin_keys():
    """The device settings the schema shows as pins, by their name in the device config."""
    schema = json.loads((CONSOLE.parent.parent / "src" / "fixtures" / "schema.json").read_text(
        encoding="utf-8"))
    keys = set()

    def walk(nodes):
        for node in nodes:
            key = node.get("key") or ""
            if node.get("display") == "pin" and key.startswith("device:"):
                keys.add(re.sub(r"\[\d+\]$", "", key[len("device:"):]))
            walk(node.get("children") or [])

    walk(schema["tree"])
    return keys


@pytest.mark.parametrize("path,board", blaster_cases())
def test_an_unwired_blaster_set_up_with_a_blaster_config_stores_the_whole_config(
        page, serve, path, board):
    # Every pin as the board has it - and, on the board the file was saved on, as the file has
    # those the board leaves unused - and every other value as the file has it: a setting the
    # firmware clamps on arrival is a blaster that runs differently from the file its builders
    # published.
    blaster = json.loads(path.read_text(encoding="utf-8"))
    name = blaster["device"]["blasterName"]
    served = serve(preset=None)
    connect(open_console(page, served))

    page.get_by_role("combobox", name="Board").click()
    page.get_by_role("option", name=board_name(board), exact=True).click()
    page.get_by_role("combobox", name="Blaster config").click()
    page.get_by_role("option", name=f"{name} (built on {board_name(blaster['board'])})").click()
    for note in blaster.get("notes", []):
        expect(page.get_by_text(note, exact=True)).to_be_visible()
    page.get_by_role("button", name="Load the wiring and config, and restart").click()

    expect(page.get_by_text(f"Set up as {name} on {board_name(board)}.")).to_be_visible(
        timeout=3 * REBOOT_MS)
    expect(page.get_by_text("Which board is this wired as?")).to_be_hidden()
    stored = [served.flash_json("/device.cfg")]
    stored += [served.flash_json(f"/profile{slot}.cfg") for slot in range(len(blaster["profiles"]))]
    pins = pin_keys()
    device = {k: v for k, v in blaster["device"].items() if k not in pins}
    wiring = {k: v for k, v in board_file(board).items() if k in pins}
    device.update(wiring)
    if blaster["board"] == board:
        device.update({k: fill_unused(wiring.get(k), v) for k, v in blaster["device"].items()
                       if k in pins})
    device.update(boardId=board, wiringConfigured=True)
    profiles = blaster["profiles"]
    if device.get("speedPotPin", 255) != 255:
        # A speed pot sets rev RPM and stores it once it holds still, so the file's value never runs.
        profiles = [{k: v for k, v in p.items() if k != "revRPM"} for p in profiles]
    wanted = [device, *profiles]
    names = ["device", *(f"profile{slot}" for slot in range(len(blaster["profiles"])))]
    assert [d for s, w, n in zip(stored, wanted, names) for d in differences(s, w, n)] == []


def test_a_pin_conflict_the_device_resolved_at_boot_is_named_in_a_banner(page, serve):
    served = serve(device={"triggerSwitchPin": 1})
    connect(open_console(page, served))
    banner = page.get_by_text(re.compile(r"Trigger.* is GPIO 1, which .* already claims"))
    expect(banner).to_be_visible()
    expect(banner).to_contain_text("detached for this boot")


def test_a_renamed_blaster_is_written_rebooted_into_and_read_back(page, serve):
    served = serve()
    connect(open_console(page, served))
    page.get_by_role("button", name="Rename this blaster").click()
    name = page.get_by_role("textbox").first
    name.fill("bench")
    name.press("Enter")

    choose(page, "Write to Device", "Device Config (1)")
    expect(page.get_by_role("button", name=re.compile("^Write to Device"))).to_be_disabled(
        timeout=REBOOT_MS)
    expect(page.get_by_text(re.compile(r"Reconnected"))).to_be_visible(timeout=REBOOT_MS)
    assert served.settings()["blasterName"] == "bench"
    expect(page.get_by_text("bench", exact=True)).to_be_visible()


def test_a_device_reset_asks_for_the_word_that_names_what_is_lost_and_keeps_the_wiring(page, serve):
    served = serve(device={"blasterName": "marked"})
    connect(open_console(page, served))
    page.get_by_role("button", name=re.compile("^Reset")).click()
    entries = [item.inner_text().splitlines()[0] for item in page.get_by_role("menuitem").all()]
    assert [e.split(":")[0] for e in entries] == ["Profile", "Device Settings", "Wiring", "Everything"]
    page.get_by_role("menuitem", name=re.compile("^Device Settings")).click()

    dialog = page.get_by_role("dialog")
    expect(dialog).to_contain_text("Your wiring and board survive")
    confirm = dialog.get_by_role("button").last
    word = dialog.get_by_label("Type DEVICE to confirm")
    expect(confirm).to_be_disabled()
    word.fill("wiring")
    expect(confirm).to_be_disabled()
    word.fill("device")
    expect(confirm).to_be_enabled()
    confirm.click()

    expect(page.get_by_text(re.compile(r"Reconnected"))).to_be_visible(timeout=REBOOT_MS)
    settings = served.settings()
    assert settings["blasterName"] == "example"
    assert settings["wiringConfigured"] is True and settings["boardId"] == "trifolium_v1_2"


def test_a_dismissed_port_picker_leaves_the_console_disconnected_and_says_why(page, serve):
    served = serve()
    open_console(page, served)
    page.evaluate("window.__simSerial.pickerCancels = true")
    page.get_by_role("button", name="Connect", exact=True).click()
    expect(page.get_by_text(re.compile("Connect failed: No port selected"))).to_be_visible()
    expect(page.get_by_role("button", name="Connect", exact=True)).to_be_enabled()


def test_a_blaster_the_browser_already_allowed_connects_without_the_picker(page, serve):
    served = serve()
    open_console(page, served)
    # A picker would be dismissed, so connecting at all proves it never opened.
    page.evaluate("window.__simSerial.granted = true; window.__simSerial.pickerCancels = true")
    connect(page)
    expect(page.get_by_text("Connected to the blaster this browser already allowed.")).to_be_visible()


def test_without_web_serial_the_console_goes_over_webusb_and_follows_the_device_through_a_reboot(
        page, serve):
    served = serve()
    connect(open_console(page, served, USB_SHIM))
    page.get_by_role("button", name="Rename this blaster").click()
    name = page.get_by_role("textbox").first
    name.fill("phone")
    name.press("Enter")

    choose(page, "Write to Device", "Device Config (1)")
    expect(page.get_by_text("Reconnected (device re-enumerated).")).to_be_visible(timeout=REBOOT_MS)
    assert served.settings()["blasterName"] == "phone"
    expect(page.get_by_text("phone", exact=True)).to_be_visible()


def test_over_webusb_disconnect_releases_the_device_and_the_allowed_one_reopens_without_a_picker(
        page, serve):
    served = serve()
    connect(open_console(page, served, USB_SHIM))
    page.get_by_role("button", name="Disconnect", exact=True).click()
    page.wait_for_function("!window.__simUsb.device.opened", timeout=5000)

    page.evaluate("window.__simUsb.pickerCancels = true")
    connect(page)
    expect(page.get_by_text("Connected to the blaster this browser already allowed.")).to_be_visible()


def test_choose_device_asks_even_when_a_blaster_is_already_allowed(page, serve):
    served = serve()
    open_console(page, served)
    page.evaluate("window.__simSerial.granted = true; window.__simSerial.pickerCancels = true")
    page.get_by_role("button", name="Choose Device", exact=True).click()
    expect(page.get_by_text(re.compile("Connect failed: No port selected"))).to_be_visible()


def test_an_rpm_capture_from_a_rev_charts_every_motor_at_the_length_the_device_published(page, serve):
    served = serve(device={"useRpmLogging": True})
    connect(open_console(page, served))
    served.wait_armed()
    served.bench("press", role="rev")
    served.run_for(1500)
    served.bench("release", role="rev")
    expect(page.get_by_text("RPM capture finished - device is back.")).to_be_visible(
        timeout=REBOOT_MS)
    expect(page.get_by_text(re.compile(r"Connected · fw \d"))).to_be_visible()

    page.get_by_role("tab", name="RPM Log").click()
    page.get_by_role("button", name="Take from device log").click()
    length = served.settings()["rpmLogLength"]
    expect(page.get_by_text(re.compile(rf"^2 motors, {length} samples"))).to_be_visible()


def test_a_setting_that_governs_others_shows_and_hides_them_as_it_is_edited(page, serve):
    """The console evaluates the schema's visibleWhen itself, so the rows move before any write."""
    served = serve()
    connect(open_console(page, served))
    page.get_by_role("tab", name="Device").click()
    expect(page.get_by_text("EMA Filter", exact=True)).to_be_visible()
    expect(page.get_by_text("Throttle Cap", exact=True)).to_have_count(0)

    page.get_by_role("button", name="TBH", exact=True).click()
    expect(page.get_by_text("EMA Filter", exact=True)).to_have_count(0)
    expect(page.get_by_text("I Threshold", exact=True)).to_have_count(0)
    expect(page.get_by_text("Throttle Cap", exact=True)).to_be_visible()

    page.get_by_role("button", name=re.compile("^Write to Device")).click()
    expect(page.get_by_role("menuitem", name=re.compile(r"^Device Config \(1\)"))).to_be_visible()
    assert served.settings()["flywheelControl"] == "pid"


def log_lines(page, text):
    return page.get_by_text(text).count()


@contextlib.contextmanager
def rebooting(page):
    """Around an action the device answers by rebooting: the console reconnects and reads it again."""
    reconnects, reads = log_lines(page, "Reconnected"), log_lines(page, "> DUMP_BOOT")
    yield
    deadline = time.monotonic() + REBOOT_MS / 1000
    while log_lines(page, "Reconnected") <= reconnects or log_lines(page, "> DUMP_BOOT") <= reads:
        assert time.monotonic() < deadline, "the console did not come back from the reboot"
        page.wait_for_timeout(100)
    expect(page.get_by_text(re.compile(r"Connected · fw \d"))).to_be_visible()


# ---- the splash --------------------------------------------------------------------------------


def lit(x, y):
    """An asymmetric test image, so a flipped or mirrored splash cannot pass for the right one."""
    return (8 <= x < 40 and 8 <= y < 24) or x == 120 or (y == 40 and x < 64)


def write_png(path, pixel_lit):
    """A 128x64 greyscale PNG, black wherever the OLED should light."""
    rows = b"".join(b"\x00" + bytes(0 if pixel_lit(x, y) else 255 for x in range(128))
                    for y in range(64))

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    header = struct.pack(">IIBBBBB", 128, 64, 8, 0, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows))
                     + chunk(b"IEND", b""))


def packed(pixel_lit):
    """The 1024 bytes SplashStore keeps: rows of 16 bytes, the most significant bit leftmost."""
    out = bytearray()
    for y in range(64):
        for byte_x in range(16):
            value = 0
            for bit in range(8):
                value = (value << 1) | pixel_lit(byte_x * 8 + bit, y)
            out.append(value)
    return bytes(out)


def test_a_splash_image_is_uploaded_drawn_at_the_next_boot_and_cleared(page, serve, tmp_path):
    served = serve()
    connect(open_console(page, served))
    image = tmp_path / "splash.png"
    write_png(image, lit)
    page.get_by_role("tab", name="Splash").click()
    expect(page.get_by_text("The console does not read a splash back from the device")).to_be_visible()
    with page.expect_file_chooser() as chooser:
        page.get_by_role("button", name="Choose image").click()
    chooser.value.set_files(str(image))
    page.get_by_role("button", name="Upload to device").click()
    served.until(lambda: served.flash("/splash.bin") == packed(lit))

    # The boot draws its version and board over the splash's bottom rows.
    expected = ["".join("1" if lit(x, y) else "0" for x in range(128)) for y in range(48)]
    with rebooting(page):
        choose(page, "Reboot", "Reboot")
        served.until(lambda: served.bench("panel", pixels=True)["pixels"][:48] == expected,
                      REBOOT_MS / 1000)

    page.get_by_role("tab", name="Splash").click()
    page.get_by_role("button", name="Clear custom splash").click()
    served.until(lambda: served.flash("/splash.bin") is None)


# ---- backups -----------------------------------------------------------------------------------


def save_full_backup(page, folder):
    with page.expect_download() as download:
        choose(page, "Backup", "Full Backup")
    saved = folder / "backup.json"
    download.value.save_as(saved)
    return saved


def test_a_full_backup_holds_every_store_and_loading_it_puts_a_changed_setting_back(
        page, serve, tmp_path):
    served = serve()
    connect(open_console(page, served))
    saved = save_full_backup(page, tmp_path)
    bundle = json.loads(saved.read_text(encoding="utf-8"))
    assert bundle["device"]["blasterName"] == "example"
    assert [p["name"] for p in bundle["profiles"]] == ["Low", "Medium", "High"]

    page.get_by_role("button", name="Rename this blaster").click()
    name = page.get_by_role("textbox").first
    name.fill("changed")
    name.press("Enter")
    with rebooting(page):
        choose(page, "Write to Device", "Device Config (1)")
    assert served.settings()["blasterName"] == "changed"

    with page.expect_file_chooser() as chooser:
        choose(page, "Load Backup", "Full Backup")
    chooser.value.set_files(str(saved))
    expect(page.get_by_text("Loaded backup.json — 1 value(s) differ from the device.")).to_be_visible()
    with rebooting(page):
        choose(page, "Write to Device", "Device Config (1)")
    assert served.settings()["blasterName"] == "example"


def test_a_full_backup_puts_back_every_profile_not_only_the_one_on_screen(page, serve, tmp_path):
    served = serve()
    connect(open_console(page, served))
    saved = save_full_backup(page, tmp_path)
    bundle = json.loads(saved.read_text(encoding="utf-8"))
    bundle["device"]["blasterName"] = "restored"
    for profile in bundle["profiles"]:
        profile["name"] += " B"
    saved.write_text(json.dumps(bundle), encoding="utf-8")

    with page.expect_file_chooser() as chooser:
        choose(page, "Load Backup", "Full Backup")
    chooser.value.set_files(str(saved))
    with rebooting(page):
        choose(page, "Write to Device (4)", "Device Config (1)")
    assert served.settings()["blasterName"] == "restored"

    # The write re-read the device, and the three profiles from the backup are still waiting.
    with rebooting(page):
        choose(page, "Write to Device (3)", "Everything (3)")
    names = [served.flash_json(f"/profile{slot}.cfg")["name"] for slot in range(3)]
    assert names == ["Low B", "Medium B", "High B"]
    expect(page.get_by_role("button", name=re.compile("^Write to Device"))).to_be_disabled()


def test_a_backup_offered_as_the_wrong_kind_is_refused_and_stages_nothing(page, serve, tmp_path):
    served = serve()
    connect(open_console(page, served))
    bundle = save_full_backup(page, tmp_path)
    with page.expect_download() as download:
        choose(page, "Backup", "Device Config")
    device = tmp_path / "device.json"
    download.value.save_as(device)

    with page.expect_file_chooser() as chooser:
        choose(page, "Load Backup", "Device Config")
    chooser.value.set_files(str(bundle))
    expect(page.get_by_text(re.compile(r"backup\.json is a full backup, not a device config"))).to_be_visible()

    with page.expect_file_chooser() as chooser:
        choose(page, "Load Backup", "Profile into")
    chooser.value.set_files(str(device))
    expect(page.get_by_text(re.compile(r"device\.json does not look like a profile"))).to_be_visible()
    expect(page.get_by_role("button", name=re.compile("^Write to Device"))).to_be_disabled()


# ---- profiles ----------------------------------------------------------------------------------


def test_copy_to_puts_the_shown_profile_onto_another_slot_and_keeps_that_slots_name(page, serve):
    served = serve(profiles={1: {"schemaVersion": 2, "name": "Medium", "dwellTime_ms": 2500}})
    connect(open_console(page, served))
    page.get_by_role("tab", name="Profile").click()
    page.get_by_role("button", name="Copy to...").click()
    dialog = page.get_by_role("dialog")
    dialog.get_by_role("combobox", name="Copy to").click()
    page.get_by_role("option", name="Low").click()
    dialog.get_by_role("button", name="Copy", exact=True).click()
    expect(page.get_by_text("Copied Medium onto Low.")).to_be_visible()

    copied = served.flash_json("/profile0.cfg")
    assert copied["name"] == "Low"
    assert copied["dwellTime_ms"] == 2500


def mode_rows(page):
    return page.get_by_role("group", name="Fire Modes").get_by_role("row")


def test_fire_modes_added_changed_and_deleted_in_the_editor_reach_the_running_profile(page, serve):
    served = serve()
    connect(open_console(page, served))
    page.get_by_role("tab", name="Profile").click()

    page.get_by_role("group", name="Fire Modes").get_by_role("button", name="+").click()
    added = mode_rows(page).nth(4)  # the header row, modes 1-3, then the new one
    added.get_by_role("combobox").click()
    page.get_by_role("option", name="BURST", exact=True).click()
    burst_length = added.get_by_role("spinbutton").first
    burst_length.fill("3")
    burst_length.press("Tab")
    mode_rows(page).nth(1).get_by_role("button", name="✕").click()  # AUTO

    with rebooting(page):
        choose(page, "Write to Device", "Profile: Medium")
    stored = served.flash_json("/profile1.cfg")
    modes = stored["fireModes"][:stored["activeModeCount"]]
    assert [m["burstMode"] for m in modes] == ["binary", "semi", "burst"]
    assert modes[2]["burstLength"] == 3
    assert modes[stored["defaultFiringMode"]]["burstMode"] == "binary"  # the default moved with it


def test_an_edit_to_one_fire_mode_marks_that_mode_alone(page, serve):
    connect(open_console(page, serve()))
    page.get_by_role("tab", name="Profile").click()
    first, second = mode_rows(page).nth(1).get_by_role("combobox"), mode_rows(page).nth(2).get_by_role("combobox")
    first.click()
    page.get_by_role("option", name="SEMI", exact=True).click()

    # The red outline is a thicker border on the field's notched outline.
    outline = "el => getComputedStyle(el.parentElement.querySelector('.MuiOutlinedInput-notchedOutline')).borderTopWidth"
    assert first.evaluate(outline) == "2px"
    assert second.evaluate(outline) == "1px"


# ---- wiring ------------------------------------------------------------------------------------


def wiring_row(page, control):
    return page.get_by_role("group", name="Wiring").get_by_role("row", name=re.compile(rf"^{control} "))


def test_a_pin_edited_in_the_wiring_table_is_marked_modified_and_written(page, serve):
    served = serve()
    connect(open_console(page, served))
    page.get_by_role("tab", name="Wiring").click()
    trigger = wiring_row(page, "Trigger").get_by_role("spinbutton")
    trigger.fill("20")
    trigger.press("Tab")
    expect(page.get_by_text("Trifolium v1.2 (modified)")).to_be_visible()

    with rebooting(page):
        choose(page, "Write to Device", "Device Config (1)")
    assert served.settings()["triggerSwitchPin"] == 20
    expect(page.get_by_text("Trifolium v1.2 (modified)")).to_be_visible()


def test_unused_is_a_choice_in_the_wiring_table_and_writes_255(page, serve):
    served = serve()
    connect(open_console(page, served))
    page.get_by_role("tab", name="Wiring").click()
    wiring_row(page, "Rev").get_by_role("button", name="unused").click()
    expect(wiring_row(page, "Rev").get_by_role("spinbutton")).to_be_disabled()

    with rebooting(page):
        choose(page, "Write to Device", "Device Config (1)")
    assert served.settings()["revSwitchPin"] == 255


def test_each_pin_field_in_the_wiring_table_is_named_for_its_pin(page, serve):
    served = serve()
    connect(open_console(page, served))
    page.get_by_role("tab", name="Wiring").click()
    table = page.get_by_role("group", name="Wiring")
    expect(wiring_row(page, "Trigger").get_by_role("spinbutton", name="Trigger Pin")).to_be_visible()
    expect(table.get_by_role("spinbutton", name="ESC 1 Pin", exact=True)).to_be_visible()
    expect(table.get_by_role("spinbutton", name="unused", exact=True)).to_have_count(0)


# Every diagram label on the page, and the pairs of them drawn over each other.
LABEL_OVERLAPS = """() => {
  const labels = [...document.querySelectorAll('.MuiTypography-caption')]
    .filter(e => getComputedStyle(e).position === 'absolute' && e.textContent.trim())
    .map(e => ({text: e.textContent.trim(), r: e.getBoundingClientRect()}));
  const hits = [];
  for (let i = 0; i < labels.length; i++)
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i].r, b = labels[j].r;
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (x > 1 && y > 1) hits.push(labels[i].text + ' / ' + labels[j].text);
    }
  return {wrapped: labels.filter(l => l.r.height > 20).length, hits};
}"""


def test_a_diagram_label_too_long_for_one_line_is_given_its_room_rather_than_drawn_over(page, serve):
    """The menu button on select 0's pin names that pad for both, which wraps - right under
    Select 2's label."""
    served = serve(device={"menuButtonPin": 9})
    connect(open_console(page, served))
    page.get_by_role("tab", name="Wiring").click()
    expect(page.get_by_text(re.compile("^Menu Button / Select 0")).first).to_be_visible()

    deadline = time.monotonic() + 3
    while True:
        found = page.evaluate(LABEL_OVERLAPS)
        if not found["hits"] or time.monotonic() > deadline:
            break
        page.wait_for_timeout(100)
    assert found["wrapped"] >= 1
    assert found["hits"] == []


def test_a_boot_action_that_loads_a_slot_names_the_profile_there_even_before_a_rename_is_written(
        page, serve):
    served = serve()
    connect(open_console(page, served))
    page.get_by_role("tab", name="Profile").click()
    name = page.get_by_role("textbox", name="Name", exact=True)
    names = ["Low", "Medium", "High"]
    names[names.index(name.input_value())] = "Indoor"
    name.fill("Indoor")

    page.get_by_role("tab", name="Wiring").click()
    wiring_row(page, "Rev").get_by_role("combobox").click()
    slots = page.get_by_role("option").filter(has_text=re.compile("^Slot"))
    expect(slots).to_have_text([f"Slot {i + 1} · {n}" for i, n in enumerate(names)])


# ---- released firmware and the console's own build ---------------------------------------------

SITE = "https://davidpyo.github.io/trifolium-controller/"  # where a local build points


def uf2_image(fill=0, address=0x10000000, number=0, count=1):
    """A one-block RP2040 .uf2, at the start of flash unless told otherwise - all the dialog's parser
    asks of one."""
    header = struct.pack("<8I", 0x0A324655, 0x9E5D5157, 0x2000, address, 256, number, count, 0xE48BFF56)
    return header + bytes([fill]) * 256 + bytes(476 - 256) + struct.pack("<I", 0x0AB16F30)


def answer(body):
    """A route handler serving `body`. Playwright hands a handler the request as a second argument,
    so the body cannot ride in as a default."""
    return lambda route: route.fulfill(body=body)


def serve_releases(page, files):
    """Stands in for the site's firmware folder: `files` maps each tag to the .uf2 it lists."""
    releases = []
    for tag, data in files.items():
        release = {"tag_name": tag, "published_at": "2026-09-25T00:00:00Z",
                   "assets": [{"name": f"trifolium-{tag[1:]}-universal.uf2", "url": ""}]}
        releases.append(build_site.entry(release, build_site.listable(release), data))
    page.route(SITE + "firmware/releases.json",
               lambda route: route.fulfill(json={"releases": releases}))
    for release, data in zip(releases, files.values()):
        page.route(SITE + "firmware/" + release["file"], answer(data))
    return releases


def open_flash_dialog(page):
    page.get_by_role("button", name="Flash Firmware").click()
    return page.get_by_role("dialog")


def test_flash_firmware_offers_the_sites_releases_newest_first_and_loads_one_after_checking_it(
        page, serve):
    serve_releases(page, {"v2.1.0": uf2_image(), "v2.2.0": uf2_image(1)})
    open_console(page, serve())
    dialog = open_flash_dialog(page)
    dialog.get_by_role("combobox", name="Released firmware").click()
    expect(page.get_by_role("option")).to_have_text(["v2.2.0 (latest)", "v2.1.0"])
    page.get_by_role("option", name="v2.2.0 (latest)").click()
    expect(dialog.get_by_text(
        re.compile(r"^v2\.2\.0 \(trifolium-2\.2\.0-universal\.uf2\) — .*, 1 blocks$"))).to_be_visible()


def test_a_release_that_does_not_match_the_list_is_refused(page, serve):
    listed = serve_releases(page, {"v2.2.0": uf2_image()})
    page.route(SITE + "firmware/" + listed[0]["file"],
               lambda route: route.fulfill(body=uf2_image(fill=7)))  # the last route wins
    open_console(page, serve())
    dialog = open_flash_dialog(page)
    dialog.get_by_role("combobox", name="Released firmware").click()
    page.get_by_role("option", name="v2.2.0 (latest)").click()
    expect(dialog.get_by_text("v2.2.0 failed its checksum")).to_be_visible()
    expect(dialog.get_by_text(re.compile(r"1 blocks$"))).to_have_count(0)


def test_without_the_site_the_dialog_says_so_and_still_takes_a_file(page, serve, tmp_path):
    page.route(SITE + "firmware/**", lambda route: route.abort())
    open_console(page, serve())
    dialog = open_flash_dialog(page)
    expect(dialog.get_by_text(re.compile("^Releases unavailable: Could not reach"))).to_be_visible()
    expect(dialog.get_by_role("combobox", name="Released firmware")).to_be_disabled()

    image = tmp_path / "local.uf2"
    image.write_bytes(uf2_image())
    with page.expect_file_chooser() as chooser:
        dialog.get_by_role("button", name="Or choose a .uf2 file").click()
    chooser.value.set_files(str(image))
    expect(dialog.get_by_text(re.compile(r"^local\.uf2 — .*, 1 blocks$"))).to_be_visible()


def test_a_factory_image_is_said_to_replace_the_blasters_config_before_it_is_flashed(
        page, serve, tmp_path):
    page.route(SITE + "firmware/**", lambda route: route.abort())
    open_console(page, serve())
    dialog = open_flash_dialog(page)
    kept = dialog.get_by_text(re.compile(r"^This replaces the firmware\. Wiring, tuning and profiles are kept"))
    expect(kept).to_be_visible()

    # The program, and a page of the settings area (uf2.ts's SETTINGS_AREA_START), as release.py's
    # --board/--blaster image carries it.
    image = tmp_path / "factory.uf2"
    image.write_bytes(uf2_image(count=2) + uf2_image(address=0x1017F000, number=1, count=2))
    with page.expect_file_chooser() as chooser:
        dialog.get_by_role("button", name="Or choose a .uf2 file").click()
    chooser.value.set_files(str(image))
    expect(dialog.get_by_text(re.compile(r"^This image carries its own config: flashing it replaces"))).to_be_visible()
    expect(kept).to_be_hidden()


def test_the_footer_names_the_build_and_offers_the_offline_copy(page, serve):
    open_console(page, serve())
    expect(page.get_by_text(
        re.compile(r"^Trifolium Console · built from [0-9a-f]{7}-local on \d{4}-\d\d-\d\d$"))).to_be_visible()
    offline = page.get_by_role("link", name="Download for offline use")
    expect(offline).to_have_attribute("href", SITE + "trifolium-console.html")
    expect(offline).to_have_attribute("download", "trifolium-console.html")


def test_a_setting_says_what_it_does_and_the_mode_list_what_each_mode_does(page, serve):
    connect(open_console(page, serve()))
    label = page.locator("#root").get_by_text("Spindown Speed", exact=True)  # not the tooltip's
    label.hover()
    expect(page.get_by_role("tooltip")).to_contain_text("How quickly the flywheels may slow down")
    expect(label).to_have_accessible_description(re.compile(r"How quickly the flywheels"))

    page.get_by_role("group", name="Fire Modes").get_by_role("combobox").first.click()
    plasma = page.get_by_role("option", name="PLASMA", exact=True)
    expect(plasma).to_have_accessible_description(re.compile(r"^A charge-up shot"))


# ---- the simulator panel -----------------------------------------------------------------------


def open_panel(page, served):
    # Not the default wait for "load", which includes the 1 MB console in the iframe beside it.
    page.goto(f"http://127.0.0.1:{served.http}/", wait_until="domcontentloaded")
    expect(page.get_by_text(re.compile(r"^Running · up"))).to_be_visible(timeout=REBOOT_MS)
    return page


def switch(page, label):
    return page.locator("#switches").get_by_role("button", name=re.compile(rf"^{label} ?GPIO"))


def test_the_panel_offers_a_button_for_each_wired_switch_and_a_held_trigger_fires(page, serve):
    served = serve()
    open_panel(page, served)
    for label, pin in (("Trigger", 21), ("Rev", 18), ("Menu", 19)):
        expect(switch(page, label)).to_have_text(f"{label}GPIO {pin}", timeout=REBOOT_MS)
    for unwired in ("Cycle", "Idle", "Safety", "Select 1", "Select 2", "Select 3"):
        expect(switch(page, unwired)).to_have_count(0)
    expect(page.locator("#led-label")).to_have_text(re.compile(r"^LED · not wired"))

    served.wait_armed()
    trigger = switch(page, "Trigger").bounding_box()
    page.mouse.move(trigger["x"] + trigger["width"] / 2, trigger["y"] + trigger["height"] / 2)
    page.mouse.down()
    expect(page.get_by_text(re.compile(r"^[1-9]\d* shots? this boot$"))).to_be_visible(timeout=5000)
    page.mouse.up()
    assert served.bench("extends")["at_us"]
    expect(page.get_by_text(re.compile(r"^Motor 2"))).to_be_visible()
    expect(page.locator("#wheels small").filter(has_text=re.compile(r"^last dart at [\d,]+$"))
           .first).to_be_visible()
    # Each pulse is the extend time for the pack: 25 ms at 16.8 V to 40 ms at 11.8 V by default, so
    # about 26 ms at the simulator's 16.4 V.
    expect(page.locator("#solenoid-label")).to_have_text(
        re.compile(r"^Solenoid · GPIO 24 · (powered|off) · last pulse 2[5-7]\.\d ms$"))


def test_an_esc_driven_pusher_lights_and_counts_on_the_panel_as_a_fet_driven_one_does(page, serve):
    served = serve(preset="trifolium_v1_4", device={"pusherDrive": "esc"})
    open_panel(page, served)
    label = page.locator("#solenoid-label")
    expect(label).to_have_text("Pusher · ESC channel 3 · off", timeout=REBOOT_MS)

    served.wait_armed()
    trigger = switch(page, "Trigger").bounding_box()
    page.mouse.move(trigger["x"] + trigger["width"] / 2, trigger["y"] + trigger["height"] / 2)
    page.mouse.down()
    expect(page.get_by_text(re.compile(r"^[1-9]\d* shots? this boot$"))).to_be_visible(timeout=5000)
    page.mouse.up()
    expect(label).to_have_text(
        re.compile(r"^Pusher · ESC channel 3 · (powered|off) · last pulse 2[5-7]\.\d ms$"))


def test_a_wired_led_on_the_panel_is_lit_once_armed_and_blinks_below_the_cutoff(page, serve):
    served = serve(preset="diana_v1_2")  # the boards that wire the LED, on GPIO 27
    open_panel(page, served)
    label = page.locator("#led-label")
    expect(label).to_have_text("LED · GPIO 27 · on", timeout=REBOOT_MS)
    served.wait_armed()
    served.bench("pack", mv=12000)  # below a 4S pack's 13.2 V cutoff, which LED Warning's default names
    expect(label).to_have_text("LED · GPIO 27 · off", timeout=10000)
    expect(label).to_have_text("LED · GPIO 27 · on", timeout=5000)


def test_the_panel_names_the_mode_the_firmware_is_in(page, serve):
    served = serve()
    open_panel(page, served)
    status = page.locator("#status")
    expect(status).to_contain_text("Mode BINARY", timeout=REBOOT_MS)  # the v1.2's, grounding none
    page.locator("#selector").get_by_role("radio").nth(0).click()
    expect(status).to_contain_text("Mode AUTO")


def test_a_switch_select_fire_is_one_switch_with_a_position_per_pin_and_one_grounding_none(page, serve):
    served = serve()
    open_panel(page, served)
    positions = page.locator("#selector").get_by_role("radio")
    expect(positions).to_have_text([re.compile(r"^Select 1\s*GPIO 9$"), re.compile(r"^None"),
                                    re.compile(r"^Select 3\s*GPIO 10$")], timeout=REBOOT_MS)
    first, none, third = positions.nth(0), positions.nth(1), positions.nth(2)
    expect(none).to_have_attribute("aria-checked", "true")

    def mode():
        return served.bench("peek", names=["firingMode"])["values"]["firingMode"]

    at_none = mode()
    first.click()
    expect(first).to_have_attribute("aria-checked", "true")
    expect(none).to_have_attribute("aria-checked", "false")
    served.until(lambda: mode() != at_none)
    at_first = mode()
    third.click()
    expect(third).to_have_attribute("aria-checked", "true")
    expect(first).to_have_attribute("aria-checked", "false")
    served.until(lambda: mode() not in (at_none, at_first))
    none.click()
    expect(none).to_have_attribute("aria-checked", "true")
    served.until(lambda: mode() == at_none)


def test_an_encoder_select_fire_is_a_knob_with_a_detent_per_combination_of_its_lines(page, serve):
    served = serve(device={"selectFireType": "encoder"})
    open_panel(page, served)
    detents = page.get_by_role("radiogroup", name="Encoder").get_by_role("radio")
    expect(detents).to_have_text(["0", "1", "2", "3"], timeout=REBOOT_MS)
    expect(page.locator("#selector")).to_be_hidden()

    def mode():
        return served.bench("peek", names=["firingMode"])["values"]["firingMode"]

    # The default profile: positions 1-3 are AUTO, BINARY and SEMI, and none is BINARY.
    detents.nth(3).click()
    expect(detents.nth(3)).to_have_attribute("aria-checked", "true")
    expect(page.locator("#encoder-lines")).to_have_text("Position 3: GPIO 9 + GPIO 10 grounded")
    served.until(lambda: mode() == 2)
    page.keyboard.press("[")
    expect(detents.nth(2)).to_have_attribute("aria-checked", "true")
    served.until(lambda: mode() == 1)
    detents.nth(1).click()
    served.until(lambda: mode() == 0)


def test_the_panel_loads_a_magazine_whose_breech_the_dart_switch_reads(page, serve):
    served = serve(device={"dartSwitchPin": 20})
    open_panel(page, served)
    label = page.locator("#magazine-label")
    expect(label).to_have_text("No magazine in: every push launches a dart.", timeout=REBOOT_MS)
    expect(switch(page, "Dart")).to_have_count(0)  # the magazine is what fills the breech

    def present():
        return served.bench("peek", names=["dart"])["values"]["dart"]["present"]

    size = page.locator("#mag-size")
    size.fill("6")
    size.press("Enter")
    page.get_by_role("button", name="Reload magazine").click()
    expect(label).to_have_text(re.compile(r"^6 of 6 left · a dart in the breech · 0 fired, 0 dry$"))
    expect(page.locator("#breech-lamp")).to_have_class(re.compile(r"\bon\b"))
    served.until(present)


def test_with_no_speed_pot_wired_the_panel_has_no_pot_slider(page, serve):
    open_panel(page, serve())
    expect(page.locator("#switches button").first).to_be_visible(timeout=REBOOT_MS)
    expect(page.locator("#pot")).to_be_hidden()


def test_a_wired_speed_pot_is_a_slider_that_moves_the_rev_target(page, serve):
    served = serve(device={"speedPotPin": 27})
    open_panel(page, served)
    pot = page.locator("#pot")
    expect(pot).to_be_visible(timeout=REBOOT_MS)

    def rev_rpm():
        return served.bench("peek", names=["motors"])["values"]["motors"][1]["revRPM"]

    served.until(lambda: rev_rpm() == 30000)  # the slider starts at full travel: Pot Max RPM
    pot.fill("0")
    served.until(lambda: rev_rpm() == 15000)  # Pot Min RPM
    expect(page.locator("#pot-value")).to_have_text("0%")


def test_an_encoder_select_fire_shows_each_combination_of_its_lines_in_place_of_the_switch(page, serve):
    connect(open_console(page, serve(device={"selectFireType": "encoder"})))
    page.get_by_role("tab", name="Profile").click()
    encoder = page.get_by_role("group", name="Selector Encoder")
    expect(encoder).to_be_visible()
    expect(page.get_by_role("group", name="Selector Switch")).to_be_hidden()
    rows = encoder.locator("tbody tr")
    expect(rows.locator("td:nth-child(1)")).to_have_text(["0", "1", "2", "3"])
    expect(rows.locator("td:nth-child(2)")).to_have_text(["none", "GP9", "GP10", "GP9 + GP10"])
    # A mode and a profile picker per position, position 0's being the Default Mode and Profile.
    expect(rows.locator("td:nth-child(3)").get_by_role("combobox")).to_have_count(4)
    expect(rows.locator("td:nth-child(4)").get_by_role("combobox")).to_have_count(4)


def test_a_profile_picked_for_an_encoder_position_is_written_to_the_device(page, serve):
    served = serve(device={"selectFireType": "encoder"})
    connect(open_console(page, served))
    page.get_by_role("tab", name="Profile").click()
    position3 = page.get_by_role("group", name="Selector Encoder").locator("tbody tr").nth(3)
    position3.locator("td:nth-child(4)").get_by_role("combobox").click()
    page.get_by_role("option", name="Low", exact=True).click()

    with rebooting(page):
        choose(page, "Write to Device", "Device Config (1)")
    assert served.settings()["switchPositionProfile"][:3] == [0, 1, 0]


def test_a_button_select_fire_makes_select_1_a_push_button_that_steps_the_mode(page, serve):
    served = serve(device={"selectFireType": "button"})

    def mode():
        return served.bench("peek", names=["firingMode"])["values"]["firingMode"]

    open_panel(page, served)
    button = switch(page, "Select 1")
    expect(button).to_be_visible(timeout=REBOOT_MS)
    expect(button).not_to_have_attribute("aria-pressed", re.compile("."))
    expect(page.locator("#selector")).to_be_hidden()
    before = mode()
    box = button.bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    served.run_for(150)
    page.mouse.up()
    served.until(lambda: mode() != before)
    expect(button).not_to_have_class(re.compile("held"))


def test_a_latching_switch_on_the_panel_stays_on_and_the_firmware_follows_it(page, serve):
    served = serve(device={"safetySwitchPin": 11})

    def engaged():
        return served.bench("peek", names=["safetyEngaged"])["values"]["safetyEngaged"]

    open_panel(page, served)
    safety = switch(page, "Safety")
    expect(safety).to_have_attribute("aria-pressed", "false", timeout=REBOOT_MS)
    before = engaged()
    safety.click()
    expect(safety).to_have_attribute("aria-pressed", "true")
    served.until(lambda: engaged() != before)
    safety.click()
    expect(safety).to_have_attribute("aria-pressed", "false")
    served.until(lambda: engaged() == before)


def test_the_pack_slider_sets_what_the_battery_monitor_reads(page, serve):
    served = serve()
    open_panel(page, served)
    page.locator("#pack").evaluate(
        "el => { el.value = 12000; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); }")
    expect(page.locator("#pack-value")).to_have_text("12.0 V")
    served.until(lambda: served.bench("peek", names=["battery"])["values"]["battery"]["mv"] < 12500)


def plug_in_pack(page, mv):
    page.locator("#pack").evaluate(
        f"el => {{ el.value = {mv}; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); }}")


def test_power_on_from_battery_shows_each_esc_starting_until_it_answers(page, serve):
    served = serve(instant_escs=False)
    open_panel(page, served)
    page.get_by_role("button", name="Power on from battery").click()
    expect(page.get_by_text("ESC starting").first).to_be_visible(timeout=REBOOT_MS)
    expect(page.locator("#wheels small")).to_have_count(0, timeout=REBOOT_MS)
    expect(page.locator("#pack-value")).to_have_text("16.4 V")


def test_power_on_from_usb_leaves_the_escs_unpowered_until_the_slider_plugs_the_pack_in(page, serve):
    served = serve(instant_escs=False)
    open_panel(page, served)
    page.get_by_role("button", name="Power on from USB").click()
    expect(page.locator("#pack-value")).to_have_text("unplugged", timeout=REBOOT_MS)
    expect(page.get_by_text("ESC unpowered")).to_have_count(2, timeout=REBOOT_MS)
    plug_in_pack(page, 16400)
    expect(page.get_by_text("ESC starting").first).to_be_visible()
    expect(page.locator("#wheels small")).to_have_count(0, timeout=REBOOT_MS)
    expect(page.locator("#pack-value")).to_have_text("16.4 V")


def test_the_console_beside_the_panel_talks_to_the_same_blaster(page, serve):
    served = serve()
    open_panel(page, served)
    console = page.frame_locator("#console")
    console.get_by_role("button", name="Connect", exact=True).click()
    expect(console.get_by_text(re.compile(r"Connected · fw \d"))).to_be_visible(timeout=REBOOT_MS)
