# Web Console

The web console is the blaster's other face. Everything on the OLED menu is here too, plus the things a 128x64 screen cannot sensibly do: pin assignments, backups, RPM charts, a custom boot image, and flashing firmware.

Open it at **[davidpyo.github.io/trifolium-controller](https://davidpyo.github.io/trifolium-controller/)**. For a copy that needs no internet connection, press **Download for offline use** at the foot of the sidebar (under **More** on a phone) and open the saved file by double-clicking; when it can reach the site, it tells you if a newer console is out. Either way it is one page with nothing to install, and it talks to the board directly over USB.

Press **Connect** and pick the blaster from the port list your browser offers. The browser remembers it, so from then on Connect goes straight to it while it is the only blaster plugged in. For a different blaster, or to choose between two plugged in at once, press **Choose Device**.

On Android there is only **Connect**, and the phone asks for permission every time, including after the blaster restarts. A write that needs a restart, a **Restart** or an RPM capture therefore stops at that point, and the log asks you to press **Connect** to carry on. Press it, allow the blaster, and the console finishes what it was doing.

> **Browser support.** Chrome, Edge or Opera on desktop, Chrome on Android over a USB cable, or Firefox 151 or newer. Safari, and every browser on an iPhone, cannot reach the blaster. Flashing firmware additionally needs Chrome or Edge, or Chrome on Android. Close any other serial monitor first, since only one program can hold the port at a time.

Opened without a blaster attached, it shows a sample configuration so you can look around. Nothing you do there reaches any hardware.

## Finding your way

The pages are in the sidebar. On a phone the main four are tabs along the bottom, and the rest are under **More**.

| Page | What it does |
|---|---|
| **Overview** | The blaster at a glance: name, board, firmware and battery, the three profiles, what the last boot reported, and backups. |
| **Profiles** | RPM targets, dwell and idle, spindown, and the fire mode list, for whichever of the 3 profile slots you pick at the top. |
| **Blaster settings** | Everything shared across profiles: motors and PID, solenoid timing, battery, display, debounce, shot counting, and on firmware 2.3.0 and later the [boot rules](Device#boot-actions) and each motor's [Test, Normal and Reversed](Motors-and-PID) buttons. |
| **Wiring** | Which pin each thing is on, with a diagram of your board where one has been drawn. Also where pin conflicts are reported, and where you change board. |
| **RPM capture** | Records a spin-up and charts it. |
| **Splash screen** | Upload a custom 128x64 boot image from any picture, or clear it back to the default. Takes effect next boot. On firmware 2.3.0 and later the page opens on the image the blaster holds, custom or built-in, and **Download** saves the one shown as a PNG that uploads back unchanged. |
| **Firmware** | Flashes new firmware over USB. |
| **Maintenance** | The resets: one profile, the blaster settings, the wiring, or everything. Each asks you to type a word first, so none happens by a stray click. |
| **Raw JSON** | The underlying settings as text, for when you want to see exactly what is stored. |

The console opens on the page you last used. After a boot that dropped part of the config, it opens on Overview instead, and a red band on the other pages says so.

The bar along the top holds the blaster's name (press it to rename the blaster) and its board (press it to change board). It also has **Read**, which reads every setting from the blaster again, and **Restart**. **More** holds the rarer actions: restarting into the bootloader, ESC passthrough for an ESC configurator, and flashing firmware. On a phone, Read and Restart are in that menu too.

To find a setting without knowing which page it is on, press **Ctrl+K** (**⌘K** on a Mac), or the search box in the top bar, and type part of its name. Commands such as Restart are found the same way.

Hover over a setting's name, or a column heading in the tables, to see what it does. To read them all at once, turn on **Descriptions** at the top of Profiles or Blaster settings. In the fire mode list, each mode is described under its name.

## Changing settings

Nothing is written to the blaster until you say so. An edited setting turns amber and shows what it was, with a **Revert** link to put it back. Type the old value back by hand and it stops counting as a change.

The bar along the bottom counts the unsaved changes and says where they are and whether writing them restarts the blaster. When they are all in one place, **Write to blaster** writes them in one click. Otherwise **Review and write** lists every change, old value and new, where you can revert any one of them, write just the blaster settings or one profile, or write the lot. The blaster restarts after a write that needs it, and the console reconnects on its own.

## The log

The log runs along the bottom of the page, open with five lines showing (folded on a phone). Drag its top edge to make it taller or shorter, or double-click the edge for five lines again. The buttons on its title row show only the blaster's lines, only the console's, or only errors, and save, clear or expand it to the full window. The console remembers whether you left it open, and how tall.

**Verbose** on the log's title row switches the blaster's verbose logging: switch presses, state changes and per-shot measurements in the log. It is a saved setting, so switching it restarts the blaster, and it stays amber while on. On a phone, open the log from **More** to reach it.

## Backups

On **Overview**, under **Backups and firmware**. **Back up** saves a **Full Backup** (blaster settings and all 3 profiles, in one file), the **Device Config** alone, or the profile the Profiles page shows. **Restore** reads one of those back in. You can also drop a `.json` file onto the Restore area, and the console asks what kind of file it is.

A restored file is staged like any other edit, so you can look it over before **Review and write** puts it on the blaster. A file of the wrong kind is refused rather than half-applied: a profile cannot be loaded as the blaster settings.

A backup records which board it came from and which firmware version wrote it. Loading one onto a different board warns you, since pin assignments in particular may not transfer.

## Setting up a blaster

A blaster with no wiring opens on **Set up this blaster**, three steps that end in one write:

1. **Board.** Pick the controller board in the blaster. If the blaster ran an older firmware that named its board, that board is already picked.
2. **Blaster config.** Pick one of the published blasters to start from its builders' settings and profiles, or **None** to keep the firmware defaults. The configs built on your board come first.
3. **Review.** What will be written, and how many times the blaster restarts on the way. Press **Set up blaster**.

If your board is not listed, press **My board is not listed: wire it by hand** on the first step. See [Building and Flashing](Building-and-Flashing#3-tell-it-which-board-you-have) for the whole first-time setup.

To change the board of a blaster already set up, press the board's name in the top bar, or **Change board** on the Wiring page. That takes the same steps without the config, and the review says which board it replaces before anything is written. Every pin moves to the new board's; profiles, tuning and fire modes are kept.

## Wiring

The Wiring page is where a board stops being a mystery. It lists every pin, what is on it, and whether anything is fighting over it.

Where a drawing exists for your board, you get the board itself with its pads marked: hover a pad or a row of the table to see the other light up, and the labels group by connector so a four-pin plug reads as one thing rather than four unrelated pins.

If two things want the same pin, the blaster does not refuse to boot. It gives up the least important one, keeps running, and reports what it dropped here and on Overview. Your stored settings are untouched, so correcting the pin is the whole fix.

## Flashing firmware

**Flash Firmware**, on the Firmware page or under **More**, writes firmware over USB, so you never need the drag-and-drop bootloader drive or a toolchain. Pick a version under **Released firmware**, which the console downloads and checks before writing, or use **Or choose a .uf2 file** for a file you already have. It offers to back your settings up first.

Settings survive a flash: they live in the board's own storage, not the firmware image. The exception is a [factory image](Building-and-Flashing#factory-images), which carries a blaster's config and replaces everything the blaster holds.

## RPM captures

The **RPM capture** page takes you through it in three steps:

1. Turn on **RPM Logging** and write it. It is a saved setting, also on the OLED under Motors & PID, and it stays on until you turn it off.
2. Rev the blaster. Each rev records a capture; the blaster then prints it and restarts, and the console reconnects. On firmware 2.3.0 and later you can also rev it from the page: hold **Hold to rev**, with the motors to spin ticked. It revs only while the button is held down. Letting go, moving off the button, switching to another window or tab, or the connection dropping all stop it within a third of a second. It is off while the blaster's menu is open or it is in SAFE, and there is no fire button: a dart only goes if you pull the trigger yourself, and not at all with some motors unticked.
3. The capture charts by itself as the console reconnects, from any page, and the newest one if the log holds several. **Take from device log** reads it again. You can also open a `.csv` file, paste one in, or drop one on the page.

Flywheel RPM and pack voltage go on separate axes, so a 300 mV sag under load is visible rather than a flat line against a 16 V rail, and the horizontal axis is real milliseconds rather than sample numbers.

The table underneath reports, per motor, the target, the time it took to reach it, and how far past it the motor went.

Turn RPM Logging off for normal use: it allocates a buffer on every rev and restarts the blaster after each capture.
