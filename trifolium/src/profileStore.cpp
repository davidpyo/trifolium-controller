#include "profileStore.h"
#include <LittleFS.h>
#include "global.h" // extern BootReason rebootReason - set before the profile-switch reboot
#include "factoryDefaults.h"

namespace
{
String profilePath(uint8_t index)
{
    return "/profile" + String(index) + ".cfg";
}

const char* ACTIVE_INDEX_PATH = "/active.cfg";

const char* defaultNameForIndex(uint8_t index)
{
    switch (index)
    {
    case 0:
        return "Low";
    case 1:
        return "Medium";
    case 2:
        return "High";
    default:
        return "";
    }
}

template <typename T> void readArray(JsonDocument& doc, const char* key, T* out, size_t count)
{
    JsonArrayConst arr = doc[key];
    if (arr.isNull())
        return;
    for (size_t i = 0; i < count && i < arr.size(); i++)
    {
        out[i] = arr[i] | out[i];
    }
}

template <typename T>
void writeArray(JsonDocument& doc, const char* key, const T* values, size_t count)
{
    JsonArray arr = doc[key].to<JsonArray>();
    for (size_t i = 0; i < count; i++)
    {
        arr.add(values[i]);
    }
}
} // namespace

namespace ProfileStore
{
bool begin()
{
    if (LittleFS.begin())
        return true;
    // Not formatted yet, or corrupt - format once and retry.
    LittleFS.format();
    return LittleFS.begin();
}

ShotProfile defaultProfile(uint8_t index)
{
    ShotProfile profile = kDefaultProfile; // see factoryDefaults.h
    profile.name = defaultNameForIndex(index);
    return profile;
}

uint8_t loadActiveProfileIndex()
{
    File f = LittleFS.open(ACTIVE_INDEX_PATH, "r");
    if (!f)
        return 0;
    int index = f.parseInt();
    f.close();
    if (index < 0 || index >= MAX_PROFILE_COUNT)
        return 0;
    return (uint8_t)index;
}

bool saveActiveProfileIndex(uint8_t index)
{
    if (index >= MAX_PROFILE_COUNT)
        return false;
    File f = LittleFS.open(ACTIVE_INDEX_PATH, "w");
    if (!f)
        return false;
    f.print(index);
    f.close();
    return true;
}

void toJson(const ShotProfile& settings, JsonDocument& doc)
{
    doc["name"] = settings.name;

    writeArray(doc, "revRPM", settings.revRPM, 4);
    doc["dwellTime_ms"] = settings.dwellTime_ms;
    doc["idleTime_ms"] = settings.idleTime_ms;
    writeArray(doc, "idleRPM", settings.idleRPM, 4);
    doc["spindownSpeed"] = settings.spindownSpeed;
    doc["revSafetyTimeout_ms"] = settings.revSafetyTimeout_ms;
    doc["rpmMode"] = (int)settings.rpmMode;

    JsonArray fireModes = doc["fireModes"].to<JsonArray>();
    for (int i = 0; i < 3; i++)
    {
        JsonObject mode = fireModes.add<JsonObject>();
        mode["name"] = settings.fireModes[i].name;
        mode["burstLength"] = settings.fireModes[i].burstLength;
        mode["burstMode"] = (int)settings.fireModes[i].burstMode;
        mode["targetDPS"] = settings.fireModes[i].targetDPS;
    }
    doc["binaryTriggerTimeout_ms"] = settings.binaryTriggerTimeout_ms;
    doc["defaultFiringMode"] = settings.defaultFiringMode;
}

void fromJson(JsonDocument& doc, ShotProfile& out)
{
    out.name = doc["name"] | out.name;

    readArray(doc, "revRPM", out.revRPM, 4);
    out.dwellTime_ms = doc["dwellTime_ms"] | out.dwellTime_ms;
    out.idleTime_ms = doc["idleTime_ms"] | out.idleTime_ms;
    readArray(doc, "idleRPM", out.idleRPM, 4);
    out.spindownSpeed = doc["spindownSpeed"] | out.spindownSpeed;
    out.revSafetyTimeout_ms = doc["revSafetyTimeout_ms"] | out.revSafetyTimeout_ms;
    out.rpmMode = (rpmModeType_t)(doc["rpmMode"] | (int)out.rpmMode);

    JsonArrayConst fireModes = doc["fireModes"];
    if (!fireModes.isNull())
    {
        for (int i = 0; i < 3 && i < (int)fireModes.size(); i++)
        {
            JsonObjectConst mode = fireModes[i];
            if (mode.isNull())
                continue;
            out.fireModes[i].name = mode["name"] | out.fireModes[i].name;
            out.fireModes[i].burstLength = mode["burstLength"] | out.fireModes[i].burstLength;
            out.fireModes[i].burstMode =
                (burstFireType_t)(mode["burstMode"] | (int)out.fireModes[i].burstMode);
            out.fireModes[i].targetDPS = mode["targetDPS"] | out.fireModes[i].targetDPS;
        }
    }
    out.binaryTriggerTimeout_ms = doc["binaryTriggerTimeout_ms"] | out.binaryTriggerTimeout_ms;
    out.defaultFiringMode = doc["defaultFiringMode"] | out.defaultFiringMode;
}

bool loadProfile(uint8_t index, ShotProfile& out)
{
    if (index >= MAX_PROFILE_COUNT)
        return false;

    out = defaultProfile(index);

    File f = LittleFS.open(profilePath(index), "r");
    if (!f)
        return true; // no file yet - defaults already in `out`, not an error

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, f);
    f.close();
    if (err)
        return true; // corrupt file - fall back to defaults already in `out`

    fromJson(doc, out);
    return true;
}

bool saveProfile(uint8_t index, const ShotProfile& settings)
{
    if (index >= MAX_PROFILE_COUNT)
        return false;

    JsonDocument doc;
    toJson(settings, doc);

    String tmpPath = profilePath(index) + ".tmp";
    File f = LittleFS.open(tmpPath, "w");
    if (!f)
        return false;
    serializeJson(doc, f);
    f.close();

    // Temp-file-then-rename: this is flash storage on a device with no clean shutdown
    // path (batteries, motors) - a power loss mid-write must not corrupt the real file.
    LittleFS.remove(profilePath(index));
    return LittleFS.rename(tmpPath, profilePath(index));
}

bool copyProfile(uint8_t from, uint8_t to)
{
    ShotProfile source;
    if (!loadProfile(from, source))
        return false;

    ShotProfile destination;
    if (!loadProfile(to, destination))
        return false;

    String keepName = destination.name;
    destination = source;
    destination.name = keepName;
    return saveProfile(to, destination);
}

bool resetProfile(uint8_t index)
{
    if (index >= MAX_PROFILE_COUNT)
        return false;
    return saveProfile(index, defaultProfile(index));
}

void switchActiveProfile(uint8_t newIndex)
{
    if (newIndex >= MAX_PROFILE_COUNT)
        return;
    saveActiveProfileIndex(newIndex);
    rebootReason = BootReason::MENU;
    delay(100);
    rp2040.reboot();
}
} // namespace ProfileStore
