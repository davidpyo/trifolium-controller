# Firing Modes

Every fire mode in your list is one of these seven behaviours. The first five are the familiar ones. **Devotion** and **Plasma** both control the flywheels themselves rather than just counting darts.

| Mode | Trigger behaviour |
|---|---|
| **AUTO** | Fires continuously while held, up to Burst Length. Releasing stops after the shot in flight. |
| **BURST** | A fixed number of darts per pull. With Reversible on, press revs and release fires. |
| **BINARY** | Fires on press and again on release, as long as the release lands inside Binary Timeout. |
| **SEMI** | Exactly 1 dart per pull, not adjustable. With Reversible on, press revs and release fires the single shot. |
| **SAFE** | Ignores the trigger entirely, and spins the flywheels down from whatever they were doing. A physical safety, not a firing style. |
| **DEVOTION** | Fires continuously like Auto, but the *rate* climbs the longer you hold. |
| **PLASMA** | A charge-up shot. A charge bar with 3 slots filling as they arm, and a blinking `OVERHEAT!` banner if you hold too long. |

Changing mode in the middle of a burst ends it: moving the select switch or pressing the select button stops the firing after the shot already due, the way letting go does in Auto, even while you hold the trigger. Firmware 2.2.1 and later; before that, the burst carried on in the new mode.

Switching to SAFE, or opening the menu, brings the flywheels down at once along the normal spindown ramp: a spin-up stops where it is, and no dwell or idle window holds them up. A pusher already extended still retracts first. Firmware 2.3.0 and later; before that, a spin-up already started ran on until the wheels reached speed, and a dwell or idle window ran to its end.

### Haptic feedback

> **Plasma can buzz the pusher as a feedback cue.** Set [Vibration Pulse](Solenoid-and-Pusher) above 0 and the solenoid fires a short pulse train when a dart slot arms (a short buzz) and when the blaster overheats (a longer one), so you can feel the charge state without watching the screen.
>
> It is off by default, never runs while a real shot is in progress, and needs a solenoid, since there is nothing else to buzz with.
