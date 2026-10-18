#include "serialCommands.h"

#include <Arduino.h>
#include <ArduinoJson.h>

#include "global.h"
#include "logging.h"
#include "serialLock.h"
#include "shotProfile.h"
#include "profileStore.h"
#include "deviceSettings.h"
#include "deviceStore.h"
#include "splashStore.h"
#include "bitmaps.h" // splash - what DUMP_SPLASH reports when no custom one is set
#include "bootStatus.h"
#include "schemaDump.h"
#include "gpioReport.h"
#include "flywheelMotor.h"
#include "enumIds.h" // kBurstModeIds - DUMP_MOTORS names the live mode rather than numbering it

// Owned by main.cpp - the live config these commands read and write.
extern ShotProfile activeProfile;
extern uint8_t activeProfileIndex; // the slot activeProfile came from, named in its dump
extern DeviceSettings deviceSettings;
extern bool wiringLive; // this boot's copy of the boot gate, for the refusal in ESC_PASSTHROUGH
// Core 0's flywheel state, for DUMP_MOTORS. Read unsynchronised from core 1, same as the menu's
// ESC dashboard does - every field is a word-sized scalar and the answer is a snapshot either way.
extern FlywheelMotor motorArr[4];
extern bool motorsEnabled[4];
extern flywheelState_t flywheelState;
extern bool idleHoldActive;
extern burstFireType_t burstMode;
extern bool safetyEngaged;
extern uint8_t speedPotPin;
extern int32_t speedPotRpm;
extern uint8_t dartSwitchPin;
extern bool dartPresent;
extern bool breechEmptiedSincePush;
extern uint32_t dartWaitSince_ms;
bool idleHoldWanted();
bool menuIsOpen();
bool revControlAllowed();
extern bool batteryFlat;
extern int16_t shotsToFire;
extern volatile uint8_t serialRevMask;
extern volatile uint32_t serialRevUntil_ms;
void runMotorTest(uint8_t motorIndex);                  // menuMotors.cpp
void runMotorDirection(uint8_t motorIndex, bool reversed); // menuMotors.cpp

// How long one REV_HOLD keeps the rev up. The console renews it well inside this, so a closed tab or
// a pulled cable lets go within it.
static constexpr uint32_t kSerialRevLease_ms = 300;

volatile bool serialCommandSeen = false;

void serialCommandsBegin()
{
    Serial.begin(115200);
    // Without this, a write blocks whenever no host is draining the port, which would stall
    // whichever core is printing.
    Serial.ignoreFlowControl(true);
}

// Every LOAD_* answers with one of these.
static void ackError(const char* command, const char* reason)
{
    Serial.print("{\"cmd\":\"");
    Serial.print(command);
    Serial.print("\",\"ok\":false,\"err\":\"");
    Serial.print(reason);
    Serial.println("\"}");
}

// A body too big for the heap fails as NoMemory, which is not malformed JSON.
static const char* parseError(DeserializationError err)
{
    return err == DeserializationError::NoMemory ? "too large" : "invalid JSON";
}

// `index` is the profile slot, or -1 where the command has no slot.
static void ackOk(const char* command, int index, bool clamped, bool rebooting)
{
    Serial.print("{\"cmd\":\"");
    Serial.print(command);
    Serial.print("\",\"ok\":true");
    if (index >= 0)
    {
        Serial.print(",\"index\":");
        Serial.print(index);
    }
    Serial.print(clamped ? ",\"clamped\":true" : ",\"clamped\":false");
    Serial.println(rebooting ? ",\"rebooting\":true}" : ",\"rebooting\":false}");
}

// Why a motor action from the console cannot run now, or nullptr. These spin a wheel, so they wait
// for the blaster to be at rest, the same as the menu that offers them.
static void printBase64(const uint8_t* data, size_t len)
{
    static const char kAlphabet[] =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (size_t i = 0; i < len; i += 3)
    {
        const uint32_t n = (uint32_t)data[i] << 16 | (i + 1 < len ? (uint32_t)data[i + 1] << 8 : 0) |
                           (i + 2 < len ? data[i + 2] : 0);
        Serial.print(kAlphabet[n >> 18 & 63]);
        Serial.print(kAlphabet[n >> 12 & 63]);
        Serial.print(i + 1 < len ? kAlphabet[n >> 6 & 63] : '=');
        Serial.print(i + 2 < len ? kAlphabet[n & 63] : '=');
    }
}

static bool motorActionRunning = false; // the test loop answers serial while it spins

static const char* motorActionRefusal(int index)
{
    if (motorActionRunning)
        return "a motor action is already running";
    if (!wiringLive)
        return "no wiring configured";
    if (index < 0 || index > 3 || !motorsEnabled[index])
        return "no such motor enabled";
    if (menuIsOpen())
        return "menu open";
    if (safetyEngaged)
        return "safety engaged";
    if (flywheelState != STATE_IDLE || shotsToFire > 0)
        return "blaster busy";
    for (int i = 0; i < 4; i++)
    {
        if (motorsEnabled[i] && motorArr[i].targetRPM != 0)
            return "wheels still turning";
    }
    return nullptr;
}

static void runMotorAction(const char* command, int index, bool test, bool reversed)
{
    const char* refusal = motorActionRefusal(index);
    if (refusal)
    {
        ackError(command, refusal);
        return;
    }
    // Acked first: the spin takes seconds, and the console only needs to know it started.
    ackOk(command, index, false, false);
    SerialLock::printKept();
    motorActionRunning = true;
    if (test)
        runMotorTest((uint8_t)index);
    else
        runMotorDirection((uint8_t)index, reversed);
    motorActionRunning = false;
}

// Rejects a payload whose schema version isn't the one this build speaks, before it reaches
// fromJson().
static bool schemaVersionOk(const char* command, JsonDocument& doc, uint16_t expected)
{
    uint16_t loaded = doc["schemaVersion"] | (uint16_t)0; // 0 = predates versioning
    if (loaded == expected)
        return true;

    Serial.print("{\"cmd\":\"");
    Serial.print(command);
    Serial.print("\",\"ok\":false,\"err\":\"schemaVersion ");
    Serial.print(loaded);
    Serial.print(" != ");
    Serial.print(expected);
    Serial.println("\",\"applied\":false}");
    return false;
}

void handleSerialCommands()
{
    // ESC passthrough reads raw bytes off Serial directly for the whole session - skip here so
    // this function's line-oriented reads don't steal bytes from that binary protocol.
    if (bootReason == BootReason::TO_ESC_PASSTHROUGH)
        return;

    if (!Serial.available())
        return;

    SerialHold serial; // for the whole command, so its reply goes out in one piece
    serialCommandSeen = true;

    String line = Serial.readStringUntil('\n');
    line.trim();

    int spaceIdx = line.indexOf(' ');
    String command = spaceIdx == -1 ? line : line.substring(0, spaceIdx);

    bool hasIndex = false;
    int explicitIndex = -1;
    bool hasArgument = false;
    String argument;
    if (spaceIdx != -1)
    {
        argument = line.substring(spaceIdx + 1);
        argument.trim();
        hasArgument = argument.length() > 0;
        hasIndex = hasArgument;
        bool allDigits = hasIndex;
        for (size_t i = 0; i < argument.length(); i++)
        {
            if (!isDigit(argument[i]))
                allDigits = false;
        }
        explicitIndex =
            allDigits ? argument.toInt() : -1; // -1 sentinel - caught by the range check below
    }

    if (command == "DUMP_SCHEMA")
    {
        dumpSchema();
    }
    else if (command == "REBOOT")
    {
        Serial.println("{\"cmd\":\"REBOOT\",\"ok\":true,\"rebooting\":true}");
        SerialLock::printKept();
        Serial.flush();
        delay(100);
        rebootReason = BootReason::MENU;
        rp2040.reboot();
    }
    else if (command == "REBOOT_BOOTLOADER")
    {
        // The only route into the bootloader that doesn't need a working screen or a mapped boot
        // button: Reboot > Bootloader lives in the menu, which a device with no display can't reach.
        Serial.println("{\"cmd\":\"REBOOT_BOOTLOADER\",\"ok\":true,\"rebooting\":true}");
        SerialLock::printKept();
        Serial.flush();
        delay(100);
        rp2040.rebootToBootloader();
    }
    else if (command == "REV_HOLD")
    {
        // Revs the motors in the mask (bit 0 = motor 1) for one lease; the console renews it while
        // its button is held. The usual gates apply: no rev in SAFE, with the menu open or on a flat
        // pack. There is no fire counterpart, by design.
        if (!hasIndex || explicitIndex < 1 || explicitIndex > 15)
        {
            ackError("REV_HOLD", "needs a motor mask, 1-15");
            return;
        }
        if (!wiringLive)
        {
            ackError("REV_HOLD", "no wiring configured");
            return;
        }
        if (!revControlAllowed())
        {
            ackError("REV_HOLD", menuIsOpen() ? "menu open" : "SAFE");
            return;
        }
        if (batteryFlat)
        {
            ackError("REV_HOLD", "battery flat");
            return;
        }
        uint8_t mask = 0;
        for (int i = 0; i < 4; i++)
        {
            if (motorsEnabled[i] && (explicitIndex & (1 << i)))
                mask |= 1 << i;
        }
        if (!mask)
        {
            ackError("REV_HOLD", "no enabled motor in the mask");
            return;
        }
        serialRevMask = mask;
        serialRevUntil_ms = millis() + kSerialRevLease_ms;
        ackOk("REV_HOLD", mask, false, false);
    }
    else if (command == "REV_RELEASE")
    {
        serialRevMask = 0;
        ackOk("REV_RELEASE", -1, false, false);
    }
    else if (command == "MOTOR_TEST")
    {
        runMotorAction("MOTOR_TEST", hasIndex ? explicitIndex : -1, true, false);
    }
    else if (command == "MOTOR_NORMAL")
    {
        runMotorAction("MOTOR_NORMAL", hasIndex ? explicitIndex : -1, false, false);
    }
    else if (command == "MOTOR_REVERSED")
    {
        runMotorAction("MOTOR_REVERSED", hasIndex ? explicitIndex : -1, false, true);
    }
    else if (command == "ESC_PASSTHROUGH")
    {
        // Entered at boot rather than here, from rebootReason: passthrough hands the ESC pins to a
        // host configurator, which means tearing down the DShot state machines this build owns. An
        // unwired device never reaches the branch.
        if (!wiringLive)
        {
            ackError("ESC_PASSTHROUGH", "no wiring configured");
            return;
        }
        // No switch ends this one: the host that asked closes the port instead.
        rebootPassthroughExit = kNoBootButton;
        ackOk("ESC_PASSTHROUGH", -1, false, true);
        SerialLock::printKept();
        Serial.flush();
        delay(100);
        rebootReason = BootReason::TO_ESC_PASSTHROUGH;
        rp2040.reboot();
    }
    else if (command == "FACTORY_RESET_DEVICE")
    {
        // factoryResetSettings(), not a payload the host composes - the device decides what the
        // preserved set is. Wiring survives this; RESET_PINS is what moves it.
        DeviceStore::saveDeviceSettings(DeviceStore::factoryResetSettings());
        ackOk("FACTORY_RESET_DEVICE", -1, false, true);
        SerialLock::printKept();
        Serial.flush();
        delay(100);
        rebootReason = BootReason::MENU;
        rp2040.reboot();
    }
    else if (command == "FACTORY_RESET_PROFILE")
    {
        if (!hasIndex || explicitIndex < 0 || explicitIndex >= ProfileStore::MAX_PROFILE_COUNT)
        {
            ackError("FACTORY_RESET_PROFILE", "needs a slot index");
            return;
        }
        if (!ProfileStore::resetProfile((uint8_t)explicitIndex))
        {
            ackError("FACTORY_RESET_PROFILE", "could not write the slot");
            return;
        }
        // Reboots whichever slot it was: activeProfile is a RAM copy loaded at boot, so resetting
        // the live slot without one would leave the blaster running tuning no longer on disk.
        ackOk("FACTORY_RESET_PROFILE", explicitIndex, false, true);
        SerialLock::printKept();
        Serial.flush();
        delay(100);
        rebootReason = BootReason::MENU;
        rp2040.reboot();
    }
    else if (command == "FACTORY_RESET_ALL")
    {
        // What the OLED's "Factory Reset All" does, in the order it does it. Still not the wiring -
        // RESET_PINS stays the only command that moves it.
        for (uint8_t i = 0; i < ProfileStore::MAX_PROFILE_COUNT; i++)
            ProfileStore::resetProfile(i);
        DeviceStore::saveDeviceSettings(DeviceStore::factoryResetSettings());
        ackOk("FACTORY_RESET_ALL", -1, false, true);
        SerialLock::printKept();
        Serial.flush();
        delay(100);
        rebootReason = BootReason::MENU;
        rp2040.reboot();
    }
    else if (command == "RESET_PINS")
    {
        // Back to no wiring at all: the device comes up driving nothing and asks for a preset. Also
        // the only thing that clears wiringConfigured - editing a pin deliberately does not.
        DeviceStore::clearWiring(deviceSettings);
        DeviceStore::saveDeviceSettings(deviceSettings);
        ackOk("RESET_PINS", -1, false, true);
        SerialLock::printKept();
        Serial.flush();
        delay(100);
        rebootReason = BootReason::MENU;
        rp2040.reboot();
    }
    else if (command == "DUMP_PROFILE")
    {
        ShotProfile settings;
        uint8_t dumpedIndex;
        if (hasIndex)
        {
            if (explicitIndex < 0 || explicitIndex >= ProfileStore::MAX_PROFILE_COUNT)
            {
                logger.error("DUMP_PROFILE: index out of range");
                return;
            }
            dumpedIndex = (uint8_t)explicitIndex;
            ProfileStore::loadProfile(dumpedIndex, settings);
        }
        else
        {
            dumpedIndex = activeProfileIndex;
            settings = activeProfile;
        }
        JsonDocument doc;
        // Framing goes in before the config so it leads the object, and here rather than in
        // toJson() - that doc is also what saveProfile() writes to flash, which holds config and
        // nothing else. `index` names the slot that was read: every slot answers with the same
        // `cmd`, so without it a reply that arrives after its reader gave up cannot be told from
        // another slot's.
        doc["cmd"] = "DUMP_PROFILE";
        doc["index"] = dumpedIndex;
        ProfileStore::toJson(settings, doc);
        serializeJson(doc, Serial);
        Serial.println();
    }
    else if (command == "LOAD_PROFILE")
    {
        if (hasIndex && (explicitIndex < 0 || explicitIndex >= ProfileStore::MAX_PROFILE_COUNT))
        {
            ackError("LOAD_PROFILE", "index out of range");
            return;
        }
        const uint8_t activeIndex = activeProfileIndex;
        uint8_t targetIndex = hasIndex ? (uint8_t)explicitIndex : activeIndex;

        JsonDocument doc;
        DeserializationError err = deserializeJson(doc, Serial);
        if (err)
        {
            ackError("LOAD_PROFILE", parseError(err));
            return;
        }
        if (!schemaVersionOk("LOAD_PROFILE", doc, ProfileStore::CURRENT_SCHEMA_VERSION))
            return;

        ShotProfile newSettings;
        if (targetIndex == activeIndex)
        {
            newSettings = activeProfile; // seed from the live in-memory profile
        }
        else
        {
            ProfileStore::loadProfile(targetIndex,
                                      newSettings); // seed from that profile's own saved state
        }
        ProfileStore::fromJson(doc, newSettings);

        if (targetIndex == activeIndex)
        {
            activeProfile = newSettings;
            const bool clamped = clampAllSettings();
            ProfileStore::saveProfile(targetIndex, activeProfile);
            ackOk("LOAD_PROFILE", targetIndex, clamped, true);
            SerialLock::printKept();
            Serial.flush();
            delay(100);
            rebootReason = BootReason::MENU;
            rp2040.reboot();
        }
        else
        {
            ProfileStore::saveProfile(targetIndex, newSettings);
            ackOk("LOAD_PROFILE", targetIndex, false, false);
        }
    }
    else if (command == "DUMP_BOOT")
    {
        BootStatus::writeJson(Serial);
    }
    else if (command == "DUMP_GPIO")
    {
        GpioReport::writeJson(Serial);
    }
    else if (command == "DUMP_MOTORS")
    {
        // What the firmware believes it is commanding, against what the ESCs report back: identical
        // throttle with only one motor turning is an ESC-side failure.
        Serial.print("{\"cmd\":\"DUMP_MOTORS\",\"ok\":true,\"uptime_ms\":");
        Serial.print(millis());
        Serial.print(",\"flywheelState\":");
        Serial.print((int)flywheelState);
        Serial.print(",\"idleHoldActive\":");
        Serial.print(idleHoldActive ? "true" : "false");
        Serial.print(",\"idleHoldWanted\":");
        Serial.print(idleHoldWanted() ? "true" : "false");
        Serial.print(",\"menuOpen\":");
        Serial.print(menuIsOpen() ? "true" : "false");
        // The effective mode, so a stopped motor can be told apart from a blocked one: SAFE is the
        // one mode that refuses rev, and safetyEngaged says whether a switch or the menu chose it.
        Serial.print(",\"burstMode\":\"");
        Serial.print(burstMode < kBurstModeIdCount ? kBurstModeIds[burstMode] : "?");
        Serial.print("\",\"safetyEngaged\":");
        Serial.print(safetyEngaged ? "true" : "false");
        Serial.print(",\"revAllowed\":");
        Serial.print(revControlAllowed() ? "true" : "false");
        Serial.print(",\"speedPot\":");
        if (speedPotPin == PIN_NOT_USED)
            Serial.print("null");
        else
            Serial.print(speedPotRpm);
        Serial.print(",\"dart\":");
        if (dartSwitchPin == PIN_NOT_USED)
        {
            Serial.print("null");
        }
        else
        {
            Serial.print("{\"present\":");
            Serial.print(dartPresent ? "true" : "false");
            Serial.print(",\"emptiedSincePush\":");
            Serial.print(breechEmptiedSincePush ? "true" : "false");
            // How long a queued shot has waited for a dart; null while none is waiting.
            const uint32_t waitSince_ms = dartWaitSince_ms;
            Serial.print(",\"waitMs\":");
            if (waitSince_ms == 0)
                Serial.print("null");
            else
                Serial.print(millis() - waitSince_ms);
            Serial.print('}');
        }
        Serial.print(",\"motors\":[");
        for (int i = 0; i < 4; i++)
        {
            if (i)
                Serial.print(',');
            Serial.print("{\"enabled\":");
            Serial.print(motorsEnabled[i] ? "true" : "false");
            // What a rev aims for, speed pot applied; targetRPM is where the wheel is headed now.
            Serial.print(",\"revRPM\":");
            Serial.print(motorArr[i].revRPM);
            Serial.print(",\"targetRPM\":");
            Serial.print(motorArr[i].targetRPM);
            Serial.print(",\"motorRPM\":");
            Serial.print(motorArr[i].motorRPM);
            Serial.print(",\"throttle\":");
            Serial.print(motorArr[i].PIDOutput);
            Serial.print(",\"erpmSeen\":");
            Serial.print(motorArr[i].telemetryErpmSeen ? "true" : "false");
            // The EDT request goes out after arming, so these answer "did the request reach this
            // ESC" - the failure mode is one motor silently lacking extended telemetry.
            Serial.print(",\"edtSeen\":{\"v\":");
            Serial.print(motorArr[i].telemetryVoltageSeen ? "true" : "false");
            Serial.print(",\"i\":");
            Serial.print(motorArr[i].telemetryCurrentSeen ? "true" : "false");
            Serial.print(",\"t\":");
            Serial.print(motorArr[i].telemetryTempSeen ? "true" : "false");
            Serial.print("}");
            Serial.print('}');
        }
        Serial.println("]}");
    }
    else if (command == "DUMP_DEVICE")
    {
        JsonDocument doc;
        // Framing before the config, and here rather than in toJson() - see DUMP_PROFILE.
        doc["cmd"] = "DUMP_DEVICE";
        DeviceStore::toJson(deviceSettings, doc);
        serializeJson(doc, Serial);
        Serial.println();
    }
    else if (command == "LOAD_DEVICE")
    {
        // A preset is an ordinary partial config: fromJson() leaves a key the payload never mentions
        // at whatever the live settings hold, so applying one changes the wiring and nothing else.
        JsonDocument doc;
        DeserializationError err = deserializeJson(doc, Serial);
        if (err)
        {
            ackError("LOAD_DEVICE", parseError(err));
            return;
        }
        if (!schemaVersionOk("LOAD_DEVICE", doc, DeviceStore::CURRENT_SCHEMA_VERSION))
            return;
        DeviceSettings newSettings = deviceSettings;
        DeviceStore::fromJson(doc, newSettings);
        // Publish before clamping, same reason as LOAD_PROFILE - and this path always reboots.
        deviceSettings = newSettings;
        const bool clamped = clampAllSettings();
        DeviceStore::saveDeviceSettings(deviceSettings);
        ackOk("LOAD_DEVICE", -1, clamped, true);
        SerialLock::printKept();
        Serial.flush();
        delay(100);
        rebootReason = BootReason::MENU;
        rp2040.reboot();
    }
    else if (command == "LOAD_SPLASH")
    {
        // Binary, not JSON - SPLASH_BYTES raw bytes immediately follow the command on the wire.
        uint8_t buf[SplashStore::SPLASH_BYTES];
        size_t received = Serial.readBytes(buf, SplashStore::SPLASH_BYTES);
        if (received != SplashStore::SPLASH_BYTES)
        {
            logger.error("LOAD_SPLASH: expected ", (int)SplashStore::SPLASH_BYTES, " bytes, got ",
                         (int)received, " - rejected");
            return;
        }
        if (SplashStore::saveCustomSplash(buf))
            logger.info("LOAD_SPLASH: saved custom splash screen (takes effect next boot)");
        else
            logger.error("LOAD_SPLASH: failed to save");
    }
    else if (command == "CLEAR_SPLASH")
    {
        SplashStore::clearCustomSplash();
        logger.info("CLEAR_SPLASH: reverted to the default splash screen (takes effect next boot)");
    }
    else if (command == "DUMP_SPLASH")
    {
        // The image the next boot draws: the custom one, or the built-in one when none is set. In
        // the layout LOAD_SPLASH takes, base64 so it fits one JSON line.
        uint8_t buf[SplashStore::SPLASH_BYTES];
        const bool custom = SplashStore::loadCustomSplash(buf);
        if (!custom)
            memcpy(buf, splash, SplashStore::SPLASH_BYTES);
        Serial.print("{\"cmd\":\"DUMP_SPLASH\",\"ok\":true,\"custom\":");
        Serial.print(custom ? "true" : "false");
        Serial.print(",\"b64\":\"");
        printBase64(buf, SplashStore::SPLASH_BYTES);
        Serial.println("\"}");
    }
}
