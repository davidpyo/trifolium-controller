// What each setting does, one line apiece, for the mark beside its name. Written from the wiki's
// settings tables: a change to a wiki row belongs here too, and the reverse.

/** By schema key, every index written as [*] so one line covers Motor 1 to 4 and the like. */
export const SETTING_HELP: Record<string, string> = {
  // Fire modes
  "profile:fireModes[*].burstMode":
    "What this mode does with the trigger. Each mode's behaviour is described in the list.",
  "profile:fireModes[*].burstLength":
    "Darts per trigger pull. Auto can go up to 500, since it keeps going while held; Burst starts at 2, because a 1-dart burst is Semi.",
  "profile:fireModes[*].targetDPS":
    "Darts per second to aim for, capped at what the pusher's timing can actually reach.",
  "profile:fireModes[*].reversible":
    "Rev on press, fire on release: holding spins the flywheels up and letting go sends the shot.",
  "profile:fireModes[*].binaryTriggerTimeout_ms":
    "How long after a press the release still fires. Released later, it counts as a new, separate pull.",
  "profile:fireModes[*].includeInCycle":
    "Whether the select button stops on this mode. Off keeps it in the list but out of the button's rotation.",
  "profile:fireModes[*].name":
    "Optional. Blank shows the firing mode itself, such as AUTO. Worth setting when several modes share one firing mode.",
  "profile:defaultFiringMode":
    "The mode used when no select line is grounded, such as a 3-way switch's middle position, and by any position left on Default.",
  "profile:switchPositionAssignment[*]":
    "The fire mode this select-switch or encoder position chooses. Default uses the profile's Default Mode.",
  "device:selectFireType":
    "How the fire mode is chosen: a switch position, an encoder whose select lines count as a binary number, a button that cycles through modes, the on-screen picker only, or not at all.",

  // Flywheel and RPM
  "profile:rpmMode":
    "Custom sets each motor's RPM on its own. Stage sets one RPM per flywheel stage, and every motor in that stage follows it.",
  "profile:revRPM[*]": "The speed this flywheel spins up to before a shot.",
  "profile:idleRPM[*]":
    "The speed this flywheel waits at between shots. 0 means no idling: the wheels spin all the way down.",
  "profile:dwellTime_ms":
    "How long the flywheels stay at full speed after a shot before idling down, ready for a quick follow-up.",
  "profile:idleTime_ms":
    "After the dwell, how long the flywheels stay at idle RPM before stopping. 0 stops them as soon as the dwell ends.",
  "profile:spindownSpeed":
    "How quickly the flywheels may slow down once idling starts. Higher spins down faster.",
  "profile:revSafetyTimeout_ms":
    "Idles the flywheels if Rev is held this long without a shot, so they are not left spinning by accident. 0 turns it off.",
  "device:firingRPMTolerance":
    "How far below the target a motor may be and still count as at speed: checked as the wheels spin up, and again before the first shot of each trigger press. Larger fires sooner into the spin-up.",
  "device:minFiringRPM":
    "A floor under the at-speed point, so a low target cannot let a shot go at a uselessly low RPM. 0 removes it.",
  "device:speedPotMinRPM":
    "Stage 1's rev RPM with the speed pot turned all the way down. Never below Min Firing RPM plus the smaller of the Firing RPM Tol and 1000 RPM, so the wheels can always reach firing speed.",
  "device:speedPotMaxRPM": "Stage 1's rev RPM with the speed pot turned all the way up.",
  "profile:speedPotStage2Ratio":
    "With a speed pot, stage 2's rev RPM as a multiple of stage 1's: 1.2 spins stage 2 20% faster. A single-stage blaster ignores it.",
  "device:speedPotReversed":
    "On if the pot reads lower as it is turned up, so turning it up still means faster.",
  "device:rampupTimeout_ms":
    "If the flywheels are not at speed this long after a rev starts, the rev gives up and drops back to idle. Plasma is exempt.",
  "device:variableFPS":
    "With a switch or encoder select fire, the selector's position at power-on picks the profile, so one switch sets the FPS.",
  "device:defaultProfileIndex":
    "The profile used at power-on when Variable FPS is on and no select line is grounded, and by any position left on Default.",
  "device:switchPositionProfile[*]":
    "The profile this select-switch or encoder position loads at power-on, when Variable FPS is on. Default uses the Default Profile.",
  "profile:name": "A name for this profile, shown wherever the blaster lists its profiles.",

  // Motors and PID
  "device:motorConfig[*].enabled":
    "Whether this motor channel is wired and used. A disabled motor is ignored everywhere, including when RPM ranges are worked out.",
  "device:motorConfig[*].stage":
    "Which flywheel stage this motor belongs to, for Stage RPM Mode and the home screen's RPM readout.",
  "device:motorConfig[*].kp": "Proportional gain of this motor's speed control. There is no D term.",
  "device:motorConfig[*].ki": "Integral gain of this motor's speed control. There is no D term.",
  "device:motorConfig[*].motorPolesDiv2":
    "Half the motor's magnetic pole count, which converts the ESC's electrical RPM to real RPM.",
  "device:motorConfig[*].motorKv":
    "The motor's Kv, in RPM per volt, from its spec sheet. With Battery Type it sets the limits of every RPM field for this motor.",
  "device:flywheelControl":
    "How the flywheels are held at their target RPM. PID is the standard choice; TBH (take-back-half) is an alternative.",
  "device:EMAFilter":
    "Smoothing on the RPM readings PID works from. Higher smooths more noise but reacts more slowly to real changes.",
  "device:iThreshold": "The PID integral term's tuning threshold.",
  "device:throttleCap":
    "Extra throttle TBH allows on the first rev, before its own feedback takes over.",
  "device:dshotMode": "The DShot rate the ESCs are driven at. Every ESC must support the rate chosen.",
  "device:useRpmLogging":
    "Records RPM against time on every rev, for the RPM Log tab. The blaster reboots after each capture, so turn it off for normal use.",
  "device:rpmLogLength": "How many samples a capture takes, one per millisecond, so 2000 is two seconds.",

  // Solenoid and pusher
  "device:pusherType":
    "Solenoid applies the voltage-compensated extend times below. None leaves them out.",
  "device:pusherReverseDirection": "Flips the pusher motor's direction, for a motor wired backwards.",
  "device:dartSensing":
    "The pusher only pushes when the dart switch shows a dart, a new one each time, and pulls back as soon as that dart has gone. It never pushes an empty breech or the same dart twice.",
  "device:minPushTime_ms":
    "How long each push ignores the dart switch, since the pusher's jolt can make a dart look gone for a moment. After it, the pusher pulls back as soon as the switch reads empty. The extend time is still the longest a push lasts: set this at or above it to always push for the full time.",
  "device:dartWaitTimeout_ms":
    "How long a queued shot waits for a dart to arrive. When it runs out, the queued shots are dropped and the wheels follow the rev switch again.",
  "device:dartSwitchDebounce_ms":
    "How long the dart switch must show a dart without a break before it counts, for Dart Sensing and Rev Only With Dart alike. Higher rides out bounce and sensor noise; lower lets a dart fire sooner after it arrives.",
  "device:revOnlyWithDart":
    "A rev, from the rev switch or a trigger pull, only starts with a dart in the breech. Once the wheels are up, an empty breech doesn't stop them: they follow the rev switch as usual.",
  "device:pusherDebounceTime_ms": "Debounce for the pusher's own cycle-detection switch.",
  "device:solenoidRetractTime_ms":
    "How long the pusher takes to retract before the next shot. With the extend time, or Min Push while Dart Sensing is on, it sets the highest DPS any mode can reach.",
  "device:solenoidExtendTimeHigh_ms":
    "How long the solenoid stays extended with the battery at the High V Threshold. With Dart Sensing on, it is the longest a push lasts: the pusher pulls back sooner once the dart has gone.",
  "device:solenoidExtendTimeHighVoltage_mv":
    "The battery voltage the High V extend time is set for. The extend time follows a straight line through the two thresholds and carries on along it beyond them, rather than stopping at either time.",
  "device:solenoidExtendTimeLow_ms":
    "How long the solenoid stays extended with the battery at the Low V Threshold, usually longer than at High V so the push stays consistent as the battery sags. With Dart Sensing on, it is the longest a push lasts.",
  "device:solenoidExtendTimeLowVoltage_mv":
    "The battery voltage the Low V extend time is set for. With no battery pin wired, the firmware assumes 3.5 V a cell: set the two extend times equal, and the push lasts the same at any voltage.",
  "device:vibrationPulseMs":
    "Length of the buzz Plasma gives for an armed dart or an overheat. Keep it short: it is meant to be felt, not to move a dart. 0 turns it off.",
  "device:pusherDrive":
    "Whether the pusher is driven by a FET or by one of the ESC channels. It depends on how your blaster is built, not only the board.",
  "device:pusherEscChannel":
    "Which ESC channel drives the pusher. That channel is then not available as a flywheel motor.",

  // Battery
  "device:batteryType":
    "Your pack's cell count. It scales the per-cell voltages below and sets every motor's RPM ceiling.",
  "device:lowVoltageCutoffPerCell_mv":
    "Below this voltage per cell the blaster refuses to spin up, to protect the pack.",
  "device:lowVoltageWarningPerCell_mv":
    "An earlier warning: LOW BATT blinks on the home screen, but you can still fire. Set it above the cutoff.",
  "device:voltageCalibrationFactor":
    "A correction for when the blaster's battery reading does not match a multimeter.",
  "device:voltageAveragingWindow":
    "How many battery readings are averaged. Higher steadies a jittery reading but reacts more slowly to a real drop.",

  // Wiring
  "device:boardId":
    "The board preset this wiring came from. For reference only: the blaster keeps it but never acts on it.",
  "device:wiringConfigured": "The master switch. Until it is on, the blaster drives no pins at all.",
  "device:escPins[*]": "The pin this motor's ESC signal wire is on.",
  "device:i2cSdaPin":
    "The data pin of the screen's I2C bus. SDA and SCL must be a pair the RP2040 can use together.",
  "device:i2cSclPin":
    "The clock pin of the screen's I2C bus. SDA and SCL must be a pair the RP2040 can use together.",
  "device:batteryAdcPin": "The analog pin, GPIO 26 to 29, that reads the battery voltage divider.",
  "device:dartSwitchPin":
    "The pin of a switch or sensor that sees a dart sitting in the breech, ready to be pushed.",
  "device:dartSwitchNormallyClosed":
    "On if the dart switch opens, rather than closes to ground, when a dart is in the breech.",
  "device:speedPotPin":
    "The analog pin, GPIO 26 to 29, that reads a speed pot's wiper. With one wired, the pot sets the rev RPM in place of the profile's own.",
  "device:escEnablePin":
    "A pin that switches the ESCs' power on once the blaster boots, and off if the battery drops below the cutoff. Only for boards with that circuit.",
  "device:pusherFetPin": "The pin that switches the solenoid's FET.",
  "device:ledDataPin": "The status LED's data pin.",
  "device:triggerSwitchPin": "The pin the trigger switch is wired to.",
  "device:revSwitchPin": "The pin the rev switch is wired to.",
  "device:menuButtonPin": "The pin the menu button is wired to.",
  "device:cycleSwitchPin":
    "The pin of the pusher's cycle switch, which tells a motor-driven pusher it has completed a stroke.",
  "device:idleSwitchPin":
    "The pin of the idle switch. While it is on, the flywheels wait at idle RPM instead of stopping.",
  "device:safetySwitchPin":
    "The pin of the safety switch. While it is engaged the blaster is in SAFE: no rev, no fire.",
  "device:select0Pin":
    "A select-switch pin. With a switch-type select fire each wired select pin is one switch position; with a button type, this one is the button.",
  "device:select1Pin":
    "A select-switch pin. With a switch-type select fire, each wired select pin is one switch position.",
  "device:select2Pin":
    "A select-switch pin. With a switch-type select fire, each wired select pin is one switch position.",
  "device:triggerSwitchNormallyClosed": "On for a switch that rests closed and opens when pressed.",
  "device:revSwitchNormallyClosed": "On for a switch that rests closed and opens when pressed.",
  "device:menuButtonNormallyClosed": "On for a button that rests closed and opens when pressed.",
  "device:cycleSwitchNormallyClosed": "On for a switch that rests closed and opens when pressed.",
  "device:idleSwitchNormallyClosed": "On for a switch that rests closed and opens when pressed.",
  "device:safetySwitchNormallyClosed": "On for a switch that rests closed and opens when pressed.",
  "device:bootAction[*]":
    "What holding this switch while the blaster powers on does. A restart from the menu or the console ignores it.",

  // Device and display
  "device:blasterName": "Shown on the home screen and the About screen.",
  "device:homeScreenDisplayMode":
    "Counter: a big shot counter. Fire Mode: the mode's name over its own animation. Both: the name over a smaller counter.",
  "device:showCurrentRpmOnHomeScreen":
    "Adds each flywheel's live RPM to the home screen, grouped by stage.",
  "device:showDpsOnHomeScreen":
    "Adds a real/set darts-per-second line, where real is measured from one extend to the next.",
  "device:displayBrightness":
    "Screen brightness. Some OLED panels change only a little, which is the panel rather than a fault.",
  "device:rotateDisplay": "Turns the screen upside down, for a board mounted the other way up.",
  "device:hasDisplay": "Whether this blaster has an OLED screen at all.",
  "device:ledWarningMode": "Which battery condition blinks the status LED.",
  "device:dualStageTrigger":
    "The trigger's two contact stages replace a separate rev switch: a light press revs, a full press fires. Plasma ignores the rev stage.",
  "device:debounceTime_ms":
    "Debounce for the trigger, rev, select and menu switches. Lower catches fast double-taps; higher is steadier against switch bounce.",
  "device:menuButtonHoldTime_ms":
    "How long the menu button must be held to count as a hold, which opens the menu or goes back, rather than a short press.",
  "device:useRpmBaseShotCounter":
    "On: a shot counts only when a sustained RPM dip is seen. Off: every pusher extend counts, whatever the RPM.",
  "device:goodRpmShotReads":
    "How many low RPM readings in a row count as a real shot rather than noise.",
  "device:rpmDropThreshold": "How far below the target RPM a reading must fall to look like a shot.",
};

/** By the id the schema publishes for each firing mode, shown under it in the mode list. */
export const FIRE_MODE_HELP: Record<string, string> = {
  auto: "Fires while the trigger is held, up to Burst Length.",
  burst: "A fixed number of darts per pull.",
  binary: "Fires on the press, and again on the release if it comes within Binary Timeout.",
  safe: "Ignores the trigger entirely.",
  semi: "One dart per pull.",
  devotion: "Fires like Auto, but the rate climbs the longer you hold.",
  plasma: "A charge-up shot: holding the trigger arms up to three darts. Held too long, it overheats.",
};

const anyIndex = (key: string) => key.replace(/\[\d+\]/g, "[*]");

export function helpFor(key: string | undefined): string | undefined {
  return key === undefined ? undefined : SETTING_HELP[anyIndex(key)];
}

/** A line under one option of a list, where a list's options need one. */
export function optionHelpFor(key: string | undefined, option: unknown): string | undefined {
  if (key === undefined || anyIndex(key) !== "profile:fireModes[*].burstMode") return undefined;
  return typeof option === "string" ? FIRE_MODE_HELP[option] : undefined;
}
