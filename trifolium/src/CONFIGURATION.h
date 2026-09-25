#pragma once
#include "motor.h"
#include "shotProfile.h"
#include "deviceSettings.h"

// Build-time check that this file matches what main.cpp expects. Unrelated to the store schema
// versions, which version the persisted flash JSON at runtime.
#define CONFIG_VERSION_MAJOR 2
#define CONFIG_VERSION_MINOR 1
#define CONFIG_VERSION_PATCH 0

inline uint32_t targetLoopTime_us = 1000;

// No wiring here. A board is a wiring preset: every pin is a stored setting, and each
// trifolium/boards/<id>/board.json is a LOAD_DEVICE payload as it stands.
//
//     python tools/send_serial.py COM8 LOAD_DEVICE boards/trifolium_v1_2/board.json
//
// What remains below is the defaults that are not wiring: tuning, timings, thresholds.

// Debug settings
inline bool printTelemetry = false; // output printing - mirrors deviceSettings.printTelemetry

// RPM logging is controlled by deviceSettings.useRpmLogging/rpmLogLength (Serial-only)
inline const uint32_t MAX_RPM_LOG_LENGTH = 2000;

inline const char* const kDefaultProfileNames[3] = {"Low", "Medium", "High"};

// Factory defaults - ProfileStore/DeviceStore fall back to these on a missing/corrupt file.
inline const ShotProfile kDefaultProfile = {
    .name = "",

    .revRPM = {30000, 30000, 30000, 30000},
    .dwellTime_ms = 1000,
    .idleTime_ms = 0,
    .idleRPM = {1000, 1000, 1000, 1000},
    .spindownSpeed = 100,
    .revSafetyTimeout_ms = 0, // disabled
    .rpmMode = RPM_STAGE,

    .fireModes =
        {
            fireMode(100, AUTO, 15.0f),
            fireMode(1, BINARY, 15.0f),
            fireMode(1, SEMI, 15.0f),
        },
    .activeModeCount = 3,
    .defaultFiringMode = 1,
    .switchPositionAssignment = {0, 1, 2},
};

inline const DeviceSettings kDefaultDeviceSettings = {
    // Unwired, and this is what makes it so: wiringConfigured false means no pinMode call is made
    // anywhere, so a device with no stored config drives nothing at all. Load a preset to arm it.
    .boardId = "",
    .wiringConfigured = false,

    .escPins = {PIN_NOT_USED, PIN_NOT_USED, PIN_NOT_USED, PIN_NOT_USED},
    .i2cSdaPin = PIN_NOT_USED,
    .i2cSclPin = PIN_NOT_USED,
    .batteryAdcPin = PIN_NOT_USED,
    .escEnablePin = PIN_NOT_USED,

    .hasDisplay = true,
    .rotateDisplay = true,
    .blasterName = "example",

    .menuButtonPin = PIN_NOT_USED,
    .triggerSwitchPin = PIN_NOT_USED,
    .revSwitchPin = PIN_NOT_USED,
    .cycleSwitchPin = PIN_NOT_USED,
    .idleSwitchPin = PIN_NOT_USED,
    .safetySwitchPin = PIN_NOT_USED,
    .select0Pin = PIN_NOT_USED,
    .select1Pin = PIN_NOT_USED,
    .select2Pin = PIN_NOT_USED,

    .revSwitchNormallyClosed = false,
    .triggerSwitchNormallyClosed = false,
    .cycleSwitchNormallyClosed = false,
    .idleSwitchNormallyClosed = false,
    .safetySwitchNormallyClosed = false,
    .menuButtonNormallyClosed = false,
    .pusherReverseDirection = false,

    .dualStageTrigger = false,

    // Indexed by bootButton_t: menu or rev held at power-on enters the bootloader, trigger held
    // enters ESC passthrough.
    .bootAction =
        {
            BOOT_ACTION_BOOTLOADER,      // menu
            BOOT_ACTION_ESC_PASSTHROUGH, // trigger
            BOOT_ACTION_BOOTLOADER,      // rev
            BOOT_ACTION_NONE,            // cycle
            BOOT_ACTION_NONE,            // idle
            BOOT_ACTION_NONE,            // select0
            BOOT_ACTION_NONE,            // select1
            BOOT_ACTION_NONE,            // select2
        },

    .pusherType = PUSHER_SOLENOID_OPENLOOP,

    // Not wiring, so they stay here: how the pusher is driven is a fact about a build, and the pin
    // it selects is unwired above until a preset says otherwise.
    .pusherDrive = PUSHER_DRIVE_FET,
    .pusherFetPin = PIN_NOT_USED,

    // esc3 is where every ESC-pusher Trifolium ships, so a config migrating up from schema v2 keeps
    // the pusher on the channel it already used.
    .pusherEscChannel = ESC_CH_3,

    .ledDataPin = PIN_NOT_USED,

    .debounceTime_ms = 20,
    .menuButtonHoldTime_ms = 1500,
    .pusherDebounceTime_ms = 25,
    .voltageAveragingWindow = 5,
    .useRpmBaseShotCounter = true,
    .goodRpmShotReads = 5,
    .rpmDropThreshold = 200,

    .displayBrightness = 255,
    .showCurrentRpmOnHomeScreen = false,
    .homeScreenDisplayMode = HOME_COUNTER, // the plain shot-counter layout
    .showDpsOnHomeScreen = false,

    .ledWarningMode = LED_WARNING_LOW_BATT,

    .dshotMode = DSHOT300,
    .printTelemetry = false,

    .useRpmLogging = false,
    .rpmLogLength = MAX_RPM_LOG_LENGTH,

    .motorConfig =
        {
            {.enabled = false,
             .stage = STAGE_1,
             .kp = 0.2f,
             .ki = 0.5f,
             .motorKv = 3200,
             .motorPolesDiv2 = 7},
            {.enabled = true,
             .stage = STAGE_1,
             .kp = 0.2f,
             .ki = 0.5f,
             .motorKv = 3200,
             .motorPolesDiv2 = 7},
            {.enabled = false,
             .stage = STAGE_1,
             .kp = 0.2f,
             .ki = 0.5f,
             .motorKv = 3200,
             .motorPolesDiv2 = 7},
            {.enabled = true,
             .stage = STAGE_1,
             .kp = 0.2f,
             .ki = 0.5f,
             .motorKv = 3200,
             .motorPolesDiv2 = 7},
        },

    .flywheelControl = PID_CONTROL,
    .firingRPMTolerance = 500,
    .minFiringRPM = 10000,
    .rampupTimeout_ms = 500,
    .EMAFilter = 2,
    .iThreshold = 50,
    .throttleCap = 300,

    .solenoidExtendTimeHigh_ms = 25,
    .solenoidExtendTimeHighVoltage_mv = 16800,
    .solenoidExtendTimeLow_ms = 40,
    .solenoidExtendTimeLowVoltage_mv = 11800,
    .solenoidRetractTime_ms = 30,
    .vibrationPulseMs = 0,

    .batteryType = BATTERY_4S,
    .lowVoltageCutoffPerCell_mv = 3300,
    .lowVoltageWarningPerCell_mv = 3700,
    .voltageCalibrationFactor = 1.0f,

    .selectFireType = SWITCH_SELECT_FIRE,
    .variableFPS = true,
    .defaultProfileIndex = 1, // Medium - used when no select-switch position is active
};
