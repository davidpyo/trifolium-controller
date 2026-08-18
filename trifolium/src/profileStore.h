#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include "runtimeSettings.h"

namespace ProfileStore
{
constexpr uint8_t MAX_PROFILE_COUNT = 4;

// Mounts LittleFS, formatting on first boot / mount failure. Call once from setup().
bool begin();

RuntimeSettings defaultProfile(); // returns kDefaultProfile - see factoryDefaults.h

uint8_t loadActiveProfileIndex();
bool saveActiveProfileIndex(uint8_t index);

bool loadProfile(uint8_t index, RuntimeSettings& out);

bool saveProfile(uint8_t index, const RuntimeSettings& settings);

// Returns false on a corrupt source slot or a full/failing LittleFS.
bool copyProfile(uint8_t from, uint8_t to);

// Persists the new active index, then reboots rather than hot-swapping into the live control loop.
void switchActiveProfile(uint8_t newIndex);

// Shared (de)serialization - also used by the DUMP_PROFILE/LOAD_PROFILE Serial commands.
void toJson(const RuntimeSettings& settings, JsonDocument& doc);

void fromJson(JsonDocument& doc, RuntimeSettings& out);
} // namespace ProfileStore
