# Not in the Menu

A handful of settings are deliberately kept off the OLED screen. None of them need a rebuild any more — they are all in the [Web Console](Web-Console), on the page named below.

The reason a setting is off the menu is almost always the same: changing it from the panel could take away the panel, or the button you were using to change it.

## Wiring

*Console: **Wiring** page.*

| Setting | What it does |
|---|---|
| **Switch and button pins** | Which physical pin each of Trigger, Rev, Menu, Cycle, Dart, Idle, Safety and Select 0-2 is wired to. The dart switch needs firmware 2.2.0 and later. Off the menu because setting the menu button's own pin from the menu could detach the button doing the setting. Which Select pins are defined also decides how many Position rows appear under Set Selector Switch Modes. |
| **Switch polarity** | Whether each switch rests open or closed. Same risk. |
| **ESC, I2C, battery and LED pins** | The outputs and buses. The I2C pair has to be legal as a *pair* — two individually fine pins can still sit on blocks that cannot serve them together — so the console checks it before the blaster tries. |
| **Speed pot pin** | Which pin a [speed pot](Flywheel-and-RPM#speed-pot) is on. Like the battery, it must be one of GPIO 26-29, the only analog pins; where the two share one, the battery keeps it. Firmware 2.2.0 and later. |
| **Pot Reversed** | Which end of the [speed pot](Flywheel-and-RPM#speed-pot) is the fast one, for a pot wired the other way round: the **Reversed** box in the Speed Pot row. Wiring, like a switch's polarity, but it takes effect at once. Firmware 2.2.0 and later. |
| **Pusher driver** | Whether the pusher is driven by a FET or by one of the ESC channels, and which pin or channel. How the pusher is wired is a fact about your build rather than about the PCB, so a board preset only proposes it. |
| **Display Attached** | Whether this build has an OLED at all. A build without one obviously cannot offer a menu row to turn it back on. |
| **Wiring Configured** | The master switch. Until it is on, the blaster drives no pins at all. |

## Device

*Console: **Blaster settings** page, except where a row says otherwise.*

| Setting | What it does |
|---|---|
| **Verbose Serial print** | Debug output over serial: switch presses, state changes, and per-shot DPS measurements. The **Verbose** switch on the console's log bar switches it as well; either way the blaster restarts. |
| **RPM log length** | How many samples a capture takes, one per millisecond, so 2000 is two seconds. On the **RPM capture** page, beside RPM Logging. The toggle that arms it *is* on the menu, under Motors & PID. |
| **Splash screen** | A custom 128x64 boot image. The **Splash screen** page has an upload button; any picture is converted for you. Takes effect next boot. On firmware 2.3.0 and later the page shows the splash the blaster holds and can download it. |

## Still fixed in the firmware

Only ceilings remain, and none of them is a per-blaster choice:

| Limit | Value |
|---|---|
| **Fire modes per profile** | 10. The menu refuses New Fire Mode and Duplicate once you reach it. |
| **RPM log length ceiling** | The longest capture the blaster will take, whatever you ask for. |
| **Profile slots** | 3. |

`src/CONFIGURATION.h` still holds the factory defaults — the tuning, timings and thresholds a **factory reset** lands on. It carries no wiring at all.

> **A default is not a migration.** Changing a factory default changes what a *fresh or reset* profile lands on. A blaster with settings already saved keeps them, so to pick up a new default you either reset that profile or set the value yourself.

## Reading an RPM capture

A capture is CSV: a `Voltage_mv` column, then `Motor N, TargetRPM N, Throttle N, value N` repeated per enabled motor, one row per control-loop tick.

Paste it into the console's **RPM capture** page to chart it, or process it yourself.
