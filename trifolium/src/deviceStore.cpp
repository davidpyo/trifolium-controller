#include "deviceStore.h"
#include <LittleFS.h>
#include "CONFIGURATION.h"
#include "logging.h"
#include "enumIds.h"
#include "bootStatus.h"
#include "pinCapabilities.h"

namespace
{
const char* DEVICE_PATH = "/device.cfg";
}

// Owned by main.cpp - factoryResetSettings() reads the live wiring off it.
extern DeviceSettings deviceSettings;

namespace DeviceStore
{
// Every pin to unused, the provenance id to empty, and the boot gate off. What RESET_PINS does.
void clearWiring(DeviceSettings& s)
{
    s.boardId = "";
    s.wiringConfigured = false;
    for (uint8_t i = 0; i < 4; i++)
        s.escPins[i] = PIN_NOT_USED;
    s.i2cSdaPin = PIN_NOT_USED;
    s.i2cSclPin = PIN_NOT_USED;
    s.batteryAdcPin = PIN_NOT_USED;
    s.escEnablePin = PIN_NOT_USED;
    s.menuButtonPin = PIN_NOT_USED;
    s.triggerSwitchPin = PIN_NOT_USED;
    s.revSwitchPin = PIN_NOT_USED;
    s.cycleSwitchPin = PIN_NOT_USED;
    s.idleSwitchPin = PIN_NOT_USED;
    s.safetySwitchPin = PIN_NOT_USED;
    s.select0Pin = PIN_NOT_USED;
    s.select1Pin = PIN_NOT_USED;
    s.select2Pin = PIN_NOT_USED;
    s.pusherFetPin = PIN_NOT_USED;
    s.ledDataPin = PIN_NOT_USED;
}

void applyWiringCapabilityLimits(DeviceSettings& s)
{
    s.hasDisplay = s.hasDisplay && i2cPairUsable(s.i2cSdaPin, s.i2cSclPin);

    for (uint8_t i = 0; i < 4; i++)
    {
        // The stored driver and channel: which channel the pusher occupies is the user's answer,
        // so it is theirs that decides which motor cannot be enabled.
        const bool isPusherChannel =
            s.pusherDrive == PUSHER_DRIVE_ESC && i == (uint8_t)s.pusherEscChannel;
        if (s.escPins[i] == PIN_NOT_USED || isPusherChannel)
            s.motorConfig[i].enabled = false;
    }
}

// The one entry point every fallback path goes through, so defaults have a single reader.
DeviceSettings defaultDeviceSettings()
{
    return kDefaultDeviceSettings;
}

DeviceSettings factoryResetSettings()
{
    DeviceSettings s = defaultDeviceSettings();

    // A menu-driven reset clears what the menu can set, and nothing else. Everything carried across
    // below has no OLED row, so clearing it here would hand back a device only a host can put
    // right.
    s.boardId = deviceSettings.boardId;
    s.wiringConfigured = deviceSettings.wiringConfigured;
    s.hasDisplay = deviceSettings.hasDisplay;

    // The rest of the wiring, by the same rule as the switch pins below: none of it has an OLED
    // row, so a reset that cleared it would leave a device only a host could arm.
    for (uint8_t i = 0; i < 4; i++)
        s.escPins[i] = deviceSettings.escPins[i];
    s.i2cSdaPin = deviceSettings.i2cSdaPin;
    s.i2cSclPin = deviceSettings.i2cSclPin;
    s.batteryAdcPin = deviceSettings.batteryAdcPin;
    s.escEnablePin = deviceSettings.escEnablePin;

    s.menuButtonPin = deviceSettings.menuButtonPin;
    s.triggerSwitchPin = deviceSettings.triggerSwitchPin;
    s.revSwitchPin = deviceSettings.revSwitchPin;
    s.cycleSwitchPin = deviceSettings.cycleSwitchPin;
    s.idleSwitchPin = deviceSettings.idleSwitchPin;
    s.safetySwitchPin = deviceSettings.safetySwitchPin;
    s.select0Pin = deviceSettings.select0Pin;
    s.select1Pin = deviceSettings.select1Pin;
    s.select2Pin = deviceSettings.select2Pin;

    // The pusher and LED wiring, by the same rule: none of the four has an OLED row, so a reset
    // that cleared one would leave a pusher driving nothing and no way to say so from the device.
    s.pusherDrive = deviceSettings.pusherDrive;
    s.pusherFetPin = deviceSettings.pusherFetPin;
    s.pusherEscChannel = deviceSettings.pusherEscChannel;
    s.ledDataPin = deviceSettings.ledDataPin;

    // Polarity travels with the pin: a normally-closed menu button reads as permanently pressed
    // once this is lost, which costs the menu exactly as surely as the wrong pin number does.
    s.menuButtonNormallyClosed = deviceSettings.menuButtonNormallyClosed;
    s.triggerSwitchNormallyClosed = deviceSettings.triggerSwitchNormallyClosed;
    s.revSwitchNormallyClosed = deviceSettings.revSwitchNormallyClosed;
    s.cycleSwitchNormallyClosed = deviceSettings.cycleSwitchNormallyClosed;
    s.idleSwitchNormallyClosed = deviceSettings.idleSwitchNormallyClosed;
    s.safetySwitchNormallyClosed = deviceSettings.safetySwitchNormallyClosed;

    // No OLED row, so the same rule applies even though these are preferences rather than wiring.
    // dshotMode and useRpmLogging both have one, so a reset may clear them.
    s.printTelemetry = deviceSettings.printTelemetry;
    s.rpmLogLength = deviceSettings.rpmLogLength;

    // Last, and allowed to overrule the preserved flags: wiring whose I2C pair no block can serve
    // cannot have a display whatever hasDisplay says.
    if (s.wiringConfigured)
        applyWiringCapabilityLimits(s);
    return s;
}

void toJson(const DeviceSettings& settings, JsonDocument& doc)
{
    doc["schemaVersion"] = CURRENT_SCHEMA_VERSION;

    // Provenance, not identity: which preset this wiring came from, or "" for wiring nobody based
    // on one. Nothing reads it back - see DeviceSettings::boardId.
    doc["boardId"] = settings.boardId;
    doc["wiringConfigured"] = settings.wiringConfigured;

    JsonArray escPins = doc["escPins"].to<JsonArray>();
    for (uint8_t i = 0; i < 4; i++)
        escPins.add(settings.escPins[i]);
    doc["i2cSdaPin"] = settings.i2cSdaPin;
    doc["i2cSclPin"] = settings.i2cSclPin;
    doc["batteryAdcPin"] = settings.batteryAdcPin;
    doc["escEnablePin"] = settings.escEnablePin;

    doc["hasDisplay"] = settings.hasDisplay;
    doc["rotateDisplay"] = settings.rotateDisplay;
    doc["blasterName"] = settings.blasterName;

    doc["menuButtonPin"] = settings.menuButtonPin;
    doc["triggerSwitchPin"] = settings.triggerSwitchPin;
    doc["revSwitchPin"] = settings.revSwitchPin;
    doc["cycleSwitchPin"] = settings.cycleSwitchPin;
    doc["idleSwitchPin"] = settings.idleSwitchPin;
    doc["safetySwitchPin"] = settings.safetySwitchPin;
    doc["select0Pin"] = settings.select0Pin;
    doc["select1Pin"] = settings.select1Pin;
    doc["select2Pin"] = settings.select2Pin;

    doc["revSwitchNormallyClosed"] = settings.revSwitchNormallyClosed;
    doc["triggerSwitchNormallyClosed"] = settings.triggerSwitchNormallyClosed;
    doc["cycleSwitchNormallyClosed"] = settings.cycleSwitchNormallyClosed;
    doc["idleSwitchNormallyClosed"] = settings.idleSwitchNormallyClosed;
    doc["safetySwitchNormallyClosed"] = settings.safetySwitchNormallyClosed;
    doc["menuButtonNormallyClosed"] = settings.menuButtonNormallyClosed;
    doc["pusherReverseDirection"] = settings.pusherReverseDirection;

    doc["dualStageTrigger"] = settings.dualStageTrigger;

    JsonArray bootAction = doc["bootAction"].to<JsonArray>();
    for (int i = 0; i < BOOT_BTN_COUNT; i++)
        bootAction.add(enumIdOf(settings.bootAction[i], kBootActionIds, kBootActionIdCount));

    doc["pusherType"] = enumIdOf(settings.pusherType, kPusherTypeIds, kPusherTypeIdCount);
    doc["pusherDrive"] = enumIdOf(settings.pusherDrive, kPusherDriveIds, kPusherDriveIdCount);
    doc["pusherFetPin"] = settings.pusherFetPin;
    doc["pusherEscChannel"] = enumIdOf(settings.pusherEscChannel, kEscChannelIds, kEscChannelIdCount);
    doc["ledDataPin"] = settings.ledDataPin;

    doc["debounceTime_ms"] = settings.debounceTime_ms;
    doc["menuButtonHoldTime_ms"] = settings.menuButtonHoldTime_ms;
    doc["pusherDebounceTime_ms"] = settings.pusherDebounceTime_ms;
    doc["voltageAveragingWindow"] = settings.voltageAveragingWindow;
    doc["useRpmBaseShotCounter"] = settings.useRpmBaseShotCounter;
    doc["goodRpmShotReads"] = settings.goodRpmShotReads;
    doc["rpmDropThreshold"] = settings.rpmDropThreshold;

    doc["displayBrightness"] = settings.displayBrightness;
    doc["showCurrentRpmOnHomeScreen"] = settings.showCurrentRpmOnHomeScreen;
    doc["homeScreenDisplayMode"] = enumIdOf(settings.homeScreenDisplayMode, kHomeScreenModeIds, kHomeScreenModeIdCount);
    doc["showDpsOnHomeScreen"] = settings.showDpsOnHomeScreen;

    doc["ledWarningMode"] = enumIdOf(settings.ledWarningMode, kLedWarningModeIds, kLedWarningModeIdCount);

    doc["dshotMode"] = enumIdOf(settings.dshotMode, kDshotModeIds, kDshotModeIdCount);
    doc["printTelemetry"] = settings.printTelemetry;

    doc["useRpmLogging"] = settings.useRpmLogging;
    doc["rpmLogLength"] = settings.rpmLogLength;

    JsonArray motorConfig = doc["motorConfig"].to<JsonArray>();
    for (int i = 0; i < 4; i++)
    {
        JsonObject cfg = motorConfig.add<JsonObject>();
        cfg["enabled"] = settings.motorConfig[i].enabled;
        cfg["stage"] = enumIdOf(settings.motorConfig[i].stage, kMotorStageIds, kMotorStageIdCount);
        cfg["kp"] = settings.motorConfig[i].kp;
        cfg["ki"] = settings.motorConfig[i].ki;
        cfg["motorKv"] = settings.motorConfig[i].motorKv;
        cfg["motorPolesDiv2"] = settings.motorConfig[i].motorPolesDiv2;
    }

    doc["flywheelControl"] = enumIdOf(settings.flywheelControl, kFlywheelControlIds, kFlywheelControlIdCount);
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
    doc["vibrationPulseMs"] = settings.vibrationPulseMs;

    doc["batteryType"] = enumIdOf(settings.batteryType, kBatteryTypeIds, kBatteryTypeIdCount);
    doc["lowVoltageCutoffPerCell_mv"] = settings.lowVoltageCutoffPerCell_mv;
    doc["lowVoltageWarningPerCell_mv"] = settings.lowVoltageWarningPerCell_mv;
    doc["voltageCalibrationFactor"] = settings.voltageCalibrationFactor;

    doc["selectFireType"] = enumIdOf(settings.selectFireType, kSelectFireTypeIds, kSelectFireTypeIdCount);
    doc["variableFPS"] = settings.variableFPS;
    doc["defaultProfileIndex"] = settings.defaultProfileIndex;
}

void fromJson(JsonDocument& doc, DeviceSettings& out, Source source)
{
    uint16_t loadedVersion = doc["schemaVersion"] | (uint16_t)0; // 0 = predates versioning
    if (loadedVersion != CURRENT_SCHEMA_VERSION &&
        (loadedVersion < OLDEST_MIGRATABLE_VERSION || loadedVersion > CURRENT_SCHEMA_VERSION))
    {
        logger.error("Device schema version ", loadedVersion, " != ", CURRENT_SCHEMA_VERSION,
                     " and not migratable - resetting to defaults");
        if (source == Source::Flash)
            BootStatus::recordConfigFault(BootStatus::ConfigFault::DeviceVersionRefused,
                                          String(loadedVersion).c_str());
        out = defaultDeviceSettings();
        return;
    }

    // Anything from OLDEST_MIGRATABLE_VERSION up is applied as-is, and the `|` overlay below leaves
    // a key it never wrote at the factory default. Not symmetric with schemaVersionOk(): a stale
    // file on flash has to boot somehow, a stale file on the wire does not.

    // A file written before v3 names a board this build has no pinout for and carries none of the
    // wiring keys that replaced it, so it comes up inert. Before the overlay, so the keys it does
    // carry still land on top - the provenance id in particular.
    if (loadedVersion < 3)
    {
        clearWiring(out);
        if (source == Source::Flash)
            BootStatus::recordConfigFault(BootStatus::ConfigFault::WiringUnavailable,
                                          doc["boardId"] | "");
    }

    // Provenance: carried through exactly as written, for the console to match against its presets.
    out.boardId = doc["boardId"] | out.boardId;
    out.wiringConfigured = doc["wiringConfigured"] | out.wiringConfigured;

    JsonArrayConst escPins = doc["escPins"];
    if (!escPins.isNull())
    {
        for (uint8_t i = 0; i < 4 && i < (int)escPins.size(); i++)
            out.escPins[i] = escPins[i] | out.escPins[i];
    }
    out.i2cSdaPin = doc["i2cSdaPin"] | out.i2cSdaPin;
    out.i2cSclPin = doc["i2cSclPin"] | out.i2cSclPin;
    out.batteryAdcPin = doc["batteryAdcPin"] | out.batteryAdcPin;
    out.escEnablePin = doc["escEnablePin"] | out.escEnablePin;

    out.hasDisplay = doc["hasDisplay"] | out.hasDisplay;
    out.rotateDisplay = doc["rotateDisplay"] | out.rotateDisplay;
    out.blasterName = doc["blasterName"] | out.blasterName;

    out.menuButtonPin = doc["menuButtonPin"] | out.menuButtonPin;
    out.triggerSwitchPin = doc["triggerSwitchPin"] | out.triggerSwitchPin;
    out.revSwitchPin = doc["revSwitchPin"] | out.revSwitchPin;
    out.cycleSwitchPin = doc["cycleSwitchPin"] | out.cycleSwitchPin;
    out.idleSwitchPin = doc["idleSwitchPin"] | out.idleSwitchPin;
    // Absent on a config written before the safety switch existed, leaving it unused - so a stored
    // wiring that predates it keeps behaving exactly as it did, with no schema bump to carry.
    out.safetySwitchPin = doc["safetySwitchPin"] | out.safetySwitchPin;
    out.select0Pin = doc["select0Pin"] | out.select0Pin;
    out.select1Pin = doc["select1Pin"] | out.select1Pin;
    out.select2Pin = doc["select2Pin"] | out.select2Pin;

    out.revSwitchNormallyClosed = doc["revSwitchNormallyClosed"] | out.revSwitchNormallyClosed;
    out.triggerSwitchNormallyClosed =
        doc["triggerSwitchNormallyClosed"] | out.triggerSwitchNormallyClosed;
    out.cycleSwitchNormallyClosed =
        doc["cycleSwitchNormallyClosed"] | out.cycleSwitchNormallyClosed;
    out.idleSwitchNormallyClosed = doc["idleSwitchNormallyClosed"] | out.idleSwitchNormallyClosed;
    out.safetySwitchNormallyClosed =
        doc["safetySwitchNormallyClosed"] | out.safetySwitchNormallyClosed;
    out.menuButtonNormallyClosed = doc["menuButtonNormallyClosed"] | out.menuButtonNormallyClosed;
    out.pusherReverseDirection = doc["pusherReverseDirection"] | out.pusherReverseDirection;

    out.dualStageTrigger = doc["dualStageTrigger"] | out.dualStageTrigger;

    // Absent on a migrated v2 file, which leaves every entry at its factory value - and the factory
    // values are the behaviour v2 hardcoded, so a migrated device boots the same way it always did.
    JsonArrayConst bootAction = doc["bootAction"];
    if (!bootAction.isNull())
    {
        for (int i = 0; i < BOOT_BTN_COUNT && i < (int)bootAction.size(); i++)
            out.bootAction[i] =
                enumFromJson(bootAction[i], kBootActionIds, kBootActionIdCount, out.bootAction[i]);
    }

    // enumFromJson() leaves an unrecognised value at the default. escPin() indexes a 4-element array
    // with pusherEscChannel, and a hand-written config reaches this before any clamp runs.
    out.pusherType =
        enumFromJson(doc["pusherType"], kPusherTypeIds, kPusherTypeIdCount, out.pusherType);
    out.pusherDrive =
        enumFromJson(doc["pusherDrive"], kPusherDriveIds, kPusherDriveIdCount, out.pusherDrive);
    out.pusherFetPin = doc["pusherFetPin"] | out.pusherFetPin;
    out.pusherEscChannel = enumFromJson(doc["pusherEscChannel"], kEscChannelIds,
                                        kEscChannelIdCount, out.pusherEscChannel);
    out.ledDataPin = doc["ledDataPin"] | out.ledDataPin;

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
    out.homeScreenDisplayMode = enumFromJson(doc["homeScreenDisplayMode"], kHomeScreenModeIds,
                                             kHomeScreenModeIdCount, out.homeScreenDisplayMode);
    out.showDpsOnHomeScreen = doc["showDpsOnHomeScreen"] | out.showDpsOnHomeScreen;

    out.ledWarningMode = enumFromJson(doc["ledWarningMode"], kLedWarningModeIds,
                                      kLedWarningModeIdCount, out.ledWarningMode);

    // Accepts the name this build writes and the bare bit rate older configs carry. An unrecognised
    // value would otherwise reach BidirDShotX1's constructor as a PIO clock divider.
    out.dshotMode = dshotModeFromJson(doc["dshotMode"], out.dshotMode);
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
            out.motorConfig[i].stage = enumFromJson(cfg["stage"], kMotorStageIds,
                                                    kMotorStageIdCount,
                                                    out.motorConfig[i].stage);
            out.motorConfig[i].kp = cfg["kp"] | out.motorConfig[i].kp;
            out.motorConfig[i].ki = cfg["ki"] | out.motorConfig[i].ki;
            out.motorConfig[i].motorKv = cfg["motorKv"] | out.motorConfig[i].motorKv;
            out.motorConfig[i].motorPolesDiv2 =
                cfg["motorPolesDiv2"] | out.motorConfig[i].motorPolesDiv2;
        }
    }

    out.flywheelControl = enumFromJson(doc["flywheelControl"], kFlywheelControlIds,
                                       kFlywheelControlIdCount, out.flywheelControl);
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
    out.vibrationPulseMs = doc["vibrationPulseMs"] | out.vibrationPulseMs;

    out.batteryType =
        enumFromJson(doc["batteryType"], kBatteryTypeIds, kBatteryTypeIdCount, out.batteryType);
    out.lowVoltageCutoffPerCell_mv =
        doc["lowVoltageCutoffPerCell_mv"] | out.lowVoltageCutoffPerCell_mv;
    out.lowVoltageWarningPerCell_mv =
        doc["lowVoltageWarningPerCell_mv"] | out.lowVoltageWarningPerCell_mv;
    out.voltageCalibrationFactor = doc["voltageCalibrationFactor"] | out.voltageCalibrationFactor;

    out.selectFireType = enumFromJson(doc["selectFireType"], kSelectFireTypeIds,
                                      kSelectFireTypeIdCount, out.selectFireType);
    out.variableFPS = doc["variableFPS"] | out.variableFPS;
    out.defaultProfileIndex = doc["defaultProfileIndex"] | out.defaultProfileIndex;
}

LoadResult loadDeviceSettings(DeviceSettings& out)
{
    // defaultDeviceSettings(), not factoryResetSettings(): there is no live config to preserve
    // anything from this early in boot.
    out = defaultDeviceSettings();

    File f = LittleFS.open(DEVICE_PATH, "r");
    if (!f)
        return LoadResult::DefaultsNoFile;

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, f);
    f.close();
    if (err)
        return LoadResult::DefaultsCorrupt;

    // The same range fromJson() gates on, read here only to say which of the two things it did.
    const uint16_t loadedVersion = doc["schemaVersion"] | (uint16_t)0;
    const bool migratable = loadedVersion >= OLDEST_MIGRATABLE_VERSION &&
                            loadedVersion <= CURRENT_SCHEMA_VERSION;

    // Source::Flash: this is the load whose refusal nobody is attached to see.
    fromJson(doc, out, Source::Flash); // resets `out` to defaults itself when out of range
    return migratable ? LoadResult::Stored : LoadResult::DefaultsBadVersion;
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

    return LittleFS.rename(tmpPath, DEVICE_PATH);
}
} // namespace DeviceStore
