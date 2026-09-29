"""Shared runner for the guided bench walks.

Everything a walk needs that is not its own steps: the serial link and its reboot handling, the
step registry, the verdict recorders, the results file, and the argparse scaffolding. A walk
module supplies configure(), its steps, and its own baseline phase; this supplies the rest.

The shape:

- Verdicts accumulate in a results file so `--only 3,8` can re-run one step. Cross-step facts
  persist in `state`; device captures must not, which is why report() drops whatever a walk
  declares volatile rather than trusting each walk to remember.
- Manual checks record SKIPPED. They are never assumed to pass, and `--skip-manual` gives an
  unattended run without inflating the score.
- instruct() returns False when nobody is there to act, so a step bails out rather than judging a
  device in the wrong state.

Import it as a module (`import bench_harness as H`) wherever OPTS is read: it is rebound by
set_opts() after parsing, so a `from ... import OPTS` would capture None.
"""

import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import time

import serial
import serial.tools.list_ports as list_ports

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FIXTURES = os.path.join(ROOT, "tools", "console", "src", "fixtures")

# Set by configure(); every save()/load() is relative to it.
STATE_DIR = None
# Keys in `state` that must never outlive a run - see report().
VOLATILE = set()
# Set by set_opts() after parsing. Read through the module, never imported by name.
OPTS = None

results = {}
state = {}
STEPS = []


def configure(state_dir, volatile=()):
    """`state_dir` is where this walk's captures and results.json live. `volatile` names the
    `state` keys holding device captures: persisting one makes a targeted re-run assert against
    the previous run instead of the device, which reads as a pass and proves nothing."""
    global STATE_DIR
    STATE_DIR = state_dir
    VOLATILE.clear()
    VOLATILE.update(volatile)


# ---------------------------------------------------------------------------------------------
# serial

BAUD = 115200


def is_url(name):
    """socket://host:port and the rest of pyserial's URL handlers - the simulator's serve.py."""
    return "://" in name


def port_exists(name):
    return any(p.device.upper() == name.upper() for p in list_ports.comports())


def wait_for_port(name, timeout=25.0, want=True):
    """Waits for the port to appear (want=True) or vanish (want=False) after a reboot. A URL's
    listener is always there, and the server drops the connection itself on a reboot, so open_port()
    retrying the connect is the whole of the wait."""
    if is_url(name):
        if not want:
            time.sleep(0.5)
        return True
    deadline = time.time() + timeout
    while time.time() < deadline:
        if port_exists(name) == want:
            return True
        time.sleep(0.25)
    return False


def open_port(name, timeout=25.0):
    if not wait_for_port(name, timeout, want=True):
        raise RuntimeError(f"{name} never came back")
    # The CDC endpoint can enumerate a moment before it will accept a connection.
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            ser = serial.serial_for_url(name, BAUD, timeout=1)
            time.sleep(0.4)
            ser.reset_input_buffer()
            return ser
        except Exception as e:  # noqa: BLE001 - retrying whatever the OS reports
            last = e
            time.sleep(0.4)
    raise RuntimeError(f"could not open {name}: {last}")


def read_lines(ser, window):
    """Yields complete JSON lines. DUMP_SCHEMA is one ~28 KB line, which arrives over several
    readline() timeouts, so partial reads have to be accumulated rather than parsed as they land."""
    deadline = time.time() + window
    buf = ""
    while time.time() < deadline:
        chunk = ser.readline().decode(errors="replace")
        if not chunk:
            continue
        buf += chunk
        while "\n" in buf:
            line, buf = buf.split("\n", 1)
            line = line.strip()
            if line.startswith("{"):
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    pass


class Link:
    """The serial connection, and everything that can go wrong with it on a rebooting device.

    Two hazards this exists to absorb:

    - **A stale handle.** The device can reboot or be replugged while a manual prompt is on screen,
      after which every write fails with a Windows PermissionError. Any request may therefore
      reopen the port once and retry.
    - **The boot window.** USB is up before setup() runs, but nothing answers until loop1() does,
      and a command sent before then is answered late rather than when asked. So every reconnect
      waits for a real reply before returning.
    """

    def __init__(self, port):
        self.port = port
        self.ser = open_port(port)

    def close(self):
        try:
            self.ser.close()
        except Exception:  # noqa: BLE001 - the port may already be gone
            pass

    def reconnect(self, wait_gone=False):
        self.close()
        if wait_gone:
            wait_for_port(self.port, want=False, timeout=10)
        self.ser = open_port(self.port)
        self.wait_ready()

    def wait_ready(self, timeout=30.0):
        """Polls until the firmware actually answers. DUMP_BOOT is the cheapest command that
        proves loop1() is running, and it touches nothing."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                if self._request_once("DUMP_BOOT", "DUMP_BOOT", window=2.0) is not None:
                    return True
            except serial.SerialException:
                # Still settling - reopen and keep waiting rather than failing the step.
                self.close()
                try:
                    self.ser = open_port(self.port, timeout=5.0)
                except Exception:  # noqa: BLE001
                    pass
        return False

    def _request_once(self, command, expect_cmd=None, window=8.0):
        self.ser.reset_input_buffer()
        self.ser.write((command + "\n").encode())
        for obj in read_lines(self.ser, window):
            if expect_cmd is not None:
                if obj.get("cmd") == expect_cmd:
                    return obj
                continue
            if "evt" in obj:
                continue
            return obj
        return None

    def request(self, command, expect_cmd=None, window=8.0):
        """Sends a command and returns its reply, reviving a dead connection once.

        `expect_cmd` matches the reply's own "cmd" field, which is what makes this safe on an
        unconfigured boot: send_serial.py takes the first line starting with a brace and would
        capture the repeating unconfigured event line instead. Left None, any non-event object is
        taken as the reply - looser, and only safe because nothing else is talking on the line.

        Every reply carries a "cmd", the config dumps included, so every caller can pass it.
        """
        try:
            reply = self._request_once(command, expect_cmd, window)
        except serial.SerialException:
            self.reconnect()
            reply = self._request_once(command, expect_cmd, window)
            return reply
        if reply is None:
            # A single miss is usually the boot window rather than a real absence.
            self.reconnect()
            reply = self._request_once(command, expect_cmd, window)
        return reply

    def reboot_request(self, command, expect_cmd, window=8.0):
        """For a command that acks and then reboots."""
        try:
            ack = self._request_once(command, expect_cmd, window)
        except serial.SerialException:
            self.reconnect()
            ack = self._request_once(command, expect_cmd, window)
        self.reconnect(wait_gone=True)
        return ack

    def load_profile(self, index, payload, retries=1):
        """LOAD_PROFILE <index>, which reboots only when it targets the active slot.

        Separate from load_device() because the reconnect is conditional: the device defers clamping
        for an inactive slot and stays up, so waiting for a re-enumeration that never happens would
        cost the walk a step to a timeout.
        """
        for _ in range(retries + 1):
            ack = None
            try:
                self.ser.reset_input_buffer()
                self.ser.write(f"LOAD_PROFILE {index}\n".encode())
                time.sleep(0.1)
                self.ser.write((json.dumps(payload) + "\n").encode())
                for obj in read_lines(self.ser, 8.0):
                    if obj.get("cmd") == "LOAD_PROFILE":
                        ack = obj
                        break
            except serial.SerialException:
                ack = None
            if ack is not None:
                if ack.get("rebooting"):
                    self.reconnect(wait_gone=True)
                    self.wait_ready()
                return ack
            self.reconnect()
        return None

    def load_device(self, payload, retries=1):
        """LOAD_DEVICE takes its JSON on the line after the command. Always reboots.

        Retries the way request() does, and returns the ack rather than discarding it. Both matter
        for the same reason: a write issued just after a manual prompt can hit a stale handle, and
        an unretried LOAD_DEVICE that threw leaves the device in the state the step was trying to
        undo. Loading the same config twice is harmless, so retrying costs nothing.
        """
        for _ in range(retries + 1):
            ack = None
            try:
                self.ser.reset_input_buffer()
                self.ser.write(b"LOAD_DEVICE\n")
                time.sleep(0.1)
                self.ser.write((json.dumps(payload) + "\n").encode())
                for obj in read_lines(self.ser, 8.0):
                    if obj.get("cmd") == "LOAD_DEVICE":
                        ack = obj
                        break
            except serial.SerialException:
                ack = None
            self.reconnect(wait_gone=True)
            if ack is not None:
                return ack
        return None


# ---------------------------------------------------------------------------------------------
# verdicts


def check(step, name, condition, detail=""):
    ok = bool(condition)
    results.setdefault(step, []).append((name, ok, detail))
    print(f"    [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))
    return ok


def manual(step, question, detail=""):
    """A hands-on check. Recorded as SKIPPED rather than assumed to pass."""
    if OPTS.skip_manual or not sys.stdin.isatty():
        results.setdefault(step, []).append((question, None, "skipped"))
        print(f"    [SKIP] {question}")
        return None
    print(f"\n    ---> {question}")
    if detail:
        for line in detail.strip().splitlines():
            print(f"         {line}")
    while True:
        answer = input("         pass / fail / skip [p/f/s]: ").strip().lower()
        if answer in ("p", "pass", "y", "yes"):
            return check(step, question, True, "confirmed by hand")
        if answer in ("f", "fail", "n", "no"):
            return check(step, question, False, "rejected by hand")
        if answer in ("s", "skip", ""):
            results.setdefault(step, []).append((question, None, "skipped"))
            print(f"    [SKIP] {question}")
            return None


def instruct(step, title, text):
    """A step that cannot start until a person does something. Returns False when nobody is there
    to do it, so the caller skips rather than judging a device in the wrong state - the automated
    checks in these steps only mean anything once the instruction was actually carried out."""
    if OPTS.skip_manual or not sys.stdin.isatty():
        results.setdefault(step, []).append((title, None, "needs a person; not attempted"))
        print(f"    [SKIP] {title} - needs a person to act first")
        return False
    print("\n    do this first:")
    for line in text.strip().splitlines():
        print(f"      {line}")
    input("      press enter when done: ")
    return True


def run_tool(step, name, args, cwd=None, shell=False):
    """`shell=True` with a string command is how npm has to be run on Windows: it is npm.cmd, which
    CreateProcess will not find, so a bare list raises WinError 2 and the check records as SKIPPED
    rather than failing. `cwd` because not every tool runs from the firmware root."""
    try:
        proc = subprocess.run(args, cwd=cwd or ROOT, capture_output=True, text=True, shell=shell)
    except FileNotFoundError as e:
        results.setdefault(step, []).append((name, None, f"not runnable: {e}"))
        print(f"    [SKIP] {name} - {e}")
        return None
    # `or ""` because a tool can finish having written to neither stream, and losing a whole step
    # to an AttributeError in the reporting is a poor trade for a missing detail line.
    tail = (proc.stdout or proc.stderr or "").strip().splitlines()
    check(step, name, proc.returncode == 0, tail[-1] if tail else f"exit {proc.returncode}")
    return proc


# ---------------------------------------------------------------------------------------------
# captures


def save(name, obj):
    os.makedirs(STATE_DIR, exist_ok=True)
    path = os.path.join(STATE_DIR, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2)
    return path


def load(name):
    path = os.path.join(STATE_DIR, name)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------------------------------------
# flashing, for the steps that need the device erased


def find_picotool():
    """picotool is not on PATH - PlatformIO's upload target calls it by full path, which is why
    flashing works while a bare `picotool` does not. Resolve it rather than telling anyone to."""
    found = shutil.which("picotool")
    if found:
        return found
    pattern = os.path.join(os.path.expanduser("~"), ".platformio", "packages",
                           "tool-picotool*", "picotool*")
    for path in sorted(glob.glob(pattern)):
        if os.path.isfile(path) and os.access(path, os.X_OK):
            return path
    return None


def find_flash_nuke():
    pattern = os.path.join(os.path.expanduser("~"), ".platformio", "platforms", "*", "misc",
                           "binaries", "flash_nuke.elf")
    hits = sorted(glob.glob(pattern))
    return hits[0] if hits else None


def erase_commands():
    """The exact commands for this machine, so a stale path in a doc cannot be what blocks it."""
    picotool, nuke = find_picotool(), find_flash_nuke()
    if not picotool or not nuke:
        missing = "picotool" if not picotool else "flash_nuke.elf"
        return (f"  (could not find {missing} under ~/.platformio - erase LittleFS however\n"
                f"   you can, then re-flash)\n")
    # `load` needs the device in BOOTSEL; -x executes the image, which is what runs the nuke.
    return (f'  "{picotool}" reboot -f -u\n'
            f'  "{picotool}" load -x "{nuke}"\n'
            f"  pio run -e pico -t upload\n")


# ---------------------------------------------------------------------------------------------
# steps


def step(number, title, destructive=False):
    def wrap(fn):
        STEPS.append((number, title, fn, destructive))
        return fn
    return wrap


def phase_verify(port, finish=None):
    """Runs the registered steps. finish(link) is called only after a complete run, so a partial
    one cannot half-restore the device."""
    wanted = None
    if OPTS.only:
        wanted = {int(x) for x in OPTS.only.split(",") if x.strip()}

    saved = load("results.json") or {}
    state.update(saved.get("state") or {})

    link = Link(port)
    for number, title, fn, destructive in sorted(STEPS):
        if wanted is not None and number not in wanted:
            continue
        if wanted is None and OPTS.start_from and number < OPTS.start_from:
            continue
        if destructive and not OPTS.allow_destructive:
            print(f"\nstep {number}: {title}")
            print("    [SKIP] destructive - re-run with --allow-destructive")
            results.setdefault(number, []).append((title, None, "destructive, not enabled"))
            continue
        print(f"\nstep {number}: {title}")
        try:
            fn(link)
        except Exception as e:  # noqa: BLE001 - one bad step should not lose the other verdicts
            check(number, f"step {number} raised", False, repr(e))
            # The recovery has to be guarded too, and for the same reason as the step. It reopens
            # the port, so it can raise exactly when the device is least reachable - and an
            # unguarded raise here would skip report() and lose every verdict in the run. Losing
            # the results file is worse than any single step failing, because it is the thing a
            # re-run resumes from.
            if not reconnect_or_stop(link, number):
                break

    if wanted is None and finish is not None:
        try:
            finish(link)
        except Exception as e:  # noqa: BLE001 - same reasoning: a failed restore is a verdict
            check(0, "the device was restored at the end of the run", False, repr(e))
    link.close()

    report(saved)


def reconnect_or_stop(link, number):
    """Put the link back, or end the run cleanly with the verdicts so far intact.

    Returns False when the port could not be reopened, which is not recoverable within a run: every
    later step would fail against a device nobody can talk to, burying the one failure that matters
    under a dozen that follow from it.
    """
    try:
        link.reconnect()
        return True
    except Exception as e:  # noqa: BLE001 - whatever the OS reports, the run ends the same way
        check(number, "the port came back after that step", False, repr(e))
        print()
        print(f"    the port did not come back, so the run stops here at step {number}.")
        print("    verdicts so far are still written - re-run with --from to resume.")
        print("      - is something else holding the port? the web console keeps it for as long")
        print("        as it is connected, and Web Serial hands a port to exactly one page")
        print("      - is the device mid-boot? a configured boot arms the ESCs before it answers")
        print("      - is it reachable at all? `picotool info` reports a device even when the")
        print("        COM port is held open by something else")
        return False


def report(saved):
    print("\n" + "=" * 78)
    passed = failed = skipped = 0
    lines = []
    merged = dict(saved.get("steps") or {})
    for number, checks in results.items():
        merged[str(number)] = [list(c) for c in checks]

    # A retired step takes its verdicts with it. The results file accumulates so that --only can
    # re-run one step without discarding the rest, so a removed step's passes would otherwise live
    # on and be counted, under a title nobody reads.
    retired = sorted((k for k in merged if int(k) not in {n for n, _, _, _ in STEPS}), key=int)
    for key in retired:
        del merged[key]
    if retired:
        print(f"dropped verdicts for retired step(s): {', '.join(retired)}\n")
    for key in sorted(merged, key=lambda k: int(k)):
        title = next((t for n, t, _, _ in STEPS if n == int(key)), "")
        verdicts = merged[key]
        good = sum(1 for _, ok, _ in verdicts if ok is True)
        bad = [name for name, ok, _ in verdicts if ok is False]
        skip = sum(1 for _, ok, _ in verdicts if ok is None)
        passed += good
        failed += len(bad)
        skipped += skip
        mark = "FAIL" if bad else ("SKIP" if skip and not good else "PASS")
        lines.append(f"  [{mark}] step {key}: {title}  ({good} passed"
                     + (f", {len(bad)} failed" if bad else "")
                     + (f", {skip} skipped" if skip else "") + ")")
        for name in bad:
            lines.append(f"           failed: {name}")
    print("\n".join(lines))
    print(f"\n{passed} passed, {failed} failed, {skipped} skipped")

    # Device captures live for the length of a run, never across one. Persisting a schema made
    # --only runs assert against the previous run's capture instead of the device - which reads as
    # a pass and proves nothing. Small cross-step facts (a board id, which pin is drvEN) do persist.
    carried = {k: v for k, v in state.items() if k not in VOLATILE}
    path = save("results.json", {"steps": merged, "state": carried,
                                 "when": time.strftime("%Y-%m-%d %H:%M:%S")})
    print(f"results: {path}")
    if skipped:
        print("skipped checks are not passes - the hands-on ones still need a person")
    sys.exit(1 if failed else 0)


# ---------------------------------------------------------------------------------------------
# argparse scaffolding


def build_parser(description, destructive_help):
    parser = argparse.ArgumentParser(
        description=description, epilog="See the module docstring for the full sequence.")
    parser.add_argument("port", nargs="?", help="serial port, e.g. COM4")
    parser.add_argument("phase", nargs="?", choices=["baseline", "verify"])
    parser.add_argument("--self-test", action="store_true",
                        help="check this script's own logic; needs no hardware")
    parser.add_argument("--only", help="comma-separated step numbers")
    parser.add_argument("--from", dest="start_from", type=int, help="resume at this step")
    parser.add_argument("--skip-manual", action="store_true",
                        help="record hands-on checks as skipped instead of asking")
    parser.add_argument("--allow-destructive", action="store_true", help=destructive_help)
    return parser


def set_opts(ns):
    global OPTS
    OPTS = ns
    return ns


def port_failure(port, err):
    """Almost always one of three things, and the third is easy to miss because the port still
    shows up in Device Manager."""
    print()
    print(f"cannot talk to {port}: {err}")
    print("  - wrong port? check which one the board enumerates as")
    print("  - is the board plugged in and past its boot delay?")
    print("  - is something else holding the port open - a serial monitor, or the IDE's?")
    sys.exit(1)
