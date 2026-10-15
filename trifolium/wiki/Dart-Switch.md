# Dart Switch

*Advanced > Dart Switch. All Device scope. Firmware 2.2.0 and later.*

A switch or sensor in the breech that sees a dart waiting. Wire it to ground on any free GPIO, like the other switches, and set **Dart Switch Pin** on the console's Wiring page, with **Dart Switch Normally Closed** for one that opens when a dart is there. This section only appears once the pin is set.

| Setting | Range | Takes effect | What it does |
|---|---|---|---|
| **Dart Sensing** | on / off | `Live` | The pusher only pushes when the dart switch shows a dart, a new one each time, and pulls back as soon as that dart has gone. It never pushes an empty breech or the same dart twice. |
| **Rev Only With Dart** | on / off | `Live` | A rev, from the rev switch or a trigger pull, only starts with a dart in the breech. A pull with no dart is dropped rather than kept for later, and a dart arriving while you hold rev starts the rev. Once the wheels are up, an empty breech does not stop them: they follow the rev switch as usual. Works with Dart Sensing on or off. |
| **Dart Debounce (ms)** | 0 to 50 | `Live` | How long the switch must show a dart without a break before it counts, for Dart Sensing and Rev Only With Dart alike. Higher rides out bounce and sensor noise; lower lets a dart fire sooner after it arrives. |
| **Dart Wait (ms)** | 200 to 5000, ±100 | `Live` · `conditional` | How long a queued shot waits for a dart. When it runs out, the queued shots are dropped and the wheels follow the rev switch again. Only shown while Dart Sensing is on. |
| **Min Push (ms)** | 0 to 60 | `Live` · `conditional` | How long each push ignores the dart switch, since the pusher's jolt can make a dart look gone for a moment. After it, the pusher pulls back as soon as the switch reads empty. The extend time is still the longest a push lasts: set Min Push at or above it to always push for the full time. Only shown while Dart Sensing is on. |

## How Dart Sensing fires

- **No dart, no push.** A pull with the breech empty revs the wheels and waits, unless Rev Only With Dart holds the rev off. A dart arriving within Dart Wait is pushed. If none arrives, the queued shots are dropped, and the wheels spin down, or stay up while you hold rev.
- **Pull back on the dart.** Each push ends once the dart has gone and Min Push has passed, so the next push can come sooner.
- **Retract Time and Target DPS still apply.** Target DPS holds exactly: the time an early pull-back saves is added back to the spacing. Its range reaches the rate Min Push and Retract Time allow, so the top of it fires as fast as the darts can be pushed.
- With Dart Sensing off, a wired dart switch is still read and logged, and the pusher ignores it.

## Rate of fire

With Dart Sensing on, each shot takes about:

- **the push:** the longer of Min Push and the time the dart takes to leave the switch;
- **then the rest:** the longer of [Retract Time](Solenoid-and-Pusher) and the time the next dart takes to arrive, plus Dart Debounce.

A magazine usually takes longer to feed the next dart than Retract Time, so **Dart Debounce is what sets the rate**: every millisecond off it is a millisecond off every shot. Retract Time only matters if the magazine feeds faster than Retract Time minus the debounce, and Min Push only if darts leave the switch sooner than it.

## Tuning

With Verbose Serial print on, the log says *Dart in the breech* and *Breech empty* at each change, *Solenoid retracting, the dart left after N ms* at each early pull-back, and *No dart in the breech, not revving* when Rev Only With Dart holds a rev off.

- **For a higher rate,** lower Dart Debounce. At 0 the switch is read raw, with no filtering.
- **If it sees darts that are not there,** or pushes with none, raise Dart Debounce.
- **If pushes end before the dart is clear,** raise Min Push.
- **If a push logs a plain *Solenoid retracting*,** it reached the extend time before the dart left. Raise Extend @ High V and Extend @ Low V under [Solenoid and Pusher](Solenoid-and-Pusher).
