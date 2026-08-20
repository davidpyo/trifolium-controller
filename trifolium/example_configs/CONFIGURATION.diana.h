#pragma once
#include "motor.h"
#include "boards_config.h" // board pinouts are in this file
#include "runtimeSettings.h"
#include "deviceSettings.h"

// config to check config and code versions match
#define CONFIG_VERSION_MAJOR 2
#define CONFIG_VERSION_MINOR 0
#define CONFIG_VERSION_PATCH 0

inline dshot_min_delay_t targetLoopTime_us = DSHOT_MIN_DELAY_300;

inline boards_t board = diana_v1_0; // select the one that matches your board revision
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

// Factory defaults - ProfileStore/DeviceStore fall back to these on a missing/corrupt file.
inline const RuntimeSettings kDefaultProfile = {
    .motors = {true, true, false, false},

    .variableFPS = true,
    .revRPMset = {{50000, 50000, 0, 0}, {50000, 50000, 0, 0}, {50000, 50000, 0, 0}},
    .dwellTimeSet_ms = {500, 500, 500},
    .idleTimeSet_ms = {0, 0, 0},
    .spindownSpeed = 100,
    .idleRPM = {300, 300, 0, 0},
    .revSafetyTimeout_ms = 300000, // 5 minutes

    .motorStage = {STAGE_1, STAGE_1, STAGE_1, STAGE_1},
    .rpmMode = RPM_STAGE,

    .flywheelControl = PID_CONTROL,
    .firingRPMTolerance = 500,
    .minFiringRPM = 10000,
    .rampupTimeout_ms = 500,

    .EMAFilter = 2,
    .iThreshold = 50,
    .throttleCap = 300,

    .KP = {0.1f, 0.1f, 0.1f, 0.1f},
    .KI = {0.2f, 0.2f, 0.2f, 0.2f},
    .KD = {0, 0, 0, 0},
    .motorPolesDiv2 = {6, 6, 6, 6},
    .motorKv = {4800, 4800, 4800, 4800},

    .burstLengthSet = {1, 100, 0},
    .burstModeSet = {BURST, AUTO, SAFE},
    .fireModeStrings = {"SEMI", "AUTO", "SAFE"},
    .binaryTriggerTimeout_ms = 2000,
    .selectFireType = SWITCH_SELECT_FIRE,
    .defaultFiringMode = 1,

    .batteryType = BATTERY_4S,
    .lowVoltageCutoffPerCell_mv = 3500,
    .lowVoltageWarningPerCell_mv = 3800,
    .voltageCalibrationFactor = 1.0f,

    .solenoidExtendTimeHigh_ms = 15,
    .solenoidExtendTimeHighVoltage_mv = 16800,
    .solenoidExtendTimeLow_ms = 20,
    .solenoidExtendTimeLowVoltage_mv = 11800,
    .solenoidRetractTime_ms = 20,

    .targetDPS = 15.0f,
    .autoTiming = false,
};

inline const DeviceSettings kDefaultDeviceSettings = {
    .hasDisplay = false,
    .rotateDisplay = true,
    .blasterName = "Diana",

    .menuButtonPin = PIN_NOT_USED,
    .triggerSwitchPin = board.IO1,
    .revSwitchPin = PIN_NOT_USED,
    .cycleSwitchPin = PIN_NOT_USED,
    .idleSwitchPin = board.IO2,
    .select0Pin = board.IO3,
    .select1Pin = board.IO4,
    .select2Pin = board.IO5,

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
    .homeScreenDisplayMode = HOME_COUNTER,
    .showDpsOnHomeScreen = false,

    .maxRpmCap = 50000,

    .ledWarningMode = LED_WARNING_LOW_BATT,

    .dshotMode = DSHOT300,
    .printTelemetry = false,

    .useRpmLogging = false,
    .rpmLogLength = MAX_RPM_LOG_LENGTH,
};
