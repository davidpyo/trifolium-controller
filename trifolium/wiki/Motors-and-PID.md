# Motors and PID

*Advanced > Motors & PID. All Device scope.*

Per-motor hardware configuration and PID tuning, which are wiring facts rather than something you would want to differ between profiles. Plus the flywheel control algorithm and the diagnostic tools.

## Motor 1 (2, 3, 4 identical)

| Setting | Range | Takes effect | What it does |
|---|---|---|---|
| **Enabled** | on / off | `Reboot` · `can lock` | Whether this motor channel is wired and used at all. A disabled motor is ignored everywhere, including when RPM ranges are worked out. Refuses on the one channel that shares its pin with the pusher, described below. |
| **Stage** | Stage 1 / Stage 2 | `Reboot` | Which flywheel stage this motor belongs to. Feeds Stage RPM Mode and the home-screen RPM readout grouping. |
| **KP / KI** | 0 to 2.00, ±0.1 | `Live` | Proportional and integral gains for this motor's speed control loop. There is no D term. |
| **Poles/2** | 1 to 10 | `Live` | Half the motor's magnetic pole count, needed to convert electrical RPM to real mechanical RPM. |
| **Kv** | 500 to 10000, ±10 (to 5000 on firmware 2.1.1 and earlier) | `Live` | The motor's Kv rating in RPM per volt, from its spec sheet. **Load-bearing:** together with Battery Type it sets the floor and ceiling of every RPM field for this motor. See [Flywheel and RPM](Flywheel-and-RPM). |
| **Test This Motor** | action | `Live` · `can lock` | Spins just this one motor at a fixed test speed for about 2 seconds, others held off. Refuses on the pusher's channel, as above. |
| **Change Direction** | action | `Live` · `can lock` | Reverses which way this motor turns, by writing the ESC's own stored direction, then spins the wheel so you can see the result. Use it when a wheel turns the wrong way instead of swapping phase wires. The screen names what it just wrote, not what the ESC holds — nothing can read that back — so the spin is the real answer. Refuses on the pusher's channel. |

## When the pusher is on a motor channel

Some builds drive the pusher from one of the four motor outputs instead of a FET, and that output is then the pusher's, not a flywheel's. It is usually **Motor 3**. Whether your build does this, and which channel it uses, is set on the [Web Console](Web-Console)'s Wiring page rather than decided by the PCB.

On firmware 2.3.0 and later, the motor table in the [Web Console](Web-Console)'s Motors & PID section, on Blaster settings, has the same two actions as rows under each enabled motor: **Test** spins it, and **Normal** or **Reversed** writes that direction to the ESC and then spins it to check. They are two buttons there rather than a toggle, because nothing can read back which way the ESC is set. The blaster has to be at rest with its menu closed and the safety off.

That channel's **Enabled**, **Test This Motor** and **Change Direction** rows are still listed, but selecting any of them shows a short message and does nothing. Nothing you can do from the menu will fire the solenoid by mistake, and the same protection covers Storage Discharge and the other motors' tests.

The channel's remaining rows stay editable and simply have no effect. On a FET-driven pusher nothing is locked and all four motors behave the same.

## General

| Setting | Range | Takes effect | What it does |
|---|---|---|---|
| **Control Type** | PID / TBH | `Live` | Which control algorithm holds the flywheels at target RPM. PID is the standard choice. TBH (take-back-half) is an alternate algorithm. |
| **EMA Filter** | 1 to 4 | `Live` · `conditional` | Smoothing strength on RPM readings. Higher smooths out more noise but reacts more slowly to real changes. Only shown while Control Type is PID, since TBH does not use it. |
| **I Threshold** | 0 to 500, ±10 | `Live` · `conditional` | PID integral-term tuning threshold. Only shown while Control Type is PID. |
| **Throttle Cap** | 0 to 2000, ±10 | `Live` · `conditional` | Extra throttle headroom TBH uses on the initial rev, before its own feedback takes over. Only shown while Control Type is TBH, since PID does not use it. |
| **Auto-Tune PID** | action | `Live` · `conditional` | Try it. |
| **ESC Dashboard** | read-only | `Live` | Live per-motor voltage, current, temperature and stress from the ESCs, if your ESC firmware reports it. Rev works from this screen so you can see numbers while spinning. |
| **RPM Logging** | on / off | `Live` | Arms an RPM-versus-time capture on every rev. The blaster prints the capture and reboots once it has its samples, so turn it off again for normal use. Chart it in the [Web Console](Web-Console). |
