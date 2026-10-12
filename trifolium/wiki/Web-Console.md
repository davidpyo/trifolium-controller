# Web Console

The web console is the blaster's other face. Everything on the OLED menu is here too, plus the things a 128x64 screen cannot sensibly do: pin assignments, backups, RPM charts, a custom boot image, and flashing firmware.

Open it at **[davidpyo.github.io/trifolium-controller](https://davidpyo.github.io/trifolium-controller/)**. For a copy that needs no internet connection, press **Download for offline use** at the bottom of the page and open the saved file by double-clicking; when it can reach the site, it tells you if a newer console is out. Either way it is one page with nothing to install, and it talks to the board directly over USB.

Press **Connect** and pick the blaster from the port list your browser offers. The browser remembers it, so from then on Connect goes straight to it while it is the only blaster plugged in. For a different blaster, or to choose between two plugged in at once, press **Choose Device**.

On Android there is only **Connect**, and the phone asks for permission every time, including after the blaster restarts. A write that needs a restart, a **Reboot** or an RPM capture therefore stops at that point, and the log asks you to press **Connect** to carry on. Press it, allow the blaster, and the console finishes what it was doing.

> **Browser support.** Chrome, Edge or Opera on desktop, Chrome on Android over a USB cable, or Firefox 151 or newer. Safari, and every browser on an iPhone, cannot reach the blaster. Flashing firmware additionally needs Chrome or Edge, or Chrome on Android. Close any other serial monitor first, since only one program can hold the port at a time.

Opened without a blaster attached, it shows a sample configuration so you can look around. Nothing you do there reaches any hardware.

## The tabs

| Tab | What it does |
|---|---|
| **Profile** | RPM targets, dwell and idle, spindown, and the fire mode list, for whichever of the 3 profile slots you pick at the top. |
| **Device** | Everything shared across profiles: motors and PID, solenoid timing, battery, display, debounce, shot counting. |
| **RPM Log** | Charts an RPM capture. Drop a `.csv` on the tab, paste one in, or read the last capture off the blaster. |
| **Splash** | Upload a custom 128x64 boot image from any picture, or clear it back to the default. Takes effect next boot. |
| **Wiring** | Which pin each thing is on, with a diagram of your board where one has been drawn. Also where pin conflicts are reported. |
| **Raw JSON** | The underlying settings as text, for when you want to see exactly what is stored. |

Hover over a setting's name, or a column heading in the tables, to see what it does; on a phone, press and hold it. In the fire mode list, each mode is described under its name.

Edited fields are highlighted until you write them, and the header keeps a count of how many are pending, so nothing is written to the blaster until you say so.

## Backups

**Backup** saves everything — device settings and all 3 profiles — to one file. **Load > Full Backup** reads it into the console, and **Write to Device > Everything** puts all of it back on the blaster. Writing only the device settings or one profile leaves the rest of the backup waiting to be written.

You are asked what kind of file you are loading before you pick it, so loading a profile into a device slot by mistake is refused rather than silently half-applied. You can also drag a file onto the header instead of using the menu.

A backup records which board it came from and which firmware version wrote it. Loading one onto a different board warns you, since pin assignments in particular may not transfer.

## Wiring

The Wiring tab is where a board stops being a mystery. It lists every pin, what is on it, and whether anything is fighting over it.

Where a drawing exists for your board, you get the board itself with its pads marked: hover a pad to see what it carries, and the labels group by connector so a four-pin plug reads as one thing rather than four unrelated pins.

If two things want the same pin, the blaster does not refuse to boot. It gives up the least important one, keeps running, and reports what it dropped here. Your stored settings are untouched, so correcting the pin is the whole fix.

## Flashing firmware

**Flash Firmware** writes firmware over USB, so you never need the drag-and-drop bootloader drive or a toolchain. Pick a version under **Released firmware**, which the console downloads and checks before writing, or use **Or choose a .uf2 file** for a file you already have. It offers to back your settings up first.

Settings survive a flash — they live in the board's own storage, not the firmware image. The exception is a [factory image](Building-and-Flashing#factory-images), which carries a blaster's config and replaces everything the blaster holds.

## RPM captures

Turn on **RPM Logging** under Motors & PID, either from the OLED or from the Device tab, and a capture arms every time the flywheels rev. Once it has collected its samples the blaster prints the whole thing and reboots.

Read it back in the **RPM Log** tab and chart it. Flywheel RPM and pack voltage go on separate axes, so a 300 mV sag under load is visible rather than a flat line against a 16 V rail, and the horizontal axis is real milliseconds rather than sample numbers.

The table underneath reports, per motor, the target, the time it took to reach it, and how far past it the motor went.

Leave RPM Logging off for normal use — it allocates a buffer on every rev and reboots the blaster after each capture.
