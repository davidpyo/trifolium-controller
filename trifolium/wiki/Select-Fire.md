# Select-Fire

*Advanced > Select-Fire. Mixed scope.*

How the blaster switches between firing behaviours mid-session: live, not boot-locked.

A profile's fire modes are a list you build: 1 to 10 entries, added, duplicated and deleted from the menu, each with its own firing mode, name and timing.

| Setting | Range | Scope | Takes effect | What it does |
|---|---|---|---|---|
| **Fire Modes** | submenu | Profile | `Live` | The mode list itself. Rows "Mode 1" through however many you have, each showing that mode's name, then **New Fire Mode** at the end. |
| **Default Mode** | your mode list | Profile | `Live` · `conditional` | The fallback used when no switch position currently reads as pressed, such as a 3-way switch's middle position with only 2 pins wired, and an encoder's position with no line grounded. Only shown for Select-Fire Type = Switch or Encoder. |
| **Active Firing Mode** | your mode list | n/a | `Live` | Sets the live mode straight away, without saving it. The on-screen equivalent of flipping a physical switch. Shown for every Select-Fire Type, and also on the root menu as **Firing Mode**. |
| **Set Selector Switch Modes** | submenu | Profile | `Live` · `conditional` | Maps each switch or encoder position to a mode, described below. Only shown for Select-Fire Type = Switch or Encoder. |
| **Select-Fire Type** | Off / Switch / Button / Screen / Encoder | Device | `Reboot` | How the mode is chosen: a physical switch position, a momentary button that cycles through modes, the on-screen picker only, a rotary selector read as an [encoder](#encoder-selectors), or disabled entirely. Encoder needs firmware 2.2.0 and later. |

## Set Selector Switch Modes

*Profile scope.*

One row per position, **Position 1** up to **Position 7**. Each is set to a mode by name, or to **Default**, meaning that position falls through to Default Mode instead of naming a mode of its own.

With a switch there is one row per wired select pin, so up to three. With an encoder there is one row per position its wired lines can make, besides the one with none grounded: one line gives Position 1, two give Positions 1-3, three give Positions 1-7. A position the wiring cannot reach does not appear at all. Positions are independent, so two of them can point at the same mode, and a mode can be reachable only from the menu with no position at all.

> **The selector wins, but the screen wins until the selector moves.** On a Switch or Encoder build, picking a mode from Active Firing Mode overrides the selector. The physical position is ignored until the selector is *actually moved*, including moved to a position that grounds nothing, at which point the selector takes authority back and your override is dropped. So an on-screen pick is not sticky across a switch flick, by design.
>
> On Button builds a screen pick holds until the next button press. On Screen and Off builds nothing else touches it.
>
> One thing to know at power-on: Screen and Off builds always start on **Mode 1**, not Default Mode. Default Mode only applies to Switch and Encoder builds.

## Encoder selectors

*Firmware 2.2.0 and later.*

Select-Fire Type **Encoder** reads the wired select pins together as one binary number, for a rotary selector or encoder that grounds a different combination of lines at each detent. Select 0 is the lowest bit, then Select 1, then Select 2, skipping any that are not wired, and a grounded line counts as 1. Two wired lines read like this:

| Grounded | Position | Selects |
|---|---|---|
| neither | 0 | Default Mode |
| Select 0 | 1 | Position 1's mode |
| Select 1 | 2 | Position 2's mode |
| both | 3 | Position 3's mode |

So a two-line selector has four positions and a three-line one eight. The lines need not be neighbours: a build that wires only Select 0 and Select 2 reads them as two lines. A new position only counts once it has held for the switch debounce, so turning the knob through a detent on the way to another never selects the one in between.

## Fire Modes > Mode *n*

*Profile scope.*

One editor per mode in the list. Which rows appear depends on the firing mode you pick in the first row: a mode that fires exactly one dart has no Burst Length, one that sets its own rate has no Target DPS.

| Setting | Range | Takes effect | What it does |
|---|---|---|---|
| **Firing Mode** | 7 modes | `Live` | AUTO, BURST, BINARY, SAFE, SEMI, DEVOTION or PLASMA. What this mode does with the trigger. See [Firing Modes](Firing-Modes). |
| **Burst Length** | AUTO 1-500, BINARY 1-10, BURST 2-10 | `Live` · `conditional` | Darts per trigger pull. The range depends on the firing mode: Auto can go up to 500 since it is a "keep going" number, and Burst starts at 2 because a 1-dart burst is just Semi. Hidden for Safe, Semi, Devotion and Plasma, which all fix their own count. |
| **Target DPS** | 1 to achievable max | `Live` · `conditional` | Desired darts-per-second. Clamped to what your current timing can actually achieve, showing `N (max)` once you are at the ceiling. Hidden for Safe, Devotion and Plasma. |
| **Reversible** | on / off | `Live` · `conditional` | Turns the trigger into rev-on-press, fire-on-release: holding spins the flywheels up, letting go sends the burst. Good for a deliberate, pre-revved shot. Only offered for BURST and SEMI. |
| **Binary Timeout** | 0 to 5s, ±1s | `Live` · `conditional` | How long release-to-refire is allowed before it counts as a new, separate trigger pull. Set per mode, so two Binary modes can use different windows. Only shown while this mode is BINARY. |
| **Include In Cycle** | on / off | `Live` · `conditional` | Whether the select *button* stops on this mode when cycling. Off keeps a mode in the list and reachable from the menu, but out of the button rotation, which is useful for parking a Safe or a novelty mode you do not want to tab through mid-game. Only shown for Select-Fire Type = Button. |
| **Half Press** | Rev Only / your mode list | `Live` · `conditional` | With a dual-stage trigger, what a half press fires while this mode is selected; a full press then takes over. Rev Only, the default, just spins the flywheels up. A mode can't pair with itself, Safe or Plasma, and the menu skips them. Only shown with [Dual Stage Trigger](Device#general) on, and not for Safe or Plasma. See [Half press](Firing-Modes#half-press). Firmware 2.3.0 and later. |
| **Name Override** | 14 chars | `Live` | Optional. Leave blank and this mode's display name is just its firing mode, such as `AUTO` or `PLASMA`. Type something here to override it. With several modes sharing one firing mode, naming them is what keeps the list readable. |
| **Duplicate** | action | `Live` | Appends a copy of this mode to the end of the list and returns to the list. The fastest way to make a near-identical variant. Refuses once the list holds 10. |
| **Delete** | action | `Live` | Removes this mode and closes the gap, then returns to the list. Anything pointing at it is fixed up for you: switch positions assigned to it revert to Default, a Half Press set to it goes back to Rev Only, and Default Mode falls back to Mode 1. Refuses to delete the last remaining mode. |
