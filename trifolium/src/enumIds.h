#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <cstring>
#include "types.h"

// The on-disk vocabulary for every enum a stored config carries. Each table is parallel to its
// enum's ordinals, so kBootActionIds[BOOT_ACTION_BOOTLOADER] is that enumerator's name on the wire.
//
// These strings ARE the contract, not the ordinals - a config file says "esc_passthrough", never 2.
// Two consequences, both deliberate:
//   - reordering or inserting an enumerator is safe, so APPEND ONLY is now only about keeping the
//     on-device picker's order stable, not about correctness;
//   - renaming one of these strings is the breaking change. Don't, unless you also want every
//     stored config that used it to fall back to its default.
// Display labels stay next to their menu items; only the wire names live here.

inline const char* const kBootActionIds[] = {"none", "bootloader", "esc_passthrough", "idle_hold"};
inline const char* const kPusherTypeIds[] = {"none", "solenoid_openloop"};
inline const char* const kEscChannelIds[] = {"esc1", "esc2", "esc3", "esc4"};
inline const char* const kPusherDriveIds[] = {"fet", "esc"};
inline const char* const kDshotModeIds[] = {"dshot300", "dshot600", "dshot1200"};
inline const char* const kHomeScreenModeIds[] = {"counter", "fire_mode", "both"};
inline const char* const kLedWarningModeIds[] = {"none", "low_batt", "warn_batt"};
inline const char* const kFlywheelControlIds[] = {"pid", "tbh"};
inline const char* const kBatteryTypeIds[] = {"3s", "4s", "5s", "6s"};
inline const char* const kMotorStageIds[] = {"stage1", "stage2"};
inline const char* const kSelectFireTypeIds[] = {"off", "switch", "button", "screen"};
inline const char* const kRpmModeIds[] = {"custom", "stage"};
inline const char* const kBurstModeIds[] = {"auto", "burst",    "binary", "safe",
                                            "semi", "devotion", "plasma"};

template <typename T, size_t N> constexpr size_t idCount(T (&)[N])
{
    return N;
}

inline constexpr uint8_t kBootActionIdCount = (uint8_t)idCount(kBootActionIds);
inline constexpr uint8_t kPusherTypeIdCount = (uint8_t)idCount(kPusherTypeIds);
inline constexpr uint8_t kEscChannelIdCount = (uint8_t)idCount(kEscChannelIds);
inline constexpr uint8_t kPusherDriveIdCount = (uint8_t)idCount(kPusherDriveIds);
inline constexpr uint8_t kDshotModeIdCount = (uint8_t)idCount(kDshotModeIds);
inline constexpr uint8_t kHomeScreenModeIdCount = (uint8_t)idCount(kHomeScreenModeIds);
inline constexpr uint8_t kLedWarningModeIdCount = (uint8_t)idCount(kLedWarningModeIds);
inline constexpr uint8_t kFlywheelControlIdCount = (uint8_t)idCount(kFlywheelControlIds);
inline constexpr uint8_t kBatteryTypeIdCount = (uint8_t)idCount(kBatteryTypeIds);
inline constexpr uint8_t kMotorStageIdCount = (uint8_t)idCount(kMotorStageIds);
inline constexpr uint8_t kSelectFireTypeIdCount = (uint8_t)idCount(kSelectFireTypeIds);
inline constexpr uint8_t kRpmModeIdCount = (uint8_t)idCount(kRpmModeIds);
inline constexpr uint8_t kBurstModeIdCount = (uint8_t)idCount(kBurstModeIds);

// The enums that carry a count sentinel can be checked here; the rest are checked against their
// label array in the menu file that declares it, since adding a sentinel to an enum used in a
// switch would trip -Wswitch on every exhaustive one.
static_assert(kBootActionIdCount == BOOT_ACTION_COUNT, "kBootActionIds is out of step");
static_assert(kEscChannelIdCount == ESC_CH_COUNT, "kEscChannelIds is out of step");
static_assert(kPusherDriveIdCount == PUSHER_DRIVE_COUNT, "kPusherDriveIds is out of step");
static_assert(kDshotModeIdCount == DSHOT_MODE_COUNT, "kDshotModeIds is out of step");

// The id for a value, or "" if it is somehow out of range - callers write this straight to JSON.
inline const char* enumIdOf(int value, const char* const* ids, uint8_t count)
{
    return (value >= 0 && value < (int)count) ? ids[value] : "";
}

// Reads an enum back. Accepts the id string this build writes and, for any config written before
// the ids existed, a bare integer ordinal - which is what makes the schema bump additive rather
// than destructive. An absent or unrecognised value leaves `current` alone, so it stays at
// whatever default the caller seeded.
template <typename E>
E enumFromJson(JsonVariantConst value, const char* const* ids, uint8_t count, E current)
{
    if (value.isNull())
        return current;

    const char* id = value.as<const char*>();
    if (id)
    {
        for (uint8_t i = 0; i < count; i++)
        {
            if (strcmp(id, ids[i]) == 0)
                return (E)i;
        }
        return current; // a name this build doesn't know - keep the default rather than guess
    }

    if (value.is<int>())
    {
        const int ordinal = value.as<int>();
        if (ordinal >= 0 && ordinal < (int)count)
            return (E)ordinal;
    }
    return current;
}

// dshot_mode_t needs its own reader because it is the one enum whose stored value is not always an
// ordinal: a config can hold the bit rate itself - 300, 600 or 1200 rather than 0, 1 or 2. Those three are mapped here; everything else falls
// through to the shared reader, which handles the name and keeps the default for anything it does
// not know. An ordinal reaches the same answer by either route, so the two cannot disagree.
inline dshot_mode_t dshotModeFromJson(JsonVariantConst value, dshot_mode_t current)
{
    if (value.is<int>())
    {
        switch (value.as<int>())
        {
        case 300: return DSHOT300;
        case 600: return DSHOT600;
        case 1200: return DSHOT1200;
        default: break;
        }
    }
    return enumFromJson(value, kDshotModeIds, kDshotModeIdCount, current);
}
