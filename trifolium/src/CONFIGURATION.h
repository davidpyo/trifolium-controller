#pragma once
#include "motor.h"
#include "boards_config.h" // board pinouts are in this file
#include "shotProfile.h"
#include "deviceSettings.h"

// Build-time check that THIS literal config file matches what main.cpp expects (see the
// #if/#error in main.cpp comparing against global.h's MAJOR_VERSION/MINOR_VERSION/PATCH_VERSION).
// Unrelated to ProfileStore::CURRENT_SCHEMA_VERSION/DeviceStore::CURRENT_SCHEMA_VERSION, which
// version the persisted flash JSON at runtime, not this source file at compile time.
#define CONFIG_VERSION_MAJOR 2
#define CONFIG_VERSION_MINOR 0
#define CONFIG_VERSION_PATCH 1

inline uint32_t targetLoopTime_us = 1000;

inline boards_t board =
    trifolium_v1_2_fet_driver; // select the one that matches your board revision
// Options
// rune_0_2,
// trifolium_v1_4_fet_driver
// trifolium_v1_3_fet_driver
// trifolium_v1_2_esc_driver
// trifolium_v1_2_fet_driver
// trifolium_v1_1_esc_driver
// trifolium_v1_1_fet_driver
// trifolium_v1_0_esc_driver
// trifolium_v1_0_fet_driver
// pico_zero
// pico_zero_diana
// diana_v1_0

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
    .hasDisplay = true,
    .rotateDisplay = true,
    .blasterName = "example",

    .menuButtonPin = board.IO5,
    .triggerSwitchPin = board.IO1,
    .revSwitchPin = board.IO2,
    .cycleSwitchPin = PIN_NOT_USED,
    .idleSwitchPin = PIN_NOT_USED,
    .select0Pin = board.IO3,
    .select1Pin = PIN_NOT_USED,
    .select2Pin = board.IO4,

    .revSwitchNormallyClosed = false,
    .triggerSwitchNormallyClosed = false,
    .cycleSwitchNormallyClosed = false,
    .idleSwitchNormallyClosed = false,
    .menuButtonNormallyClosed = false,
    .pusherReverseDirection = false,

    .dualStageTrigger = false,

    .pusherType = PUSHER_SOLENOID_OPENLOOP,

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
