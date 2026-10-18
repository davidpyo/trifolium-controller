# Device

*Advanced > Device. All Device scope.*

Everything else hardware-level, shared across all 3 profiles.

## Reboot

| Setting | Range | Takes effect | What it does |
|---|---|---|---|
| **Reboot** | action | `Live` | Plain restart. |
| **ESC Passthrough** | action | `Live` | Reboots straight into ESC configurator mode, so you can connect with the AM32 tool of your choice over USB. |
| **Bootloader** | action | `Live` | Drops into the RP2040's USB mass-storage bootloader for reflashing. There is no way back from the device itself once triggered: unplug or reflash to leave. You rarely need this now — the [Web Console](Web-Console) can flash over USB without it. |
| **Factory Reset All** | confirm | `Reboot` | Resets *both* the active profile and all device settings. **Your wiring is kept**, so a reset never leaves a blaster only a computer can rescue. |

## Boot actions

Hold switches while powering on and the blaster does something other than start normally. Only a power-on counts: a restart from the menu or the console ignores held switches.

On firmware 2.3.0 and later, this is a list of up to 8 **boot rules**. Each rule names one or more switches and an action, and fires when every switch it names is held. Other switches held at the same time don't matter, so a selector sitting on a position doesn't stop a rule. The rules are checked from the top and the first match wins, which is how you choose between two rules that both match: with **Menu** on Rule 1 and **Menu + Trigger** on Rule 2, holding both fires Rule 1, so put the two-switch rule first. Set them in the [Web Console](Web-Console) under **Blaster settings > Boot Actions**, where you drag a rule by its handle to change the order (or focus the handle and use the arrow keys) and a rule that can never fire says why, or on the blaster under **Advanced > Device > Boot Actions > Rule 1-8** (each rule has its action, a toggle per switch, **Move Up** and **Clear**).

Some switches are never read at power-on, and the console and menu don't offer them:

- the **cycle switch**, because the pusher rests on it, so it is held at every power-on;
- **rev** with a dual-stage trigger, because every full pull holds rev too;
- the **select lines** when Select Fire is Off;
- **select 0** when it is the menu button's own pin, with button select fire.

Settings saved by firmware 2.2.0 or earlier, which gave each switch one action, load as one rule per switch in the order they were checked then (menu, trigger, rev, idle, select 0-2), so the blaster boots exactly as it did. On those versions, each switch's action is set in the **Held At Boot** column of the Wiring page instead, and the first held switch in that order wins.

| Action | What it does |
|---|---|
| **Bootloader** | Comes up ready to be reflashed. By default, a rule on the menu button and one on the rev switch. |
| **ESC Passthrough** | Comes up handing the ESC pins to an AM32 configurator. By default, a rule on the trigger. Hold the rule's first switch again to leave and carry on booting; the screen names it. |
| **Idle Hold** | Comes up with the flywheels sitting at idle RPM rather than stopped, so they are already turning when you pull. Stays on until you power off, or turn it off from the root menu's **Idle Mode**. |
| **Slot 1 / Slot 2 / Slot 3** | Comes up running that profile slot, for this power-on only: the next plain power-on is back on the usual profile. It takes priority over the select switch. The way to change FPS on a blaster with no screen, and the console lists each slot with the profile in it, such as *Slot 1 · Low*. |
| **None** | Nothing: an empty rule. The default for every rule after the first three. |

## Display

| Setting | Range | Takes effect | What it does |
|---|---|---|---|
| **Home Screen** | Counter / Fire Mode / Both | `Live` | Counter: Big shot counter. Fire Mode: Mode name on top, with the bottom zone drawn by whichever firing mode is active. Both: Mode on top, with a smaller shot counter in place of that animation. A mode with a [Half Press](Firing-Modes#half-press) shows both of its modes. |
| **Show Current RPM** | on / off | `Live` | Adds a live-RPM grid to the home screen, grouped by Stage (top row is Stage 2, bottom row is Stage 1). |
| **Show DPS** | on / off | `Live` | Adds a `<real>/<set>` darts-per-second line, where "real" is the actual measured extend-to-extend interval. |
| **Brightness** | 5 to 255, ±5 | `Live` | Screen contrast, adjusting as you turn it. Some OLED panels show only a subtle difference, which can be the panel rather than a bug. |
| **Rotate Display** | on / off | `Live` | Flips the screen 180 degrees instantly, including the menu you are currently in, for boards mounted upside-down. |

## General

| Setting | Range | Takes effect | What it does |
|---|---|---|---|
| **Blaster Name** | 14 chars | `Live` | Shown on the home screen and the About screen. Uses the on-device text editor. |
| **LED Warning** | No Warning / Low Batt / Warning Batt | `Live` · `conditional` | What battery condition blinks the status LED, if your board has one. Hidden entirely on boards with no LED wired. |
| **Safety Switch** | wired / not | `Reboot` · `conditional` | A switch that forces the blaster to SAFE while engaged, whatever firing mode is selected: the flywheels spin down, and it will not rev or fire. It beats everything, including the ESC dashboard. A blaster with no safety pin wired never shows this. Set the pin on the console's Wiring page. |
| **Dual Stage Trigger** | on / off | `Live` · `conditional` | On: the trigger's own two contact stages replace a separate Rev switch, so a light press revs and a full press fires. On firmware 2.3.0 and later, a fire mode's [Half Press](Firing-Modes#half-press) can make the light press fire a mode of its own too. Hidden when no rev pin is wired at all. Note that Plasma ignores the rev stage entirely. |
| **Switch Debounce (ms)** | 5 to 50, ±5 | `Live` | Debounce window for Trigger, Rev, all 3 Select switches, and the Menu button. Lower reacts faster to intentional fast double-taps but is more sensitive to switch bounce, and higher is the opposite. |
| **Menu Hold Time** | 1 to 5s, ±0.5s | `Live` | How long you have to hold Menu for it to count as a hold, meaning open the menu or go back, instead of a short press. |
| **Volt Avg Window** | 1 to 20 | `Live` | How many battery readings are averaged together. Higher smooths a jittery voltage readout at the cost of reacting more slowly to a real, fast voltage drop. |
| **RPM Shot Counter** | on / off | `Live` | On: a shot only counts once a sustained RPM dip is detected. Off: a shot counts immediately whenever the solenoid extends, regardless of RPM. |
| **Good RPM Reads** | 1 to 30 | `Live` · `conditional` | How many consecutive low readings in a row are required before a dip counts as a real shot rather than noise. Hidden while RPM Shot Counter is off. |
| **RPM Drop Thresh** | 0 to 2000, ±100 | `Live` · `conditional` | How far below target RPM a reading must fall to look like a shot in progress. Hidden while RPM Shot Counter is off. |
| **Factory Reset Device** | confirm | `Reboot` | Resets only Device Settings back to factory defaults. Your active profile is untouched. |
| **About** | read-only | `Live` | Blaster name, active profile's name, firmware version, board name. |