# Flywheel and RPM

*Advanced > Flywheel / RPM. Mixed scope.*

How fast the flywheels spin and how they ramp, per the active profile, plus the control-loop safety limits that apply no matter which profile is loaded.

Several timing fields read in **seconds** on screen and step in whole seconds, even though they are still stored in milliseconds.

| Setting | Range | Scope | Takes effect | What it does |
|---|---|---|---|---|
| **RPM Mode** | Custom / Stage | Profile | `Reboot` | Custom: set every motor's RPM individually. Stage: set one RPM per flywheel Stage (1st or 2nd, assigned per motor under [Motors and PID](Motors-and-PID)) and every motor in that stage follows it. |
| **Per Motor RPM > Motor 1-4** | floor to ceiling*, ±500 | Profile | `Reboot` · `conditional` | Target RPM for each enabled motor directly. Only shown while RPM Mode is Custom, and hidden while a [speed pot](#speed-pot) is wired, since the pot sets it. |
| **Per Stage RPM > 1st / 2nd Stage** | floor to ceiling*, ±500 | Profile | `Reboot` · `conditional` | One RPM per stage, applied to every enabled motor assigned to it. Limits come from the highest-Kv enabled motor in that stage. Only shown while RPM Mode is Stage, and hidden while a [speed pot](#speed-pot) is wired, since the pot sets it. |
| **Stage 2 Ratio** | 0.5 to 2.0, ±0.05 | Profile | `Live` · `conditional` | With a speed pot wired, the 2nd stage runs at this times the 1st stage's RPM. Only shown while a speed pot is wired. Firmware 2.2.0 and later. |
| **Dwell Time** | 0 to 10s, ±1s | Profile | `Reboot` | How long the flywheels hold at speed after a shot before starting to idle down. Covers rapid follow-up shots. Default 1s. |
| **Idle Time** | 0 to 60s, ±1s | Profile | `Reboot` | After Dwell Time expires with no more shots, how long the flywheels hold at Idle RPM before spinning all the way down. Default 0, which stops the wheels as soon as dwell expires. |
| **Idle RPM (Custom) > Motor 1-4** | 0 to ceiling*, ±100 | Profile | `Live` · `conditional` | Idle speed per motor, default 1000. **0 means do not idle**, so the wheels spin all the way down. Only shown while RPM Mode is Custom. Idle RPM follows the same Custom/Stage split as the main RPM targets. |
| **Idle RPM (Stage) > 1st / 2nd Stage** | 0 to ceiling*, ±100 | Profile | `Live` · `conditional` | Idle speed per stage, in finer 100 RPM steps than the per-motor rows. Only shown while RPM Mode is Stage. |
| **Spindown Speed** | 10 to 500, ±10 | Profile | `Live` | How quickly the flywheels are allowed to slow down once idling starts. Higher spins down faster. |
| **Rev Safety TO** | 0 to 60s, ±1s | Profile | `Live` | Auto-idles/stops the flywheels if you hold Rev this long without firing a shot, guarding against leaving it spun up and forgotten. 0 disables the timeout, which is the default. |
| **Firing RPM Tol** | 0 to 20000, ±500 | Device | `Live` | How far below the target a motor may still be and count as "at speed". Smaller means it must get closer before firing, larger means it fires sooner into the spin-up. |
| **Min Firing RPM** | 0 to ceiling*, ±1000 | Device | `Live` | A hard floor under the "at speed" point, so a low target cannot let a shot go at a uselessly low RPM. 0 removes the floor entirely and leaves Firing RPM Tol as the only gate. Its ceiling comes from the highest-Kv enabled motor. |
| **Rampup Timeout (ms)** | 100 to 5000, ±50 | Device | `Live` | If the flywheels have not reached firing speed within this long after a rev starts, the attempt aborts back to idle rather than waiting forever. Plasma is exempt, since a long charge is not a failed rev. |
| **Variable FPS** | on / off | Device | `Reboot` · `conditional` | When on and Select-Fire Type is Switch or Encoder, the selector's position at power-on picks the active profile. Which slot each position boots is set under [Profiles](Profiles), in Selector Profiles. Hidden while Select-Fire Type is Off, where it has no effect. |
| **Pot Min RPM** | floor to ceiling*, ±1000 | Device | `Live` · `conditional` | The 1st stage's RPM with the speed pot turned all the way down. Only shown while a speed pot is wired. Firmware 2.2.0 and later. |
| **Pot Max RPM** | floor to ceiling*, ±1000 | Device | `Live` · `conditional` | The 1st stage's RPM with the speed pot turned all the way up. Only shown while a speed pot is wired. Firmware 2.2.0 and later. |

## Speed pot

*Firmware 2.2.0 and later.*

A potentiometer can set the rev RPM live, in place of the profile's own RPM rows. Wire its wiper to one of GPIO 26-29, the RP2040's only analog pins, one end to ground and the other to **3.3 V**. Never 5 V: it damages the pin. Then set **Speed Pot Pin** on the console's Wiring page.

- Across its travel the 1st stage runs from Pot Min RPM to Pot Max RPM, and motors assigned to the 2nd stage run at Stage 2 Ratio times that.
- Each target is kept between what the motor can reach and a little above Min Firing RPM: Firing RPM Tol above it, or 1000 RPM if that is smaller. So the lowest setting still reaches firing speed, and a wide tolerance does not take the bottom of the pot away.
- The rev RPM rows, and the root menu's **RPM / Timing** shortcut, are hidden while a pot is wired.
- What the pot sets is saved with the active profile once the pot has held still for a second and the wheels have stopped.
- If it is fastest at the wrong end, tick **Reversed** in the Speed Pot row of the console's Wiring page. See [Not in the Menu](Not-in-the-Menu).

## \* Why a field will not go where you want

Each RPM field is limited by the motor it controls, based on that motor's **Kv** and your **Battery Type**. There is no separate cap setting to raise.

So if an RPM field stops short of the number you want:

1. Check **Kv** under [Motors and PID](Motors-and-PID) against your motor's spec sheet. A Kv entered too low is the usual cause, and it makes every RPM field for that motor read low.
2. Check **Battery Type** under [Battery](Battery) matches the pack you actually run. A 4S setting on a 6S pack holds the ceiling down.

Two more things worth knowing:

- The rev targets (Per Motor RPM, Per Stage RPM) will not go below a speed the wheels can reliably start from. Idle RPM and Min Firing RPM both go all the way to 0, because switching them off is a real choice.
- Change Kv or Battery Type and a field you have not touched can briefly read outside its new range. Step it once and it settles.