"""Release acceptance: what only a real blaster can answer, walked once per release candidate.

    python tests/bench/bench_acceptance.py COM8 baseline      # before flashing the candidate
    python tests/bench/bench_acceptance.py COM8 verify        # step 1 walks you through the flash
    python tests/bench/bench_acceptance.py --self-test        # no hardware: checks the checker

    --only 3,8        run just these steps        --from 4    resume at step 4
    --skip-manual     mark hands-on steps SKIPPED (for an unattended first pass)

Everything the firmware decides is covered by the simulator suite in tests/suite/, which step 10
runs. This walk is the rest - the list tests/README.md gives under "What it cannot tell you": the compiled ARM
image, real ESCs and motors, the pusher, the ADC, a real ESC configurator and the bootloader.

Needs a wired blaster with its flywheels on, darts out and the muzzle clear. Nothing here writes the
blaster's config, and every step that reads it checks it against the baseline. Step 5 changes one
ESC's stored direction and has you put it back.

The walk's automated checks also run against the simulator, which is how to try a change to this
file without a blaster:

    python -m trifolium_sim.serve --preset trifolium_v1_2 --display      # from tests/sim/
    python tests/bench/bench_acceptance.py socket://127.0.0.1:5333 baseline
    python tests/bench/bench_acceptance.py socket://127.0.0.1:5333 verify --skip-manual --only 2,3
"""

import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.join(os.path.dirname(os.path.dirname(HERE)), "tools")]
import bench_harness as H  # noqa: E402
from bench_harness import ROOT, check, instruct, load, manual, run_tool, save, step  # noqa: E402
from release import firmware_version  # noqa: E402

STATE_DIR = os.path.join(ROOT, "config_dumps", "bench_acceptance")
H.configure(STATE_DIR)

FRAMING = {"cmd", "ok", "index"}
PIN_NOT_USED = 255
REV_HOLD_S = 3.0
ARM_WAIT_S = 10.0  # the firmware gives up arming after 6 s


def source_version():
    with open(os.path.join(ROOT, "src", "global.h"), encoding="utf-8") as f:
        return firmware_version(f.read())


# ---------------------------------------------------------------------------------------------
# comparators - what stands in for reading a reply by eye


def flatten(value, path="", out=None):
    out = {} if out is None else out
    if isinstance(value, dict):
        for key, v in value.items():
            if not path and key in FRAMING:
                continue
            flatten(v, f"{path}.{key}" if path else key, out)
    elif isinstance(value, list):
        for i, v in enumerate(value):
            flatten(v, f"{path}[{i}]", out)
    else:
        out[path] = value
    return out


def drift(before, after):
    """Paths whose value differs between two dumps of the same store. None when either is missing,
    which the caller records as a failure rather than a match."""
    if not isinstance(before, dict) or not isinstance(after, dict) or not before or not after:
        return None
    a, b = flatten(before), flatten(after)
    return sorted(p for p in a.keys() | b.keys() if a.get(p) != b.get(p))


def enabled_motors(device):
    return [i for i, m in enumerate(device.get("motorConfig") or [])
            if m.get("enabled") and (device.get("escPins") or [PIN_NOT_USED] * 4)[i] != PIN_NOT_USED]


def unarmed_escs(boot, motors):
    """Enabled motors whose ESC never answered during arming, or why the record cannot say."""
    arming = (boot or {}).get("escArming") or {}
    if not arming.get("ran"):
        return "arming never ran"
    if arming.get("timedOut"):
        return "arming timed out"
    answered = arming.get("answeredAt_ms") or []
    missing = [i + 1 for i in motors if i >= len(answered) or answered[i] < 0]
    return f"motor(s) {missing} never answered" if missing else None


def rev_verdicts(polls, motors, tolerance):
    """From DUMP_MOTORS polled through a held rev: for each enabled motor, (target, peak, reached),
    and the ms from the first poll with a target to the first with every motor within tolerance."""
    verdicts = {}
    for i in motors:
        target = max((p["motors"][i]["targetRPM"] for _, p in polls), default=0)
        peak = max((p["motors"][i]["motorRPM"] for _, p in polls), default=0)
        verdicts[i] = (target, peak, target > 0 and peak >= target - tolerance)

    started = next((t for t, p in polls if any(p["motors"][i]["targetRPM"] > 0 for i in motors)),
                   None)
    settled = next((t for t, p in polls if started is not None and t >= started and all(
        p["motors"][i]["targetRPM"] > 0
        and p["motors"][i]["motorRPM"] >= p["motors"][i]["targetRPM"] - tolerance
        for i in motors)), None)
    to_speed_ms = None if settled is None else round((settled - started) * 1000)
    return verdicts, to_speed_ms


# ---------------------------------------------------------------------------------------------
# phase: baseline


def dump_stores(link):
    device = link.request("DUMP_DEVICE", "DUMP_DEVICE")
    profiles = [link.request(f"DUMP_PROFILE {slot}", "DUMP_PROFILE") for slot in range(3)]
    return device, profiles


def phase_baseline(port):
    print("baseline - before flashing the candidate\n")
    link = H.Link(port)
    schema = link.request("DUMP_SCHEMA", "DUMP_SCHEMA", window=20.0)
    device, profiles = dump_stores(link)
    link.close()
    if not device or not all(profiles):
        print("  the device did not answer every dump - nothing written")
        sys.exit(1)
    save("device.json", device)
    save("profiles.json", profiles)
    print(f"  running {(schema or {}).get('fw', '?')}; this tree is {source_version()}")
    print(f"  wiring {device.get('boardId') or '(none)'}, motors {enabled_motors(device)}")
    print(f"\nbaseline written to {STATE_DIR}")


def baseline_device():
    return load("device.json")


def check_config_untouched(number, link, what):
    device, profiles = dump_stores(link)
    moved = drift(baseline_device(), device)
    check(number, f"{what} left the device settings alone", moved == [],
          "no baseline or no dump" if moved is None else f"changed: {moved[:6]}")
    base_profiles = load("profiles.json") or [None] * 3
    moved = [slot for slot in range(3) if drift(base_profiles[slot], profiles[slot]) != []]
    check(number, f"{what} left all three profiles alone", not moved, f"slots {moved}")
    return device


# ---------------------------------------------------------------------------------------------
# steps


@step(1, "the candidate goes on through the console's WebUSB flasher")
def step1(link):
    version = source_version()
    if not instruct(1, f"build {version} and flash it from the console", f"""
        python tools/release.py       (stages release/trifolium-{version}-universal.uf2)
        Open the console, connect, and use Flash firmware with that file. The blaster reboots
        into its bootloader, takes the image, and comes back on its own.
        """):
        return
    link.close()
    link.reconnect(wait_gone=True)
    manual(1, "the console reported the flash finished, and the blaster came back without a replug")


@step(2, "the blaster runs this tree's image, on the config it had before")
def step2(link):
    schema = link.request("DUMP_SCHEMA", "DUMP_SCHEMA", window=20.0) or {}
    check(2, "it reports this tree's version", schema.get("fw") == source_version(),
          f"device {schema.get('fw')}, tree {source_version()}")
    check(2, "it is wired", schema.get("wiringConfigured") is True, repr(schema.get("boardId")))
    check(2, "no pin is in conflict", schema.get("pinConflicts") == [],
          str(schema.get("pinConflicts")))
    boot = link.request("DUMP_BOOT", "DUMP_BOOT") or {}
    check(2, "the stores loaded with no fault", boot.get("configFaults") == [],
          str(boot.get("configFaults")))
    check_config_untouched(2, link, "the flash")


@step(3, "every enabled ESC armed and is sending telemetry")
def step3(link):
    device = link.request("DUMP_DEVICE", "DUMP_DEVICE") or {}
    motors = enabled_motors(device)
    if not check(3, "the wiring enables at least one flywheel motor", motors, str(motors)):
        return
    # Arming runs after the device first answers, and is only recorded once it ends.
    deadline = time.time() + ARM_WAIT_S
    boot = link.request("DUMP_BOOT", "DUMP_BOOT") or {}
    while not (boot.get("escArming") or {}).get("ran") and time.time() < deadline:
        time.sleep(0.5)
        boot = link.request("DUMP_BOOT", "DUMP_BOOT") or {}
    problem = unarmed_escs(boot, motors)
    check(3, "each enabled ESC answered during arming", problem is None,
          problem or f"{(boot.get('escArming') or {}).get('duration_ms')} ms")
    reply = link.request("DUMP_MOTORS", "DUMP_MOTORS") or {}
    rows = reply.get("motors") or [{}] * 4
    silent = [i + 1 for i in motors if not rows[i].get("erpmSeen")]
    check(3, "each enabled ESC is sending eRPM", not silent, f"silent: {silent}")
    edt = {i + 1: rows[i].get("edtSeen") for i in motors}
    check(3, "extended telemetry is the same on every ESC", len({str(v) for v in edt.values()}) == 1,
          str(edt))


@step(4, "the wheels reach their target, and turn the way that fires")
def step4(link):
    device = link.request("DUMP_DEVICE", "DUMP_DEVICE") or {}
    motors = enabled_motors(device)
    tolerance = device.get("firingRPMTolerance", 0)
    if not instruct(4, f"darts out, muzzle clear - then hold rev for {REV_HOLD_S:.0f} s", """
        Press enter, then pull and hold rev straight away until the wheels have been at speed a
        moment. This walk reads the motors while you hold it.
        """):
        return
    polls = []
    start = time.time()
    while time.time() - start < REV_HOLD_S + 2.0:
        reply = link.request("DUMP_MOTORS", "DUMP_MOTORS", window=1.0)
        if reply and reply.get("motors"):
            polls.append((time.time(), reply))
    verdicts, to_speed_ms = rev_verdicts(polls, motors, tolerance)
    for i, (target, peak, reached) in verdicts.items():
        check(4, f"motor {i + 1} reached its target", reached,
              f"target {target}, peak {peak}, tolerance {tolerance}")
    timeout = device.get("rampupTimeout_ms")
    check(4, "all of them inside the rampup timeout",
          to_speed_ms is not None and timeout is not None and to_speed_ms <= timeout,
          f"{to_speed_ms} ms (polled, so up to a poll late) of {timeout} ms")
    manual(4, "every wheel turned the way that sends a dart out, and they sounded even")


@step(5, "Change Direction reaches the ESC, and the ESC keeps it")
def step5(link):
    if not instruct(5, "change one motor's direction twice from the OLED", """
        Advanced > Motors & PID > Motor N > Change Direction, on any enabled motor, twice. Each
        press says what it wrote - Normal first, then Reversed - and spins the wheel. The first
        press may not move anything: it writes an absolute direction, not a toggle.
        """):
        return
    manual(5, "the second press spun the wheel the other way from the first")
    if not instruct(5, "power the ESCs off and on", """
        Unplug the battery, wait five seconds, plug it back in. Leave USB connected.
        """):
        return
    link.reconnect()
    manual(5, "a short rev turns that wheel the way the last press left it - the ESC saved it")
    if not instruct(5, "put it back", """
        If the wheel no longer turns the way that fires, Change Direction on it once more.
        """):
        return
    manual(5, "the wheel is back to turning the way that fires")
    check_config_untouched(5, link, "changing an ESC's direction")


@step(6, "a real ESC configurator reads every ESC through passthrough")
def step6(link):
    device = link.request("DUMP_DEVICE", "DUMP_DEVICE") or {}
    count = len(enabled_motors(device)) + (1 if device.get("pusherDrive") == "esc" else 0)
    if not instruct(6, "open esc-configurator.com in Chrome, but do not connect yet", """
        Press enter and this walk asks for passthrough and lets go of the port.
        """):
        return
    ack = link.request("ESC_PASSTHROUGH", "ESC_PASSTHROUGH") or {}
    if not check(6, "ESC_PASSTHROUGH was accepted", ack.get("ok") and ack.get("rebooting"), str(ack)):
        return
    link.close()
    if not instruct(6, "connect, read, disconnect", f"""
        Connect to the blaster's port in the configurator and Read Settings. It should find
        {count} ESC(s). Then Disconnect - the blaster carries on booting by itself.
        """):
        return
    manual(6, f"the configurator found {count} ESC(s) and read their settings")
    link.reconnect()
    boot = link.request("DUMP_BOOT", "DUMP_BOOT") or {}
    check(6, "the boot after it says a session ran", boot.get("passthroughExited") is True,
          repr(boot.get("passthroughExited")))
    check(6, "and it is back on the stock clock", boot.get("sysClockHz") == 133_000_000,
          str(boot.get("sysClockHz")))
    check_config_untouched(6, link, "the session")


@step(7, "the pusher fires what the mode asks for")
def step7(link):
    profile = link.request("DUMP_PROFILE", "DUMP_PROFILE") or {}
    modes = [m.get("burstMode") for m in (profile.get("fireModes") or [])
             [:profile.get("activeModeCount", 0)]]
    manual(7, "in a single-shot mode, one pull is one full extend and retract", f"modes: {modes}")
    if "auto" in modes:
        manual(7, "in AUTO, a held trigger fires at a steady rate and stops the moment it is let go")
    manual(7, "the wheels are at speed before the first dart, every time")


@step(8, "the panel and the battery reading")
def step8(link):
    device = link.request("DUMP_DEVICE", "DUMP_DEVICE") or {}
    if not device.get("hasDisplay"):
        H.results.setdefault(8, []).append(("a panel is wired", None, "hasDisplay is off"))
        print("    [SKIP] no panel on this wiring")
        return
    manual(8, "the home screen shows the name, profile, pack voltage and firing mode")
    manual(8, "the pack voltage on the panel is within 0.1 V of a meter across the pack",
           "Measure at the balance lead or the main connector with the blaster idle.")
    manual(8, "holding the menu button opens the menu, and a long press backs out of it")


@step(9, "the safety switch overrides everything while engaged")
def step9(link):
    device = link.request("DUMP_DEVICE", "DUMP_DEVICE") or {}
    if device.get("safetySwitchPin", PIN_NOT_USED) == PIN_NOT_USED:
        H.results.setdefault(9, []).append(("a safety switch is wired", None, "none on this wiring"))
        print("    [SKIP] no safety switch on this wiring")
        return
    if not instruct(9, "engage the safety switch", "Leave it engaged until the next prompt."):
        return
    motors = link.request("DUMP_MOTORS", "DUMP_MOTORS") or {}
    check(9, "the blaster reads it engaged and is in SAFE",
          motors.get("safetyEngaged") is True and motors.get("burstMode") == "safe", str(motors)[:120])
    check(9, "and refuses rev", motors.get("revAllowed") is False, repr(motors.get("revAllowed")))
    manual(9, "rev and trigger do nothing")
    if not instruct(9, "release the safety switch", ""):
        return
    motors = link.request("DUMP_MOTORS", "DUMP_MOTORS") or {}
    check(9, "released, the selected mode is back", motors.get("safetyEngaged") is False
          and motors.get("burstMode") != "safe", str(motors)[:120])


@step(10, "the simulator suite and the checkers pass on this tree")
def step10(link):
    run_tool(10, "the simulator suite", [sys.executable, "-m", "pytest", "-n", "auto", "-q"],
             cwd=os.path.join(ROOT, "tests"))
    run_tool(10, "check_bundle.py",
             [sys.executable, os.path.join(ROOT, "tests", "checks", "check_bundle.py")])


# ---------------------------------------------------------------------------------------------


def self_test():
    """Checks the checker, with no hardware. Every case asserts that a wrong answer is caught."""
    ok = True

    def expect(name, condition, detail=""):
        nonlocal ok
        ok = ok and bool(condition)
        print(f"  [{'PASS' if condition else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))

    device = {"cmd": "DUMP_DEVICE", "escPins": [0, 1, 2, 3], "blasterName": "a",
              "motorConfig": [{"enabled": False}, {"enabled": True}, {"enabled": False},
                              {"enabled": True}]}
    expect("enabled motors are the enabled ones with a pin", enabled_motors(device) == [1, 3])
    unpinned = dict(device, escPins=[0, 1, 2, 255])
    expect("an enabled motor with no pin is not counted", enabled_motors(unpinned) == [1])

    expect("an identical dump has no drift", drift(device, dict(device)) == [])
    expect("framing is not drift", drift(device, dict(device, cmd="X")) == [])
    expect("a changed field is drift", drift(device, dict(device, blasterName="b")) == ["blasterName"])
    nested = dict(device, motorConfig=[{"enabled": False}] * 4)
    expect("a changed nested field is drift", "motorConfig[1].enabled" in drift(device, nested))
    expect("a missing dump is not a match", drift(device, None) is None)

    good = {"escArming": {"ran": True, "timedOut": False, "answeredAt_ms": [-1, 800, -1, 820]}}
    expect("every enabled ESC answering passes", unarmed_escs(good, [1, 3]) is None)
    silent = {"escArming": {"ran": True, "timedOut": False, "answeredAt_ms": [-1, 800, -1, -1]}}
    expect("a silent enabled ESC is caught", unarmed_escs(silent, [1, 3]))
    expect("a timed-out arming is caught",
           unarmed_escs({"escArming": dict(good["escArming"], timedOut=True)}, [1, 3]))
    expect("an arming that never ran is caught", unarmed_escs({}, [1, 3]))

    def poll(t, rpms, target):
        return (t, {"motors": [{"targetRPM": target if r is not None else 0, "motorRPM": r or 0}
                               for r in rpms]})

    polls = [poll(0.0, [None, 0, None, 0], 0), poll(0.1, [None, 0, None, 0], 30000),
             poll(0.3, [None, 29800, None, 29000], 30000), poll(0.4, [None, 30000, None, 29900], 30000)]
    verdicts, ms = rev_verdicts(polls, [1, 3], 500)
    expect("both wheels at target pass", all(v[2] for v in verdicts.values()), str(verdicts))
    expect("time to speed counts from the first target to all within tolerance", ms == 300, str(ms))
    slow = polls[:3] + [poll(0.4, [None, 30000, None, 29000], 30000)]
    verdicts, ms = rev_verdicts(slow, [1, 3], 500)
    expect("a wheel short of its target is caught", not verdicts[3][2], str(verdicts))
    expect("and so is the time to speed", ms is None, str(ms))
    verdicts, _ = rev_verdicts(polls[:1], [1, 3], 500)
    expect("a rev that never asked for speed is caught", not any(v[2] for v in verdicts.values()))

    expect("the tree's version is readable", source_version() is not None, str(source_version()))

    print("\nself-test " + ("passed" if ok else "FAILED"))
    sys.exit(0 if ok else 1)


def main():
    parser = H.build_parser("Release acceptance on a real blaster.",
                            "unused - this walk writes no config to the device")
    opts = H.set_opts(parser.parse_args())
    if opts.self_test:
        self_test()
    if not opts.port or not opts.phase:
        parser.print_help()
        print("\n" + __doc__)
        sys.exit(1)
    try:
        if opts.phase == "baseline":
            phase_baseline(opts.port)
        else:
            if baseline_device() is None:
                print("no baseline - run the baseline phase before flashing the candidate")
                sys.exit(1)
            H.phase_verify(opts.port)
    except RuntimeError as e:
        H.port_failure(opts.port, e)


if __name__ == "__main__":
    main()
