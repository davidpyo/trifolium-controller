# Profiles

*Advanced > Profile.*

Managing the 3 named slots described on [Home](Home).

| Setting | Range | Scope | Takes effect | What it does |
|---|---|---|---|---|
| **Switch Profile** | Low / Medium / High | n/a | `Reboot` | Loads a different saved profile as active and reboots. Each row shows that slot's live name. |
| **Copy To** | Low / Medium / High | n/a | `Live` | Copies the *currently active* profile's settings into another slot, including its whole fire-mode list. Handy for starting a new profile from your current one instead of factory defaults. The destination keeps its own name, and only the data copies. No reboot, since it only writes the target slot's file. |
| **Default Profile** | Low / Medium / High | Device | `Live` · `conditional` | Which profile loads at boot when Variable FPS is on and the selector grounds no line, or sits at a position set to Default under Selector Profiles. Only shown when Variable FPS is on *and* Select-Fire Type is Switch or Encoder, since it is unused otherwise. |
| **Selector Profiles** | submenu | Device | `Reboot` · `conditional` | Which slot each selector position boots, **Position 1** to **Position 7**, with a row for each position your wiring can reach. Each is a slot by name, or **Default** for the Default Profile. Out of the box, Positions 1 to 3 boot slots 1 to 3. Only shown when Variable FPS is on *and* Select-Fire Type is Switch or Encoder. Firmware 2.2.0 and later. |
| **Factory Reset Profile** | confirm | n/a | `Reboot` | Resets the active profile slot to factory defaults, including clearing its name back to blank and returning its mode list to the stock 3: Auto, Binary, Semi. |

> **No screen?** A switch held at power-on can pick the profile instead: give it a **Slot 1**, **Slot 2** or **Slot 3** [boot action](Device#boot-actions). On firmware 2.3.0 and later that is a boot rule, which can also need two switches held together, so a blaster with few switches can still reach all three slots.

## What a profile holds

| Group | Settings |
|---|---|
| RPM and timing | Per-motor or per-stage RPM, dwell time, idle time, idle RPM, spindown speed, rev safety timeout, RPM Mode |
| Fire modes | 1 to 10 entries, each with its firing mode, burst length, target DPS, reversible flag, binary timeout, cycle inclusion, half press and name |
| Selector mapping | Which fire mode each switch position selects, plus Default Mode |

Everything else is Device scope and shared across all three slots. Notably, motor Kv, PID gains and solenoid timing do **not** vary per profile.
