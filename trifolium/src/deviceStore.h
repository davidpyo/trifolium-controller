#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include "deviceSettings.h"

namespace DeviceStore
{
DeviceSettings defaultDeviceSettings(); // returns kDefaultDeviceSettings - see factoryDefaults.h

bool loadDeviceSettings(DeviceSettings& out);

// Temp-file-then-rename, same power-loss-safety reasoning as ProfileStore::saveProfile.
bool saveDeviceSettings(const DeviceSettings& settings);

void toJson(const DeviceSettings& settings, JsonDocument& doc);

void fromJson(JsonDocument& doc, DeviceSettings& out);
} // namespace DeviceStore
