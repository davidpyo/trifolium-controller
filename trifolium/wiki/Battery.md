# Battery

*Advanced > Battery. All Device scope.*

The two per-cell voltage limits share one range, 3000 to 3800 mV/cell, centered on where LiPo cutoffs actually belong rather than letting you dial in a number that would flatten a pack or burn your motors.

| Setting | Range | Takes effect | What it does |
|---|---|---|---|
| **Battery Type** | 3S / 4S / 5S / 6S | `Live` | Cell count of the pack you are running. Sets how the per-cell voltage settings below scale to a real cutoff, and feeds the RPM ceiling for every motor. |
| **Low V Cutoff** | 3000 to 3800 mV/cell, ±50 | `Live` | Hard cutoff. Once a rev and its dwell are over, a pack reading below this per-cell voltage for a second counts as flat, and the blaster will not rev, idle or fire again until it restarts, protecting the pack. Default 3300. See [How the cutoff trips](#how-the-cutoff-trips). |
| **Low V Warning** | 3000 to 3800 mV/cell, ±50 | `Live` | An earlier heads-up: the home screen blinks `LOW BATT` once you cross this, well before the hard cutoff. Does not stop you from firing. Default 3700. Set it above your cutoff so it trips first. |
| **Low Batt Beep** | on / off | `Live` | Firmware 2.3.0 and later. Once the pack trips Low V Cutoff, the ESCs beep, and again every 10 s until the pack is swapped or the blaster restarts. Only with the wheels stopped, since an ESC ignores commands while its motor turns, and only with the pack in, since the ESCs make the sound. Default on. |
| **Volt Calibration** | 0.5 to 1.5, ±0.1 | `Live` | Correction factor if the displayed battery voltage does not match a multimeter reading. |
| **Storage Discharge** | action | `Live` | Spins all motors at a low, steady draw to bleed the pack down to a safe storage voltage, then stops automatically. Better for LiPo longevity between sessions than storing at full charge. On ESC-driver boards this skips the pusher's channel, described under [Motors and PID](Motors-and-PID). |

## How the cutoff trips

A pack sags well below its resting voltage while the flywheels draw hard, and is back within milliseconds once they stop. So the cutoff only judges the pack while the wheels are not under load:

- **Never during a rev.** Revving, firing and the dwell after a shot never count, however low the pack sags. A rev in progress is never cut short.
- **A second off the load.** From the moment the dwell lets the wheels coast down, the reading has to stay below the cutoff for a full second. Coasting, idling and standing still all count, whether the idle comes from Idle Hold, the idle switch or the idle time after a rev, so neither a blaster left idling nor one revved again and again is left unprotected. A rev started within that second goes ahead, and the count starts over when it ends.
- **Then until restart.** The wheels stop, any idle included, queued shots are dropped, and rev, fire and idle are all refused. `LOW BATT` stays up even if the pack reads above the cutoff again with the load off, because a drained pack recovers on paper the moment it stops working. Swapping the battery restarts the blaster, which clears it. With USB plugged in the blaster stays on while the pack is out, so taking the pack out clears it instead, on firmware 2.3.0 and later: once the reading has fallen under 1 V a cell for a second, far below anything a pack rests at, whatever is plugged in next is judged as a fresh pack.
- **Not straight after power-on.** On some boards the reading climbs from near zero for tens of seconds after power-on, and USB power alone reads nothing. The cutoff only starts watching once the reading has reached it, so a slow reading never trips it. A pack already below the cutoff when you plug it in is not caught.
- **ESC Enable**, on a board with that circuit, switches the ESCs off once a flat pack has brought the wheels to a stop, never while they are still spinning down.

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
