# Root and Advanced

The root menu opens directly to shortcuts for the settings changed most often, plus one **Advanced** submenu holding everything else.

## Root menu

| Setting | Range | Takes effect | What it does |
|---|---|---|---|
| **Firing Mode** | your mode list | `Live` | Picks which of the profile's fire modes is live right now, by name. The same row as Select-Fire > Active Firing Mode. |
| **Burst Length** | varies by mode | `Live` · `conditional` | Shortcut to the active mode's Burst Length. Hidden whenever the active mode does not use one, meaning Safe, Semi, Devotion and Plasma. |
| **Target DPS** | 1 to achievable max | `Live` · `conditional` | Shortcut to the active mode's target darts-per-second. Hidden whenever the active mode sets its own rate or does not fire, meaning Safe, Devotion and Plasma. |
| **RPM / Timing** | per-motor limits | `Reboot` | Shortcut into the active profile's Per Motor RPM or Per Stage RPM editor, whichever RPM Mode is selected. See [Flywheel and RPM](Flywheel-and-RPM). |
| **Switch Profile** | Low / Medium / High | `Reboot` | Shortcut to Profile > Switch Profile. |
| **Reboot** | action | `Live` | Shortcut to Device > Reboot > Reboot. |

Because Burst Length and Target DPS are aliases into *whichever* mode is currently active, they will show different values, or vanish, after you switch modes. That is expected.

## Advanced

In order:

1. [Flywheel / RPM](Flywheel-and-RPM)
2. [Select-Fire](Select-Fire)
3. [Profile](Profiles)
4. [Motors & PID](Motors-and-PID)
5. [Solenoid / Pusher](Solenoid-and-Pusher)
6. [Dart Switch](Dart-Switch), only shown while a dart switch is wired
7. [Battery](Battery)
8. [Device](Device)
