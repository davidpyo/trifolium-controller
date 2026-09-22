#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include "deviceSettings.h"

namespace DeviceStore
{
// Bump whenever a breaking change is made to DeviceSettings's on-disk shape. Independent from
// ProfileStore::CURRENT_SCHEMA_VERSION - see that constant's comment for the full rationale.
constexpr uint16_t CURRENT_SCHEMA_VERSION = 3;

// Versions fromJson() will migrate a file found on flash up from, rather than discarding. Only add
// a version here when every key it wrote still means the same thing at CURRENT_SCHEMA_VERSION.
//
// v2 is upstream `main`, the only version in the field, and carries no wiring - fromJson() brings
// such a file up inert rather than guessing a pinout. Raising this floor orphans every user on it.
constexpr uint16_t OLDEST_MIGRATABLE_VERSION = 2;

// Which of these a config came from. Three of the four mean "there is no wiring", because no build
// carries one - which is a state the device handles rather than a failure.
enum class LoadResult : uint8_t
{
    Stored,             // a valid file of the current (or a migratable) version was applied
    DefaultsNoFile,     // first boot
    DefaultsCorrupt,    // deserializeJson failed
    DefaultsBadVersion, // schemaVersion neither current nor migratable
};

// Every wiring field to unused, the provenance id to empty, and the boot gate off. The route back
// to an inert device, which RESET_PINS uses to recover a blaster whose pins were typed wrongly.
void clearWiring(DeviceSettings& s);

// Turns off what this wiring physically cannot do. Only ever clears, never enables: which motors a
// blaster actually has is a build choice no pin list can know.
void applyWiringCapabilityLimits(DeviceSettings& s);

// CONFIGURATION.h's kDefaultDeviceSettings. No build carries a wiring, so every fallback is unwired.
DeviceSettings defaultDeviceSettings();

// Factory reset, keeping the wiring. Reads the live deviceSettings for the fields it preserves.
DeviceSettings factoryResetSettings();

LoadResult loadDeviceSettings(DeviceSettings& out);

// Temp-file-then-rename, same power-loss-safety reasoning as ProfileStore::saveProfile.
bool saveDeviceSettings(const DeviceSettings& settings);

void toJson(const DeviceSettings& settings, JsonDocument& doc);

// Where the document came from. Only a file read off flash records a refusal as a boot fault: an
// upload fails in front of the host that sent it.
enum class Source : uint8_t
{
    Flash,
    Host,
};

void fromJson(JsonDocument& doc, DeviceSettings& out, Source source = Source::Host);
} // namespace DeviceStore
