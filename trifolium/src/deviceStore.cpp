#include "deviceStore.h"
#include <LittleFS.h>
#include "factoryDefaults.h"

namespace
{
const char* DEVICE_PATH = "/device.cfg";
}

namespace DeviceStore
{
DeviceSettings defaultDeviceSettings()
{
    return kDefaultDeviceSettings; // see factoryDefaults.h
}

void toJson(const DeviceSettings& settings, JsonDocument& doc)
{
    doc["hasDisplay"] = settings.hasDisplay;
    doc["rotateDisplay"] = settings.rotateDisplay;
    doc["blasterName"] = settings.blasterName;

    doc["menuButtonPin"] = settings.menuButtonPin;
    doc["triggerSwitchPin"] = settings.triggerSwitchPin;
    doc["revSwitchPin"] = settings.revSwitchPin;
    doc["cycleSwitchPin"] = settings.cycleSwitchPin;
    doc["idleSwitchPin"] = settings.idleSwitchPin;
    doc["select0Pin"] = settings.select0Pin;
    doc["select1Pin"] = settings.select1Pin;
    doc["select2Pin"] = settings.select2Pin;

    doc["revSwitchNormallyClosed"] = settings.revSwitchNormallyClosed;
    doc["triggerSwitchNormallyClosed"] = settings.triggerSwitchNormallyClosed;
    doc["cycleSwitchNormallyClosed"] = settings.cycleSwitchNormallyClosed;
    doc["idleSwitchNormallyClosed"] = settings.idleSwitchNormallyClosed;
    doc["menuButtonNormallyClosed"] = settings.menuButtonNormallyClosed;
    doc["pusherReverseDirection"] = settings.pusherReverseDirection;

    doc["dualStageTrigger"] = settings.dualStageTrigger;

    doc["pusherType"] = (int)settings.pusherType;

    doc["debounceTime_ms"] = settings.debounceTime_ms;
    doc["menuButtonHoldTime_ms"] = settings.menuButtonHoldTime_ms;
    doc["pusherDebounceTime_ms"] = settings.pusherDebounceTime_ms;
    doc["voltageAveragingWindow"] = settings.voltageAveragingWindow;
    doc["useRpmBaseShotCounter"] = settings.useRpmBaseShotCounter;
    doc["goodRpmShotReads"] = settings.goodRpmShotReads;
    doc["rpmDropThreshold"] = settings.rpmDropThreshold;

    doc["displayBrightness"] = settings.displayBrightness;
    doc["showCurrentRpmOnHomeScreen"] = settings.showCurrentRpmOnHomeScreen;
    doc["homeScreenDisplayMode"] = (int)settings.homeScreenDisplayMode;
    doc["showDpsOnHomeScreen"] = settings.showDpsOnHomeScreen;

    doc["maxRpmCap"] = settings.maxRpmCap;

    doc["ledWarningMode"] = (int)settings.ledWarningMode;

    doc["dshotMode"] = (int)settings.dshotMode;
    doc["printTelemetry"] = settings.printTelemetry;

    doc["useRpmLogging"] = settings.useRpmLogging;
    doc["rpmLogLength"] = settings.rpmLogLength;

    JsonArray motorConfig = doc["motorConfig"].to<JsonArray>();
    for (int i = 0; i < 4; i++)
    {
        JsonObject cfg = motorConfig.add<JsonObject>();
        cfg["enabled"] = settings.motorConfig[i].enabled;
        cfg["stage"] = (int)settings.motorConfig[i].stage;
        cfg["kp"] = settings.motorConfig[i].kp;
        cfg["ki"] = settings.motorConfig[i].ki;
        cfg["motorKv"] = settings.motorConfig[i].motorKv;
        cfg["motorPolesDiv2"] = settings.motorConfig[i].motorPolesDiv2;
    }

    doc["flywheelControl"] = (int)settings.flywheelControl;
    doc["firingRPMTolerance"] = settings.firingRPMTolerance;
    doc["minFiringRPM"] = settings.minFiringRPM;
    doc["rampupTimeout_ms"] = settings.rampupTimeout_ms;
    doc["EMAFilter"] = settings.EMAFilter;
    doc["iThreshold"] = settings.iThreshold;
    doc["throttleCap"] = settings.throttleCap;

    doc["solenoidExtendTimeHigh_ms"] = settings.solenoidExtendTimeHigh_ms;
    doc["solenoidExtendTimeHighVoltage_mv"] = settings.solenoidExtendTimeHighVoltage_mv;
    doc["solenoidExtendTimeLow_ms"] = settings.solenoidExtendTimeLow_ms;
    doc["solenoidExtendTimeLowVoltage_mv"] = settings.solenoidExtendTimeLowVoltage_mv;
    doc["solenoidRetractTime_ms"] = settings.solenoidRetractTime_ms;

    doc["batteryType"] = (int)settings.batteryType;
    doc["lowVoltageCutoffPerCell_mv"] = settings.lowVoltageCutoffPerCell_mv;
    doc["lowVoltageWarningPerCell_mv"] = settings.lowVoltageWarningPerCell_mv;
    doc["voltageCalibrationFactor"] = settings.voltageCalibrationFactor;

    doc["selectFireType"] = (int)settings.selectFireType;
    doc["variableFPS"] = settings.variableFPS;
    doc["defaultProfileIndex"] = settings.defaultProfileIndex;
}

void fromJson(JsonDocument& doc, DeviceSettings& out)
{
    out.hasDisplay = doc["hasDisplay"] | out.hasDisplay;
    out.rotateDisplay = doc["rotateDisplay"] | out.rotateDisplay;
    out.blasterName = doc["blasterName"] | out.blasterName;

    out.menuButtonPin = doc["menuButtonPin"] | out.menuButtonPin;
    out.triggerSwitchPin = doc["triggerSwitchPin"] | out.triggerSwitchPin;
    out.revSwitchPin = doc["revSwitchPin"] | out.revSwitchPin;
    out.cycleSwitchPin = doc["cycleSwitchPin"] | out.cycleSwitchPin;
    out.idleSwitchPin = doc["idleSwitchPin"] | out.idleSwitchPin;
    out.select0Pin = doc["select0Pin"] | out.select0Pin;
    out.select1Pin = doc["select1Pin"] | out.select1Pin;
    out.select2Pin = doc["select2Pin"] | out.select2Pin;

    out.revSwitchNormallyClosed = doc["revSwitchNormallyClosed"] | out.revSwitchNormallyClosed;
    out.triggerSwitchNormallyClosed =
        doc["triggerSwitchNormallyClosed"] | out.triggerSwitchNormallyClosed;
    out.cycleSwitchNormallyClosed =
        doc["cycleSwitchNormallyClosed"] | out.cycleSwitchNormallyClosed;
    out.idleSwitchNormallyClosed = doc["idleSwitchNormallyClosed"] | out.idleSwitchNormallyClosed;
    out.menuButtonNormallyClosed = doc["menuButtonNormallyClosed"] | out.menuButtonNormallyClosed;
    out.pusherReverseDirection = doc["pusherReverseDirection"] | out.pusherReverseDirection;

    out.dualStageTrigger = doc["dualStageTrigger"] | out.dualStageTrigger;

    int loadedPusherType = doc["pusherType"] | (int)out.pusherType;
    if (loadedPusherType < NO_PUSHER || loadedPusherType > PUSHER_SOLENOID_OPENLOOP)
        loadedPusherType = PUSHER_SOLENOID_OPENLOOP;
    out.pusherType = (pusherType_t)loadedPusherType;

    out.debounceTime_ms = doc["debounceTime_ms"] | out.debounceTime_ms;
    out.menuButtonHoldTime_ms = doc["menuButtonHoldTime_ms"] | out.menuButtonHoldTime_ms;
    out.pusherDebounceTime_ms = doc["pusherDebounceTime_ms"] | out.pusherDebounceTime_ms;
    out.voltageAveragingWindow = doc["voltageAveragingWindow"] | out.voltageAveragingWindow;
    out.useRpmBaseShotCounter = doc["useRpmBaseShotCounter"] | out.useRpmBaseShotCounter;
    out.goodRpmShotReads = doc["goodRpmShotReads"] | out.goodRpmShotReads;
    out.rpmDropThreshold = doc["rpmDropThreshold"] | out.rpmDropThreshold;

    out.displayBrightness = doc["displayBrightness"] | out.displayBrightness;
    out.showCurrentRpmOnHomeScreen =
        doc["showCurrentRpmOnHomeScreen"] | out.showCurrentRpmOnHomeScreen;
    out.homeScreenDisplayMode =
        (homeScreenDisplayMode_t)(doc["homeScreenDisplayMode"] | (int)out.homeScreenDisplayMode);
    out.showDpsOnHomeScreen = doc["showDpsOnHomeScreen"] | out.showDpsOnHomeScreen;

    out.maxRpmCap = doc["maxRpmCap"] | out.maxRpmCap;

    out.ledWarningMode = (ledWarningMode_t)(doc["ledWarningMode"] | (int)out.ledWarningMode);

    out.dshotMode = (dshot_mode_t)(doc["dshotMode"] | (int)out.dshotMode);
    out.printTelemetry = doc["printTelemetry"] | out.printTelemetry;

    out.useRpmLogging = doc["useRpmLogging"] | out.useRpmLogging;
    uint32_t requestedLength = doc["rpmLogLength"] | out.rpmLogLength;
    out.rpmLogLength = min(requestedLength, MAX_RPM_LOG_LENGTH);

    JsonArrayConst motorConfig = doc["motorConfig"];
    if (!motorConfig.isNull())
    {
        for (int i = 0; i < 4 && i < (int)motorConfig.size(); i++)
        {
            JsonObjectConst cfg = motorConfig[i];
            if (cfg.isNull())
                continue;
            out.motorConfig[i].enabled = cfg["enabled"] | out.motorConfig[i].enabled;
            out.motorConfig[i].stage =
                (motorStage_t)(cfg["stage"] | (int)out.motorConfig[i].stage);
            out.motorConfig[i].kp = cfg["kp"] | out.motorConfig[i].kp;
            out.motorConfig[i].ki = cfg["ki"] | out.motorConfig[i].ki;
            out.motorConfig[i].motorKv = cfg["motorKv"] | out.motorConfig[i].motorKv;
            out.motorConfig[i].motorPolesDiv2 =
                cfg["motorPolesDiv2"] | out.motorConfig[i].motorPolesDiv2;
        }
    }

    out.flywheelControl =
        (flywheelControlType_t)(doc["flywheelControl"] | (int)out.flywheelControl);
    out.firingRPMTolerance = doc["firingRPMTolerance"] | out.firingRPMTolerance;
    out.minFiringRPM = doc["minFiringRPM"] | out.minFiringRPM;
    out.rampupTimeout_ms = doc["rampupTimeout_ms"] | out.rampupTimeout_ms;
    out.EMAFilter = doc["EMAFilter"] | out.EMAFilter;
    out.iThreshold = doc["iThreshold"] | out.iThreshold;
    out.throttleCap = doc["throttleCap"] | out.throttleCap;

    out.solenoidExtendTimeHigh_ms =
        doc["solenoidExtendTimeHigh_ms"] | out.solenoidExtendTimeHigh_ms;
    out.solenoidExtendTimeHighVoltage_mv =
        doc["solenoidExtendTimeHighVoltage_mv"] | out.solenoidExtendTimeHighVoltage_mv;
    out.solenoidExtendTimeLow_ms = doc["solenoidExtendTimeLow_ms"] | out.solenoidExtendTimeLow_ms;
    out.solenoidExtendTimeLowVoltage_mv =
        doc["solenoidExtendTimeLowVoltage_mv"] | out.solenoidExtendTimeLowVoltage_mv;
    out.solenoidRetractTime_ms = doc["solenoidRetractTime_ms"] | out.solenoidRetractTime_ms;

    out.batteryType = (batteryType_t)(doc["batteryType"] | (int)out.batteryType);
    out.lowVoltageCutoffPerCell_mv =
        doc["lowVoltageCutoffPerCell_mv"] | out.lowVoltageCutoffPerCell_mv;
    out.lowVoltageWarningPerCell_mv =
        doc["lowVoltageWarningPerCell_mv"] | out.lowVoltageWarningPerCell_mv;
    out.voltageCalibrationFactor = doc["voltageCalibrationFactor"] | out.voltageCalibrationFactor;

    out.selectFireType = (selectFireType_t)(doc["selectFireType"] | (int)out.selectFireType);
    out.variableFPS = doc["variableFPS"] | out.variableFPS;
    out.defaultProfileIndex = doc["defaultProfileIndex"] | out.defaultProfileIndex;
}

bool loadDeviceSettings(DeviceSettings& out)
{
    out = defaultDeviceSettings();

    File f = LittleFS.open(DEVICE_PATH, "r");
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

bool saveDeviceSettings(const DeviceSettings& settings)
{
    JsonDocument doc;
    toJson(settings, doc);

    String tmpPath = String(DEVICE_PATH) + ".tmp";
    File f = LittleFS.open(tmpPath, "w");
    if (!f)
        return false;
    serializeJson(doc, f);
    f.close();

    LittleFS.remove(DEVICE_PATH);
    return LittleFS.rename(tmpPath, DEVICE_PATH);
}
} // namespace DeviceStore
