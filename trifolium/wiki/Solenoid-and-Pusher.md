# Solenoid and Pusher

*Advanced > Solenoid / Pusher. All Device scope.*

Pusher hardware and its timing curve. One set for the whole blaster rather than per profile.

| Setting | Range | Takes effect | What it does |
|---|---|---|---|
| **Extend @ High V (ms)** | 0 to 60 | `Live` · `conditional` | How long the solenoid stays extended with the battery at the High V Threshold. With [Dart Sensing](Dart-Switch) on (firmware 2.2.0 and later), it is the longest a push lasts: the pusher pulls back sooner once the dart has gone. Only shown while Pusher Type is Solenoid. |
| **High V Threshold (mV)** | Low Voltage Cutoff to a full pack (13200 to 16800 on 4S), ±10 | `Live` · `conditional` | The battery voltage the High V extend time is set for. The extend time follows a straight line through the two thresholds and carries on along it beyond them, rather than stopping at either time. With the usual longer Low V time, a push keeps getting shorter above High V and longer below Low V. Only shown while Pusher Type is Solenoid. |
| **Extend @ Low V (ms)** | 0 to 60 | `Live` · `conditional` | How long the solenoid stays extended with the battery at the Low V Threshold, usually longer than at High V so the push stays consistent as the battery, and with it the solenoid's force, sags. With [Dart Sensing](Dart-Switch) on (firmware 2.2.0 and later), it is the longest a push lasts. Only shown while Pusher Type is Solenoid. |
| **Low V Threshold (mV)** | 1 V a cell under the cutoff, to just under High V Threshold (9200 to 16790 on 4S), ±10 | `Live` · `conditional` | The battery voltage the Low V extend time is set for; see High V Threshold for how the time carries on past it. With no battery pin wired, the firmware assumes 3.5 V a cell: set the two extend times equal, and the push lasts the same at any voltage. Only shown while Pusher Type is Solenoid. |
| **Retract Time (ms)** | 0 to 100 | `Live` | How long the pusher takes to retract before the next cycle can begin. Applies regardless of Pusher Type. Together with extend time, this sets the achievable-DPS ceiling that every mode's Target DPS clamps to. While [Dart Sensing](Dart-Switch) is on, Min Push stands in for the extend time, since a push can end that soon (firmware 2.2.0 and later). |
| **Vibration Pulse (ms)** | 0 to 20 | `Live` | Pulse width for the haptic feedback buzz Plasma uses to signal an armed dart or an overheat. 0 disables it entirely, which is the default. Keep it short: it is meant to be felt, not to move a dart. |
| **Pusher Type** | None / Solenoid | `Reboot` | Whether a solenoid's voltage-compensated timing curve, meaning the four fields above, applies at all. |
| **Reverse Direction** | on / off | `Live` | Flips pusher motor polarity, for a motor wired backwards. |
| **Debounce (ms)** | 0 to 200 | `Live` | Debounce specifically for the pusher's own cycle-detection switch. |

A wired dart switch has its own section, which can end a push early and hold a shot until a dart arrives: see [Dart Switch](Dart-Switch).
