#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include "shotProfile.h"

namespace ProfileStore
{
constexpr uint8_t MAX_PROFILE_COUNT = 3;

// Bump whenever a breaking change is made to ShotProfile's on-disk shape (field moved/removed,
// enum repurposed, etc). Independent from DeviceStore::CURRENT_SCHEMA_VERSION - the two structs
// evolve separately.
constexpr uint16_t CURRENT_SCHEMA_VERSION = 2;

// Versions fromJson() will migrate a file found on flash up from, rather than discarding, on the
// same terms as DeviceStore::OLDEST_MIGRATABLE_VERSION: only add a version here when every key it
// wrote still means the same thing now, so the `|` defaulting leaves new keys at factory values.
//
//   v1 -> v2: rpmMode and fireModes[].burstMode became id strings instead of ordinals. A v1 file
//             carries the ordinals, which enumFromJson() still accepts, so nothing is lost.
constexpr uint16_t OLDEST_MIGRATABLE_VERSION = 1;

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

// Where the document came from - see DeviceStore::Source. `slot` names which file, so the boot
// record can say which profile lost its saved data rather than just that one did.
enum class Source : uint8_t
{
    Flash,
    Host,
};

void fromJson(JsonDocument& doc, ShotProfile& out, Source source = Source::Host,
              uint8_t slot = 0);
} // namespace ProfileStore
