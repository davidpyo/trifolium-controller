"""Guided RPM captures, for fitting the simulator's flywheel model to a real blaster.

    python tests/bench/capture_rpm.py COM8                        # every scenario, 3 runs each
    python tests/bench/capture_rpm.py COM8 --runs 1 --only cold,shots
    python tests/bench/capture_rpm.py socket://127.0.0.1:5333     # against serve.py, to try it

A capture is the firmware's own RPM log. From the moment the wheels start to rev it records 2000
control-loop samples - 2 s at 1 kHz - of each motor's RPM, target and throttle and the pack voltage,
dumps them over serial and restarts the blaster. Everything a scenario shows has to happen in the
2 s after a rev starts.

For each scenario the walk sets up the running profile, says what to do, and saves the dump. It
changes only what the scenarios need - RPM logging, and in the running profile the fire modes,
target RPM, dwell and idle time - and puts all of it back at the end, Ctrl+C included. The whole
config is saved first as well.

Captures land in config_dumps/rpm_<date>_<time>/, one CSV per run, with session.json holding what
the CSVs do not: the setup, your notes, and the profile each scenario ran with.
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime

import serial

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bench_harness as H  # noqa: E402

LOG_LENGTH = 2000  # the firmware's MAX_RPM_LOG_LENGTH
HEADER_RE = re.compile(r"^Voltage_mv,(Motor \d+,TargetRPM \d+,Throttle \d+,value \d+,)+$")
WAIT_FOR_ACTION_S = 120
PIN_NOT_USED = 255

# Every profile key a scenario may change. Each scenario sends all of them - its own values, the
# original for the rest - so one scenario's settings never carry into the next.
PROFILE_KEYS = ("fireModes", "activeModeCount", "defaultFiringMode", "switchPositionAssignment",
                "revRPM", "dwellTime_ms", "idleTime_ms")


def mode(burst_mode, burst_length, dps):
    return {"name": "", "burstLength": burst_length, "burstMode": burst_mode, "targetDPS": dps,
            "reversible": False, "binaryTriggerTimeout_ms": 2000, "includeInCycle": True}


def only_mode(profile, fire_mode):
    """`fire_mode` as the one mode, on every selector position."""
    return {"fireModes": [fire_mode], "activeModeCount": 1, "defaultFiringMode": 0,
            "switchPositionAssignment": [0] * len(profile["switchPositionAssignment"])}


def own_auto(profile):
    """The profile's own AUTO mode, so the rate is the user's, else a default one."""
    auto = next((m for m in profile["fireModes"] if m.get("burstMode") == "auto"), None)
    return only_mode(profile, auto or mode("auto", 100, 15))


class Scenario:
    def __init__(self, name, title, fits, action, patch, darts=False, rev=False):
        self.name, self.title, self.fits, self.action = name, title, fits, action
        self.patch, self.darts, self.rev = patch, darts, rev


HOLD_REV = "Press and hold REV. Let go when it says saved."
SCENARIOS = [
    Scenario("cold", "Cold to target", "the spin-up rate, overshoot, and the throttle it settles at",
             HOLD_REV, lambda p: {}, rev=True),
    Scenario("low", "Lower target, cold", "whether throttle to RPM scales linearly",
             HOLD_REV, lambda p: {"revRPM": [20000] * len(p["revRPM"])}, rev=True),
    Scenario("spindown", "Spin-down", "the coast-down rate, and the spindown ramp on the way down",
             "Tap REV for about half a second, then let go.",
             lambda p: {"dwellTime_ms": 0, "idleTime_ms": 0}, rev=True),
    # One pull for three shots: a capture restarts at every rev that begins from idle, and a SEMI
    # pull after a shot is one, so separate pulls would leave only the last.
    Scenario("shots", "Single shots",
             "RPM lost per dart, the delay from pusher to dip, recovery, and the shot counter",
             "From a standstill, pull the trigger once and let go: a burst of 3, a third of a "
             "second apart.",
             lambda p: only_mode(p, mode("burst", 3, 3)), darts=True),
    Scenario("burst", "Full-auto burst", "losses piling up, recovery under steady load, pack sag",
             "From a standstill, hold the trigger for about 2 s.", own_auto, darts=True),
]


def wait_armed(link, timeout=20.0):
    """After a restart: the wheels ignore a rev until the ESCs have armed."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        boot = link.request("DUMP_BOOT", "DUMP_BOOT", window=2.0)
        if boot and boot.get("escArming", {}).get("ran"):
            return True
        time.sleep(0.5)
    return False


def read_capture(link):
    """Waits for the person to act, then reads the dump: a header line and LOG_LENGTH rows. The
    blaster restarts once it is sent, which can end the read."""
    ser = link.ser
    ser.reset_input_buffer()
    deadline = time.time() + WAIT_FOR_ACTION_S
    buf, header, rows = "", None, []
    while time.time() < deadline:
        try:
            chunk = ser.read(ser.in_waiting or 1).decode(errors="replace")
        except serial.SerialException:
            break
        buf += chunk
        while "\n" in buf:
            line, buf = buf.split("\n", 1)
            line = line.strip()
            if header is None:
                if HEADER_RE.match(line):
                    header, deadline = line, time.time() + 30
            elif line and not line.startswith("{"):
                rows.append(line)
                if len(rows) == LOG_LENGTH:
                    return header, rows
    return header, rows


def summarise(header, rows):
    """A line per motor to show the capture is sane: time to target, peak, lowest after."""
    cols = header.rstrip(",").split(",")
    table = [r.rstrip(",").split(",") for r in rows]
    volts = [int(r[0]) / 1000 for r in table]
    lines = [f"pack {volts[0]:.2f} V at the start, {min(volts):.2f} V lowest"]
    for c, name in enumerate(cols):
        if not name.startswith("Motor "):
            continue
        rpm = [int(r[c]) for r in table]
        target = max(int(r[c + 1]) for r in table)
        reach = next((i for i, v in enumerate(rpm) if target and v >= 0.97 * target), None)
        motor = f"motor {int(name.split()[1]) + 1}"
        if reach is None:
            lines.append(f"{motor}: never within 3% of {target:,} (peak {max(rpm):,})")
        else:
            lines.append(f"{motor}: within 3% of {target:,} at {reach} ms, peak {max(rpm):,}, "
                         f"lowest after {min(rpm[reach:]):,}")
    return lines


def ask(question):
    try:
        return input(question)
    except EOFError:
        return ""


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("port", help="COM8, or socket://127.0.0.1:5333 for the simulator")
    parser.add_argument("--runs", type=int, default=3, help="captures per scenario (default 3)")
    parser.add_argument("--only", help="scenarios, comma-separated: "
                        + ",".join(s.name for s in SCENARIOS))
    parser.add_argument("--out", help="where to save (default config_dumps/rpm_<date>_<time>)")
    opts = parser.parse_args()
    wanted = opts.only.split(",") if opts.only else [s.name for s in SCENARIOS]
    unknown = set(wanted) - {s.name for s in SCENARIOS}
    if unknown:
        parser.error(f"no scenario {', '.join(sorted(unknown))}")
    chosen = [s for s in SCENARIOS if s.name in wanted]
    out = opts.out or os.path.join(H.ROOT, "config_dumps",
                                   datetime.now().strftime("rpm_%Y%m%d_%H%M"))
    os.makedirs(os.path.join(out, "before"), exist_ok=True)

    link = H.Link(opts.port)
    if not link.wait_ready():
        sys.exit(f"{opts.port} does not answer")
    schema = link.request("DUMP_SCHEMA", "DUMP_SCHEMA", window=15.0)
    device = link.request("DUMP_DEVICE", "DUMP_DEVICE")
    profiles = [link.request(f"DUMP_PROFILE {i}", "DUMP_PROFILE")
                for i in range(schema["profileCount"])]
    if not device or None in profiles:
        sys.exit("could not read the config")
    for name, doc in [("schema", schema), ("device", device)] + [
            (f"profile{i}", p) for i, p in enumerate(profiles)]:
        with open(os.path.join(out, "before", f"{name}.json"), "w", encoding="utf-8") as f:
            json.dump(doc, f, indent=2)

    slot = schema["activeProfileIndex"]
    original = profiles[slot]
    motors = [i for i, m in enumerate(device["motorConfig"]) if m.get("enabled")]
    if not schema.get("wiringConfigured") or not motors:
        sys.exit("the blaster has no wiring or no motor enabled - set it up first")
    rev_wired = device.get("revSwitchPin", PIN_NOT_USED) != PIN_NOT_USED

    print(f"\n{device.get('blasterName')} on {schema.get('boardId') or 'custom wiring'}, "
          f"firmware {schema['fw']}")
    print(f"running slot {slot + 1} ({original.get('name')}), target {original['revRPM']}, "
          f"{device.get('flywheelControl')} control, motors {[m + 1 for m in motors]}")
    print(f"your config is saved in {out}{os.sep}before")
    print("\nA few notes for the record, which the captures cannot carry (Enter to leave one out):")
    notes = {"darts": ask("  darts (type, weight): "),
             "esc": ask("  ESC firmware and its braking setting: "),
             "pack": ask("  pack (cells, capacity, charge): ")}

    session = {"started": datetime.now().isoformat(timespec="seconds"), "port": opts.port,
               "fw": schema["fw"], "board": schema.get("boardId"), "slot": slot,
               "device": {k: device.get(k) for k in ("motorConfig", "flywheelControl", "dshotMode",
                                                     "throttleCap", "batteryType", "firingRPMTolerance",
                                                     "minFiringRPM", "rpmDropThreshold")},
               "notes": notes, "captures": []}
    logging_changed = not device.get("useRpmLogging") or device.get("rpmLogLength") != LOG_LENGTH
    profile_changed = False
    darts_ready = False
    try:
        if logging_changed:
            print("\nturning RPM logging on, 2000 samples...")
            link.load_device({"schemaVersion": schema["deviceSchemaVersion"],
                              "useRpmLogging": True, "rpmLogLength": LOG_LENGTH})
        for sc in chosen:
            patch = sc.patch(original)
            payload = {k: patch.get(k, original[k]) for k in PROFILE_KEYS}
            payload["schemaVersion"] = schema["profileSchemaVersion"]
            print(f"\n=== {sc.title} ({sc.name}): {sc.fits}")
            print("setting up the running profile...")
            link.load_profile(slot, payload)
            profile_changed = True
            if sc.darts and not darts_ready:
                ask("\nLoad darts and point the blaster somewhere safe, then press Enter. ")
                darts_ready = True
            action = sc.action if rev_wired or not sc.rev else (
                sc.action.replace("REV", "the trigger") + " (magazine out)")
            run = 1
            while run <= opts.runs:
                if not wait_armed(link):
                    print("  the ESCs did not arm - is the pack connected?")
                print(f"\nRun {run} of {opts.runs} ({sc.name}): {action}")
                header, rows = read_capture(link)
                if header is None or len(rows) < LOG_LENGTH:
                    got = "nothing" if header is None else f"{len(rows)} of {LOG_LENGTH} samples"
                    if ask(f"  captured {got}. Enter to try again, s to skip this scenario: ") == "s":
                        break
                    link.reconnect()
                    continue
                path = os.path.join(out, f"{sc.name}_{run}.csv")
                with open(path, "w", encoding="utf-8", newline="\n") as f:
                    f.write("\n".join([header] + rows) + "\n")
                print(f"  saved {os.path.relpath(path, H.ROOT)}")
                for line in summarise(header, rows):
                    print(f"    {line}")
                session["captures"].append({"scenario": sc.name, "run": run,
                                            "file": os.path.basename(path), "profile": payload})
                link.reconnect(wait_gone=True)
                run += 1
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        print("\nputting your settings back...")
        try:
            if profile_changed:
                back = {k: original[k] for k in PROFILE_KEYS}
                back["schemaVersion"] = schema["profileSchemaVersion"]
                link.load_profile(slot, back)
            if logging_changed:
                link.load_device({"schemaVersion": schema["deviceSchemaVersion"],
                                  "useRpmLogging": device.get("useRpmLogging", False),
                                  "rpmLogLength": device.get("rpmLogLength", LOG_LENGTH)})
            print("done")
        except Exception as e:  # noqa: BLE001 - the saved config is the way back
            print(f"could not put everything back ({e}); your config is in {out}{os.sep}before")
        with open(os.path.join(out, "session.json"), "w", encoding="utf-8") as f:
            json.dump(session, f, indent=2)
        link.close()
    print(f"\n{len(session['captures'])} capture(s) in {out}")


if __name__ == "__main__":
    main()
