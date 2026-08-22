#pragma once
#include <Arduino.h>
#include "types.h"

struct FireModeConfig
{
    String name; // empty = no override, show effectiveName() instead
    uint32_t burstLength;
    burstFireType_t burstMode;
    float targetDPS; // <= 0 means "no auto dwell padding"

    String effectiveName() const
    {
        return name.length() ? name : String(defaultBurstModeName(burstMode));
    }

    uint32_t effectiveBurstLength() const { return burstMode == SEMI ? 1 : burstLength; }
};

struct ShotProfile
{
    String name; // "Low" / "Medium" / "High" defaults, user-renameable

    // RPM/timing - flat, one set per profile
    int32_t revRPM[4];
    uint32_t dwellTime_ms;
    uint32_t idleTime_ms;
    int32_t idleRPM[4];
    uint32_t spindownSpeed;
    uint32_t revSafetyTimeout_ms; // max time held revved with no shot fired before auto-idling; 0
                                  // disables
    rpmModeType_t rpmMode;

    // Select-fire, indexed by firingMode 0-2
    FireModeConfig fireModes[3];
    uint32_t binaryTriggerTimeout_ms;
    uint8_t defaultFiringMode;
};
