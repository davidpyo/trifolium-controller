#pragma once
#include <Arduino.h>
#include "types.h"
#include "firingModeBehavior.h"

static constexpr uint8_t MAX_FIRE_MODES = 10;

static constexpr int8_t NO_FIRE_MODE = -1;

struct FireModeConfig
{
    String name; // empty = no override, show effectiveName() instead
    uint32_t burstLength;
    burstFireType_t burstMode;
    float targetDPS; // <= 0 means "no auto dwell padding"
    bool reversible;
    uint32_t binaryTriggerTimeout_ms;
    bool includeInCycle;

    String effectiveName() const
    {
        return name.length() ? name : String(behaviorFor(burstMode).defaultName());
    }
};

// Factory for a CONFIGURATION.h fireModes[] entry
inline FireModeConfig fireMode(uint32_t burstLength, burstFireType_t burstMode, float targetDPS,
                               bool reversible = false, uint32_t binaryTriggerTimeout_ms = 2000,
                               bool includeInCycle = true, const char* name = "")
{
    return FireModeConfig{name,     burstLength,   burstMode, targetDPS,
                          reversible, binaryTriggerTimeout_ms, includeInCycle};
}

struct ShotProfile
{
    String name; // "Low" / "Medium" / "High" defaults, user-renameable

    int32_t revRPM[4];
    uint32_t dwellTime_ms;
    uint32_t idleTime_ms;
    int32_t idleRPM[4];
    uint32_t spindownSpeed;
    uint32_t revSafetyTimeout_ms;
    rpmModeType_t rpmMode;

    FireModeConfig fireModes[MAX_FIRE_MODES];
    uint8_t activeModeCount; // how many leading fireModes[] slots are in use, 1-MAX_FIRE_MODES
    uint8_t defaultFiringMode; // index into fireModes[0, activeModeCount)

    int8_t switchPositionAssignment[3];
};
