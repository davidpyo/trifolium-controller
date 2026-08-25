#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include "deviceSettings.h"

namespace DeviceStore
{
// Bump whenever a breaking change is made to DeviceSettings's on-disk shape. Independent from
// ProfileStore::CURRENT_SCHEMA_VERSION - see that constant's comment for the full rationale.
constexpr uint16_t CURRENT_SCHEMA_VERSION = 2;

DeviceSettings defaultDeviceSettings(); // returns kDefaultDeviceSettings - see CONFIGURATION.h

bool loadDeviceSettings(DeviceSettings& out);

// Temp-file-then-rename, same power-loss-safety reasoning as ProfileStore::saveProfile.
bool saveDeviceSettings(const DeviceSettings& settings);

void toJson(const DeviceSettings& settings, JsonDocument& doc);

void fromJson(JsonDocument& doc, DeviceSettings& out);
} // namespace DeviceStore
