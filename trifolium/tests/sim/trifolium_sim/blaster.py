"""A blaster on the bench, in software.

The firmware booted on the simulator, with its switches, wheels, pusher, battery, panel and a USB
host in the test's hands. One Blaster is one blaster across any number of reboots. Each boot is its
own trifolium-sim process, started on the flash the last one left and - after a real reboot - on the
RAM a reboot keeps, so a test sees the device come back the way a real one does. The outside world
(held switches, the pack, the panel, the wheels) is replayed onto every boot, as it would still be
there.
"""

import base64
import json

from .host import EXE, PROJECT, HostProcess, SimCrash
from .panel import Panel

SWITCHES = ("menu", "trigger", "rev", "cycle", "idle", "safety", "select0", "select1", "select2")

# flywheelState
IDLE, ACCELERATING, FULLSPEED = 0, 1, 2

# BootReason, as the firmware numbers it
POR, WATCHDOG, CLEAR_EEPROM, MENU, TO_ESC_PASSTHROUGH, FROM_ESC_PASSTHROUGH = range(6)

POWER_ON_MAGIC = "deadbeefdeadbeef"

# ESC start-up on a v1.2 blaster, from the start of the arm loop: repeatable to a couple of ms over
# pack power-ons, and the same 715 ms longer for both ESCs on a reboot. Motors 2 and 4 were measured;
# 1 and 3 repeat them.
ESC_STARTUP_MS = (1526, 1526, 318, 318)
ESC_RESTART_MS = 715


class FirmwareStopped(Exception):
    """The firmware panicked or threw - a fault in it, or in a fake it reached."""


def preset(board_id, overrides=None):
    """boards/<id>/board.json with `overrides` laid over its top-level keys."""
    doc = json.loads((PROJECT / "boards" / board_id / "board.json").read_text(encoding="utf-8"))
    doc.update(overrides or {})
    return doc


class Blaster:
    def __init__(self, exe=EXE):
        self._exe = exe
        self._world = {}
        self._proc = HostProcess(exe)
        self._child_now = 0
        self._offset_us = 0
        self._powered_at_us = 0
        self._restarted = False  # this boot follows a reboot the ESCs stayed powered through
        self._serial = bytearray()
        self._child_serial = 0
        self.state = "off"  # off, running, bootloader, halted
        self.history = []  # how each finished boot ended: {"stop", "uptime_us"}
        self._child_booted = False
        self._child_done = False
        self.auto_reboot = True
        self.set_pack(16400)

    # ---- lifetime --------------------------------------------------------------------------------

    def close(self):
        self._proc.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    @property
    def boot_count(self):
        """Boots so far, counting one still running."""
        return len(self.history) + (1 if self._child_booted and not self._child_done else 0)

    @property
    def now_us(self):
        """Time since the first power-on, across every boot."""
        return self._offset_us + self._child_now

    @property
    def now_ms(self):
        return self.now_us // 1000

    @property
    def uptime_ms(self):
        """Time since this boot's power-on - the clock the firmware's own timestamps count on."""
        return self._child_now // 1000

    @property
    def uptime_us(self):
        return self._child_now

    @property
    def last_stop(self):
        return self.history[-1]["stop"] if self.history else None

    # ---- the world outside the chip, replayed onto every boot --------------------------------------

    def _set_world(self, key, op, **params):
        self._world[key] = (op, params)
        return self._call(op, **self._as_of_now(op, params))

    def _as_of_now(self, op, params):
        if op == "pack":
            return dict(params, chargedMs=(self._offset_us - self._powered_at_us) // 1000)
        if op == "esc.startup":
            return dict(params, restarted=self._restarted)
        return params

    @property
    def pack_mv(self):
        """The pack voltage set_pack() last gave."""
        return self._world[("pack",)][1]["mv"]

    def set_pack(self, mv, rise_ms=0):
        """The pack voltage the battery divider sees - and the wheels' supply. With `rise_ms`, the
        divider's reading climbs toward it from power-on with that time constant, while the wheels
        have the whole pack at once. A reboot leaves it charged; power_cycle() starts it again.
        A pack of 0 is USB alone, and an ESC with no pack neither answers nor drives its wheel."""
        self._set_world(("pack",), "pack", mv=mv, riseMs=rise_ms)

    def esc_startup(self, ms=ESC_STARTUP_MS, restart_ms=ESC_RESTART_MS):
        """Real ESC start-up: each ESC stays silent and ignores throttle until ms[i] after the signal
        first reaches it in a boot, or after its pack does if that comes later - restart_ms longer
        after a reboot it stayed powered through, as an ESC restarts when the signal goes. Off until
        called: without it an ESC answers from its first frame."""
        self._set_world(("escStartup",), "esc.startup", ms=list(ms), restartMs=restart_ms)

    def analog(self, pin, raw):
        self._set_world(("analog", pin), "analog", pin=pin, raw=raw)

    def drive(self, pin, level):
        """Something outside the chip holding `pin` - a switch to ground is drive(pin, False)."""
        self._set_world(("pin", pin), "pin.drive", pin=pin, level=level)

    def release_pin(self, pin):
        self._set_world(("pin", pin), "pin.release", pin=pin)

    def set_switch(self, role, pressed):
        """A switch by role, at the pin and polarity the wiring gives it - the firmware's own copy
        once booted, the config on flash before that."""
        reply = self._call("switch", role=role, pressed=pressed)
        pin = reply["pin"]
        if reply["level"] is None:
            self._world[("pin", pin)] = ("pin.release", {"pin": pin})
        else:
            self._world[("pin", pin)] = ("pin.drive", {"pin": pin, "level": reply["level"]})
        return pin

    def press(self, role):
        return self.set_switch(role, True)

    def release(self, role):
        return self.set_switch(role, False)

    def tap(self, role, hold_ms=60, gap_ms=60):
        self.press(role)
        self.run_ms(hold_ms)
        self.release(role)
        self.run_ms(gap_ms)

    def hold(self, role, ms, after_ms=100):
        self.press(role)
        self.run_ms(ms)
        self.release(role)
        self.run_ms(after_ms)

    def attach_display(self, upside_down=True):
        """An SSD1306 on the bus, mounted the way the shipped rotateDisplay expects by default."""
        self._set_world(("panel",), "panel.attach", upsideDown=upside_down)

    def i2c_device(self, address, present=True):
        self._set_world(("i2c", address), "i2c.device", address=address, present=present)

    def host_connected(self, connected):
        self._set_world(("host",), "host.connected", value=connected)

    def passthrough_session(self, ticks, restore_fails=False):
        """How long, in ms, a configurator holds a passthrough session before closing the port.
        restore_fails leaves the session's 132 MHz clock running after it ends."""
        self._set_world(("passthrough",), "passthrough", ticks=ticks, restoreFails=restore_fails)

    def wheel(self, index, **params):
        """The flywheel model on escPins[index]: kv, loaded, startDelay, maxAccel, tauUp, tauDown,
        poles, replyEvery, replies. Its ESC's start-up is esc_startup()."""
        key = ("wheel", index)
        merged = dict(self._world.get(key, ("wheel", {"index": index}))[1], **params)
        self._set_world(key, "wheel", **merged)

    def darts(self, **params):
        """loaded, delay_us, loss_rpm - what goes through the wheels on each extend."""
        merged = dict(self._world.get(("darts",), ("darts", {}))[1], **params)
        self._set_world(("darts",), "darts", **merged)

    def esc_reply(self, index, **params):
        """The next reply from wheel `index`'s ESC in place of the wheel's own: erpm=, corrupt=True
        or edt="temperature"/"voltage"/... with value=. Once."""
        self._call("esc.reply", index=index, **params)

    # ---- flash and the RAM a reboot keeps ------------------------------------------------------------

    def flash_put(self, path, data):
        if isinstance(data, (dict, list)):
            data = json.dumps(data)
        if isinstance(data, str):
            data = data.encode()
        self._call("flash.put", path=path, b64=base64.b64encode(data).decode())

    def flash_get(self, path):
        reply = self._call("flash.get", path=path)
        return base64.b64decode(reply["b64"]) if reply["exists"] else None

    def flash_json(self, path):
        data = self.flash_get(path)
        return json.loads(data) if data is not None else None

    def flash_files(self):
        return {p: base64.b64decode(b) for p, b in self._call("flash.dump")["files"].items()}

    def flash_preset(self, board_id, overrides=None):
        self.flash_put("/device.cfg", preset(board_id, overrides))

    def flash_device(self, doc):
        self.flash_put("/device.cfg", doc)

    def flash_profile(self, slot, doc):
        self.flash_put(f"/profile{slot}.cfg", doc)

    def cut_power_before_write(self, n):
        """Power goes as the n-th flash write from now is about to land."""
        self._call("flash.cut", write=n)

    def flash_writes(self):
        return self._call("flash.stats")["writes"]

    def set_noinit(self, reboot_reason, passthrough_exit=8, magic=POWER_ON_MAGIC):
        """What the RAM a reboot keeps holds at the next boot - to stand in for a reboot."""
        self._call("noinit.set", rebootReason=reboot_reason, passthroughExit=passthrough_exit,
                   magic=magic)

    def noinit(self):
        return self._call("noinit.get")

    # ---- running -------------------------------------------------------------------------------------

    def power_on(self):
        if self.state in ("running", "bootloader"):
            return
        if self._child_booted:
            self._next_boot(keep_ram=False)
        self._start_child()

    def boot(self, settle_ms=0, limit_ms=30000):
        """Powers on and runs until setup() has finished, then `settle_ms` more. False if it stopped
        on the way."""
        self.power_on()
        if not self.wait_booted(limit_ms):
            return False
        return self.run_ms(settle_ms) if settle_ms else True

    def wait_booted(self, limit_ms=30000):
        return self._run_host(limit_ms * 1000, {"booted": True}) and self.peek("booted")

    def power_cycle(self):
        """Off and on again: flash kept, the RAM a reboot keeps lost. Not booted - call boot()."""
        self._next_boot(keep_ram=False)
        self.state = "off"

    def run_ms(self, ms):
        return self.run_us(ms * 1000)

    def run_us(self, us):
        """Runs for `us`, rebooting as the firmware asks. True if it is still running at the end."""
        return self._run_host(us, None)

    def run_until(self, done, limit_ms, step_ms=1):
        """Runs until `done()` holds, looking every `step_ms`. True if it did."""
        waited = 0
        while not done():
            if waited >= limit_ms or not self.run_ms(step_ms):
                return done()
            waited += step_ms
        return True

    def run_until_peek(self, name, value, op="eq", limit_ms=5000, step_ms=1):
        """Runs until a peeked value compares as asked - checked inside the host, so it is cheap."""
        until = {"peek": name, "op": op, "value": value}
        self._run_host(limit_ms * 1000, until, step_ms * 1000)
        return self._compare(self.peek(name), value, op)

    def run_until_stopped(self, limit_ms=5000):
        """Runs until this boot ends, whatever ends it - auto_reboot is off for the wait."""
        before = len(self.history)
        auto, self.auto_reboot = self.auto_reboot, False
        try:
            self._run_host(limit_ms * 1000, {"stopped": True})
        finally:
            self.auto_reboot = auto
        return len(self.history) > before

    def resume(self):
        """Carries on after run_until_stopped() stopped at a reboot: the next boot, on the RAM that
        reboot kept."""
        if self.state != "halted" or self.last_stop != "reboot":
            raise RuntimeError(f"nothing to resume: state {self.state}, last stop {self.last_stop}")
        self._next_boot(keep_ram=True)
        self._start_child()

    def run_until_reboot(self, limit_ms=5000):
        """Runs until the firmware reboots and the next boot has started."""
        before = len(self.history)
        self.run_until(lambda: len(self.history) > before, limit_ms)
        return len(self.history) > before and self.last_stop == "reboot"

    # ---- the USB host --------------------------------------------------------------------------------

    def send(self, text):
        data = text.encode() if isinstance(text, str) else text
        # In pieces: the host's request parser holds a string of at most 64 KB.
        for at in range(0, len(data), 32768):
            self._call("serial.write", b64=base64.b64encode(data[at:at + 32768]).decode())

    @property
    def transcript(self):
        """Everything the device has printed, across every boot."""
        self._pull_serial()
        return self._serial.decode("utf-8", errors="replace")

    def command(self, line, timeout_ms=3000, parse=True):
        """Sends `line` and runs until the reply naming its command arrives - parsed, or the raw line
        with parse=False. None if none came, which includes a reboot that got there first."""
        self._pull_serial()
        start = len(self._serial)
        name = line.split()[0] if line.split() else line
        key = f'"cmd":"{name}"'
        self.send(line if line.endswith("\n") else line + "\n")
        deadline = self.now_us + timeout_ms * 1000
        while True:
            reply, seen = self._find_line(start, key)
            if reply is not None:
                return json.loads(reply) if parse else reply
            if self.state != "running" or self.now_us >= deadline:
                return None
            step = min(deadline - self.now_us, 50000)
            if seen:  # half printed: let it finish
                self.run_us(1000)
            else:
                self._run_host(step, {"serial": key, "from": self._child_serial}, 1000)

    # ---- looking at it -------------------------------------------------------------------------------

    def peek(self, *names):
        values = self._call("peek", names=list(names))["values"]
        return values[names[0]] if len(names) == 1 else values

    def wheels(self):
        return self._call("wheels")["wheels"]

    def reset_peak(self, index):
        self._call("wheel.resetPeak", index=index)

    def escs(self):
        return {e["pin"]: e for e in self._call("escs")["escs"]}

    def heap(self):
        """What the firmware holds on the heap - live, peak, allocations, and those refused for
        taking it past `limit` - in the blocks newlib would give the same requests. An upper bound:
        the PC's pointers are twice the size."""
        return self._call("heap")

    def reset_heap_peak(self):
        self._call("heap.resetPeak")

    def set_heap_limit(self, bytes_):
        """Past this an allocation fails, as it does on the device; 0 puts back the RP2040's. For
        this boot only."""
        self._call("heap.limit", bytes=bytes_)

    def pins(self):
        return self._call("pins")["pins"]

    def pin(self, n):
        return self.pins()[n]

    def pin_mode_calls(self):
        return self._call("pinModeCalls")["count"]

    def edges(self, pin, since_us=0):
        """This boot's level changes on `pin`, as (µs since this boot's power-on, level)."""
        return [tuple(e) for e in self._call("pin.edges", pin=pin, since_us=since_us)["edges"]]

    def extends(self):
        """This boot's pusher extends, in µs since its power-on."""
        return self._call("extends")["at_us"]

    def panel(self, pixels=False):
        return Panel(self._call("panel.read", pixels=pixels))

    def wiring(self):
        """The device settings the firmware holds - or, before boot, the ones on flash."""
        return self._call("wiring")["settings"]

    def passthrough(self):
        return self._call("passthrough.state")

    def grid(self, cases):
        """steppedToGrid() on each (value, direction, step, lo, hi, wrap)."""
        return self._call("grid", cases=[list(c) for c in cases])["results"]

    # ---- inside -----------------------------------------------------------------------------------

    def _call(self, op, **params):
        try:
            return self._proc.call(op, **params)
        except SimCrash as crash:
            tail = self._serial[-2000:].decode("utf-8", errors="replace")
            raise SimCrash(crash.returncode, f"serial tail:\n{tail}") from None

    @staticmethod
    def _compare(a, b, op):
        return {"eq": a == b, "ne": a != b, "ge": a >= b, "gt": a > b, "le": a <= b,
                "lt": a < b}[op]

    def _pull_serial(self):
        while True:
            reply = self._call("serial.read", **{"from": self._child_serial})
            self._serial += base64.b64decode(reply["b64"])
            self._child_serial = reply["end"]
            if not reply["more"]:
                return

    def _find_line(self, start, key):
        """The whole line carrying key, and whether key has appeared at all."""
        self._pull_serial()
        text = self._serial[start:].decode("utf-8", errors="replace")
        at = text.find(key)
        if at < 0:
            return None, False
        begin = text.rfind("\n", 0, at) + 1
        end = text.find("\n", at)
        if end < 0:
            return None, True
        return text[begin:end].rstrip("\r"), True

    def _run_host(self, us, until, step_us=1000):
        """Runs this boot in the host, carrying on into the next boot after a reboot. True if
        running at the end - and, with `until`, whether it was met is the caller's to check."""
        remaining = us
        while True:
            if self.state != "running":
                return False
            params = {"us": remaining}
            if until:
                params.update(until=until, step_us=step_us)
            before = self._child_now
            reply = self._call("run", **params)
            self._child_now = reply["now_us"]
            remaining -= max(self._child_now - before, 0)
            if reply["stopped"]:
                if not self._stopped(reply):
                    return False
                if until and until.get("stopped"):
                    return True
                continue
            if until is None or reply["met"] or remaining <= 0:
                return True

    def _stopped(self, reply):
        """Ends this boot. True if the blaster carried on into another."""
        stop = reply["stop"]
        self._pull_serial()
        if stop in ("panic", "exception"):
            self._finish_boot(stop)
            self.state = "halted"
            raise FirmwareStopped(f"{stop}: {reply['detail']}\nserial tail:\n"
                                  + self._serial[-2000:].decode("utf-8", errors="replace"))
        if stop == "reboot" and self.auto_reboot:
            self._next_boot(keep_ram=True)
            self._start_child()
            return True
        self._finish_boot(stop)
        self.state = {"bootloader": "bootloader", "powerloss": "off"}.get(stop, "halted")
        return False

    def _start_child(self):
        self.state = "running"
        self._child_booted = True
        self._child_done = False
        self._call("boot")

    def _finish_boot(self, stop):
        if self._child_booted and not self._child_done:
            self.history.append({"stop": stop, "uptime_us": self._child_now})
            self._child_done = True

    def _next_boot(self, keep_ram):
        """Swaps in a fresh process carrying the flash, the world and - after a reboot - the RAM a
        reboot keeps."""
        self._pull_serial()
        files = self._call("flash.dump")["files"]
        ram = self._call("noinit.get") if keep_ram else None
        self._finish_boot("reboot" if keep_ram else "power")
        self._proc.close()

        self._offset_us += self._child_now
        self._child_now = 0
        if not keep_ram:
            self._powered_at_us = self._offset_us
        self._restarted = keep_ram and self.pack_mv > 0
        self._child_serial = 0
        self._child_booted = False
        self._child_done = False
        self._proc = HostProcess(self._exe)
        self._call("flash.load", files=files)
        if ram:
            self._call("noinit.set", rebootReason=ram["rebootReason"],
                       passthroughExit=ram["passthroughExit"], magic=ram["magic"])
        for op, params in self._world.values():
            self._call(op, **self._as_of_now(op, params))
