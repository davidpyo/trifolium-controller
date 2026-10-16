# Trifolium Menu &amp; Settings Reference

Every setting on the on-device OLED menu: what it does, whether it takes effect immediately or needs a reboot, and when it disappears from the screen because something else made it irrelevant. Plus what is not in the menu at all, and where to change it instead.

Setting up a board for the first time, start with **[Building and Flashing](Building-and-Flashing)**. There is nothing to compile: one firmware fits every board, you tell it which one you have from the [Web Console](Web-Console), and it remembers.

Already running, start with **[Using the Menu](Using-the-Menu)** for the buttons and the screen patterns. Everything after that is reference, organized the same way the menu is.

## Reading the tables

Every settings table on this wiki uses the same columns. The **Takes effect** column carries more than just timing:

| Tag | Meaning |
|---|---|
| `Live` | Applies as soon as you save it. |
| `Reboot` | Stored immediately, but the blaster keeps using the old value until it restarts. |
| `conditional` | The row only appears when the condition named in its description is true. Otherwise it is not on screen at all, rather than greyed out. |
| `can lock` | The row is always listed, but under the condition in its description it refuses: selecting it shows a short message and changes nothing. Used where a setting would drive the wrong piece of hardware. |

The **Scope** column says whether a setting belongs to the blaster itself (`Device`) or to the loadout you are shooting (`Profile`). That distinction is worth getting straight early, so it has its own section below.

## How settings are organized

Settings split into two groups, and mixing them up is the easiest way to get confused about why a change did not do what you expected.

**Device** settings describe the blaster in front of you. There is one set, shared no matter what you are shooting:

- Pins and switch polarity
- Display settings and debounce
- Per-motor KP, KI, Kv and pole count
- Solenoid extend/retract timing and vibration pulse
- Battery type, cutoffs and calibration
- Pusher type and dart sensing, which select-fire hardware is wired, and a speed pot's range

**Profile** settings describe how *this loadout* shoots. There are 3 of them, called Low / Medium / High by default, and you can rename them to anything:

- RPM targets, dwell/idle time, idle RPM, spindown, rev safety timeout
- Its own list of 1 to 10 fire modes, each with a firing mode, burst length, target rate and display name

Because the mode list belongs to the profile, Low / Medium / High can each carry a different number of modes, tuned differently.

## Pages

| Page | Covers |
|---|---|
| [Building and Flashing](Building-and-Flashing) | Getting the firmware on, choosing your board, first boot, building from source |
| [Web Console](Web-Console) | The browser tool: settings, wiring, backups, RPM charts, flashing |
| [Using the Menu](Using-the-Menu) | Buttons, screen patterns, trigger-only builds, why rows vanish |
| [Root and Advanced](Root-and-Advanced) | The shortcuts on the root menu and what sits under Advanced |
| [Flywheel and RPM](Flywheel-and-RPM) | RPM targets, idle, spindown, at-speed thresholds, where RPM limits come from |
| [Motors and PID](Motors-and-PID) | Per-motor hardware config, PID tuning, ESC dashboard, the pusher channel lock |
| [Select-Fire](Select-Fire) | Building the fire mode list and mapping it to hardware |
| [Firing Modes](Firing-Modes) | What each of the 7 modes does with the trigger |
| [Solenoid and Pusher](Solenoid-and-Pusher) | Pusher hardware and its voltage-compensated timing curve |
| [Dart Switch](Dart-Switch) | A switch in the breech: fire only with a dart, pull back once it has gone, rev only with one |
| [Battery](Battery) | Cell count, cutoffs, calibration, storage discharge |
| [Profiles](Profiles) | Managing the 3 named slots |
| [Device](Device) | Reboot actions, display, debounce, shot counting, factory resets |
| [Not in the Menu](Not-in-the-Menu) | Settings kept off the screen, and where to find them instead |
