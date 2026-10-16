"""2.3.0 on a real blaster: the parts of this release only hardware can answer.

    python tests/bench/bench_2_3.py COM8 baseline      # on 2.2.0, before flashing 2.3.0
    python tests/bench/bench_2_3.py COM8 verify        # after flashing it
    python tests/bench/bench_2_3.py --self-test        # no hardware: checks the checker

    --only 3,6        run just these steps        --from 4    resume at step 4
    --skip-manual     mark hands-on steps SKIPPED

Run it alongside bench_acceptance.py, which covers flashing, arming, the wheels, passthrough through
a real configurator, the pusher, the panel and the safety switch. The simulator suite covers the
logic of everything below: rule matching and order, the legacy conversion, the select-line rules,
the half-press handover, the cutoff's timing rules. What is left for this walk:

    1  this blaster's own stored config, written by real 2.2.0, survives the flash
    2  a default boot rule on real switches, at a real power-on, into the ROM bootloader
    3  a two-switch rule written from the redesigned console, over real USB, fires at power-on
    4  a combination's ESC passthrough ends on its first switch, through the real PIO hand-over
    5  real pack sag under a hard rev never trips the cutoff
    6  a really low pack refuses rev until a restart
    7  the menu spins the real wheels down mid-rev
    8  the half press on a real two-stage trigger, including the fast full press the design flags
    9  the console's Test, Normal and Reversed buttons drive a real ESC
   10  a rev held over real USB lapses on its own, and the console's Hold to rev lets go

A power-on here means a real one: battery out, USB unplugged and plugged back in. A restart from
the menu or the console skips boot rules by design, and unplugging USB with the battery in leaves
the board powered.

Steps 3, 4 and 8 change the config to test it and put it back at the end of the step. Step 6 asks
you to change Low V Cutoff, or a bench supply, and checks it was put back.
"""

import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.join(os.path.dirname(os.path.dirname(HERE)), "tools")]
import bench_harness as H  # noqa: E402
from bench_harness import ROOT, check, instruct, load, manual, save, step  # noqa: E402
from release import firmware_version  # noqa: E402
from bench_migrations import NO_FIRE_MODE, SWITCHES, as_current, legacy_rules, rule  # noqa: E402

STATE_DIR = os.path.join(ROOT, "config_dumps", "bench_2_3")
H.configure(STATE_DIR)

FRAMING = {"cmd", "ok", "index"}
PIN_NOT_USED = 255
LABELS = {"menu": "the MENU button", "trigger": "the TRIGGER", "rev": "the REV switch",
          "idle": "the IDLE switch", "select0": "select line 0", "select1": "select line 1",
          "select2": "select line 2"}


def source_version():
    with open(os.path.join(ROOT, "src", "global.h"), encoding="utf-8") as f:
        return firmware_version(f.read())


# ---------------------------------------------------------------------------------------------
# comparators


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


def config_drift(before, after):
    """Paths the baseline carries whose value moved. A field only the new build has is skipped: the
    baseline cannot judge it, and the fields it does carry keep their teeth. None when either dump
    is missing, which the caller records as a failure."""
    if not isinstance(before, dict) or not isinstance(after, dict) or not before or not after:
        return None
    a, b = flatten(before), flatten(after)
    return sorted(p for p in a if a[p] != b.get(p))


def new_modes_unpaired(profile):
    """Every fire mode a 2.2.0 profile carried loads with no half press."""
    modes = (profile or {}).get("fireModes") or []
    return [i for i, m in enumerate(modes) if m.get("revStageMode", NO_FIRE_MODE) != NO_FIRE_MODE]


def enabled_motors(device):
    return [i for i, m in enumerate(device.get("motorConfig") or [])
            if m.get("enabled") and (device.get("escPins") or [PIN_NOT_USED] * 4)[i] != PIN_NOT_USED]


def poll_motors(link, seconds, every=0.1):
    polls, end = [], time.time() + seconds
    while time.time() < end:
        dump = link.request("DUMP_MOTORS", "DUMP_MOTORS", window=2.0)
        if dump:
            polls.append((time.time(), dump))
        time.sleep(every)
    return polls


def revved(polls, motors):
    """Some poll asked every enabled motor for speed."""
    return any(all(p["motors"][i]["targetRPM"] > 0 for i in motors) for _, p in polls)


def refused(polls, motors):
    """Polls were taken, and none asked any enabled motor for speed."""
    return bool(polls) and not any(p["motors"][i]["targetRPM"] > 0 for _, p in polls for i in motors)


STATE_IDLE = 0  # flywheelState_t


def rev_ended_at(polls):
    """When the flywheel state first left the rev. The targets themselves ease down after that, through
    the dwell and the spindown, so they say nothing about when the rev let go."""
    return next((t for t, p in polls if p.get("flywheelState") == STATE_IDLE), None)


def spun_down_after(polls, motors, cue, key, value):
    """After `cue`, a poll shows `key` at `value` with every enabled motor's target at 0."""
    return any(t >= cue and p.get(key) == value
               and all(p["motors"][i]["targetRPM"] == 0 for i in motors) for t, p in polls)


def live_rule(rules, action, size):
    """The first rule taking `action` on exactly `size` switches, as (index, switches), or None."""
    for i, r in enumerate(rules or []):
        on = [s for s in SWITCHES if r.get(s)]
        if r.get("action") == action and len(on) == size:
            return i, on
    return None


def without_framing(dump):
    return {k: v for k, v in dump.items() if k not in FRAMING}


# ---------------------------------------------------------------------------------------------
# a real power-on


def power_on(number, link, holding, then=""):
    """Closes the port, walks a person through a real power-on with `holding` held, and leaves the
    port closed: the caller decides whether the device should come back on it."""
    link.close()
    held = " and ".join(LABELS[s] for s in holding) if holding else "nothing"
    return instruct(number, f"power on holding {held}", f"""
        1. Take the battery out, and unplug USB.
        2. Hold {held}.
        3. Plug USB back in, and keep holding for 2 s, then let go.
        {then}
        """)


def came_back(link):
    try:
        link.reconnect(wait_gone=False)
        return True
    except Exception:  # noqa: BLE001 - the port not coming back is the answer, not an error
        return False


# ---------------------------------------------------------------------------------------------
# phase: baseline


def dump_stores(link):
    device = link.request("DUMP_DEVICE", "DUMP_DEVICE")
    profiles = [link.request(f"DUMP_PROFILE {slot}", "DUMP_PROFILE") for slot in range(3)]
    return device, profiles


def phase_baseline(port):
    print("baseline - on 2.2.0, before flashing 2.3.0\n")
    link = H.Link(port)
    schema = link.request("DUMP_SCHEMA", "DUMP_SCHEMA", window=20.0) or {}
    device, profiles = dump_stores(link)
    link.close()
    if not device or not all(profiles):
        print("  the device did not answer every dump - nothing written")
        sys.exit(1)
    if "bootRules" in device:
        print("  this device already stores bootRules - the baseline has to come from 2.2.0, so")
        print("  flash 2.2.0 first or step 1 has nothing to judge")
        sys.exit(1)
    save("device.json", device)
    save("profiles.json", profiles)
    print(f"  running {schema.get('fw', '?')}; this tree is {source_version()}")
    print(f"  boot actions {device.get('bootAction')}, dual stage {device.get('dualStageTrigger')}")
    print(f"\nbaseline written to {STATE_DIR}")


# ---------------------------------------------------------------------------------------------
# steps


@step(1, "this blaster's own 2.2.0 config came through the flash")
def step1(link):
    schema = link.request("DUMP_SCHEMA", "DUMP_SCHEMA", window=20.0) or {}
    check(1, "it reports this tree's version", schema.get("fw") == source_version(),
          f"device {schema.get('fw')}, tree {source_version()}")
    boot = link.request("DUMP_BOOT", "DUMP_BOOT") or {}
    check(1, "the stores loaded with no fault", boot.get("configFaults") == [],
          str(boot.get("configFaults")))

    device, profiles = dump_stores(link)
    before = load("device.json")
    check(1, "the per-switch boot actions became the equivalent rules, in the same order",
          (device or {}).get("bootRules") == as_current(before).get("bootRules"),
          f"stored {(before or {}).get('bootAction')}, now {(device or {}).get('bootRules')}")
    check(1, "and the old array is gone", "bootAction" not in (device or {}))
    moved = config_drift(as_current(before), device)
    check(1, "every other device setting is as it was", moved == [],
          "no baseline or no dump" if moved is None else f"changed: {moved[:6]}")

    base_profiles = load("profiles.json") or [None] * 3
    moved = [s for s in range(3) if config_drift(base_profiles[s], profiles[s]) != []]
    check(1, "all three profiles are as they were", not moved, f"slots {moved}")
    paired = {s: new_modes_unpaired(profiles[s]) for s in range(3) if new_modes_unpaired(profiles[s])}
    check(1, "and every fire mode came up with no half press", not paired, str(paired))


@step(2, "a default boot rule on real switches enters the ROM bootloader")
def step2(link):
    device = link.request("DUMP_DEVICE", "DUMP_DEVICE") or {}
    hit = live_rule(device.get("bootRules"), "bootloader", 1)
    if not hit:
        H.results.setdefault(2, []).append(("a one-switch Bootloader rule", None, "none stored"))
        print("    [SKIP] no one-switch Bootloader rule on this blaster")
        return
    _, (switch,) = hit
    if not power_on(2, link, [switch]):
        return
    check(2, "the serial port stays gone, as it does in the bootloader",
          not H.wait_for_port(link.port, timeout=8.0, want=True))
    manual(2, "an RPI-RP2 drive appeared, or `picotool info` finds a device in BOOTSEL")
    if not power_on(2, link, [], then="Nothing held this time: it should start normally."):
        return
    check(2, "a plain power-on afterwards boots normally", came_back(link))
    check(2, "and fired no rule",
          (link.request("DUMP_BOOT", "DUMP_BOOT") or {}).get("bootProfile") == -1)


@step(3, "a two-switch rule written from the console fires at power-on")
def step3(link):
    original = (link.request("DUMP_DEVICE", "DUMP_DEVICE") or {}).get("bootRules")
    if not check(3, "the device reports its boot rules", isinstance(original, list)):
        return
    link.close()
    if not instruct(3, "write a rule from the console", """
        Open the console and connect. Under Blaster settings > Boot Actions, set Rule 1 to
        Menu Button + Trigger, action Slot 2, and nothing else ticked on that row. Review and write.
        Leave the console open until it has reconnected, then Disconnect it.
        """):
        return
    manual(3, "the blaster restarted and the console reconnected by itself, with no replug")
    link.reconnect()
    written = (link.request("DUMP_DEVICE", "DUMP_DEVICE") or {}).get("bootRules") or []
    check(3, "Rule 1 on the device is Menu + Trigger for Slot 2",
          written[:1] == [rule("profile_1", "menu", "trigger")], str(written[:1]))

    if power_on(3, link, ["menu", "trigger"]):
        check(3, "the blaster came back", came_back(link))
        check(3, "holding both booted Slot 2",
              (link.request("DUMP_BOOT", "DUMP_BOOT") or {}).get("bootProfile") == 1)
    if power_on(3, link, ["trigger"], then="Trigger alone should not boot Slot 2."):
        check(3, "the blaster came back", came_back(link))
        check(3, "one of the two did not boot Slot 2",
              (link.request("DUMP_BOOT", "DUMP_BOOT") or {}).get("bootProfile") != 1)

    restore_rules(3, link, original)


def restore_rules(number, link, rules):
    if not came_back(link):
        check(number, "the device answered for the restore", False)
        return
    ack = link.load_device({"schemaVersion": 3, "bootRules": rules})
    check(number, "the original rules were put back", (ack or {}).get("ok") and
          (link.request("DUMP_DEVICE", "DUMP_DEVICE") or {}).get("bootRules") == rules, str(ack))


@step(4, "a combination's ESC passthrough ends on its first switch")
def step4(link):
    device = link.request("DUMP_DEVICE", "DUMP_DEVICE") or {}
    original = device.get("bootRules")
    if not enabled_motors(device):
        H.results.setdefault(4, []).append(("an enabled ESC", None, "none to hand over"))
        print("    [SKIP] no enabled motor, so no session opens")
        return
    if H.OPTS.skip_manual or not sys.stdin.isatty():
        H.results.setdefault(4, []).append(("a person to power-cycle it", None, "unattended"))
        print("    [SKIP] needs a person at the blaster - nothing written")
        return
    ack = link.load_device({"schemaVersion": 3,
                            "bootRules": [rule("esc_passthrough", "menu", "trigger")] + original[1:]})
    if not check(4, "a Menu + Trigger passthrough rule was written", (ack or {}).get("ok"), str(ack)):
        return
    # The session takes the port: opening it now would count as a configurator connecting.
    if power_on(4, link, ["menu", "trigger"], then="Then do not connect anything to the port."):
        if device.get("hasDisplay"):
            manual(4, "the panel says ESC Passthrough, hold MENU to exit")
        if instruct(4, "end the session from the blaster",
                    "With both released, hold the MENU button for 4 s, then let go."):
            check(4, "the blaster carried on booting", came_back(link))
            boot = link.request("DUMP_BOOT", "DUMP_BOOT") or {}
            check(4, "the boot says a session ran and ended", boot.get("passthroughExited") is True)
            check(4, "and it is back on the stock clock", boot.get("sysClockHz") == 133_000_000,
                  str(boot.get("sysClockHz")))
            manual(4, "rev spins every wheel, so the ESC pins came back from passthrough")
    restore_rules(4, link, original)


def battery_wired(number, device):
    if device.get("batteryAdcPin", PIN_NOT_USED) == PIN_NOT_USED:
        H.results.setdefault(number, []).append(("a battery reading is wired", None, "none"))
        print("    [SKIP] no battery pin on this wiring - the cutoff never trips")
        return False
    return True


@step(5, "real pack sag under a hard rev never trips the cutoff")
def step5(link):
    device = link.request("DUMP_DEVICE", "DUMP_DEVICE") or {}
    motors = enabled_motors(device)
    if not battery_wired(5, device) or not check(5, "a flywheel motor is enabled", motors):
        return
    if not instruct(5, "rev it hard on a charged pack", """
        On a charged pack: five full revs of 3 s each, about a second apart. Fire darts through them
        if you can - the sag is deepest with the pusher working too. Then let the wheels stop.
        """):
        return
    if not instruct(5, "hold rev", "Hold rev and press enter with your other hand; keep holding."):
        return
    polls = poll_motors(link, 2.5)
    check(5, "the next rev still spins up", revved(polls, motors))
    manual(5, "no LOW BATT on the panel at any point")


@step(6, "a really low pack refuses rev until a restart")
def step6(link):
    device = link.request("DUMP_DEVICE", "DUMP_DEVICE") or {}
    motors = enabled_motors(device)
    cutoff = device.get("lowVoltageCutoffPerCell_mv")
    if not battery_wired(6, device) or not check(6, "a flywheel motor is enabled", motors):
        return
    if not instruct(6, "take the pack below the cutoff, with the wheels stopped", f"""
        The cutoff only arms once a reading is at or above it, so start from a normal boot.
        Either: on a bench supply, turn it down below {cutoff} mV a cell.
        Or: on a pack at storage charge (under 3.8 V a cell), raise Advanced > Battery > Low V
        Cutoff on the blaster to 3800, and leave the menu.
        Then wait 3 s with the wheels stopped.
        """):
        return
    if not instruct(6, "hold rev", "Hold rev and press enter with your other hand; keep holding."):
        return
    check(6, "a held rev gets no speed", refused(poll_motors(link, 2.5), motors))
    manual(6, "the panel shows LOW BATT, and the trigger fires nothing")
    if device.get("lowBattBeep", True):
        manual(6, "with rev let go, every ESC plays a rising sweep, and again about 10 s later",
               "Listen for 15 s. It waits for the wheels to stop, and the pack must be in.")

    if not instruct(6, "bring the voltage back, without restarting", f"""
        Turn the supply back up, or set Low V Cutoff back to {cutoff} and leave the menu.
        Then hold rev and press enter; keep holding.
        """):
        return
    check(6, "still refused: a flat pack holds until a restart", refused(poll_motors(link, 2.5), motors))
    if power_on(6, link, [], then="Put the battery or supply back in as normal after."):
        check(6, "the blaster came back", came_back(link))
        if instruct(6, "hold rev", "Hold rev and press enter; keep holding."):
            check(6, "after the restart it revs again", revved(poll_motors(link, 2.5), motors))
    after = (link.request("DUMP_DEVICE", "DUMP_DEVICE") or {}).get("lowVoltageCutoffPerCell_mv")
    check(6, "Low V Cutoff is back where it was", after == cutoff, f"{after}, was {cutoff}")


@step(7, "the menu spins the real wheels down mid-rev")
def step7(link):
    device = link.request("DUMP_DEVICE", "DUMP_DEVICE") or {}
    motors = enabled_motors(device)
    if not check(7, "a flywheel motor is enabled", motors) or not device.get("hasDisplay"):
        if motors:
            print("    [SKIP] no panel, so no menu to open")
        return
    if not instruct(7, "hold rev", """
        Hold rev and press enter with your other hand. Keep holding rev: this walk tells you when
        to press the MENU button.
        """):
        return
    spinning = poll_motors(link, 1.5)
    if not check(7, "the wheels spun up", revved(spinning, motors)):
        return
    print("\n      >>> press the MENU button now, still holding rev <<<\n")
    cue = time.time()
    polls = poll_motors(link, 5.0)
    check(7, "with the menu open, every wheel was told to stop",
          spun_down_after(polls, motors, cue, "menuOpen", True))
    manual(7, "the wheels coasted down cleanly: no stutter, no ESC beeping, no restart")
    instruct(7, "close the menu", "Let go of rev, and back out of the menu.")


@step(8, "the half press on a real two-stage trigger")
def step8(link):
    device = link.request("DUMP_DEVICE", "DUMP_DEVICE") or {}
    if not device.get("dualStageTrigger"):
        H.results.setdefault(8, []).append(("a dual-stage trigger", None, "Dual Stage Trigger off"))
        print("    [SKIP] needs a real two-stage trigger (a Fencer, say) with Dual Stage Trigger on.")
        print("           Two separate switches pressed by hand close too far apart to test it.")
        return
    original = link.request("DUMP_PROFILE", "DUMP_PROFILE") or {}
    slot = original.get("index")
    link.close()
    if not instruct(8, "pair a half press from the console", """
        In the console, on the active profile: give the mode the selector is on a BURST of 3, with
        Half Press set to a SEMI mode. Write, let it reconnect, then Disconnect the console.
        """):
        link.reconnect()
        return
    link.reconnect()
    profile = link.request("DUMP_PROFILE", "DUMP_PROFILE") or {}
    modes = profile.get("fireModes") or []
    pairs = [(i, m["revStageMode"]) for i, m in enumerate(modes)
             if m.get("revStageMode", NO_FIRE_MODE) != NO_FIRE_MODE]
    check(8, "a mode on the active profile has a half press", pairs, str(pairs))

    manual(8, "a half press fires one dart, and holding it fires no more")
    manual(8, "pausing at half until its dart fires, then pressing on, fires 4: the half press's dart"
              " stands and the full press takes over with its 3")
    manual(8, "easing back from a full press to a half press, then letting go, fires nothing more")
    manual(8, "a fast full press from stopped wheels fires 3, five times out of five",
           "The half press's shot is still waiting for the wheels, so the full press drops it.")
    manual(8, "a fast full press straight after a burst, wheels still turning, fires 3 and not 4,"
              " five times out of five",
           "This is the extra shot MOH-40 flags. A 4 here means the half-press delay is needed.")
    if device.get("hasDisplay"):
        manual(8, "the panel shows both modes, the one firing drawn inverted")

    if slot is not None:
        ack = link.load_profile(slot, without_framing(original))
        check(8, "the profile was put back", (ack or {}).get("ok"), str(ack))


@step(9, "the console's Test, Normal and Reversed buttons drive a real ESC")
def step9(link):
    device = link.request("DUMP_DEVICE", "DUMP_DEVICE") or {}
    motors = enabled_motors(device)
    if not check(9, "a flywheel motor is enabled", motors):
        return
    link.close()
    if not instruct(9, "use the motor buttons in the console", f"""
        Darts out. Open the console, connect, and go to Blaster settings > Motors & PID.
        Press Test on each of motors {', '.join(str(i + 1) for i in motors)} in turn.
        """):
        link.reconnect()
        return
    manual(9, "each Test spun only its own wheel, for about 2 s, and the panel named the motor")
    first = motors[0] + 1
    if instruct(9, f"flip motor {first}", f"""
        Press Reversed on motor {first}, and watch which way it spins. Then press Normal.
        """):
        manual(9, f"Reversed spun motor {first} the other way from Normal")
    if instruct(9, f"put motor {first} back", f"""
        Press whichever of Normal or Reversed spins motor {first} the way that fires, then
        Disconnect the console.
        """):
        manual(9, f"motor {first} spins the firing way again")
    link.reconnect()


@step(10, "a rev held over real USB lapses on its own, and Hold to rev lets go")
def step10(link):
    device = link.request("DUMP_DEVICE", "DUMP_DEVICE") or {}
    motors = enabled_motors(device)
    if not check(10, "a flywheel motor is enabled", motors):
        return
    if device.get("useRpmLogging"):
        H.results.setdefault(10, []).append(("RPM Logging off", None, "it is on"))
        print("    [SKIP] turn RPM Logging off first: every rev would restart the blaster")
        return
    if H.OPTS.skip_manual or not sys.stdin.isatty():
        H.results.setdefault(10, []).append(("a person at the blaster", None, "unattended"))
        print("    [SKIP] needs a person at the blaster - nothing revved")
        return
    if not instruct(10, "darts out", "This walk revs the wheels itself first. Keep clear."):
        return
    mask = sum(1 << i for i in motors)
    polls, end = [], time.time() + 1.5
    while time.time() < end:
        link.request(f"REV_HOLD {mask}", "REV_HOLD", window=1.0)
        dump = link.request("DUMP_MOTORS", "DUMP_MOTORS", window=1.0)
        if dump:
            polls.append((time.time(), dump))
        time.sleep(0.05)
    check(10, "renewing REV_HOLD revs every enabled motor", revved(polls, motors))
    stopped_at = time.time()
    after = poll_motors(link, 1.0, every=0.05)
    lapsed = rev_ended_at(after)
    check(10, "with the renewals stopped, the rev ends within half a second",
          lapsed is not None and lapsed - stopped_at < 0.5,
          "never" if lapsed is None else f"{(lapsed - stopped_at) * 1000:.0f} ms")

    link.close()
    if not instruct(10, "use Hold to rev in the console", """
        Open the console, connect, and go to RPM capture. With every motor ticked, hold Hold to rev
        for a couple of seconds and let go. Then hold it again and, still holding, switch to
        another window (Alt+Tab). Then untick one motor, hold it, and pull the trigger.
        Disconnect the console after.
        """):
        link.reconnect()
        return
    manual(10, "the wheels spun while it was held and spun down the moment you let go")
    manual(10, "switching window spun them down without letting go of the button")
    manual(10, "with a motor unticked only the others spun, and the trigger did not move the pusher")
    link.reconnect()


# ---------------------------------------------------------------------------------------------


def self_test():
    """Checks the checker, with no hardware. Every case asserts that a wrong answer is caught."""
    ok = True

    def expect(name, condition, detail=""):
        nonlocal ok
        ok = ok and bool(condition)
        print(f"  [{'PASS' if condition else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))

    legacy = ["bootloader", "esc_passthrough", "profile_1", "bootloader", "none", "none", "none",
              "idle_hold"]
    rules = legacy_rules(legacy, False)
    expect("the conversion keeps the old order", rules[:4] == [
        rule("bootloader", "menu"), rule("esc_passthrough", "trigger"), rule("profile_1", "rev"),
        rule("idle_hold", "select2")], str(rules[:4]))
    expect("and drops the cycle switch's entry", [r["action"] for r in rules].count("none") == 4)
    expect("a dual-stage trigger drops rev", legacy_rules(legacy, True)[2] == rule("idle_hold", "select2"))
    expect("it always yields eight slots", len(legacy_rules([], False)) == 8)

    before = {"cmd": "DUMP_DEVICE", "blasterName": "a", "dualStageTrigger": False,
              "bootAction": ["bootloader"] + ["none"] * 7}
    after = {"cmd": "DUMP_DEVICE", "blasterName": "a", "dualStageTrigger": False,
             "bootRules": legacy_rules(before["bootAction"], False)}
    expect("a faithful conversion is no drift", config_drift(as_current(before), after) == [])
    expect("a field the new build adds is not drift",
           config_drift(as_current(before), dict(after, newThing=1)) == [])
    expect("a changed field is drift",
           config_drift(as_current(before), dict(after, blasterName="b")) == ["blasterName"])
    expect("a field the flash dropped is drift", "blasterName" in config_drift(
        as_current(before), {k: v for k, v in after.items() if k != "blasterName"}))
    wrong = dict(after, bootRules=legacy_rules(["none", "bootloader"] + ["none"] * 6, False))
    expect("a conversion onto the wrong switch is drift", config_drift(as_current(before), wrong))
    expect("a missing dump is not a match", config_drift(before, None) is None)

    expect("a profile from 2.2.0 has no pairing", new_modes_unpaired({"fireModes": [
        {"revStageMode": -1}, {"burstMode": "auto"}]}) == [])
    expect("a paired mode is caught", new_modes_unpaired({"fireModes": [{"revStageMode": 2}]}) == [0])

    def poll(t, targets, **extra):
        return (t, {"motors": [{"targetRPM": x} for x in targets], **extra})

    up = [poll(0, [0, 0, 0, 0]), poll(1, [30000, 30000, 0, 0])]
    expect("a rev that reached every motor counts", revved(up, [0, 1]))
    expect("one motor left at 0 is not a rev", not revved([poll(1, [30000, 0, 0, 0])], [0, 1]))
    expect("all-zero polls are a refusal", refused([poll(0, [0, 0, 0, 0])] * 3, [0, 1]))
    expect("a single target is not a refusal", not refused(up, [0, 1]))
    expect("no polls at all is not a refusal", not refused([], [0, 1]))
    down = [poll(1, [30000, 30000, 0, 0], menuOpen=False), poll(3, [0, 0, 0, 0], menuOpen=True)]
    expect("stopped with the menu open after the cue counts",
           spun_down_after(down, [0, 1], 2, "menuOpen", True))
    expect("a stop before the cue does not",
           not spun_down_after(down[:1] + [poll(1.5, [0, 0, 0, 0], menuOpen=True)], [0, 1], 2,
                               "menuOpen", True))

    dwelling = [(1, {"flywheelState": 2}), (2, {"flywheelState": 0, "motors": [{"targetRPM": 30000}]})]
    expect("a rev counts as ended when the state leaves it, targets still up", rev_ended_at(dwelling) == 2)
    expect("a rev still under way has not ended", rev_ended_at(dwelling[:1]) is None)

    expect("a one-switch bootloader rule is found", live_rule(rules, "bootloader", 1) == (0, ["menu"]))
    expect("a two-switch search does not match it", live_rule(rules, "bootloader", 2) is None)
    expect("the tree's version is readable", source_version() is not None, str(source_version()))

    print("\nself-test " + ("passed" if ok else "FAILED"))
    sys.exit(0 if ok else 1)


def main():
    parser = H.build_parser("2.3.0's hardware-only checks on a real blaster.",
                            "unused - every step that changes the config puts it back itself")
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
            if load("device.json") is None:
                print("no baseline - run the baseline phase on 2.2.0 before flashing 2.3.0")
                sys.exit(1)
            H.phase_verify(opts.port)
    except RuntimeError as e:
        H.port_failure(opts.port, e)


if __name__ == "__main__":
    main()
