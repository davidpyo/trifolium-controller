# Battery

*Advanced > Battery. All Device scope.*

The two per-cell voltage limits share one range, 3000 to 3800 mV/cell, centered on where LiPo cutoffs actually belong rather than letting you dial in a number that would flatten a pack or burn your motors.

| Setting | Range | Takes effect | What it does |
|---|---|---|---|
| **Battery Type** | 3S / 4S / 5S / 6S | `Live` | Cell count of the pack you are running. Sets how the per-cell voltage settings below scale to a real cutoff, and feeds the RPM ceiling for every motor. |
| **Low V Cutoff** | 3000 to 3800 mV/cell, ±50 | `Live` | Hard cutoff. Below this per-cell voltage the blaster refuses to spin up at all, protecting the pack. Default 3300. |
| **Low V Warning** | 3000 to 3800 mV/cell, ±50 | `Live` | An earlier heads-up: the home screen blinks `LOW BATT` once you cross this, well before the hard cutoff. Does not stop you from firing. Default 3700. Set it above your cutoff so it trips first. |
| **Volt Calibration** | 0.5 to 1.5, ±0.1 | `Live` | Correction factor if the displayed battery voltage does not match a multimeter reading. |
| **Storage Discharge** | action | `Live` | Spins all motors at a low, steady draw to bleed the pack down to a safe storage voltage, then stops automatically. Better for LiPo longevity between sessions than storing at full charge. On ESC-driver boards this skips the pusher's channel, described under [Motors and PID](Motors-and-PID). |

## Battery Type does more than set the cutoff

It is also half of the RPM ceiling calculation. Changing from 4S to 6S raises the ceiling on every RPM field, and changing down lowers it, which can leave a stored RPM target above its new ceiling until you step that field once.

See [Flywheel and RPM](Flywheel-and-RPM) for the full derivation.

## With no battery pin

A build can leave **Battery ADC** unused in the Wiring table, as on a bare module where every pin is taken. With nothing to read, the firmware assumes the pack sits at 3.5 V a cell, and:

- **Nothing warns about a flat pack.** Low V Cutoff and Low V Warning never trip, `LOW BATT` never shows, and the status LED gives no battery warning. Fit a LiPo alarm, or rely on the ESCs' own cutoff.
- **The home screen shows no voltage.**
- **Storage Discharge refuses to run**, since it has no voltage to stop at.
- **Throttle is worked out for 3.5 V a cell**, or for the Low V Cutoff if that is higher. Idle runs on that figure alone, so on a fuller pack the wheels idle faster than set: about a fifth faster at 4.2 V a cell. Under rev, PID or TBH corrects for it.
- **The solenoid's extend time is worked out at 3.5 V a cell.** Set Extend @ High V and Extend @ Low V equal, and the push lasts the same at any voltage. See [Solenoid and Pusher](Solenoid-and-Pusher).

Battery Type still matters: it sets every motor's RPM ceiling.
