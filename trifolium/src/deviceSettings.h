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
    bool hasDisplay;
    bool rotateDisplay;
    String blasterName;

    uint8_t menuButtonPin;
    uint8_t triggerSwitchPin;
    uint8_t revSwitchPin;
    uint8_t cycleSwitchPin;
    uint8_t idleSwitchPin; // holds flywheels at idle RPM manually, instead of the dwell/idle timers
    uint8_t select0Pin;
    uint8_t select1Pin;
    uint8_t select2Pin;

    bool revSwitchNormallyClosed;
    bool triggerSwitchNormallyClosed;
    bool cycleSwitchNormallyClosed;
    bool idleSwitchNormallyClosed;
    bool menuButtonNormallyClosed;
    bool pusherReverseDirection;

    bool dualStageTrigger;

    pusherType_t pusherType;

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

    ledWarningMode_t ledWarningMode; // what battery condition blinks board.LED_DATA, if present

    dshot_mode_t dshotMode; // reboot-required, read once at boot
    bool printTelemetry;    // gates print()/logger.* calls (logging.h)

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
