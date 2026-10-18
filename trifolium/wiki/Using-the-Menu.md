# Using the Menu

**Hold Menu** for about 1.5 seconds to open it. Inside:

- **Trigger** and **Rev** move the highlight or adjust a value
- **Short-press Menu** selects or saves
- **Hold Menu** goes back or cancels

## The five screen patterns

Every screen falls into one of these.

| Pattern | What you will see |
|---|---|
| **List / submenu** | A title bar, then rows, with the current one shown inverted. Trigger and Rev scroll, short-press Menu enters. A `< Back` row is always appended after the last real item. |
| **Number / decimal edit** | Title bar, then one big centered value. Trigger and Rev step it up and down, holding auto-repeats for long ranges. Short-press saves, hold reverts to what it was before you opened it. |
| **Option list** | Every choice shown at once, current one inverted. Used for anything with a small fixed set of options. |
| **Toggle** | No separate edit screen. A short-press flips it between ON and OFF right there in the list. |
| **Text editor** | Used for Blaster Name and each fire mode's Name Override. A fixed 14-character string with one character highlighted, cycling through space, A-Z, a-z, 0-9, `-` and `_`. Trigger and Rev cycle its value, short-press Menu commits it and moves to the next character (wrapping back to the start), hold-Menu opens a **Save / Cancel / Continue Editing** list. |

## Trigger-only builds: double-click to count down

On a build with no Rev switch usable for navigation, Trigger is the only thing stepping a value, so it can only ever count one way.

On a number-edit screen, **double-click Menu** to flip the step direction. `REV` appears in the top-right corner while the direction is reversed, and double-clicking again flips it back.

The cost is that a save now waits about 350ms for a possible second click, so the screen lingers for a moment after you press Menu to save. That pause is the double-click window, not a hang.

Builds with a usable Rev switch are unaffected: Trigger counts up, Rev counts down, and a single Menu press saves immediately.

## Rows can disappear

A setting that would not currently do anything is not shown at all, rather than sitting there disabled. For example:

- EMA Filter while Control Type is TBH
- The 4 solenoid voltage fields while Pusher Type is None
- Burst Length on a mode that fires a fixed count

If a row you expect is not where you remember it, check what it depends on first. These are tagged `conditional` on this wiki, and each one states its exact condition in its description.

## And a few rows refuse

One case is different. A setting that would drive the wrong piece of hardware stays visible and explains itself instead of vanishing, because a missing row would be the more confusing outcome. Selecting it shows a short message and changes nothing.

These are tagged `can lock`. Today that is the pusher's motor channel on ESC-driver boards, covered under [Motors and PID](Motors-and-PID).
