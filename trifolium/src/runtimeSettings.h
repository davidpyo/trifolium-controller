#pragma once
#include <Arduino.h>
#include "types.h"

struct RuntimeSettings
{
    bool motors[4];

    // Flywheel / RPM
    bool variableFPS;
    int32_t revRPMset[3][4];
    uint32_t dwellTimeSet_ms[3];
    uint32_t idleTimeSet_ms[3];
    uint32_t spindownSpeed;
    int32_t idleRPM[4];
    uint32_t revSafetyTimeout_ms; // max time held revved with no shot fired before auto-idling; 0
                                  // disables

    // Which flywheel stage each motor belongs to - shared across all 3 RPM profiles.
    motorStage_t motorStage[4];
    rpmModeType_t rpmMode[3];
    uint16_t stageRatioPercent[3];
    int32_t stage2Rpm[3];

    // Closed loop
    flywheelControlType_t flywheelControl;
    int32_t firingRPMTolerance;
    int32_t minFiringRPM;
    uint32_t rampupTimeout_ms; // abort to idle if flywheels don't reach firingRPM within this long

    // PID / TBH
    uint8_t EMAFilter;
    uint8_t iThreshold;
    uint16_t throttleCap;

    // Motor gains - one slot per motorArr[]/motorsObj[] index.
    float KP[4];
    float KI[4];
    float KD[4];
    int16_t motorPolesDiv2[4];
    int32_t motorKv[4];

    // Select-fire
    uint32_t burstLengthSet[3];
    burstFireType_t burstModeSet[3];
    String fireModeStrings[3]; // display names for firingMode 0/1/2
    uint32_t binaryTriggerTimeout_ms;
    selectFireType_t selectFireType;
    uint8_t defaultFiringMode;

    // Battery
    batteryType_t batteryType;
    uint32_t lowVoltageCutoffPerCell_mv;  // per-cell mV cutoff
    uint32_t lowVoltageWarningPerCell_mv; // non-cutoff warning threshold, above the cutoff
    float voltageCalibrationFactor;

    // Solenoid
    uint16_t solenoidExtendTimeHigh_ms;
    uint32_t solenoidExtendTimeHighVoltage_mv;
    uint16_t solenoidExtendTimeLow_ms;
    uint32_t solenoidExtendTimeLowVoltage_mv;
    uint16_t solenoidRetractTime_ms;

    // Auto Timing: dials a target rate of fire by padding the extend/retract cycle instead of
    // hand-tuning the fields above.
    float targetDPS;
    bool autoTiming;
};
