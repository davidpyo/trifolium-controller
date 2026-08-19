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

    out.pusherType = (pusherType_t)(doc["pusherType"] | (int)out.pusherType);

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
