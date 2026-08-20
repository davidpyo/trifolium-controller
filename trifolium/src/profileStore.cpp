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

RuntimeSettings defaultProfile()
{
    return kDefaultProfile; // see factoryDefaults.h
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

void toJson(const RuntimeSettings& settings, JsonDocument& doc)
{
    writeArray(doc, "motors", settings.motors, 4);
    doc["variableFPS"] = settings.variableFPS;
    JsonArray revRPMset = doc["revRPMset"].to<JsonArray>();
    for (int mode = 0; mode < 3; mode++)
    {
        JsonArray row = revRPMset.add<JsonArray>();
        for (int i = 0; i < 4; i++)
            row.add(settings.revRPMset[mode][i]);
    }
    writeArray(doc, "dwellTimeSet_ms", settings.dwellTimeSet_ms, 3);
    writeArray(doc, "idleTimeSet_ms", settings.idleTimeSet_ms, 3);
    doc["spindownSpeed"] = settings.spindownSpeed;
    writeArray(doc, "idleRPM", settings.idleRPM, 4);
    doc["revSafetyTimeout_ms"] = settings.revSafetyTimeout_ms;

    JsonArray motorStage = doc["motorStage"].to<JsonArray>();
    for (int i = 0; i < 4; i++)
        motorStage.add((int)settings.motorStage[i]);
    doc["rpmMode"] = (int)settings.rpmMode;

    doc["flywheelControl"] = (int)settings.flywheelControl;
    doc["firingRPMTolerance"] = settings.firingRPMTolerance;
    doc["minFiringRPM"] = settings.minFiringRPM;
    doc["rampupTimeout_ms"] = settings.rampupTimeout_ms;

    doc["EMAFilter"] = settings.EMAFilter;
    doc["iThreshold"] = settings.iThreshold;
    doc["throttleCap"] = settings.throttleCap;

    writeArray(doc, "KP", settings.KP, 4);
    writeArray(doc, "KI", settings.KI, 4);
    writeArray(doc, "KD", settings.KD, 4);
    writeArray(doc, "motorPolesDiv2", settings.motorPolesDiv2, 4);
    writeArray(doc, "motorKv", settings.motorKv, 4);

    writeArray(doc, "burstLengthSet", settings.burstLengthSet, 3);
    JsonArray burstModeSet = doc["burstModeSet"].to<JsonArray>();
    for (int i = 0; i < 3; i++)
        burstModeSet.add((int)settings.burstModeSet[i]);
    JsonArray fireModeStrings = doc["fireModeStrings"].to<JsonArray>();
    for (int i = 0; i < 3; i++)
        fireModeStrings.add(settings.fireModeStrings[i]);
    doc["binaryTriggerTimeout_ms"] = settings.binaryTriggerTimeout_ms;
    doc["selectFireType"] = (int)settings.selectFireType;
    doc["defaultFiringMode"] = settings.defaultFiringMode;

    doc["batteryType"] = (int)settings.batteryType;
    doc["lowVoltageCutoffPerCell_mv"] = settings.lowVoltageCutoffPerCell_mv;
    doc["lowVoltageWarningPerCell_mv"] = settings.lowVoltageWarningPerCell_mv;
    doc["voltageCalibrationFactor"] = settings.voltageCalibrationFactor;

    doc["solenoidExtendTimeHigh_ms"] = settings.solenoidExtendTimeHigh_ms;
    doc["solenoidExtendTimeHighVoltage_mv"] = settings.solenoidExtendTimeHighVoltage_mv;
    doc["solenoidExtendTimeLow_ms"] = settings.solenoidExtendTimeLow_ms;
    doc["solenoidExtendTimeLowVoltage_mv"] = settings.solenoidExtendTimeLowVoltage_mv;
    doc["solenoidRetractTime_ms"] = settings.solenoidRetractTime_ms;

    doc["targetDPS"] = settings.targetDPS;
    doc["autoTiming"] = settings.autoTiming;
}

void fromJson(JsonDocument& doc, RuntimeSettings& out)
{
    readArray(doc, "motors", out.motors, 4);
    out.variableFPS = doc["variableFPS"] | out.variableFPS;
    JsonArrayConst revRPMset = doc["revRPMset"];
    if (!revRPMset.isNull())
    {
        for (int mode = 0; mode < 3 && mode < (int)revRPMset.size(); mode++)
        {
            JsonArrayConst row = revRPMset[mode];
            if (row.isNull())
                continue;
            for (int i = 0; i < 4 && i < (int)row.size(); i++)
                out.revRPMset[mode][i] = row[i] | out.revRPMset[mode][i];
        }
    }
    readArray(doc, "dwellTimeSet_ms", out.dwellTimeSet_ms, 3);
    readArray(doc, "idleTimeSet_ms", out.idleTimeSet_ms, 3);
    out.spindownSpeed = doc["spindownSpeed"] | out.spindownSpeed;
    readArray(doc, "idleRPM", out.idleRPM, 4);
    out.revSafetyTimeout_ms = doc["revSafetyTimeout_ms"] | out.revSafetyTimeout_ms;

    JsonArrayConst motorStage = doc["motorStage"];
    if (!motorStage.isNull())
    {
        for (int i = 0; i < 4 && i < (int)motorStage.size(); i++)
            out.motorStage[i] = (motorStage_t)(motorStage[i] | (int)out.motorStage[i]);
    }
    out.rpmMode = (rpmModeType_t)(doc["rpmMode"] | (int)out.rpmMode);

    out.flywheelControl =
        (flywheelControlType_t)(doc["flywheelControl"] | (int)out.flywheelControl);
    out.firingRPMTolerance = doc["firingRPMTolerance"] | out.firingRPMTolerance;
    out.minFiringRPM = doc["minFiringRPM"] | out.minFiringRPM;
    out.rampupTimeout_ms = doc["rampupTimeout_ms"] | out.rampupTimeout_ms;

    out.EMAFilter = doc["EMAFilter"] | out.EMAFilter;
    out.iThreshold = doc["iThreshold"] | out.iThreshold;
    out.throttleCap = doc["throttleCap"] | out.throttleCap;

    readArray(doc, "KP", out.KP, 4);
    readArray(doc, "KI", out.KI, 4);
    readArray(doc, "KD", out.KD, 4);
    readArray(doc, "motorPolesDiv2", out.motorPolesDiv2, 4);
    readArray(doc, "motorKv", out.motorKv, 4);

    readArray(doc, "burstLengthSet", out.burstLengthSet, 3);
    JsonArrayConst burstModeSet = doc["burstModeSet"];
    if (!burstModeSet.isNull())
    {
        for (int i = 0; i < 3 && i < (int)burstModeSet.size(); i++)
            out.burstModeSet[i] = (burstFireType_t)(burstModeSet[i] | (int)out.burstModeSet[i]);
    }
    JsonArrayConst fireModeStrings = doc["fireModeStrings"];
    if (!fireModeStrings.isNull())
    {
        for (int i = 0; i < 3 && i < (int)fireModeStrings.size(); i++)
            out.fireModeStrings[i] = fireModeStrings[i] | out.fireModeStrings[i];
    }
    out.binaryTriggerTimeout_ms = doc["binaryTriggerTimeout_ms"] | out.binaryTriggerTimeout_ms;
    out.selectFireType = (selectFireType_t)(doc["selectFireType"] | (int)out.selectFireType);
    out.defaultFiringMode = doc["defaultFiringMode"] | out.defaultFiringMode;

    out.batteryType = (batteryType_t)(doc["batteryType"] | (int)out.batteryType);
    out.lowVoltageCutoffPerCell_mv =
        doc["lowVoltageCutoffPerCell_mv"] | out.lowVoltageCutoffPerCell_mv;
    out.lowVoltageWarningPerCell_mv =
        doc["lowVoltageWarningPerCell_mv"] | out.lowVoltageWarningPerCell_mv;
    out.voltageCalibrationFactor = doc["voltageCalibrationFactor"] | out.voltageCalibrationFactor;

    out.solenoidExtendTimeHigh_ms =
        doc["solenoidExtendTimeHigh_ms"] | out.solenoidExtendTimeHigh_ms;
    out.solenoidExtendTimeHighVoltage_mv =
        doc["solenoidExtendTimeHighVoltage_mv"] | out.solenoidExtendTimeHighVoltage_mv;
    out.solenoidExtendTimeLow_ms = doc["solenoidExtendTimeLow_ms"] | out.solenoidExtendTimeLow_ms;
    out.solenoidExtendTimeLowVoltage_mv =
        doc["solenoidExtendTimeLowVoltage_mv"] | out.solenoidExtendTimeLowVoltage_mv;
    out.solenoidRetractTime_ms = doc["solenoidRetractTime_ms"] | out.solenoidRetractTime_ms;

    out.targetDPS = doc["targetDPS"] | out.targetDPS;
    out.autoTiming = doc["autoTiming"] | out.autoTiming;
}

bool loadProfile(uint8_t index, RuntimeSettings& out)
{
    if (index >= MAX_PROFILE_COUNT)
        return false;

    out = defaultProfile();

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

bool saveProfile(uint8_t index, const RuntimeSettings& settings)
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
    RuntimeSettings settings;
    if (!loadProfile(from, settings))
        return false;
    return saveProfile(to, settings);
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
