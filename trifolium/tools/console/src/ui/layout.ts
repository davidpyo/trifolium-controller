// Curated presentation grouping for the config form.
//
// A deliberate change of stance, worth stating plainly: the schema remains the single source of
// truth for which fields exist, what they are called, and what values they accept. This file owns
// only *presentation* - what order sections appear in and which section a field is shown under.
//
// It exists because the firmware tree is shaped by the OLED's navigation, not by how someone thinks
// about a blaster. Shot-counter settings sit next to display brightness under "Device" because that
// is where they fit in a scrolling list, and the four motors are four submenus because a 128x64
// screen cannot show them side by side.
//
// The rule that keeps this honest: anything not claimed below still renders, in a trailing section.
// A field added in firmware can never silently disappear from the console because this file did not
// know about it.

/**
 * Fields the layout claims and deliberately does not render, because another component owns them.
 *
 * The trailing-section promise is that nothing added in firmware can silently disappear. A field
 * shown somewhere better would otherwise turn up twice - once where it belongs and once in "Other
 * settings" - so it is claimed here instead, with the place it went written down.
 */
export const RENDERED_ELSEWHERE: Record<string, string> = {
  "device:blasterName": "the header, next to the pencil",
  // Arming a capture and setting its length are the first two things you do on the RPM Log tab,
  // and they were two tabs away from the chart they govern. They live there now, next to the
  // buttons that read the result - not duplicated, moved.
  "device:useRpmLogging": "the RPM Log tab",
  "device:rpmLogLength": "the RPM Log tab",
  "device:boardId": "the header - provenance, and the preset picker beside it",
  // The boot gate rather than a pin, and the picker and the custom path are the two things
  // that set it. Rendered in the Wiring table's own footer, where what it arms is visible.
  "device:wiringConfigured": "the Wiring table footer",
  // Only read when variableFPS is on and select-fire is SWITCH - selectShotProfileAtBoot()
  // reaches it from no other branch - which is exactly when the Selector Switch editor renders.
  // On the Device tab it showed unconditionally and did nothing most of the time.
  "device:defaultProfileIndex": "the Selector Switch editor, on the none row",
  "profile:name": "the profile bar, beside the slot picker",
  // The RPM editor renders these in both modes - four per-motor rows, or one row per stage that
  // writes every enabled motor in it. The firmware's own stage rows are `derived` and keyless, so
  // the generic form had nothing to show in stage mode and these were the only real fields.
  "profile:revRPM[0]": "the RPM editor",
  "profile:revRPM[1]": "the RPM editor",
  "profile:revRPM[2]": "the RPM editor",
  "profile:revRPM[3]": "the RPM editor",
  "profile:idleRPM[0]": "the RPM editor",
  "profile:idleRPM[1]": "the RPM editor",
  "profile:idleRPM[2]": "the RPM editor",
  "profile:idleRPM[3]": "the RPM editor",
};

export interface SectionSpec {
  label: string;
  /** Field keys, in the order they should appear. */
  keys: string[];
  /** Also absorb every remaining field from these schema sections, after the keyed ones. */
  absorb?: string[];
}

/**
 * Device settings, in the order asked for: identity first, then the things you tune most, then
 * hardware wiring, then presentation.
 */
export const DEVICE_LAYOUT: SectionSpec[] = [
  { label: "Motors & PID", keys: [], absorb: ["Motors & PID"] },
  {
    label: "Flywheel / RPM",
    keys: ["device:firingRPMTolerance", "device:minFiringRPM", "device:rampupTimeout_ms"],
  },
  {
    // Named keys first, then everything else the firmware groups here. These five apply whatever
    // pusher is fitted; the extend-time rows that absorb in below them are solenoid-only, and the
    // firmware hides them on any other type. Same order as solenoidItems[] in menuSolenoid.cpp, so
    // the panel and this page read alike.
    label: "Solenoid / Pusher",
    keys: [
      // How the pusher is driven leads what it is: the ESC-channel row below is shown or hidden by
      // this one, and both were board identity until MOH-17. The two pins they select are wiring,
      // so they live in the Wiring table instead.
      "device:pusherDrive",
      "device:pusherEscChannel",
      "device:pusherType",
      "device:pusherReverseDirection",
      "device:pusherDebounceTime_ms",
      "device:solenoidRetractTime_ms",
      "device:vibrationPulseMs",
    ],
    absorb: ["Solenoid / Pusher"],
  },
  {
    // New grouping. Alternative shot-detection schemes would land here rather than under Device.
    label: "Shot Counter",
    keys: ["device:useRpmBaseShotCounter", "device:goodRpmShotReads", "device:rpmDropThreshold"],
  },
  {
    label: "Battery",
    keys: [
      "device:batteryType",
      "device:lowVoltageCutoffPerCell_mv",
      "device:lowVoltageWarningPerCell_mv",
      "device:voltageCalibrationFactor",
      // Moved here from Device: it is the averaging window for the voltage reading, so it belongs
      // with the thresholds it smooths rather than with unrelated device options.
      "device:voltageAveragingWindow",
    ],
  },
  {
    // Everything about the physical switches and how the firmware reads them.
    label: "Switch Settings",
    keys: [
      "device:selectFireType",
      "device:variableFPS",
      "device:dualStageTrigger",
      "device:debounceTime_ms",
      "device:menuButtonHoldTime_ms",
    ],
  },
  {
    label: "Display",
    keys: [
      "device:hasDisplay",
      "device:homeScreenDisplayMode",
      "device:showCurrentRpmOnHomeScreen",
      "device:showDpsOnHomeScreen",
      "device:displayBrightness",
      "device:rotateDisplay",
      "device:ledWarningMode",
    ],
  },
  {
    // The nine switch pins and the six resting-state flags. Claimed rather than left to the
    // trailing section because the firmware groups them deliberately - a switch's pin and whether
    // it is normally closed are one fact about one switch - and "Other settings" throws that away.
    //
    // Last, because it is the longest section and the one a user touches least once their board is
    // wired - and because the I2C pair in it follows Display Attached above, so the thing that
    // governs those two rows is now read before them.
    //
    // Pins first in the order the conflict engine resolves them, which is the order menuDevice.cpp
    // declares them in, so a banner naming a loser reads against the same list. Polarities after,
    // rather than interleaved, so the pin numbers can be read down a column.
    label: "Wiring",
    keys: [
      // First, the order the firmware's conflict engine resolves them in: a detached safety
      // switch reads as disengaged, so it outranks everything else for a contested GPIO.
      "device:safetySwitchPin",
      "device:triggerSwitchPin",
      "device:revSwitchPin",
      "device:menuButtonPin",
      "device:cycleSwitchPin",
      "device:idleSwitchPin",
      "device:select0Pin",
      "device:select1Pin",
      "device:select2Pin",
      // Outputs rather than switches, so they have no polarity row and no boot action - but they
      // are pins, WiringTable finds them by display:"pin" on its own, and claiming them here is
      // what keeps them from also falling through into the trailing section.
      "device:pusherFetPin",
      "device:ledDataPin",
      // Claimed here for the same reason as the rest: WiringTable finds them by display:"pin" on
      // its own, and this keeps them from also falling through into the trailing section.
      "device:escPins[0]",
      "device:escPins[1]",
      "device:escPins[2]",
      "device:escPins[3]",
      "device:i2cSdaPin",
      "device:i2cSclPin",
      "device:batteryAdcPin",
      "device:escEnablePin",
      "device:triggerSwitchNormallyClosed",
      "device:revSwitchNormallyClosed",
      "device:menuButtonNormallyClosed",
      "device:cycleSwitchNormallyClosed",
      "device:idleSwitchNormallyClosed",
      "device:safetySwitchNormallyClosed",
      // Boot actions are not wiring, but they are indexed by these same eight controls, so the
      // table gives each one a column rather than leaving them as eight unattached enums. Claimed
      // here so they do not also fall through into the trailing section - WiringTable finds its own
      // nodes in the schema, so the order in this list is not what it renders.
      "device:bootAction[0]",
      "device:bootAction[1]",
      "device:bootAction[2]",
      "device:bootAction[3]",
      "device:bootAction[4]",
      "device:bootAction[5]",
      "device:bootAction[6]",
      "device:bootAction[7]",
    ],
  },
];

/** Profile settings. Fire modes are rendered by their own component, not from this list. */
export const PROFILE_LAYOUT: SectionSpec[] = [
  {
    // These five hold whichever RPM Mode is selected - they are the shape of the rev, not of one
    // way of spelling its targets - so they lead, and the per-motor or per-stage editor follows
    // below them. Named rather than absorbed so the order is the order, not the firmware's.
    label: "RPM & Timing",
    keys: [
      "profile:rpmMode",
      "profile:dwellTime_ms",
      "profile:idleTime_ms",
      "profile:spindownSpeed",
      "profile:revSafetyTimeout_ms",
    ],
    absorb: ["Flywheel / RPM"],
  },
  { label: "Selector Switch", keys: [], absorb: ["Select-Fire"] },
];

/** Label for whatever the layout did not claim, so nothing is ever silently dropped. */
export const FALLTHROUGH_LABEL = "Other settings";
