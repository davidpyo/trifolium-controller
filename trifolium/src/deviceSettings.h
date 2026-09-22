#pragma once
#include <Arduino.h>
#include "types.h"

struct MotorConfig
{
    bool enabled;
    motorStage_t stage;
    float kp;
    float ki;
    int32_t motorKv;
    int16_t motorPolesDiv2;
};

struct DeviceSettings
{
    // Which preset this wiring came from, or "". Provenance only: never interpreted here.
    String boardId;

    // The boot gate. False means no pinMode() call is made anywhere - see runUnconfiguredBoot().
    // An explicit flag rather than "boardId is set", because boardId is unvalidated provenance: a
    // preset naming a board would otherwise arm a device whose pins are nonsense.
    bool wiringConfigured;

    // Every one of these is a GPIO somebody chose, so each is checked by the conflict engine
    // (pinConflicts.h) and by the capability layer (pinCapabilities.h) rather than trusted.
    uint8_t escPins[4];    // the four flywheel DShot channels; any GPIO is legal (PIO)
    uint8_t i2cSdaPin;     // the display bus. The pair's block is derived, not stored - a GPIO's
    uint8_t i2cSclPin;     // I2C role is fixed by pin % 4, so storing it would be a second answer.
    uint8_t batteryAdcPin; // GPIO 26-29 only; anything else folds to unused
    uint8_t escEnablePin;  // driven LOW at boot and by the low-voltage cutoff, to kill ESC power

    bool hasDisplay;
    bool rotateDisplay;
    String blasterName;

    uint8_t menuButtonPin;
    uint8_t triggerSwitchPin;
    uint8_t revSwitchPin;
    uint8_t cycleSwitchPin;
    uint8_t idleSwitchPin; // holds flywheels at idle RPM manually, instead of the dwell/idle timers
    uint8_t safetySwitchPin; // engaged, it forces the effective firing mode to SAFE
    uint8_t select0Pin;
    uint8_t select1Pin;
    uint8_t select2Pin;

    bool revSwitchNormallyClosed;
    bool triggerSwitchNormallyClosed;
    bool cycleSwitchNormallyClosed;
    bool idleSwitchNormallyClosed;
    bool safetySwitchNormallyClosed;
    bool menuButtonNormallyClosed;
    bool pusherReverseDirection;

    bool dualStageTrigger;

    // What each switch does when held at power-on, indexed by bootButton_t. Evaluated once per
    // power-on cycle by evaluateBootAction() in main.cpp.
    bootAction_t bootAction[BOOT_BTN_COUNT];

    pusherType_t pusherType;

    // Which of the two is read follows pusherDrive; the other is kept, not cleared, so flipping the
    // driver back finds the pin still there.
    pusherDrive_t pusherDrive;
    uint8_t pusherFetPin;           // PUSHER_DRIVE_FET: the gate pin
    escChannel_t pusherEscChannel;  // PUSHER_DRIVE_ESC: which of the four channels.

    // Where a status LED is wired, or PIN_NOT_USED. ledWarningMode's visibility follows it.
    uint8_t ledDataPin;

    uint16_t debounceTime_ms;
    uint32_t menuButtonHoldTime_ms;
    uint16_t pusherDebounceTime_ms;
    int voltageAveragingWindow;

    bool useRpmBaseShotCounter; // if true, shot counter increases based on detected rpm drop,
                                // otherwise increases based on pusher cycles
    uint16_t goodRpmShotReads;  // number of good rpm reads below threshold to count as a shot
    uint16_t rpmDropThreshold;  // rpm drop to count as a shot

    uint8_t displayBrightness;       // 0-255, applied via a raw SETCONTRAST I2C write
    bool showCurrentRpmOnHomeScreen; // home screen shows live motorRPM instead of target revRPM
    homeScreenDisplayMode_t homeScreenDisplayMode; // Counter / Fire Mode / Both - see types.h
    bool showDpsOnHomeScreen; // adds a 3rd line under the live-RPM column: real/set DPS

    ledWarningMode_t ledWarningMode; // what battery condition blinks ledDataPin, if one is wired

    dshot_mode_t dshotMode; // reboot-required, read once at boot
    bool printTelemetry;    // gates logger.warn/info; error/fatal always print (logging.h)

    bool useRpmLogging;
    uint32_t rpmLogLength; // clamped to MAX_RPM_LOG_LENGTH on load

    MotorConfig motorConfig[4];

    flywheelControlType_t flywheelControl;
    int32_t firingRPMTolerance;
    int32_t minFiringRPM;
    uint32_t rampupTimeout_ms;
    uint8_t EMAFilter;
    uint16_t iThreshold;
    uint16_t throttleCap;

    // Solenoid timing
    uint16_t solenoidExtendTimeHigh_ms;
    uint32_t solenoidExtendTimeHighVoltage_mv;
    uint16_t solenoidExtendTimeLow_ms;
    uint32_t solenoidExtendTimeLowVoltage_mv;
    uint16_t solenoidRetractTime_ms;
    uint16_t vibrationPulseMs;

    // Battery
    batteryType_t batteryType;
    uint32_t lowVoltageCutoffPerCell_mv;
    uint32_t lowVoltageWarningPerCell_mv;
    float voltageCalibrationFactor;

    // Select-fire hardware wiring + physical-switch feature toggle
    selectFireType_t selectFireType;
    bool variableFPS;
    uint8_t defaultProfileIndex; // used at boot when no select-switch position is active
};
