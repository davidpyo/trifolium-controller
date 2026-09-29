# Tests

Everything that checks the firmware and the console, as opposed to operating a blaster, which is
`tools/`:

| | |
|---|---|
| `sim/` | The blaster simulator. `host/` is the firmware, `src/` unmodified, compiled for this PC against a fake board (C++); `trifolium_sim/` drives it from Python. |
| `suite/` | The pytest suite against the simulator, the web console in a browser included. `golden/` holds its OLED images and `fixtures/` the stepping table the console's `grid.test.ts` shares. |
| `bench/` | What only hardware can answer: `bench_acceptance.py`, walked once per release candidate, on `bench_harness.py`. |
| `checks/` | Static checks of the source and the checked-in data - `check_*.py`, each with `--self-test`. |

## Running it

```
cd trifolium/tests
python -m pytest -n auto                  # everything, ~3 min on 8 cores; builds the simulator first
python -m pytest suite/test_blaster.py -s
python -m pytest --no-build ...           # use the simulator as built
```

**Needs**
- A host gcc on `PATH` to build it. On Windows: `scoop install mingw-winlibs`.
- `[env:pico]`'s packages installed: `pio pkg install -e pico`, or any pico build. The fake core
  compiles arduino-pico's own ArduinoCore-API out of that package.
- `pip install -r requirements.txt`, then `python -m playwright install chromium` for the console
  tests.

`suite/test_factory_build.py` also builds `[env:pico]`, once, through `tools/release.py --board
--blaster`, and unpacks the image's settings area with that package's `mklittlefs`, which
`release.py` installs if it is missing. Its tests share one worker (`xdist_group`, with
`--dist loadgroup` in `pytest.ini`), so the image is built once and never read while another build
writes it.

**CI** (`.github/workflows/ci.yml`) runs the whole suite on every pull request, on a Windows runner
with the same winlibs MinGW, pinned by hash: the simulator counts on a 32-bit `long` and a static
libstdc++, which 64-bit Linux would not give it. About 9 minutes, 6 of them the suite. Each failed
test becomes an error annotation on the run.

The build is `pio run -e sim`, to `.pio/build/sim/trifolium-sim.exe`. `trifolium-sim --self-test`
checks the fakes against the parts they stand in for; `suite/test_self.py` runs it.

The checks run from `trifolium/`, for example `python tests/checks/check_reset.py`. The suite runs
`check_schema.py` on the schema it captures.

## The simulator

`sim/host/`: `hal/` and `hal_*.cpp` are the fake board, `host.cpp` the protocol, `sim_flywheel.h` and
`sim_panel.*` what sits around the board. `sim/trifolium_sim/`: `Blaster` is the API the suite uses,
`serve.py` the wall-clock server for tools and the browser.

## Writing tests

One `Blaster` is one blaster across any number of reboots. Each boot is its own simulator process,
started on the flash the last one left and, after a real reboot, on the RAM a reboot keeps. The
world around the board - held switches, the pack, the panel, the wheels - is replayed onto every
boot. So a flow that reboots is a straight-line test:

```python
def test_a_preset_arms_an_unwired_board(blaster):
    assert blaster.boot()
    blaster.command("LOAD_DEVICE\n" + json.dumps(preset("trifolium_v1_2")))
    assert blaster.run_until_reboot(2000) and blaster.wait_booted()
    assert blaster.peek("wiringLive") is True
```

- **Before boot:** `flash_preset(id, overrides)`, `flash_profile(slot, doc)`, `flash_put(path, data)`,
  `attach_display()`, `set_pack(mv, rise_ms=)`, `wheel(i, kv=, loaded=, tauUp=, replies=, replyEvery=)`,
  `esc_startup(ms=, restart_ms=)`, `darts(loaded=, loss_rpm=)`, `passthrough_session(ms, restore_fails=)`, `set_noinit(...)`. A switch
  can be held through power-on, too.
- **Running:** `boot(settle_ms)`, `power_on()`, `run_ms()`, `run_until(pred, limit_ms)`,
  `run_until_peek(name, value)` (checked inside the simulator, so cheap), `run_until_reboot()`,
  `run_until_stopped()` + `resume()`, `power_cycle()`, `cut_power_before_write(n)`.
- **The user's side:** `press/release/tap/hold(role)` by role - menu, trigger, rev, cycle, idle,
  safety, select0-2 - at the pin and polarity the wiring gives it.
- **The host's side:** `command(line)` returns the parsed reply; `transcript` is everything printed.
- **Watching:** `peek(...)` names firmware state the serial protocol does not publish (the list is in
  `host.cpp`), `wheels()`, `escs()` with the DShot commands each ESC was sent and the frames and
  replies it lost, `heap()`, `pins()`, `edges(pin)`,
  `extends()`, `panel()` - its text read back the way a person reads it, with the highlighted row
  marked.
- **The OLED menu:** `suite/helpers.py` drives it the way a person does - `open_menu`,
  `enter(b, "Advanced", "Device")`, `select(b, "Idle Mode")`, `rows(b)` for the open list,
  `close_menu`. Rows too long for the panel are cut at its edge, as on the device.

`booted` means `setup()` has returned; ESC arming runs for about 2.5 s after that, and a rev during
it is ignored. `armed_v12()` waits it out.

A **known issue** is `@pytest.mark.xfail(reason=...)` with `xfail_strict` on: it reports while the
firmware still misbehaves, and fails the run once it stops, so a fix cannot land without the
marker coming off.

With `TRIFOLIUM_UPDATE_GOLDEN=1` set the golden images are rewritten; with
`TRIFOLIUM_UPDATE_FIXTURES=1`, the grid table and the console's fixtures in
`tools/console/src/fixtures/`, which `suite/test_fixtures.py` otherwise holds to this firmware's own
dumps. Review the diff before keeping it.

## The console

`suite/test_console.py` opens the console as built, `tools/console/dist/index.html`, in headless Chromium
against a blaster from `serve.py`. `sim/trifolium_sim/webserial_shim.js` stands in for
`navigator.serial` over the server's WebSocket, so the console's own transport does the reads,
writes, reboots and reconnects. `webusb_shim.js` is the same bridge as Chrome on Android sees it -
no `navigator.serial`, one USB serial device on `navigator.usb` - for the console's WebUSB path.
The tests use the console as last built: after changing it,
`npm run build` in `tools/console/` first. `--headed` shows the browser.

## Tools against the simulator

```
cd trifolium/tests/sim
python -m trifolium_sim.serve --preset trifolium_v1_2 --display
```

This keeps a blaster running in wall-clock time. Its USB serial is `socket://127.0.0.1:5333`, which
pyserial opens with `serial.serial_for_url()`; `ws://127.0.0.1:5335` is the same serial for a browser.
One host at a time. A reboot drops it, as re-enumeration drops the COM port, and for a moment after
nothing can connect. Port 5334 takes one JSON request per line for the bench: `press`, `release`, `tap`,
`pack` (with `riseMs` for a divider still charging), `panel`, `peek`, `wheels`, `extends`, `wiring`,
`power_cycle`, `power_on` (with `source` `battery` or `usb`), `state`, and `flash`, which reads a file
off the blaster's flash. Its ESCs start up as the measured blaster's do; `--instant-escs` makes them
answer at once, which is how the suite's own `serve.py` tests run it.

pyserial's `socket://` `read()` discards the bytes it has gathered when the connection closes during
the call, and a capture dump always ends in a reboot. Read one with a plain socket.

## The simulator panel

With `serve.py` running, **http://127.0.0.1:5336/** is a blaster to use by hand:
- **Screen:** the OLED, live, with the LED under it when `ledDataPin` is wired.
- **Switches:** a button for each switch the wiring defines. Trigger, rev, menu and cycle are held
  while pressed, or with Space, R, M and C; the rest latch. With a switch-type select fire the select
  pins are one switch instead: a position for each wired pin and one grounding none, which sits
  between them on a two-pin switch as on a centre-off toggle. With a button-type one, Select 1 is a
  push button, left out when it shares the menu button's pin.
- **Readouts:** each wheel's RPM against its target, with its ESC while that is starting or
  unpowered, the pusher's shots this boot, the solenoid - lit while powered, with the last pulse's
  length - and the rev state.
- **Controls:** the pack voltage, the simulation speed (simulated seconds per real one: below 1x is
  slow motion, though the console's timeouts stay real-time), and power: **Power on from battery**
  starts the ESCs with the chip; **Power on from USB** leaves the pack unplugged, so the ESCs stay dark
  and arming runs out, until the slider plugs it back in.

The web console sits beside it, connected to the same blaster, so a setup is made there exactly as on
hardware and tried on the panel. The console is served as last built, with `webserial_shim.js` in
front of it. The page talks to the server over a WebSocket at `/control`, using the bench port's
requests plus `snapshot` and `speed`. What it shows is the firmware's logic, not physical performance -
see what the simulator cannot tell you, below.

## The hardware walk

`bench/bench_acceptance.py` covers what the simulator cannot - the list below. It judges what it can
and asks a person for the rest; `--skip-manual` records the hands-on checks as skipped, never passed.
`bench/bench_harness.py` opens a URL as readily as a COM port, so the walk's automated steps can be
tried against `serve.py` before a bench session; the walk's docstring says how.

`bench/capture_rpm.py` walks through the RPM captures `SimFlywheel` is fitted to: cold to target, a
lower target, spin-down, a burst of single shots, and full auto, three runs each. Each capture is the
firmware's own RPM log, the 2 s from a rev's start, saved with the setup into
`config_dumps/rpm_<date>_<time>/`. It sets up the running profile for each scenario and puts it back
afterwards. A capture restarts at any rev that begins from idle, including a SEMI pull after a shot,
which is why the shots are one pull of a burst of three.

## How faithful the simulator is

Real code wherever it can be:
- The Arduino API (`String`, `Print`, `Stream`, number formatting) is arduino-pico's own copy.
- ArduinoJson, the Adafruit display stack, elapsedMillis and Bounce2 are the pinned libraries.
- `char` is unsigned, and on Windows `long` is 32 bits, both as on the RP2040.

The fake board:
- **Two cores, one clock.** Each core is a thread, and only one runs at a time. The running core keeps
  going until it delays, or reads the clock past the other core's (or the test's) wake time. Runs
  are deterministic, and a core spinning on `millis()` still lets the other run.
- **GPIO** with pulls and outputs, and the pad and SIO registers `DUMP_GPIO` reads.
- **LittleFS** with its semantics: a write lands on close, rename replaces, nothing opens unmounted.
  Flash writes take time and stop both cores.
- **DShot** replies decoded by the library's own code, so the firmware sees the same quantised eRPM,
  on the PIO program's timing: a reply lands 140 us after its frame at DShot300, a frame offered
  sooner loses it, and the RX FIFO holds four. A new channel's first read is a checksum error, from
  the program's opening push.
- **The heap**, counted at the allocator in the blocks newlib would hand out, against what the pico
  build leaves for it (232 KB at 2.1); past that an allocation fails. The fakes' own storage is not
  counted. The PC's pointers are twice the size, so the count is an upper bound: a JSON document
  costs about 16 bytes a value here and 8 on the RP2040.
- **The battery divider** can be made to climb from power-on, first order, with `set_pack(mv,
  rise_ms=)`; a reboot leaves it charged. Off by default: one reading, 3.3 V of 13.2 V at 7.1 s,
  fits 24 s, which `test_battery.py` uses, but not enough to say every blaster does it.
- **ESC start-up**, with `esc_startup()`: each ESC ignores the signal until a set time after it first
  arrives, or after the pack does if that comes later, and a set time longer after a reboot it stayed
  powered through. The defaults are one v1.2 blaster's, from the arm loop's start: 318 and 1526 ms for
  its two ESCs, repeatable to a couple of ms over pack power-ons, and 715 ms more for both after a
  reboot. Off by default, since it adds 1.5 s of arming to every boot; `test_esc_startup.py` holds the
  firmware's arming record to that blaster's. Without it, an ESC answers from its first frame. Either
  way, one with no pack neither answers nor drives its wheel.
- **Wire** with arduino-pico's pin rules - `setSDA()` on the wrong pin panics - and its return codes.
- **The OLED** rebuilt from the I2C bytes the firmware sends.

## What it cannot tell you

- The compiled ARM image: stack depth, static RAM, anything the `-Os` build does differently.
- Peripheral timing beyond the rules above.
- The ESC firmware, the RP2040 bootloader and a real ESC configurator. ESC start-up is timed from
  the signal, which matches every boot measured; whether a real ESC counts from its power-on instead
  shows only where an ESC sits powered without a signal, and that is unmeasured.
- USB enumeration. The port here is there from power-on and keeps what a host sends until core 1
  reads it, as TinyUSB does, up to its 256 bytes before the host's write waits.
- How any other blaster's motors respond. `SimFlywheel` is fitted to one v1.2 blaster's captures
  (`bench/capture_rpm.py`: two 3200 kV motors on 4S, PID control). It models the ESC's start delay
  from rest (a fixed 80 ms here, 40-150 ms there), spin-up at the ESC's current limit (325 RPM/ms),
  the braking spin-down, and each dart's loss (1700 RPM). It does not hunt around its target as the
  real PID does, by 300-500 RPM at 32k, and it has none of the telemetry spikes at start-up.
- Integer division by zero: the PC traps where the RP2040 returns a saturated quotient.
