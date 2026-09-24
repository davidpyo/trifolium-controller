#include <Arduino.h>
#include <cstdio>
#include <PIO_DShot.h>
#include "../lib/Bounce2/src/Bounce2.h"
#include "fetDriver.h"
#include "escDriver.h"
#include "elapsedMillis.h"
#include "pico/stdlib.h"
#include "CONFIGURATION.h"
#include "schemaDump.h"
#include "serialCommands.h"
#include "esc_passthrough.h"
#include "global.h"
#include "logging.h"
#include "flywheelMotor.h"
#include "menu.h"
#include "shotProfile.h"
#include "profileStore.h"
#include "deviceSettings.h"
#include "deviceStore.h"
#include "batteryMonitor.h"
#include "rpmLogger.h"
#include "displayManager.h"
#include "firingModeBehavior.h"
#include "bootStatus.h"
#include "pinConflicts.h"
#include "pinCapabilities.h"

#include <SPI.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "bitmaps.h"

#if CONFIG_VERSION_MAJOR != MAJOR_VERSION || CONFIG_VERSION_MINOR != MINOR_VERSION ||              \
    CONFIG_VERSION_PATCH != PATCH_VERSION
#error                                                                                             \
    "Your configuration file version does not match code version. Update your configuration file with the missing settings!"
#endif

#define SCREEN_WIDTH 128    // OLED display width, in pixels
#define SCREEN_HEIGHT 64    // OLED display height, in pixels
#define SCREEN_ADDRESS 0x3C ///< See datasheet for Address; 0x3C

int32_t batteryVoltageMax_mv[4] = {12600, 16800, 21000, 25200}; // 3S, 4S, 5S, 6S

ShotProfile activeProfile;
uint8_t activeProfileIndex; // which of the 3 named profiles activeProfile came from

DeviceSettings deviceSettings;

// setup1() (core 1) spins on this until core 0 finishes its boot-time profile/device load, so
// it can't race that load and skip DisplayManager::begin().
volatile bool bootSettingsLoaded = false;

BoardDisplay display(SCREEN_WIDTH, SCREEN_HEIGHT); // menu.cpp externs this directly
DisplayManager displayManager(display);

// Written once by setup() before bootSettingsLoaded, read by setup1() on core 1.
TwoWire* displayBus = nullptr;

// The pins actually attached this boot. PinConflicts::resolve() is the only writer and never writes
// deviceSettings back. PIN_NOT_USED, not the implicit zero, which pinDefined() calls wired.
uint8_t menuButtonPin = PIN_NOT_USED;
uint8_t triggerSwitchPin = PIN_NOT_USED;
uint8_t revSwitchPin = PIN_NOT_USED;
uint8_t cycleSwitchPin = PIN_NOT_USED;
uint8_t idleSwitchPin = PIN_NOT_USED;
uint8_t safetySwitchPin = PIN_NOT_USED;

// Whether this boot armed the device. NOT deviceSettings.wiringConfigured, which a LOAD_DEVICE can
// flip mid-run: loop() would then enter fwControlLoop() with no pusher and fault. Written once on
// core 0 before bootSettingsLoaded releases core 1, which is what makes it lock-free.
bool wiringLive = false;

// Same for the outputs: resolve() takes a pin away in RAM, leaving the stored config as written.
uint8_t ledDataPin = PIN_NOT_USED;
uint8_t batteryAdcPin = PIN_NOT_USED;
uint8_t escEnablePin = PIN_NOT_USED;

// deviceSettings.hasDisplay after the I2C pair has been judged. selectDisplayBus() re-checks, since
// setSDA must not be reached on an illegal pin whatever this says.
bool displayAllowed = false;

bool menuButtonNormallyClosed;
uint16_t debounceTime_ms;
// show runtime info
bool showRuntimeInfo = false;
bool updateRuntimeNow = false;
uint32_t runtimeShotCounter = 0;
uint32_t displayShotCounter = 0;
uint8_t pendingShotDetections = 0;
static const uint32_t kShotDetectionGraceMs = 250;

// rebooting stuff
BootReason bootReason;
BootReason __uninitialized_ram(rebootReason);
// Rides the same powerOnResetMagicNumber check as rebootReason: which switch ends the passthrough
// session being rebooted into, since the reason alone cannot say which of the three ways in it was.
u8 __uninitialized_ram(rebootPassthroughExit);
u64 __uninitialized_ram(powerOnResetMagicNumber);

uint32_t lastRevTime_ms = 0; // for calculating idling

uint32_t loopStartTimer_us = micros();
int32_t loopTime_us = targetLoopTime_us;
uint32_t lastMainLoopTime = millis();
uint32_t time_ms = millis();
// uint32_t lastRevTime_ms = 0; // for calculating idling
uint32_t pusherTimer_ms = 0;
uint32_t revStartTime_us = 0;
uint32_t triggerTime_ms = 0;
static uint32_t lastShotExtendTime_ms = 0; // for the per-shot achieved-DPS log line below
static float lastMeasuredDPS = 0; // last extend-to-extend rate, read by loop1() for Show DPS

uint32_t dwellTime_ms;
uint32_t idleTime_ms;
uint32_t currentSpindownSpeed = 0;
// The mode the blaster runs this tick. The override never writes the selection, so releasing the
// safety switch restores it with nothing to re-select.
burstFireType_t burstMode;
int8_t firingMode = 0;
static int8_t persistedFiringMode = 0;
int8_t activeSwitchPosition = -1; // -1 only until the first updateFiringMode() tick sets it
int8_t screenOverrideMode = -1;
int16_t shotsToFire = 0;
float liveTargetDPS = 0;
bool requestRev = false;
flywheelState_t flywheelState = STATE_IDLE;
bool firing = false;
float rpmScale_ = -1.0f;
int16_t buzzPulsesRequested_ = 0;

BatteryMonitor* batteryMonitor; // constructed in setup(), once activeProfile is loaded

const int32_t maxThrottle = 1999;
uint32_t half =
    0; // 1 << (deviceSettings.EMAFilter - 1); computed in setup(), once activeProfile is loaded
Driver* pusher;
uint16_t solenoidExtendTime_ms = 0;
float solenoidVoltageTimeSlope =
    0; // relationship between voltage and solenoid extend time calculated at setup
int16_t solenoidVoltageTimeIntercept = 0;
float maxAchievableDPS = 0;

bool enableFwControl = true;

volatile bool directMotorControlActive = false;

bool escDashboardOpen = false;

// SAFE beats everything here, the ESC dashboard included: a switch that stops the pusher but leaves
// the wheels turning is worse than none. Menu motor tests bypass this via directMotorControlActive.
bool revControlAllowed()
{
    return (!menuIsOpen() || escDashboardOpen) && burstMode != SAFE;
}

bool revSafetyLatched = false;

bool batteryWarningActive = false;

// Idle-hold's standing request: set by the BOOT_ACTION_IDLE_HOLD dispatch at power-on or the root
// menu's Idle Mode toggle. Neither persists it - any reboot starts false.
bool idleHoldActive = false;

// The safety switch, debounced. Written on core 0 - seeded in setup() before bootSettingsLoaded so
// core 1's first frame is already right - and read on either core through effectiveBurstMode().
bool safetyEngaged = false;

// SAFE while the switch is held, the selected mode otherwise. Every reader of the live mode goes
// through this, so the override reaches firing, the flywheels and the panel from one place.
burstFireType_t effectiveBurstMode(burstFireType_t selected)
{
    return safetyEngaged ? SAFE : selected;
}

// SAFE always spins fully down regardless, and the menu needs motors stopped for bench testing.
bool idleHoldWanted()
{
    return idleHoldActive && burstMode != SAFE && !menuIsOpen();
}

Bounce2::Button revSwitch = Bounce2::Button();
Bounce2::Button triggerSwitch = Bounce2::Button();
Bounce2::Button cycleSwitch = Bounce2::Button();
Bounce2::Button idleSwitch = Bounce2::Button();
Bounce2::Button safetySwitch = Bounce2::Button();
Bounce2::Button select0 = Bounce2::Button();
Bounce2::Button select1 = Bounce2::Button();
Bounce2::Button select2 = Bounce2::Button();
Bounce2::Button* selectSwitches[3] = {&select0, &select1, &select2};
uint8_t selectPins[3] = {PIN_NOT_USED, PIN_NOT_USED, PIN_NOT_USED}; // same as above

bool revRequestedNow()
{
    if (requestRev)
        return true;
    return !behaviorFor(burstMode).managesOwnRevLifecycle() && revSwitch.isPressed();
}

Motor motorsObj[4] = {Motor(0, 0, 0, 0), Motor(0, 0, 0, 0), Motor(0, 0, 0, 0), Motor(0, 0, 0, 0)};

// Runtime resolution of motorConfig[].enabled: validatePusherAndMotors() clears entries whose ESC
// channel this wiring cannot drive. The stored config is left alone.
bool motorsEnabled[4];
motorStage_t motorStages[4];

// Same idea for the pusher: cleared when the configured pusher channel can't be driven.
bool pusherValid = true;

// per-motor runtime state - one instance per motors[]/motorsObj[] slot
FlywheelMotor motorArr[4] = {FlywheelMotor(&motorsObj[0]), FlywheelMotor(&motorsObj[1]),
                             FlywheelMotor(&motorsObj[2]), FlywheelMotor(&motorsObj[3])};

RpmLogger rpmLogger;

void updateFiringMode();
void cycleFiringMode();
uint8_t selectShotProfileAtBoot();
bool fwControlLoop();
void mainFiringLogic();
void resetFWControl();
void registerShot();
void applyMotorConfig();
void applyEmaFilterConstant();
void applySolenoidTimingCurve();
void applyMaxAchievableDps();
void applyDebounceInterval();
void applyPrintTelemetry();
uint32_t computePusherDwellPadding_ms();

static bool firingModePersists()
{
    return deviceSettings.selectFireType == BUTTON_SELECT_FIRE ||
           deviceSettings.selectFireType == SCREEN_SELECT_FIRE;
}

bool pinDefined(uint8_t pin)
{
    return pin != PIN_NOT_USED;
}

// Wire or Wire1 repointed at the stored I2C pins, or null when none can serve them. setSDA/setSCL
// panic() on an illegal pin - an unrecoverable boot loop - so the legality test cannot be deferred.
static TwoWire* selectDisplayBus()
{
    if (!i2cPairUsable(deviceSettings.i2cSdaPin, deviceSettings.i2cSclPin))
        return nullptr; // no I2C wired, or the pair straddles both blocks

    TwoWire* bus = i2cUsesBlock0(deviceSettings.i2cSdaPin) ? &Wire : &Wire1;
    bus->setSDA(deviceSettings.i2cSdaPin);
    bus->setSCL(deviceSettings.i2cSclPin);
    bus->setTimeout(25, true); // bound a stuck bus; Stream's default is 1000 ms per transaction
    return bus;
}

uint8_t escPin(uint8_t motorIndex)
{
    return deviceSettings.escPins[motorIndex];
}

// Both halves are stored settings: how a pusher is wired is a fact about the build, not the PCB.
uint8_t pusherPin()
{
    if (deviceSettings.pusherDrive != PUSHER_DRIVE_ESC)
        return deviceSettings.pusherFetPin;
    return escPin(deviceSettings.pusherEscChannel);
}

bool isPusherEscChannel(uint8_t motorIndex)
{
    return deviceSettings.pusherDrive == PUSHER_DRIVE_ESC &&
           motorIndex == deviceSettings.pusherEscChannel;
}

int32_t atSpeedRpm(uint8_t motorIndex)
{
    return max((int32_t)motorArr[motorIndex].targetRPM - deviceSettings.firingRPMTolerance,
               deviceSettings.minFiringRPM);
}

void logData()
{
    // record() is a no-op unless a capture is currently armed (startCapture() succeeded and
    // hasn't been dumped yet) - no separate deviceSettings.useRpmLogging check needed here.
    rpmLogger.record(motorArr, motorsEnabled, batteryMonitor->getVoltage_mv());
}

// call this whenever a shot is detected/fired, regardless of which detection method triggered it
void registerShot()
{
    runtimeShotCounter++;
    displayShotCounter++;
    if (runtimeShotCounter % 10000 == 0)
    {
        displayShotCounter = 0;
    }
    updateRuntimeNow = true;
}

// Rebuilds motorsObj[i] from the active profile's PID gains/Kv/poles. Safe to call live.
void applyMotorConfig()
{
    for (int i = 0; i < 4; i++)
    {
        motorsObj[i] = Motor(deviceSettings.motorConfig[i].kp, deviceSettings.motorConfig[i].ki,
                             deviceSettings.motorConfig[i].motorKv,
                             deviceSettings.motorConfig[i].motorPolesDiv2);
    }
}

// Recomputes `half`, the EMA filter shift constant. EMAFilter must be >= 1.
void applyEmaFilterConstant()
{
    if (deviceSettings.EMAFilter == 0)
    {
        logger.warn("Profile EMAFilter is 0, clamping to 1");
        deviceSettings.EMAFilter = 1;
    }
    half = uint32_t{1} << (deviceSettings.EMAFilter - 1);
}

// Recomputes the solenoid extend-time/voltage slope+intercept from the four Solenoid/Pusher fields.
void applySolenoidTimingCurve()
{
    if (deviceSettings.pusherType != PUSHER_SOLENOID_OPENLOOP)
        return;

    if (deviceSettings.solenoidExtendTimeLow_ms == deviceSettings.solenoidExtendTimeHigh_ms ||
        deviceSettings.solenoidExtendTimeLowVoltage_mv >
            deviceSettings.solenoidExtendTimeHighVoltage_mv)
    { // if times are equal, don't do this calc
        solenoidVoltageTimeSlope = 0;
        solenoidVoltageTimeIntercept = deviceSettings.solenoidExtendTimeHigh_ms;
    }
    else
    {
        solenoidVoltageTimeSlope =
            (deviceSettings.solenoidExtendTimeHigh_ms - deviceSettings.solenoidExtendTimeLow_ms) /
            ((float)(deviceSettings.solenoidExtendTimeHighVoltage_mv -
                     deviceSettings.solenoidExtendTimeLowVoltage_mv));
        solenoidVoltageTimeIntercept =
            deviceSettings.solenoidExtendTimeHigh_ms -
            (solenoidVoltageTimeSlope * deviceSettings.solenoidExtendTimeHighVoltage_mv) + 1;
        logger.info("solenoidVoltageTimeSlope: ", solenoidVoltageTimeSlope);
        logger.info("solenoidVoltageTimeIntercept: ", solenoidVoltageTimeIntercept);
    }
}

void applyMaxAchievableDps()
{
    float extendAtVoltage_ms =
        batteryMonitor->getVoltage_mv() * solenoidVoltageTimeSlope + solenoidVoltageTimeIntercept;
    float cycle_ms = extendAtVoltage_ms + deviceSettings.solenoidRetractTime_ms;
    maxAchievableDPS = cycle_ms > 0 ? 1000.0f / cycle_ms : 0;
}

// Auto Timing's additive dwell on top of the existing voltage-compensated extend/retract cycle.
uint32_t computePusherDwellPadding_ms()
{
    if (liveTargetDPS <= 0)
        return 0;

    float extendAtVoltage_ms =
        batteryMonitor->getVoltage_mv() * solenoidVoltageTimeSlope + solenoidVoltageTimeIntercept;
    float cycleTarget_ms = 1000.0f / liveTargetDPS;
    float padding_ms = cycleTarget_ms - extendAtVoltage_ms - deviceSettings.solenoidRetractTime_ms;
    if (padding_ms < 0) // requested DPS isn't reachable - fire as fast as the hardware allows
        padding_ms = 0;
    return (uint32_t)padding_ms;
}

void applyDebounceInterval()
{
    debounceTime_ms = deviceSettings.debounceTime_ms;
    if (pinDefined(revSwitchPin))
        revSwitch.interval(debounceTime_ms);
    if (pinDefined(triggerSwitchPin))
        triggerSwitch.interval(debounceTime_ms);
    if (pinDefined(idleSwitchPin))
        idleSwitch.interval(debounceTime_ms);
    if (pinDefined(safetySwitchPin))
        safetySwitch.interval(debounceTime_ms);
    for (int i = 0; i < 3; i++)
    {
        if (pinDefined(selectPins[i]))
            selectSwitches[i]->interval(debounceTime_ms);
    }
    if (pinDefined(cycleSwitchPin))
        cycleSwitch.interval(deviceSettings.pusherDebounceTime_ms);
}

// Mirrors deviceSettings.printTelemetry into the plain global logging.h actually gates on.
void applyPrintTelemetry()
{
    printTelemetry = deviceSettings.printTelemetry;
}

// True if `pin` is held in its pressed state right now. Raw reads, because this runs before the
// Bounce2 instances are attached.
static bool heldAtBoot(uint8_t pin, bool normallyClosed)
{
    if (!pinDefined(pin))
        return false;
    pinMode(pin, INPUT_PULLUP);
    bool pressedLevel = normallyClosed ? HIGH : LOW;
    if (digitalRead(pin) != pressedLevel)
        return false;
    delay(50); // reject power-on electrical noise - must still read held after a beat
    return digitalRead(pin) == pressedLevel;
}

struct BootSwitch
{
    uint8_t pin;
    bool normallyClosed;
};

// The switch a bootButton_t names, with its own polarity. The select lines are attached with
// setPressedState(false) everywhere else, so they have no normally-closed option here either.
static BootSwitch bootSwitch(uint8_t button)
{
    const BootSwitch switches[BOOT_BTN_COUNT] = {
        {menuButtonPin, deviceSettings.menuButtonNormallyClosed},
        {triggerSwitchPin, deviceSettings.triggerSwitchNormallyClosed},
        {revSwitchPin, deviceSettings.revSwitchNormallyClosed},
        {cycleSwitchPin, deviceSettings.cycleSwitchNormallyClosed},
        {idleSwitchPin, deviceSettings.idleSwitchNormallyClosed},
        {selectPins[0], false},
        {selectPins[1], false},
        {selectPins[2], false},
    };
    if (button >= BOOT_BTN_COUNT)
        return {PIN_NOT_USED, false};
    return switches[button];
}

// The name the panel uses for a boot switch. Abbreviated from the boot-action row labels in
// menuDevice.cpp: one 128 px line has less room than a menu row.
static const char* bootSwitchName(uint8_t button)
{
    static const char* const names[BOOT_BTN_COUNT] = {
        "MENU", "TRIGGER", "REV", "CYCLE", "IDLE", "SELECT 0", "SELECT 1", "SELECT 2",
    };
    return button < BOOT_BTN_COUNT ? names[button] : "the switch";
}

// Which switch was held at power-on, and what the user mapped it to; first match wins. Only the
// caller's POR check makes this safe: a permanently-held pin would re-trigger every boot, and for
// ESC passthrough that is a lockout with BOOTSEL the only way out. Keep new actions inside it.
static bootAction_t evaluateBootAction(uint8_t& firedButton)
{
    firedButton = kNoBootButton;
    for (uint8_t i = 0; i < BOOT_BTN_COUNT; i++)
    {
        if (deviceSettings.bootAction[i] == BOOT_ACTION_NONE)
            continue;
        // With a dual-stage trigger, rev is the trigger's first stage, so pulling the trigger holds
        // rev too. Honouring rev's action would shadow the trigger's own.
        if (i == BOOT_BTN_REV && deviceSettings.dualStageTrigger)
            continue;
        const BootSwitch sw = bootSwitch(i);
        if (heldAtBoot(sw.pin, sw.normallyClosed))
        {
            firedButton = i;
            return deviceSettings.bootAction[i];
        }
    }
    return BOOT_ACTION_NONE;
}

// Pusher and motor channels this wiring can't drive, resolved before anything reads motorsEnabled[].
// An enabled motor on an undefined channel is undefined behaviour: BidirDShotX1 leaves pio/sm
// unassigned for an out-of-range pin and sendRaw12Bit() never checks iError.
static void validatePusherAndMotors()
{
    if (deviceSettings.pusherDrive == PUSHER_DRIVE_ESC && !pinDefined(pusherPin()))
    {
        pusherValid = false;
        PinConflicts::record("pusher", PIN_NOT_USED, "unwired",
                             PinConflicts::Action::PusherDisabled);
        logger.error("Pusher ESC channel ", (int)deviceSettings.pusherEscChannel + 1,
                     " has no pin in this wiring - pusher disabled");
    }
    else if (deviceSettings.pusherDrive == PUSHER_DRIVE_FET && !pinDefined(pusherPin()))
    {
        // Said, but not recorded as a conflict: an unset gate pin is an answer - a build with no
        // pusher - rather than something taken away, and the conflicts array means "these collided".
        logger.warn("Pusher gate pin is unused - no pusher on this build");
    }

    // The motor gives way, not the pusher: a blaster down one flywheel still fires.
    static const char* const motorFields[4] = {"motor1", "motor2", "motor3", "motor4"};
    for (int i = 0; i < 4; i++)
    {
        if (!motorsEnabled[i])
            continue;
        if (isPusherEscChannel(i))
        {
            motorsEnabled[i] = false;
            PinConflicts::record(motorFields[i], escPin(i), "pusher",
                                 PinConflicts::Action::MotorDisabled);
            logger.error("Motor ", i + 1, " is the pusher ESC channel - motor disabled. Change the "
                                          "pusher channel or disable this motor.");
        }
        else if (!pinDefined(escPin(i)))
        {
            motorsEnabled[i] = false;
            PinConflicts::record(motorFields[i], PIN_NOT_USED, "unwired",
                                 PinConflicts::Action::MotorDisabled);
            logger.error("Motor ", i + 1, " has no ESC pin in this wiring - motor disabled");
        }
    }
}

// ESC startup: zero throttle until every enabled ESC answers, then the EDT request. An ESC still in
// its own power-on init can miss a fixed number of frames entirely - one board measures 336 ms and
// 1545 ms for its two. An eRPM frame means listening, not armed; the dwell after it is what arms.
static bool escStartupComplete()
{
    enum Phase : uint8_t
    {
        ARMING,
        REQUESTING_EDT,
        DONE
    };
    static Phase phase = ARMING;
    if (phase == DONE)
        return true;

    const uint32_t kArmDwell_ms = 1500;   // zero throttle held after the last ESC answers
    const uint32_t kArmTimeout_ms = 6000; // ceiling, for an ESC that never reports eRPM

    static uint32_t start_ms = 0;
    static uint32_t dwellStart_ms = 0;
    static bool dwelling = false;
    static int32_t answeredAt_ms[4] = {-1, -1, -1, -1};
    static int8_t edtRepeatsLeft = 10;

    if (start_ms == 0)
        start_ms = time_ms;

    if (phase == ARMING)
    {
        bool allAnswered = true;
        for (int i = 0; i < 4; i++)
        {
            if (!motorsEnabled[i])
                continue;
            motorArr[i].sendThrottle(0);
            if (answeredAt_ms[i] < 0 && motorArr[i].pumpTelemetry())
            {
                answeredAt_ms[i] = (int32_t)(time_ms - start_ms);
                logger.info("Motor ", i + 1, " ESC answered after ", answeredAt_ms[i], "ms");
            }
            allAnswered = allAnswered && answeredAt_ms[i] >= 0;
        }

        if (allAnswered && !dwelling)
        {
            dwelling = true;
            dwellStart_ms = time_ms;
        }

        const bool dwelt = dwelling && time_ms - dwellStart_ms >= kArmDwell_ms;
        const bool timedOut = time_ms - start_ms >= kArmTimeout_ms;
        if (!dwelt && !timedOut)
            return false;

        if (timedOut && !dwelt)
        {
            for (int i = 0; i < 4; i++)
            {
                if (motorsEnabled[i] && answeredAt_ms[i] < 0)
                    logger.warn("Motor ", i + 1, " ESC never reported eRPM - arming blind");
            }
        }
        BootStatus::recordEscArming(answeredAt_ms, time_ms - start_ms, timedOut && !dwelt);
        phase = REQUESTING_EDT;
        return false;
    }

    // One command per tick, in place of that tick's throttle, so no motor gets two frames in one
    // loop. After arming, not in setup(): an ESC still in its own init never hears a request there.
    for (int i = 0; i < 4; i++)
    {
        if (motorsEnabled[i])
            motorArr[i].esc->sendRaw11Bit(DSHOT_CMD_EXTENDED_TELEMETRY_ENABLE);
    }
    if (--edtRepeatsLeft <= 0)
        phase = DONE;
    return false;
}

// Everything a device can do without knowing which GPIOs are safe to drive. No pinMode call is made
// anywhere on this path, so every GPIO stays in its reset state.
static void runUnconfiguredBoot()
{
    // Seeds the resolved pins and stops there: with no wiring nothing claims a GPIO. Makes no
    // pinMode call, which is the property this path exists to keep.
    PinConflicts::resolve();

    ProfileStore::loadProfile(activeProfileIndex, activeProfile);

    // PIN_NOT_USED makes begin() skip the ADC and report a nominal cellCount * 3500 mV, so the paths
    // that dereference batteryMonitor stay safe and the DPS bounds aren't degenerate.
    batteryMonitor = new BatteryMonitor(PIN_NOT_USED, deviceSettings.voltageCalibrationFactor,
                                        deviceSettings.voltageAveragingWindow,
                                        cellCount(deviceSettings.batteryType));
    batteryMonitor->begin();
    applySolenoidTimingCurve();
    applyMaxAchievableDps();
    clampAllSettings();

    displayManager.setHasDisplay(false);
    bootSettingsLoaded = true; // release core 1 so loop1() can serve the console
}

void setup()
{
    uint8_t passthroughExit = kNoBootButton;
    if (powerOnResetMagicNumber == 0xdeadbeefdeadbeef)
    {
        bootReason = rebootReason;
        passthroughExit = rebootPassthroughExit;
    }
    else
    {
        bootReason = BootReason::POR;
    }
    powerOnResetMagicNumber = 0xdeadbeefdeadbeef;
    rebootReason = BootReason::WATCHDOG;
    rebootPassthroughExit = kNoBootButton;
    serialCommandsBegin();

    ProfileStore::begin();
    activeProfileIndex = ProfileStore::loadActiveProfileIndex();
    DeviceStore::LoadResult loaded = DeviceStore::loadDeviceSettings(deviceSettings);
    applyPrintTelemetry(); // as early as possible so logging behaves correctly for the rest of boot

    // Recorded because the boot line announcing it is gone from the port before a host can attach.
    (void)loaded;
    wiringLive = deviceSettings.wiringConfigured;
    BootStatus::recordWiring(deviceSettings.boardId.c_str(), wiringLive);

    for (int i = 0; i < 4; i++)
    {
        motorsEnabled[i] = deviceSettings.motorConfig[i].enabled;
        motorStages[i] = deviceSettings.motorConfig[i].stage;
    }

    // The gate. Everything below this drives GPIO or builds something that does, and none of it
    // knows which pins are safe until a wiring exists.
    if (!wiringLive)
    {
        // Before core 1 is released: handleSerialCommands() gates on TO_ESC_PASSTHROUGH, so leaving
        // the latch set would mute serial for the rest of the boot.
        if (bootReason == BootReason::TO_ESC_PASSTHROUGH)
        {
            logger.info("ESC passthrough asked for on an unwired device - booting normally");
            bootReason = BootReason::FROM_ESC_PASSTHROUGH;
        }
        runUnconfiguredBoot();
        return;
    }

    // Both before evaluateBootAction(), which reaches pinMode() through heldAtBoot(). resolve()
    // builds its claimed-pin set from motorsEnabled[], so undrivable motors have to leave it first.
    validatePusherAndMotors();
    PinConflicts::resolve();

    // Active-high, and ahead of ESC passthrough and arming, which both need the ESCs powered. The pin
    // floats until here, so a board wiring it pulls it down. The low-voltage cutoff drops it again.
    if (pinDefined(escEnablePin))
    {
        pinMode(escEnablePin, OUTPUT);
        digitalWrite(escEnablePin, HIGH);
    }

    // The action mapped to whichever switch is held at power-on. Runs before the pins below are
    // attached, so it reads them raw.
    int8_t bootProfile = -1;
    if (bootReason == BootReason::POR)
    {
        uint8_t firedButton = kNoBootButton;
        const bootAction_t action = evaluateBootAction(firedButton);
        switch (action)
        {
        case BOOT_ACTION_BOOTLOADER:
            rp2040.rebootToBootloader();
            break;
        case BOOT_ACTION_ESC_PASSTHROUGH:
            // The switch that asked for the session is the one that ends it.
            rebootPassthroughExit = firedButton;
            rebootReason = BootReason::TO_ESC_PASSTHROUGH;
            delay(100);
            rp2040.reboot();
            break;
        case BOOT_ACTION_IDLE_HOLD:
            // No reboot - loop()'s flywheel state machine reads this latch for the rest of the
            // session instead.
            idleHoldActive = true;
            BootStatus::recordIdleHold(true);
            break;
        case BOOT_ACTION_PROFILE_0:
        case BOOT_ACTION_PROFILE_1:
        case BOOT_ACTION_PROFILE_2:
            // For this boot only: /active.cfg is left alone, so the next plain power-on is back on
            // the stored profile.
            bootProfile = (int8_t)(action - BOOT_ACTION_PROFILE_0);
            break;
        default:
            break;
        }
    }

    menuButtonNormallyClosed = deviceSettings.menuButtonNormallyClosed;
    debounceTime_ms = deviceSettings.debounceTime_ms;

    // Before bootSettingsLoaded: setSDA/setSCL panic once the bus is running, and core 1 starts it.
    // displayAllowed too - the conflict engine may have taken the panel away already.
    displayBus = displayAllowed ? selectDisplayBus() : nullptr;
    display.bindWire(displayBus);
    displayManager.setHasDisplay(displayAllowed);

    // The selector has to be readable before the profile is chosen, which has to happen before core 1
    // is released. Still after evaluateBootAction(), which reads the same pins raw.
    if (pinDefined(revSwitchPin))
    {
        revSwitch.attach(revSwitchPin, INPUT_PULLUP);
        revSwitch.setPressedState(deviceSettings.revSwitchNormallyClosed);
    }
    if (pinDefined(triggerSwitchPin))
    {
        triggerSwitch.attach(triggerSwitchPin, INPUT_PULLUP);
        triggerSwitch.setPressedState(deviceSettings.triggerSwitchNormallyClosed);
    }
    if (pinDefined(cycleSwitchPin))
    {
        cycleSwitch.attach(cycleSwitchPin, INPUT_PULLUP);
        cycleSwitch.interval(deviceSettings.pusherDebounceTime_ms);
        cycleSwitch.setPressedState(deviceSettings.cycleSwitchNormallyClosed);
    }
    if (pinDefined(idleSwitchPin))
    {
        idleSwitch.attach(idleSwitchPin, INPUT_PULLUP);
        idleSwitch.setPressedState(deviceSettings.idleSwitchNormallyClosed);
    }
    if (pinDefined(safetySwitchPin))
    {
        safetySwitch.attach(safetySwitchPin, INPUT_PULLUP);
        safetySwitch.setPressedState(deviceSettings.safetySwitchNormallyClosed);
        // Seeded here, not left to the first loop() tick: core 1 reads it, and everything core 1
        // reads is written before bootSettingsLoaded below.
        safetySwitch.update();
        safetyEngaged = safetySwitch.isPressed();
    }
    setupMenuButton();
    if (deviceSettings.selectFireType != NO_SELECT_FIRE)
    {
        for (int i = 0; i < 3; i++)
        {
            if (i == 0 && menuButtonDrivesModeCycle())
                continue;
            if (pinDefined(selectPins[i]))
            {
                selectSwitches[i]->attach(selectPins[i], INPUT_PULLUP);
                selectSwitches[i]->setPressedState(false);
            }
        }
    }
    applyDebounceInterval();

    // Settled before core 1 can be asked: everything core 1 reads is written before
    // bootSettingsLoaded. The release cannot move later - the splash and the conflict banner are
    // drawn from core 0 through a display core 1 has not yet brought up.
    if (deviceSettings.variableFPS)
    {
        activeProfileIndex = selectShotProfileAtBoot();
    }
    if (bootProfile >= 0)
    {
        activeProfileIndex = (uint8_t)bootProfile; // mapping the action outranks the selector
    }
    BootStatus::recordBootProfile(bootProfile);
    ProfileStore::loadProfile(activeProfileIndex, activeProfile);

    bootSettingsLoaded = true;

    applyEmaFilterConstant();
    applyMotorConfig();

    // only do esc passthrough for the motors that are defined and esc driver pin if defined
    u8 numPassthrough = 0;
    for (int i = 0; i < 4; i++)
    {
        if (motorsEnabled[i])
        {
            numPassthrough++;
        }
    }
    if (deviceSettings.pusherDrive == PUSHER_DRIVE_ESC && pusherValid)
    {
        numPassthrough++;
    }

    // beginPassthrough() clamps a zero count up to 1 and then reads pins[0], so passthrough needs
    // at least one ESC pin to hand over. No switch required - a host asked for it.
    if (bootReason == BootReason::TO_ESC_PASSTHROUGH && numPassthrough == 0)
    {
        logger.error("ESC passthrough has no ESC pin to hand over - skipping");
        bootReason = BootReason::FROM_ESC_PASSTHROUGH;
    }

    if (bootReason == BootReason::TO_ESC_PASSTHROUGH)
    {
        // The switch that asked for the session is the one that ends it. Serial entry names none,
        // because the host that asked closes the port instead.
        const BootSwitch exit = bootSwitch(passthroughExit);
        const bool exitBySwitch = pinDefined(exit.pin);
        Bounce2::Button exitSwitch = Bounce2::Button();
        if (exitBySwitch)
        {
            exitSwitch.attach(exit.pin, INPUT_PULLUP);
            exitSwitch.interval(debounceTime_ms);
            exitSwitch.setPressedState(exit.normallyClosed);
        }

        u8 pins[numPassthrough] = {0};
        u8 currentPin = 0;
        for (int i = 0; i < 4; i++)
        {
            if (motorsEnabled[i])
            {
                pins[currentPin] = escPin(i);
                currentPin++;
            }
        }
        if (deviceSettings.pusherDrive == PUSHER_DRIVE_ESC && pusherValid)
        {
            pins[currentPin] = pusherPin();
        }

        char exitLine[48];
        if (exitBySwitch)
            snprintf(exitLine, sizeof(exitLine), "ESC Passthrough, hold %s to exit",
                     bootSwitchName(passthroughExit));
        else
            snprintf(exitLine, sizeof(exitLine), "ESC Passthrough, disconnect to exit");
        displayManager.showText(exitLine, 0, 0, true);

        static const unsigned long kExitHold_ms = 3000;
        // Only while nothing has ever connected: after that the port close is the exit, and a cap
        // firing mid-write during an ESC flash would be worse than a long session.
        static const unsigned long kNoHostTimeout_ms = 5UL * 60UL * 1000UL;

        const uint32_t clockBefore_hz = clock_get_hz(clk_sys);
        beginPassthrough(pins, numPassthrough);
        unsigned long sessionStart = millis();
        unsigned long currentTime = sessionStart;
        bool exitEverReleased = false;
        bool hostSeen = false;
        while (processPassthrough())
        {
            if (Serial)
                hostSeen = true;
            if (exitBySwitch)
            {
                exitSwitch.update();
                if (!exitSwitch.isPressed())
                {
                    exitEverReleased = true;
                    currentTime = millis();
                }
                // A switch pressed from the moment passthrough opened is one still held from
                // power-on, not an exit gesture. Without a release first, the session exits at once.
                if (exitEverReleased && millis() - currentTime > kExitHold_ms)
                {
                    break;
                }
            }
            if (!hostSeen && millis() - sessionStart > kNoHostTimeout_ms)
            {
                logger.error("ESC passthrough timed out after 5 min - nothing ever connected");
                break;
            }
        }

        // Falls through into a normal boot rather than rebooting out: nothing below has driven a
        // pin or claimed a PIO block yet, so there is nothing a reboot would be tidying up.
        endPassthrough();
        if (clock_get_hz(clk_sys) != clockBefore_hz)
        {
            // endPassthrough() restores the clock with required = false, so this is the only thing
            // standing between a failed restore and a boot that runs DShot, I2C and SPI 5.6% fast.
            logger.error("ESC passthrough left clk_sys at ", clock_get_hz(clk_sys),
                         " Hz - rebooting instead of booting on it");
            rebootReason = BootReason::FROM_ESC_PASSTHROUGH;
            delay(100);
            rp2040.reboot();
        }
        bootReason = BootReason::FROM_ESC_PASSTHROUGH;
        BootStatus::recordPassthroughExit();
    }
    // display bootup screen if available
    displayManager.requestBootupSplash();
    logger.info("Booting");
    // delay to allow gpio to stabilize
    delay(1000);

    // losses(), not count(): an advisory takes nothing away, and a banner on a correctly wired
    // blaster would train people to ignore the one that matters.
    if (PinConflicts::losses())
    {
        String note = String(PinConflicts::losses()) + " pin conflict" +
                      (PinConflicts::losses() == 1 ? "" : "s") + "\nresolved for this boot.\n" +
                      (PinConflicts::menuButtonLost() ? "MENU BUTTON LOST" : "Check the console.");
        displayManager.showText(note, 0, 0, true);
        delay(2500);
    }

    batteryMonitor = new BatteryMonitor(batteryAdcPin, deviceSettings.voltageCalibrationFactor,
                                        deviceSettings.voltageAveragingWindow,
                                        cellCount(deviceSettings.batteryType));
    batteryMonitor->begin();

    if (pinDefined(ledDataPin))
    {
        pinMode(ledDataPin, OUTPUT);
        digitalWrite(ledDataPin, HIGH); // steady on = armed, blinks on low-voltage cutoff
    }

    // Every branch has to leave `pusher` non-null: fwControlLoop() calls pusher->update()
    // unconditionally. Fet on PIN_NOT_USED is the inert stand-in.
    if (!pusherValid)
    {
        pusher = new Fet(PIN_NOT_USED);
    }
    else
    {
        switch (deviceSettings.pusherDrive)
        {
        case PUSHER_DRIVE_ESC:
            pusher = new EscDriver(pusherPin(), dshotRate(deviceSettings.dshotMode));
            break;
        case PUSHER_DRIVE_FET:
        default:
            pusher = new Fet(pusherPin());
            break;
        }
    }

    applySolenoidTimingCurve();
    applyMaxAchievableDps();

    // Clamps whatever is in flash into the range the menu enforces. Stays here: the bounds derive
    // from batteryMonitor and the two calls above, and firingMode below is read after the clamp.
    clampAllSettings();
    firingMode = (int8_t)activeProfile.defaultFiringMode;
    logger.info("activeProfileIndex: ", activeProfileIndex);

    if (firingModePersists())
    {
        int8_t storedMode = ProfileStore::loadLastFiringMode(activeProfileIndex);
        if (storedMode >= 0 && storedMode < (int8_t)activeProfile.activeModeCount)
            firingMode = storedMode;
        persistedFiringMode = firingMode;
        logger.info("Boot firingMode ", firingMode);
    }

    for (int i = 0; i < 4; i++)
    {
        if (motorsEnabled[i])
        {
            motorArr[i].revRPM = activeProfile.revRPM[i];
            motorArr[i].attachEsc(new BidirDShotX1(escPin(i), dshotRate(deviceSettings.dshotMode)));
        }
    }
    dwellTime_ms = activeProfile.dwellTime_ms;
    idleTime_ms = activeProfile.idleTime_ms;

    showRuntimeInfo = true;
}

void loop()
{
    // wiringLive, not the stored flag: a LOAD_DEVICE that arms the device publishes before it
    // reboots, and this boot never constructed the pusher or the ESCs.
    if (!wiringLive)
    {
        delay(10);
        return;
    }

    loopStartTimer_us = micros();
    time_ms = millis();
    fwControlLoop();

    if (lastMainLoopTime != time_ms)
    { // run main loop roughly every 1 ms
        mainFiringLogic();
        lastMainLoopTime = time_ms;
    }
}

void mainFiringLogic()
{
    if (pinDefined(revSwitchPin))
    {
        revSwitch.update();
        if (revSwitch.pressed())
        {
            logger.info("Rev switch pressed");
        }
        else if (revSwitch.released())
        {
            logger.info("Rev switch released");
            revSafetyLatched = false;
        }
    }
    if (pinDefined(triggerSwitchPin))
    {
        triggerSwitch.update();
        if (triggerSwitch.pressed())
        {
            logger.info("Trigger switch pressed");
        }
        else if (triggerSwitch.released())
        {
            logger.info("Trigger switch released");
        }
    }
    if (pinDefined(idleSwitchPin))
    {
        idleSwitch.update();
        if (idleSwitch.pressed())
        {
            logger.info("Idle switch pressed");
        }
        else if (idleSwitch.released())
        {
            logger.info("Idle switch released");
        }
    }
    if (pinDefined(safetySwitchPin))
    {
        safetySwitch.update();
        if (safetySwitch.pressed())
        {
            logger.info("Safety switch engaged");
        }
        else if (safetySwitch.released())
        {
            logger.info("Safety switch released");
        }
        safetyEngaged = safetySwitch.isPressed();
    }
    int8_t previousFiringMode = firingMode;
    updateFiringMode();
    burstMode = effectiveBurstMode(activeProfile.fireModes[firingMode].burstMode);
    if (firingMode != previousFiringMode)
        liveTargetDPS = activeProfile.fireModes[firingMode].targetDPS;

    requestRev = false;

    if (menuIsOpen())
    {
        shotsToFire = 0;
    }
    else
    {
        TriggerEvent event = triggerSwitch.pressed()     ? TriggerEvent::PRESSED
                             : triggerSwitch.released()  ? TriggerEvent::RELEASED
                             : triggerSwitch.isPressed() ? TriggerEvent::HELD
                                                         : TriggerEvent::IDLE;

        if (event == TriggerEvent::PRESSED)
            liveTargetDPS = activeProfile.fireModes[firingMode].targetDPS;

        FiringContext ctx{
            shotsToFire,
            liveTargetDPS,
            time_ms,
            triggerTime_ms,
            activeProfile.fireModes[firingMode].binaryTriggerTimeout_ms,
            activeProfile.fireModes[firingMode].burstLength,
            activeProfile.fireModes[firingMode].reversible,
            requestRev,
            rpmScale_,
            buzzPulsesRequested_,
            flywheelState == STATE_FULLSPEED,
            safetyEngaged,
        };
        behaviorFor(burstMode).update(ctx, event);
    }
    batteryMonitor->update();
}

static uint32_t ledTime_ms = 0;
static bool ledOn = true;

void checkLowVoltageCutoff()
{
    if (batteryMonitor->isDefined() && time_ms > 2000)
    {
        uint8_t cells = cellCount(deviceSettings.batteryType);
        bool belowCutoff =
            batteryMonitor->getVoltage_mv() < deviceSettings.lowVoltageCutoffPerCell_mv * cells;
        // On the way into cutoff only: this runs every control loop iteration, so reporting each
        // pass would put hundreds of lines a second on the port.
        static bool cutoffReported = false;
        if (belowCutoff)
        {
            if (pinDefined(escEnablePin))
                digitalWrite(escEnablePin, LOW); // cut power to ESCs and pusher
            if (!cutoffReported)
            {
                cutoffReported = true;
                logger.error("Battery low, shutting down! ", batteryMonitor->getVoltage_mv(), "mv");
            }
        }
        else
        {
            cutoffReported = false;
        }
        // Non-cutoff early warning - lowVoltageWarningPerCell_mv is above the cutoff, so this
        // trips first as the battery depletes.
        batteryWarningActive =
            batteryMonitor->getVoltage_mv() < deviceSettings.lowVoltageWarningPerCell_mv * cells;

        if (pinDefined(ledDataPin))
        {
            bool shouldBlink =
                (deviceSettings.ledWarningMode == LED_WARNING_LOW_BATT && belowCutoff) ||
                (deviceSettings.ledWarningMode == LED_WARNING_WARN_BATT && batteryWarningActive);
            if (!shouldBlink)
            {
                digitalWrite(ledDataPin, HIGH);
            }
            else if (time_ms > ledTime_ms + 500)
            {
                ledTime_ms = time_ms;
                ledOn = !ledOn;
                digitalWrite(ledDataPin, ledOn ? HIGH : LOW);
            }
        }
    }
}

// RPM-drop-based shot detection
void checkRpmDropShotDetection()
{
    if (pendingShotDetections == 0 || !deviceSettings.useRpmBaseShotCounter)
    {
        return;
    }
    if (flywheelState == STATE_ACCELERATING)
    {
        return;
    }
    for (int i = 0; i < 4; i++)
    {
        if (motorsEnabled[i])
        {
            if ((motorArr[i].targetRPM > motorArr[i].motorRPM) &&
                (motorArr[i].targetRPM - motorArr[i].motorRPM > deviceSettings.rpmDropThreshold))
            {
                motorArr[i].shotsUnderThreshold++;
            }
        }

        if (motorArr[i].shotsUnderThreshold >= deviceSettings.goodRpmShotReads)
        {
            logger.info("SHOT DETECTED!!!");
            registerShot();
            pendingShotDetections--;
            for (int j = 0; j < 4; j++)
            {
                motorArr[j].shotsUnderThreshold = 0;
            }
            break;
        }
    }
}

static int16_t buzzPulsesRemaining_ = 0;
static bool buzzPulsing_ = false;
static uint32_t buzzPulseTimer_ms = 0;
static const uint32_t kBuzzPulseGapMs = 60; // fixed spacing between pulses within one burst

void handlePlasmaBuzzPulse()
{
    if (deviceSettings.vibrationPulseMs == 0) // 0 = disabled
    {
        buzzPulsesRequested_ = 0;
        return;
    }
    if (buzzPulsesRequested_ > 0 && buzzPulsesRemaining_ == 0 && !buzzPulsing_ && !firing)
    {
        buzzPulsesRemaining_ = buzzPulsesRequested_;
        buzzPulsesRequested_ = 0;
    }
    if (buzzPulsesRemaining_ == 0 || firing) // never fight a real shot for the solenoid
        return;

    if (!buzzPulsing_ && time_ms >= buzzPulseTimer_ms)
    {
        pusher->drive(1.0f, deviceSettings.pusherReverseDirection);
        buzzPulsing_ = true;
        buzzPulseTimer_ms = time_ms + deviceSettings.vibrationPulseMs;
    }
    else if (buzzPulsing_ && time_ms >= buzzPulseTimer_ms)
    {
        pusher->coast();
        buzzPulsing_ = false;
        buzzPulsesRemaining_--;
        buzzPulseTimer_ms = time_ms + kBuzzPulseGapMs;
    }
}

// The battery reading, floored at the configured cutoff, for every throttle calculation. The divider
// reads far below the real pack for seconds after power-on, and 0 on USB power alone, and it sits in
// a denominator - a low reading inflates the throttle, and a zero one divides by it.
static int32_t throttleReferenceVoltage_mv()
{
    const int32_t floor_mv =
        (int32_t)deviceSettings.lowVoltageCutoffPerCell_mv * cellCount(deviceSettings.batteryType);
    return max(batteryMonitor->getVoltage_mv(), floor_mv);
}

// Open-loop control only ratchets throttle down (FlywheelMotor::updateOpenLoop()), so restarting
// motors from a stop needs a direct kick.
static void kickMotorsToIdle()
{
    currentSpindownSpeed = 0;
    for (int i = 0; i < 4; i++)
    {
        if (motorsEnabled[i])
        {
            motorArr[i].targetRPM = activeProfile.idleRPM[i];
            motorArr[i].PIDOutput = maxThrottle * motorArr[i].targetRPM /
                                    throttleReferenceVoltage_mv() * 1000 /
                                    motorArr[i].m_config->m_motorKv;
        }
    }
}

bool fwControlLoop()
{
    if (directMotorControlActive)
    {
        pusher->update();
        loopTime_us = micros() - loopStartTimer_us;
        if (loopTime_us > targetLoopTime_us)
        {
            logger.warn("Loop over time, ", loopTime_us);
        }
        else
        {
            delayMicroseconds(max((long)(0), (long)(targetLoopTime_us - loopTime_us)));
            loopTime_us = targetLoopTime_us;
        }
        return true;
    }

    // Nothing commands a real throttle until the ESCs have had their zero-throttle window. It
    // sends its own frames, so this keeps the loop's cadence rather than skipping a tick.
    if (!escStartupComplete())
    {
        pusher->update();
        loopTime_us = micros() - loopStartTimer_us;
        if (loopTime_us > targetLoopTime_us)
        {
            logger.warn("Loop over time, ", loopTime_us);
        }
        else
        {
            delayMicroseconds(max((long)(0), (long)(targetLoopTime_us - loopTime_us)));
            loopTime_us = targetLoopTime_us;
        }
        return true;
    }

    switch (flywheelState)
    {

    case STATE_IDLE:
        checkLowVoltageCutoff();

        {
            // Catch the instant the menu closes so motors resume at idle - the ratchet below only
            // pulls targetRPM down, so real RPM would stay wherever it decayed to.
            static bool menuWasOpenForIdleHold = false;
            bool menuOpenNow = menuIsOpen();
            if (menuWasOpenForIdleHold && !menuOpenNow && idleHoldWanted())
                kickMotorsToIdle();
            menuWasOpenForIdleHold = menuOpenNow;
        }

        if (shotsToFire > 0 || (revControlAllowed() && revRequestedNow() && !revSafetyLatched))
        {
            enableFwControl = true;
            revStartTime_us = loopStartTimer_us;
            for (int i = 0; i < 4; i++)
            {
                motorArr[i].targetRPM = motorArr[i].revRPM; // Copy revRPM to targetRPM
            }
            lastRevTime_ms = time_ms;
            flywheelState = STATE_ACCELERATING;
            currentSpindownSpeed = 0; // reset spindownSpeed
            resetFWControl();
            if (deviceSettings.flywheelControl == TBH_CONTROL)
            {
                for (int i = 0; i < 4; i++)
                {
                    if (motorsEnabled[i])
                    {
                        // for optimal rev let's set throttle to max until first crossing
                        motorArr[i].PIDOutput =
                            max(min(maxThrottle, (maxThrottle * motorArr[i].targetRPM /
                                                  throttleReferenceVoltage_mv() * 1000 /
                                                  motorArr[i].m_config->m_motorKv) +
                                                     deviceSettings.throttleCap),
                                0);
                        // premptly setup TBH variable to reduce overshoot
                        motorArr[i].PIDIntegral =
                            (2 *
                             map(((motorArr[i].targetRPM * 1000) / motorArr[i].m_config->m_motorKv),
                                 0, throttleReferenceVoltage_mv(), 0, maxThrottle)) -
                            motorArr[i].PIDOutput;
                    }
                }
            }
            if (deviceSettings.useRpmLogging)
            {
                if (!rpmLogger.startCapture(deviceSettings.rpmLogLength))
                    logger.error(
                        "RPM logging: capture buffer allocation failed, skipping this rev");
            }
        }
        else if ((time_ms < lastRevTime_ms + dwellTime_ms && lastRevTime_ms > 0) ||
                 pendingShotDetections > 0)
        { // dwell flywheels
            if (pendingShotDetections > 0 && time_ms > pusherTimer_ms +
                                                           deviceSettings.solenoidRetractTime_ms +
                                                           kShotDetectionGraceMs)
            {
                // Gave up waiting - a dry fire never produces the drop.
                pendingShotDetections = 0;
                for (int j = 0; j < 4; j++)
                {
                    motorArr[j].shotsUnderThreshold = 0;
                }
            }
            else
            {
                // logger.info("Holding for dwell");
            }
        }
        else if (((pinDefined(idleSwitchPin) && idleSwitch.isPressed() && burstMode != SAFE) ||
                  idleHoldWanted()) &&
                 motorArr[0].targetRPM == 0 && motorArr[1].targetRPM == 0 &&
                 motorArr[2].targetRPM == 0 && motorArr[3].targetRPM == 0)
        { // idle switch pressed from a full stop, or idle-hold engaging from a dead stop -
          // open-loop kick straight to idle RPM, since updateOpenLoop() only ever ratchets
          // throttle down, never up
            enableFwControl = false;
            kickMotorsToIdle();
        }
        else if ((pinDefined(idleSwitchPin) && idleSwitch.isPressed() && burstMode != SAFE) ||
                 idleHoldWanted() ||
                 (time_ms < lastRevTime_ms + dwellTime_ms + idleTime_ms && lastRevTime_ms > 0))
        { // idle flywheels - post-dwell idle window, the idle switch held, or idle-hold standing
          // at idle
            enableFwControl = false;
            if (currentSpindownSpeed < activeProfile.spindownSpeed)
            {
                currentSpindownSpeed += 1;
            }
            for (int i = 0; i < 4; i++)
            {
                if (motorsEnabled[i])
                {
                    int32_t rpmDrop =
                        (currentSpindownSpeed * loopTime_us + 999) / 1000; // rounded up

                    // Prevent targetRPM from going below idle
                    motorArr[i].targetRPM =
                        (motorArr[i].targetRPM > rpmDrop + activeProfile.idleRPM[i])
                            ? (motorArr[i].targetRPM - rpmDrop)
                            : activeProfile.idleRPM[i];
                }
            }
        }
        else
        { // stop flywheels
            enableFwControl = false;
            if (currentSpindownSpeed < activeProfile.spindownSpeed)
            {
                currentSpindownSpeed += 1;
            }
            for (int i = 0; i < 4; i++)
            {
                if (motorsEnabled[i] && motorArr[i].targetRPM != 0)
                {
                    int32_t rpmDrop =
                        (currentSpindownSpeed * loopTime_us + 999) / 1000; // rounded up

                    // Prevent targetRPM from going below zero
                    motorArr[i].targetRPM =
                        (motorArr[i].targetRPM > rpmDrop) ? (motorArr[i].targetRPM - rpmDrop) : 0;
                }
            }
        }
        break;

    case STATE_ACCELERATING:
        // clang-format off

        // Every tick, not just at rev-start, so a mode can reshape the ramp live.
        for (int i = 0; i < 4; i++)
            motorArr[i].targetRPM = (rpmScale_ >= 0.0f) ? (uint32_t)(motorArr[i].revRPM * rpmScale_)
                                                       : motorArr[i].revRPM;

        // If all motors are at target RPM, update the blaster's state to FULLSPEED.
        if ((!motorsEnabled[0] || (int32_t)motorArr[0].motorRPM > atSpeedRpm(0)) &&
            (!motorsEnabled[1] || (int32_t)motorArr[1].motorRPM > atSpeedRpm(1)) &&
            (!motorsEnabled[2] || (int32_t)motorArr[2].motorRPM > atSpeedRpm(2)) &&
            (!motorsEnabled[3] || (int32_t)motorArr[3].motorRPM > atSpeedRpm(3))
        ) {
            flywheelState = STATE_FULLSPEED;
            logger.info("STATE_FULLSPEED transition 1");
        } else if (!behaviorFor(burstMode).managesOwnRevLifecycle() &&
                   loopStartTimer_us - revStartTime_us > deviceSettings.rampupTimeout_ms * 1000UL) {
            flywheelState = STATE_IDLE;
            resetFWControl();
            shotsToFire = 0;
            for (int i = 0; i < 4; i++) {
                if (motorsEnabled[i]) {
                    if ((int32_t)motorArr[i].motorRPM <= atSpeedRpm(i)) {
                        logger.warn("Motor ", i + 1, " failed to reach target speed! motorRPM=", motorArr[i].motorRPM, " firingRPM=", atSpeedRpm(i));
                    }
                    motorArr[i].targetRPM = 0;
                    motorArr[i].PIDOutput = 0;
                }
            }
        }

        break;
        // clang-format on

    case STATE_FULLSPEED:
        for (int i = 0; i < 4; i++)
            motorArr[i].targetRPM = (rpmScale_ >= 0.0f) ? (uint32_t)(motorArr[i].revRPM * rpmScale_)
                                                        : motorArr[i].revRPM;

        if ((!revControlAllowed() || !revRequestedNow()) && shotsToFire == 0 && !firing)
        {
            flywheelState = STATE_IDLE;
            logger.info("State transition: FULLSPEED to IDLE 1");
        }
        else if (!behaviorFor(burstMode).managesOwnRevLifecycle() &&
                 activeProfile.revSafetyTimeout_ms > 0 && shotsToFire == 0 && !firing &&
                 time_ms - lastRevTime_ms > activeProfile.revSafetyTimeout_ms)
        {
            flywheelState = STATE_IDLE;
            revSafetyLatched = true;
            logger.warn(
                "Rev safety timeout - motors held revved too long without firing, spinning down");
        }
        else if (shotsToFire > 0 || firing)
        {
            lastRevTime_ms = time_ms;

            if (shotsToFire > 0 && !firing &&
                time_ms > pusherTimer_ms + deviceSettings.solenoidRetractTime_ms +
                              computePusherDwellPadding_ms())
            { // extend solenoid
                if (!deviceSettings.useRpmBaseShotCounter)
                {
                    registerShot();
                }
                else
                {
                    pendingShotDetections++;
                }

                pusher->drive(1.0f, deviceSettings.pusherReverseDirection);
                firing = true;
                shotsToFire = max(0, shotsToFire - 1);
                pusherTimer_ms = time_ms;
                solenoidExtendTime_ms =
                    batteryMonitor->getVoltage_mv() * solenoidVoltageTimeSlope +
                    solenoidVoltageTimeIntercept; // assumes  a linear relationship between voltage
                                                  // and solenoid extend time

                // Per-shot DPS verification: extend-to-extend interval, skipping the first shot
                // (no prior extend to measure from).
                if (lastShotExtendTime_ms != 0)
                {
                    uint32_t interval_ms = time_ms - lastShotExtendTime_ms;
                    lastMeasuredDPS = interval_ms > 0 ? 1000.0f / interval_ms : 0;
                    logger.info("Solenoid extending, interval_ms=", interval_ms,
                                " achievedDPS=", lastMeasuredDPS,
                                " targetDPS=", activeProfile.fireModes[firingMode].targetDPS);
                }
                else
                {
                    logger.info("Solenoid extending");
                }
                lastShotExtendTime_ms = time_ms;
            }
            else if (firing && time_ms > pusherTimer_ms + solenoidExtendTime_ms)
            { // retract solenoid
                pusher->coast();
                firing = false;
                pusherTimer_ms = time_ms;
                logger.info("Solenoid retracting");
            }
        }
        break;
    }
    // let's do the solenoid counting
    checkRpmDropShotDetection();

    if (burstMode == PLASMA || buzzPulsesRemaining_ > 0 || buzzPulsing_)
        handlePlasmaBuzzPulse();

    if (enableFwControl)
    {
        switch (deviceSettings.flywheelControl)
        {
        case PID_CONTROL:
            for (int i = 0; i < 4; i++)
            {
                if (motorsEnabled[i])
                {
                    motorArr[i].updatePID(throttleReferenceVoltage_mv(), loopTime_us, maxThrottle,
                                          deviceSettings.EMAFilter, half, deviceSettings.iThreshold,
                                          deviceSettings.batteryType);
                }
            }
            break;
        case TBH_CONTROL:
            for (int i = 0; i < 4; i++)
            {
                if (motorsEnabled[i])
                {
                    motorArr[i].updateTBH(throttleReferenceVoltage_mv(), flywheelState,
                                          maxThrottle);
                }
            }
            break;
        }
    }
    else
    {
        // we are spinning down or idling, just do open loop control
        for (int i = 0; i < 4; i++)
        {
            if (motorsEnabled[i])
            {
                motorArr[i].updateOpenLoop(throttleReferenceVoltage_mv(), maxThrottle);
            }
        }
    }

    logData();

    // Held off while core 1 is mid-command: DUMP_SCHEMA is one very long line written from core 1,
    // and interleaving corrupts the JSON. Skipping a tick is free - the capture waits.
    if (!serialCommandBusy && rpmLogger.dumpIfReady(motorsEnabled))
    {
        logger.info("RPM log dump complete, rebooting now as part of normal RPM logging - this is "
                    "expected");
        Serial.println("{\"evt\":\"rebooting\",\"reason\":\"rpmLog\"}");
        Serial.flush();
        rp2040.reboot();
    }
    // update pusher driver
    pusher->update();

    loopTime_us = micros() - loopStartTimer_us; // 'us' is microseconds
    if (loopTime_us > targetLoopTime_us)
    {
        logger.warn("Loop over time, ", loopTime_us);
    }
    else
    {
        delayMicroseconds(max((long)(0), (long)(targetLoopTime_us - loopTime_us)));
        loopTime_us = targetLoopTime_us;
    }

    return true;
}

void updateFiringMode()
{
    if (menuIsOpen())
    {
        return;
    }

    if (deviceSettings.selectFireType == NO_SELECT_FIRE)
    {
        return;
    }
    else if (deviceSettings.selectFireType == SWITCH_SELECT_FIRE)
    {
        int8_t previousFiringMode = firingMode;

        int8_t newActivePosition = -1; // -1 = no wired pin is currently grounded
        for (int i = 0; i < 3; i++)
        {
            if (pinDefined(selectPins[i]))
            {
                selectSwitches[i]->update();
                if (selectSwitches[i]->isPressed())
                {
                    newActivePosition = i;
                    break;
                }
            }
        }

        if (newActivePosition != activeSwitchPosition)
        {
            // The switch itself moved (even to/from "nothing grounded") - hand authority back to
            // it, discarding any menu override from before this move.
            activeSwitchPosition = newActivePosition;
            screenOverrideMode = -1;
        }

        if (screenOverrideMode != -1)
        {
            firingMode = screenOverrideMode;
        }
        else if (activeSwitchPosition < 0)
        {
            firingMode = activeProfile.defaultFiringMode;
        }
        else
        {
            int8_t assigned = activeProfile.switchPositionAssignment[activeSwitchPosition];
            bool assignedIsUsable =
                assigned >= 0 && assigned < (int8_t)activeProfile.activeModeCount;
            firingMode = assignedIsUsable ? assigned : activeProfile.defaultFiringMode;
        }

        if (firingMode != previousFiringMode)
            logger.info("Select switch changed, firingMode ", firingMode);
        return;
    }
    else if (deviceSettings.selectFireType == BUTTON_SELECT_FIRE)
    {
        if (!menuButtonDrivesModeCycle() && pinDefined(selectPins[0]))
        {
            select0.update();
            if (select0.pressed())
            {
                cycleFiringMode();
                logger.info("Select button pressed, firingMode ", firingMode);
            }
        }
    }
}

void cycleFiringMode()
{
    int8_t candidate = firingMode;
    bool found = false;
    for (uint8_t attempts = 0; attempts < activeProfile.activeModeCount; attempts++)
    {
        candidate++;
        if (candidate > (int8_t)activeProfile.activeModeCount - 1)
            candidate = 0;
        if (activeProfile.fireModes[candidate].includeInCycle)
        {
            found = true;
            break;
        }
    }
    firingMode = found ? candidate : activeProfile.defaultFiringMode;
}

// call this function to reset PID integral values, or reset I for TBH control
void resetFWControl()
{
    for (int i = 0; i < 4; i++)
    {
        if (motorsEnabled[i])
        {
            motorArr[i].resetControl(deviceSettings.flywheelControl);
        }
    }
}

uint8_t selectShotProfileAtBoot()
{
    if (deviceSettings.selectFireType == SWITCH_SELECT_FIRE)
    {
        for (int i = 0; i < 3; i++)
        {
            if (pinDefined(selectPins[i]))
            {
                selectSwitches[i]->update();
                if (selectSwitches[i]->isPressed())
                {
                    return i;
                }
            }
        }
        return deviceSettings.defaultProfileIndex;
    }
    else if (deviceSettings.selectFireType == BUTTON_SELECT_FIRE)
    {
        if (!menuButtonDrivesModeCycle() && pinDefined(selectPins[0]))
        {
            select0.update();
            if (select0.isPressed())
            {
                return 1;
            }
        }
    }
    return activeProfileIndex;
}

void setup1()
{
    // Wait for core 0 to finish loading deviceSettings before touching displayManager.
    while (!bootSettingsLoaded)
    {
        delay(1);
    }
    displayManager.begin(deviceSettings.rotateDisplay, deviceSettings.displayBrightness, displayBus);
}

static bool serviceMenuButton()
{
    MenuButtonPress press = pollMenuButton();
    if (press == MenuButtonPress::Tap && menuButtonDrivesModeCycle())
    {
        cycleFiringMode();
        logger.info("Menu button tapped, firingMode ", firingMode);
    }
    return press == MenuButtonPress::Hold;
}

static const uint32_t FIRING_MODE_SETTLE_MS = 2000;

static bool driveTrainStopped()
{
    if (flywheelState != STATE_IDLE || shotsToFire != 0 || firing)
        return false;
    for (int i = 0; i < 4; i++)
    {
        if (motorsEnabled[i] && motorArr[i].targetRPM != 0)
            return false;
    }
    return true;
}

static void persistFiringModeWhenIdle()
{
    if (!showRuntimeInfo || !firingModePersists())
        return;

    static int8_t lastSeenMode = 0;
    static uint32_t changedAt_ms = 0;

    int8_t mode = firingMode;
    if (mode != lastSeenMode)
    {
        lastSeenMode = mode;
        changedAt_ms = millis();
        return;
    }

    if (changedAt_ms == 0 || mode == persistedFiringMode)
        return;
    if (millis() - changedAt_ms < FIRING_MODE_SETTLE_MS)
        return;
    if (!driveTrainStopped())
        return;

    if (ProfileStore::saveLastFiringMode(activeProfileIndex, mode))
    {
        persistedFiringMode = mode;
        changedAt_ms = 0;
        logger.info("Stored firingMode ", mode);
    }
}

// One line at boot and every 3 s after, from core 1, the only core that writes to Serial. Stops
// once a host has spoken - a reader taking the first JSON line would otherwise capture this.
static void announceUnconfigured()
{
    static uint32_t lastAnnounce_ms = 0;
    if (serialCommandSeen)
        return;
    if (lastAnnounce_ms != 0 && millis() - lastAnnounce_ms < 3000)
        return;
    lastAnnounce_ms = millis();
    Serial.println("{\"evt\":\"unconfigured\",\"msg\":\"no wiring configured\"}");
}

void loop1()
{
    handleSerialCommands();

    if (!wiringLive)
    {
        announceUnconfigured();
        return; // no menu, no display, no firing-mode persistence
    }

    // The manager's flag, not the stored setting: DisplayManager::begin() clears it when the
    // panel fails to come up, and pushing frames at a display that is not there burns core 1.
    if (!displayManager.hasDisplay())
    {
        serviceMenuButton();
        persistFiringModeWhenIdle();
        return;
    }

    displayManager.flushMailbox();

    unsigned long lastUpdated = 0;
    while (showRuntimeInfo)
    {
        handleSerialCommands();

        if (serviceMenuButton())
        {
            runMenu();
            break; // menu closed - fall through and let loop1() re-enter fresh next tick
        }

        persistFiringModeWhenIdle();

        if (millis() - lastUpdated > 100 || updateRuntimeNow)
        {
            // Cross-core read-only mirror of core 0's firing state, same plain-global
            // sharing pattern as displayShotCounter above - only used for rendering here.
            const FireModeConfig& liveFireMode = activeProfile.fireModes[firingMode];
            FiringContext fireCtx{
                shotsToFire,
                liveTargetDPS,
                time_ms,
                triggerTime_ms,
                liveFireMode.binaryTriggerTimeout_ms,
                liveFireMode.burstLength,
                liveFireMode.reversible,
                requestRev,
                rpmScale_,
                buzzPulsesRequested_,
                false, // render() never reads this
                safetyEngaged,
            };
            // Real/set DPS for the home screen's optional 3rd RPM-column line - real is the
            // last measured extend-to-extend interval, set is the raw targetDPS setting.
            displayManager.renderTelemetry(
                safetyEngaged ? "SAFE" : liveFireMode.effectiveName().c_str(),
                activeProfile.name.c_str(),
                deviceSettings.blasterName.c_str(), motorArr, motorsEnabled, motorStages,
                displayShotCounter, batteryMonitor->isDefined(),
                batteryMonitor->getVoltage_mv(), deviceSettings.showCurrentRpmOnHomeScreen,
                idleHoldActive, batteryWarningActive, deviceSettings.homeScreenDisplayMode,
                behaviorFor(effectiveBurstMode(liveFireMode.burstMode)), fireCtx,
                deviceSettings.showDpsOnHomeScreen, lastMeasuredDPS, liveFireMode.targetDPS);
            updateRuntimeNow = false;
            lastUpdated = millis();
        }
    }
}
