# Building and Flashing

Most people never need to build anything. The released firmware fits every supported board, and you tell it which board you have once, from the web console. Building from source is for changing the firmware itself, and is covered at the end.

## 1. Open the web console

Open it at [davidpyo.github.io/trifolium-controller](https://davidpyo.github.io/trifolium-controller/). It is a single page with nothing to install. For a copy that works without an internet connection, press **Download for offline use** at the foot of the sidebar and open the saved file by double-clicking. See [Web Console](Web-Console).

The firmware is one `.uf2`, the same for every board. The console lists every released version when you flash, so there is usually nothing to download yourself. The files are also on the [releases page](https://github.com/davidpyo/trifolium-controller/releases/latest).

## 2. Flash it

The console can do this over USB, so a fresh board needs no toolchain at all.

On the **Firmware** page, press **Flash Firmware**, pick a version under **Released firmware** (the newest is marked latest), and follow the prompts. The console downloads it and checks it before writing anything. To flash a file you already have, use **Or choose a .uf2 file** instead, which is also the way when the console cannot reach the internet. It offers to save a backup of your settings first, which is worth taking.

If the board has never run this firmware, or is unresponsive, hold **BOOTSEL** while plugging in the USB cable so it comes up in bootloader mode. A board already running Trifolium can be sent there from the menu instead: **Advanced > Device > Reboot > Bootloader**.

Flashing keeps your settings. They live in the board's own storage, not in the firmware image, so they survive every later flash. The one exception is a [factory image](#factory-images), which is built to replace them.

## 3. Tell it which board you have

A newly flashed board comes up **unwired**: it drives no pins at all, so no motors spin, no solenoid fires, and the screen stays dark. This is deliberate. The firmware has no idea what it is fitted to yet, and guessing wrong would drive the wrong pins.

Connect the console and it will ask, in three steps. Pick your board, press **Next** past **Blaster config** with **None** picked, and press **Set up blaster** on the review. That is the setup done. The board remembers, so this is once per board rather than once per flash.

If you built one of the published blasters, pick it on the **Blaster config** step instead of **None**; the configs built on your board are listed first. The blaster then starts from its builders' settings instead of the firmware defaults: tuning, fire modes, all three profiles, and how the pusher is driven. The pins are your board's. A config saved on the same board you picked also fills in any pin the board leaves unused, so one made on a bare module such as the Seeed XIAO RP2040 or the RP2040-Zero, whose presets claim no pins, brings the blaster's whole wiring with it. Read any notes that appear under the config, which the review repeats, before setting up. If your build wires a switch to a different pad from the board's usual one, change it on the **Wiring** page afterwards.

If your board is not listed, choose **My board is not listed: wire it by hand** on the first step, which opens the Wiring page with every pin unset so you can enter them one at a time. Nothing is driven until you tick **Wiring Configured** and write.

> **Pick the board you actually have.** A wrong choice drives the wrong pins on real hardware.

## 4. Set it up for your build

Everything else is editable and saved on the blaster. Work through it in this order, since each step feeds the next:

1. **Motors & PID**, per motor: confirm `Enabled`, `Kv` and `Poles/2` match your hardware, and use **Test This Motor** to check each channel spins the wheel you expect. If one spins the wrong way, **Change Direction** fixes it without rewiring. On firmware 2.3.0 and later the [Web Console](Web-Console) has both too, as **Test**, **Normal** and **Reversed** under Blaster settings > Motors & PID.
2. **Battery > Battery Type**, so the RPM ceilings and voltage cutoff are right.
3. **Flywheel / RPM**, for your actual RPM targets, or the speed pot's range if you wired one. See [Flywheel and RPM](Flywheel-and-RPM).
4. **Solenoid / Pusher**, for extend and retract timing. See [Solenoid and Pusher](Solenoid-and-Pusher). If you wired a dart switch, **Dart Switch** too: see [Dart Switch](Dart-Switch).
5. **Select-Fire**, to build the fire modes you want. See [Select-Fire](Select-Fire).

All of it is reachable from both the OLED menu and the console, whichever you prefer.

If you loaded a blaster config in step 3, most of this is already done. Check the motors and the battery type against your own hardware anyway, before firing. The configs live in `trifolium/blasters/` in the repository, and `blasters/README.md` there explains how to add one.

## 5. First boot

Open the console's log pane, or a serial monitor at **115200 baud**, if you want to watch it come up. It reports boot progress and any faults, but nothing routine.

If something is wired in a way the chip cannot do — two things on one pin, an I2C pair that no hardware block can serve — the blaster does not refuse to start. It gives up the least important thing, keeps running, and tells you what it dropped: on the screen, in the boot log, and in the console, on Overview and the **Wiring** page. Your stored settings are left exactly as you entered them, so fixing the pin is all it takes.

## Building from source

Only needed if you are changing the firmware.

You need [VSCode](https://code.visualstudio.com/) with the **PlatformIO IDE** extension. PlatformIO downloads the RP2040 toolchain and every library the first time you build.

```bash
git clone https://github.com/mohitg11/trifolium-controller.git
```

Open the **`trifolium` subfolder**, not the repository root:

```
trifolium-controller/          <- do NOT open this
└── trifolium/                 <- open THIS one
    ├── platformio.ini
    └── src/
```

In VSCode use **File > Open Folder** and pick `trifolium-controller/trifolium`. If PlatformIO's toolbar does not appear, or you see "No PlatformIO project found", you have opened the parent by mistake.

Connect the board and press **Upload** on the PlatformIO toolbar, or run `pio run -t upload`. The first build is slow, several minutes, while the toolchain downloads. Later builds take seconds.

There is nothing to edit before building. No pinout is compiled in, there is one build for every board, and `src/CONFIGURATION.h` holds only the defaults that are *not* wiring — tuning, timings and thresholds — which a factory reset lands on.

## Factory images

For bringing a batch of blasters to the same config by flashing alone, with no console step per blaster. It needs the repository and PlatformIO, as for building from source.

Set one blaster up, save a **Full Backup** from the console, and build an image from it. From the `trifolium` folder:

```bash
python tools/release.py --board trifolium_v1_4 --blaster path/to/backup.json
```

`--board` is the board the blasters are built on: a folder name in `trifolium/boards/`. `--blaster` is any Full Backup, or one of the files in `trifolium/blasters/`. The image lands in `trifolium/release/`, named for both, e.g. `trifolium-2.1.0-backup-trifolium_v1_4.uf2`. The board's pins and the backup's other settings are combined as the console's **Blaster config** step combines them.

Flash it like any other `.uf2`. **Every flash of it replaces everything the blaster holds** — settings, all three profiles, the splash — as though the board were new. Changes made afterwards stick until it is flashed again, and flashing the ordinary release afterwards keeps them, as it always does.

It takes longer to flash than the ordinary firmware, about 20 seconds from the console, because it writes the settings storage as well. The build refuses a backup saved by a firmware whose settings format differs from the one being built. To bring one up to date, update a blaster that holds that config to the new firmware, which converts its stored settings, and save a new backup from it.
