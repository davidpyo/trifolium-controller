#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include "shotProfile.h"

namespace ProfileStore
{
constexpr uint8_t MAX_PROFILE_COUNT = 3;

// Bump whenever a breaking change is made to ShotProfile's on-disk shape (field moved/removed,
// enum reordered/repurposed, etc). fromJson() resets to defaults on a mismatch instead of
// silently overlaying fields that may no longer mean what they used to. Independent from
// DeviceStore::CURRENT_SCHEMA_VERSION - the two structs evolve separately.
constexpr uint16_t CURRENT_SCHEMA_VERSION = 1;

// Mounts LittleFS, formatting on first boot / mount failure. Call once from setup().
bool begin();

ShotProfile defaultProfile(uint8_t index); // returns kDefaultProfile with name defaulted by
                                            // index - see CONFIGURATION.h

uint8_t loadActiveProfileIndex();
bool saveActiveProfileIndex(uint8_t index);

int8_t loadLastFiringMode(uint8_t index);
bool saveLastFiringMode(uint8_t index, int8_t mode);

bool loadProfile(uint8_t index, ShotProfile& out);

bool saveProfile(uint8_t index, const ShotProfile& settings);

// Returns false on a corrupt source slot or a full/failing LittleFS.
bool copyProfile(uint8_t from, uint8_t to);

// Resets a profile to factory defaults, including its name.
bool resetProfile(uint8_t index);

// Persists the new active index, then reboots rather than hot-swapping into the live control loop.
void switchActiveProfile(uint8_t newIndex);

// Shared (de)serialization - also used by the DUMP_PROFILE/LOAD_PROFILE Serial commands.
void toJson(const ShotProfile& settings, JsonDocument& doc);

void fromJson(JsonDocument& doc, ShotProfile& out);
} // namespace ProfileStore
