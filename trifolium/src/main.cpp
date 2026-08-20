#include <Arduino.h>
#include <cstdio>
#include <PIO_DShot.h>
#include "../lib/Bounce2/src/Bounce2.h"
#include "fetDriver.h"
#include "drvDriver.h"
#include "escDriver.h"
#include "elapsedMillis.h"
#include "pico/stdlib.h"
#include "CONFIGURATION.h"
#include "esc_passthrough.h"
#include "global.h"
#include "logging.h"
#include "flywheelMotor.h"
#include "menu.h"
#include "runtimeSettings.h"
#include "profileStore.h"
#include "deviceSettings.h"
#include "deviceStore.h"
#include "splashStore.h"
#include "batteryMonitor.h"
#include "rpmLogger.h"
#include "displayManager.h"

#include <SPI.h>
// #include <Wire.h>
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

RuntimeSettings activeProfile;
uint8_t activeProfileIndex; // which slot activeProfile came from

DeviceSettings deviceSettings;

// setup1() (core 1) spins on this until core 0 finishes its boot-time profile/device load, so
// it can't race that load and skip DisplayManager::begin().
volatile bool bootSettingsLoaded = false;

TwoWire myI2C(board.I2C_HW_BLK, board.I2C_SCL, board.I2C_SDA);
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &myI2C, -1); // menu.cpp externs this directly
DisplayManager displayManager(display);

uint8_t menuButtonPin;
bool menuButtonNormallyClosed;
uint8_t triggerSwitchPin;
uint8_t revSwitchPin;
uint16_t debounceTime_ms;
// show runtime info
bool showRuntimeInfo = false;
bool updateRuntimeNow = false;
uint32_t runtimeShotCounter = 0;
uint32_t displayShotCounter = 0;
bool allowShotDetection = false;

// rebooting stuff
BootReason bootReason;
BootReason __uninitialized_ram(rebootReason);
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
uint16_t burstLength;
burstFireType_t burstMode;
int8_t firingMode = 0;
int8_t fpsMode = 0;
bool fromIdle;
int32_t dshotValue = 0;
int16_t shotsToFire = 0;
flywheelState_t flywheelState = STATE_IDLE;
bool firing = false;
bool reverseBraking = false;
bool pusherDwelling = false;

BatteryMonitor* batteryMonitor; // constructed in setup(), once activeProfile is loaded

int32_t pusherShunt_mv = 0;
int32_t pusherCurrent_ma = 0;
int32_t pusherCurrentSmoothed_ma = 0;
const int32_t maxThrottle = 1999;
uint32_t half =
    0; // 1 << (activeProfile.EMAFilter - 1); computed in setup(), once activeProfile is loaded
Driver* pusher;
uint16_t solenoidExtendTime_ms = 0;
float solenoidVoltageTimeSlope =
    0; // relationship between voltage and solenoid extend time calculated at setup
int16_t solenoidVoltageTimeIntercept = 0;
bool wifiState = false;
// String telemBuffer = "";
int8_t telemMotorNum = -1; // 0-3

int32_t tempRPM;
bool currentlyLogging = false;
bool enableFwControl = true;

// Set by a menu action that needs direct, exclusive throttle control (flywheel test, storage
// discharge) - fwControlLoop() skips its own motor/ESC handling while this is set.
volatile bool directMotorControlActive = false;

// True only while the ESC Dashboard screen is open, so Rev can keep spinning flywheels for that
// one read-only view even though every other menu screen blocks it.
bool escDashboardOpen = false;

bool revControlAllowed()
{
    return !menuIsOpen() || escDashboardOpen;
}

bool revSafetyLatched = false;

// True once the battery drops below the non-cutoff warning threshold - drives a blinking
// indicator in DisplayManager::renderTelemetry().
bool batteryWarningActive = false;

Bounce2::Button revSwitch = Bounce2::Button();
Bounce2::Button triggerSwitch = Bounce2::Button();
Bounce2::Button cycleSwitch = Bounce2::Button();
Bounce2::Button idleSwitch = Bounce2::Button();
Bounce2::Button select0 = Bounce2::Button();
Bounce2::Button select1 = Bounce2::Button();
Bounce2::Button select2 = Bounce2::Button();
Bounce2::Button* selectSwitches[3] = {&select0, &select1, &select2};
uint8_t selectPins[3]; // populated in setup() from deviceSettings.select0/1/2Pin

Motor motorsObj[4] = {Motor(0, 0, 0, 0, 0), Motor(0, 0, 0, 0, 0), Motor(0, 0, 0, 0, 0),
                      Motor(0, 0, 0, 0, 0)};

// per-motor runtime state - one instance per motors[]/motorsObj[] slot
FlywheelMotor motorArr[4] = {FlywheelMotor(&motorsObj[0]), FlywheelMotor(&motorsObj[1]),
                             FlywheelMotor(&motorsObj[2]), FlywheelMotor(&motorsObj[3])};

RpmLogger rpmLogger;

void updateFiringMode();
void selectRPMProfile();
bool fwControlLoop();
void mainFiringLogic();
void resetFWControl();
void registerShot();
void handleSerialCommands();
void applyMotorConfig();
void applyEmaFilterConstant();
void applyFiringRpmThresholds();
void applySolenoidTimingCurve();
void applyDebounceInterval();
void applyPrintTelemetry();
uint32_t computePusherDwellPadding_ms();

bool pinDefined(uint8_t pin)
{
    return pin != PIN_NOT_USED;
}

void logData()
{
    // record() is a no-op unless a capture is currently armed (startCapture() succeeded and
    // hasn't been dumped yet) - no separate deviceSettings.useRpmLogging check needed here.
    rpmLogger.record(motorArr, activeProfile.motors);
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
        motorsObj[i] = Motor(activeProfile.KP[i], activeProfile.KI[i], activeProfile.KD[i],
                             activeProfile.motorKv[i], activeProfile.motorPolesDiv2[i]);
    }
}

// Recomputes `half`, the EMA filter shift constant. EMAFilter must be >= 1.
void applyEmaFilterConstant()
{
    if (activeProfile.EMAFilter == 0)
    {
        logger.error("Profile EMAFilter is 0, clamping to 1");
        activeProfile.EMAFilter = 1;
    }
    half = uint32_t{1} << (activeProfile.EMAFilter - 1);
}

// Recomputes each enabled motor's firingRPM ("at speed" threshold) from revRPM plus
// firingRPMTolerance/minFiringRPM.
void applyFiringRpmThresholds()
{
    for (int i = 0; i < 4; i++)
    {
        if (activeProfile.motors[i])
        {
            motorArr[i].firingRPM = max(motorArr[i].revRPM - activeProfile.firingRPMTolerance,
                                        activeProfile.minFiringRPM);
        }
    }
}

// Recomputes the solenoid extend-time/voltage slope+intercept from the four Solenoid/Pusher fields.
void applySolenoidTimingCurve()
{
    if (deviceSettings.pusherType != PUSHER_SOLENOID_OPENLOOP)
        return;

    if (activeProfile.solenoidExtendTimeLow_ms == activeProfile.solenoidExtendTimeHigh_ms ||
        activeProfile.solenoidExtendTimeLowVoltage_mv >
            activeProfile.solenoidExtendTimeHighVoltage_mv)
    { // if times are equal, don't do this calc
        solenoidVoltageTimeSlope = 0;
        solenoidVoltageTimeIntercept = activeProfile.solenoidExtendTimeHigh_ms;
    }
    else
    {
        solenoidVoltageTimeSlope =
            (activeProfile.solenoidExtendTimeHigh_ms - activeProfile.solenoidExtendTimeLow_ms) /
            ((float)(activeProfile.solenoidExtendTimeHighVoltage_mv -
                     activeProfile.solenoidExtendTimeLowVoltage_mv));
        solenoidVoltageTimeIntercept =
            activeProfile.solenoidExtendTimeHigh_ms -
            (solenoidVoltageTimeSlope * activeProfile.solenoidExtendTimeHighVoltage_mv) + 1;
        logger.info("solenoidVoltageTimeSlope: ", solenoidVoltageTimeSlope);
        logger.info("solenoidVoltageTimeIntercept: ", solenoidVoltageTimeIntercept);
    }
}

// Auto Timing's additive dwell on top of the existing voltage-compensated extend/retract cycle.
uint32_t computePusherDwellPadding_ms()
{
    if (!activeProfile.autoTiming || activeProfile.targetDPS <= 0)
        return 0;

    float extendAtVoltage_ms =
        batteryMonitor->getVoltage_mv() * solenoidVoltageTimeSlope + solenoidVoltageTimeIntercept;
    float cycleTarget_ms = 1000.0f / activeProfile.targetDPS;
    float padding_ms = cycleTarget_ms - extendAtVoltage_ms - activeProfile.solenoidRetractTime_ms;
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
    if (pinDefined(deviceSettings.idleSwitchPin))
        idleSwitch.interval(debounceTime_ms);
    for (int i = 0; i < 3; i++)
    {
        if (pinDefined(selectPins[i]))
            selectSwitches[i]->interval(debounceTime_ms);
    }
}

// Mirrors deviceSettings.printTelemetry into the plain global logging.h actually gates on.
void applyPrintTelemetry()
{
    printTelemetry = deviceSettings.printTelemetry;
}

void setup()
{
    if (powerOnResetMagicNumber == 0xdeadbeefdeadbeef)
        bootReason = rebootReason;
    else
        bootReason = BootReason::POR;
    powerOnResetMagicNumber = 0xdeadbeefdeadbeef;
    rebootReason = BootReason::WATCHDOG;
    Serial.begin(115200);
    Serial.ignoreFlowControl(true);

    // load the active runtime settings profile and device-wide settings before anything below
    // reads a field
    ProfileStore::begin();
    activeProfileIndex = ProfileStore::loadActiveProfileIndex();
    ProfileStore::loadProfile(activeProfileIndex, activeProfile);
    DeviceStore::loadDeviceSettings(deviceSettings);
    applyPrintTelemetry(); // as early as possible so logging behaves correctly for the rest of boot
    targetLoopTime_us = dshotMinDelayFor(deviceSettings.dshotMode); // before attachEsc() calls

    // Headless BOOTSEL entry: hold Menu or Rev at power-on to jump into the USB bootloader
    if (bootReason == BootReason::POR)
    {
        auto heldAtBoot = [](uint8_t pin, bool normallyClosed) -> bool
        {
            if (!pinDefined(pin))
                return false;
            pinMode(pin, INPUT_PULLUP);
            bool pressedLevel = normallyClosed ? HIGH : LOW;
            if (digitalRead(pin) != pressedLevel)
                return false;
            delay(50); // reject power-on electrical noise - must still read held after a beat
            return digitalRead(pin) == pressedLevel;
        };

        bool revBootHold =
            !deviceSettings.dualStageTrigger &&
            heldAtBoot(deviceSettings.revSwitchPin, deviceSettings.revSwitchNormallyClosed);
        if (heldAtBoot(deviceSettings.menuButtonPin, deviceSettings.menuButtonNormallyClosed) ||
            revBootHold)
        {
            rp2040.rebootToBootloader();
        }
    }

    menuButtonPin = deviceSettings.menuButtonPin;
    menuButtonNormallyClosed = deviceSettings.menuButtonNormallyClosed;
    triggerSwitchPin = deviceSettings.triggerSwitchPin;
    revSwitchPin = deviceSettings.revSwitchPin;
    debounceTime_ms = deviceSettings.debounceTime_ms;
    selectPins[0] = deviceSettings.select0Pin;
    selectPins[1] = deviceSettings.select1Pin;
    selectPins[2] = deviceSettings.select2Pin;

    displayManager.setHasDisplay(deviceSettings.hasDisplay);

    bootSettingsLoaded = true;

    applyEmaFilterConstant();
    applyMotorConfig();

    // per-motor ESC pin, indexed same as motors[]/motorsObj[]
    const uint8_t escPins[4] = {board.esc1, board.esc2, board.esc3, board.esc4};

    // need to do some checking for valid motor/esc driver pins here
    for (int i = 0; i < 4; i++)
    {
        if (activeProfile.motors[i])
        {
            if (board.pusherDriverType == ESC_DRIVER && board.drvEN == escPins[i])
            {
                while (1)
                {
                    logger.error("Motor conflict with solenoid drive pin");
                    logger.error("Either change pusher type, or disable motor");
                    delay(1000);
                }
            }
        }
    }

    // esc passthrough requires a trigger pin
    if (bootReason == BootReason::TO_ESC_PASSTHROUGH && pinDefined(triggerSwitchPin))
    {
        // setup the trigger pin to exit passthrough

        triggerSwitch.attach(triggerSwitchPin, INPUT_PULLUP);
        triggerSwitch.interval(debounceTime_ms);
        triggerSwitch.setPressedState(deviceSettings.triggerSwitchNormallyClosed);

        // only do esc passthrough for the motors that are defined and esc driver pin if defined
        u8 numPassthrough = 0;
        for (int i = 0; i < 4; i++)
        {
            if (activeProfile.motors[i])
            {
                numPassthrough++;
            }
        }
        if (board.pusherDriverType == ESC_DRIVER)
        {
            numPassthrough++;
        }
        u8 pins[numPassthrough] = {0};
        u8 currentPin = 0;
        for (int i = 0; i < 4; i++)
        {
            if (activeProfile.motors[i])
            {
                pins[currentPin] = escPins[i];
                currentPin++;
            }
        }
        if (board.pusherDriverType == ESC_DRIVER)
        {
            pins[currentPin] = board.drvEN;
        }

        displayManager.showText("ESC Passthrough, hold trigger to exit", 0, 0, true);

        beginPassthrough(pins, numPassthrough);
        unsigned long currentTime = millis();
        while (processPassthrough())
        {
            triggerSwitch.update();
            if (!triggerSwitch.isPressed())
            {
                currentTime = millis();
            }
            if (millis() - currentTime > 3000)
            {
                // exit passthrough after 3 secs of trigger
                break;
            }
        }
        bootReason = BootReason::FROM_ESC_PASSTHROUGH;
        delay(100);
        rp2040.reboot();
    }
    // display bootup screen if available
    displayManager.requestBootupSplash();
    logger.info("Booting");
    // delay to allow gpio to stabilize
    delay(1000);

    batteryMonitor = new BatteryMonitor(board.batteryADC, activeProfile.voltageCalibrationFactor,
                                        deviceSettings.voltageAveragingWindow,
                                        cellCount(activeProfile.batteryType));
    batteryMonitor->begin();

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
    if (pinDefined(deviceSettings.cycleSwitchPin))
    {
        cycleSwitch.attach(deviceSettings.cycleSwitchPin, INPUT_PULLUP);
        cycleSwitch.interval(deviceSettings.pusherDebounceTime_ms);
        cycleSwitch.setPressedState(deviceSettings.cycleSwitchNormallyClosed);
    }
    if (pinDefined(deviceSettings.idleSwitchPin))
    {
        idleSwitch.attach(deviceSettings.idleSwitchPin, INPUT_PULLUP);
        idleSwitch.setPressedState(deviceSettings.idleSwitchNormallyClosed);
    }
    setupMenuButton();
    if (activeProfile.selectFireType != NO_SELECT_FIRE)
    {
        for (int i = 0; i < 3; i++)
        {
            if (pinDefined(selectPins[i]))
            {
                selectSwitches[i]->attach(selectPins[i], INPUT_PULLUP);
                selectSwitches[i]->setPressedState(false);
            }
        }
    }
    applyDebounceInterval();

    if (pinDefined(board.ESC_ENABLE))
    {
        pinMode(board.ESC_ENABLE, OUTPUT);
        digitalWrite(board.ESC_ENABLE, LOW);
    }

    if (pinDefined(board.LED_DATA))
    {
        pinMode(board.LED_DATA, OUTPUT);
        digitalWrite(board.LED_DATA, HIGH); // steady on = armed, blinks on low-voltage cutoff
    }

    // if trigger is pulled on boot, enter esc passthrough mode
    triggerSwitch.update();
    if (triggerSwitch.isPressed())
    {
        rebootReason = BootReason::TO_ESC_PASSTHROUGH;
        delay(100);
        rp2040.reboot();
    }

    switch (board.pusherDriverType)
    {
    case DRV_DRIVER:
        pusher = new Drv(board.drvPH, board.drvEN, board.drvNSLEEP, board.drvMOSI, board.drvMISO,
                         board.drvNSCS, board.drvSCLK);
        break;
    case FET_DRIVER:
        pusher = new Fet(board.drvEN);
        break;
    case ESC_DRIVER:
        pusher = new EscDriver(board.drvEN);
        break;
    default:
        break;
    }

    applySolenoidTimingCurve();

    // change FPS using select fire switch position at boot time
    if (activeProfile.variableFPS)
    {
        selectRPMProfile();
    }

    fpsMode = firingMode;
    firingMode = 0;
    logger.info("fpsMode: ", fpsMode);
    for (int i = 0; i < 4; i++)
    {
        if (activeProfile.motors[i])
        {
            motorArr[i].revRPM = activeProfile.revRPMset[fpsMode][i];
            motorArr[i].attachEsc(new BidirDShotX1(escPins[i], deviceSettings.dshotMode));
        }
    }
    applyFiringRpmThresholds();
    dwellTime_ms = activeProfile.dwellTimeSet_ms[fpsMode];
    idleTime_ms = activeProfile.idleTimeSet_ms[fpsMode];

    // make sure to send neutral throttle to arm esc's
    for (int j = 0; j < 15000; j++)
    {
        // if pusher is esc driver, do the startup loop for the esc driver too
        if (board.pusherDriverType == ESC_DRIVER)
        {
            pusher->update();
        }
        // do neutral throttle for all motors
        for (int i = 0; i < 4; i++)
        {
            if (activeProfile.motors[i])
            {
                motorArr[i].sendThrottle(0);
            }
        }
        delayMicroseconds(100);
    }

    // Request Extended DShot Telemetry from ESCs that support it
    for (int i = 0; i < 4; i++)
    {
        if (activeProfile.motors[i])
        {
            for (int rep = 0; rep < 10; rep++)
            {
                motorArr[i].esc->sendRaw11Bit(DSHOT_CMD_EXTENDED_TELEMETRY_ENABLE);
                delayMicroseconds(1000);
            }
        }
    }

    showRuntimeInfo = true;
}

void loop()
{
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
    if (pinDefined(deviceSettings.idleSwitchPin))
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
    updateFiringMode();
    // changes burst options
    burstLength = activeProfile.burstLengthSet[firingMode];
    burstMode = activeProfile.burstModeSet[firingMode];

    if (menuIsOpen() || burstMode == SAFE)
    {
        // menu mode and firing mode are mutually exclusive, or the active mode's burst mode is
        // the safety - either way, ignore trigger input and cancel any shots already queued
        shotsToFire = 0;
    }
    else if (triggerSwitch.pressed() ||
             (burstMode == BINARY && triggerSwitch.released() &&
              time_ms < triggerTime_ms + activeProfile.binaryTriggerTimeout_ms))
    { // pressed and released are transitions, isPressed is for state
        const char* eventLabel = triggerSwitch.pressed() ? "Trigger pressed, burstMode "
                                                         : " binary trigger released, burstMode ";
        triggerTime_ms = time_ms;
        int16_t shotsToFireBefore = shotsToFire;
        if (burstMode == AUTO)
        {
            shotsToFire = burstLength;
        }
        else
        {
            if (shotsToFire < burstLength || shotsToFire == 1)
            {
                shotsToFire += burstLength;
            }
        }
        logger.info(eventLabel, burstMode, " shotsToFire before ", shotsToFireBefore, " after ",
                    shotsToFire);
    }
    else if (triggerSwitch.released())
    {
        if (burstMode == AUTO && shotsToFire > 1)
        {
            shotsToFire = 1;
        }
    }
    batteryMonitor->update();
}

static uint32_t ledTime_ms = 0;
static bool ledOn = true;

void checkLowVoltageCutoff()
{
    if (batteryMonitor->isDefined() && time_ms > 2000)
    {
        uint8_t cells = cellCount(activeProfile.batteryType);
        bool belowCutoff =
            batteryMonitor->getVoltage_mv() < activeProfile.lowVoltageCutoffPerCell_mv * cells;
        if (belowCutoff)
        {
            digitalWrite(board.ESC_ENABLE, LOW); // cut power to ESCs and pusher
            logger.error("Battery low, shutting down! ", batteryMonitor->getVoltage_mv(), "mv");
        }
        // Non-cutoff early warning - lowVoltageWarningPerCell_mv is above the cutoff, so this
        // trips first as the battery depletes.
        batteryWarningActive =
            batteryMonitor->getVoltage_mv() < activeProfile.lowVoltageWarningPerCell_mv * cells;

        if (pinDefined(board.LED_DATA))
        {
            bool shouldBlink =
                (deviceSettings.ledWarningMode == LED_WARNING_LOW_BATT && belowCutoff) ||
                (deviceSettings.ledWarningMode == LED_WARNING_WARN_BATT && batteryWarningActive);
            if (!shouldBlink)
            {
                digitalWrite(board.LED_DATA, HIGH);
            }
            else if (time_ms > ledTime_ms + 500)
            {
                ledTime_ms = time_ms;
                ledOn = !ledOn;
                digitalWrite(board.LED_DATA, ledOn ? HIGH : LOW);
            }
        }
    }
}

// RPM-drop-based shot detection
void checkRpmDropShotDetection()
{
    if (!(allowShotDetection && deviceSettings.useRpmBaseShotCounter))
    {
        return;
    }
    for (int i = 0; i < 4; i++)
    {
        if (activeProfile.motors[i])
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
            allowShotDetection = false;
            for (int j = 0; j < 4; j++)
            {
                motorArr[j].shotsUnderThreshold = 0;
            }
            break;
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
            logger.error("Loop over time, ", loopTime_us);
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

        if (shotsToFire > 0 || (revControlAllowed() && revSwitch.isPressed() && !revSafetyLatched))
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
            if (activeProfile.flywheelControl == TBH_CONTROL)
            {
                for (int i = 0; i < 4; i++)
                {
                    if (activeProfile.motors[i])
                    {
                        // for optimal rev let's set throttle to max until first crossing
                        motorArr[i].PIDOutput =
                            max(min(maxThrottle, (maxThrottle * motorArr[i].targetRPM /
                                                  batteryMonitor->getVoltage_mv() * 1000 /
                                                  motorArr[i].m_config->m_motorKv) +
                                                     activeProfile.throttleCap),
                                0);
                        // premptly setup TBH variable to reduce overshoot
                        motorArr[i].PIDIntegral =
                            (2 *
                             map(((motorArr[i].targetRPM * 1000) / motorArr[i].m_config->m_motorKv),
                                 0, batteryMonitor->getVoltage_mv(), 0, maxThrottle)) -
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
                 allowShotDetection)
        { // dwell flywheels
            if (allowShotDetection &&
                time_ms > pusherTimer_ms + activeProfile.solenoidRetractTime_ms)
            {
                allowShotDetection = false;
                for (int j = 0; j < 4; j++)
                {
                    motorArr[j].shotsUnderThreshold = 0;
                }
                // logger.info("Timeout reached");
            }
            else
            {
                // logger.info("Holding for dwell");
            }
        }
        else if (pinDefined(deviceSettings.idleSwitchPin) && idleSwitch.isPressed() &&
                 burstMode != SAFE && motorArr[0].targetRPM == 0 && motorArr[1].targetRPM == 0 &&
                 motorArr[2].targetRPM == 0 && motorArr[3].targetRPM == 0)
        { // idle switch pressed from a full stop - open-loop kick straight to idle RPM, since
          // updateOpenLoop() only ever ratchets throttle down, never up
            enableFwControl = false;
            currentSpindownSpeed = 0;
            for (int i = 0; i < 4; i++)
            {
                if (activeProfile.motors[i])
                {
                    motorArr[i].targetRPM = activeProfile.idleRPM[i];
                    motorArr[i].PIDOutput = maxThrottle * motorArr[i].targetRPM /
                                            batteryMonitor->getVoltage_mv() * 1000 /
                                            motorArr[i].m_config->m_motorKv;
                }
            }
        }
        else if ((pinDefined(deviceSettings.idleSwitchPin) && idleSwitch.isPressed() &&
                  burstMode != SAFE) ||
                 (time_ms < lastRevTime_ms + dwellTime_ms + idleTime_ms && lastRevTime_ms > 0))
        { // idle flywheels - post-dwell idle window, or the idle switch held
            enableFwControl = false;
            if (currentSpindownSpeed < activeProfile.spindownSpeed)
            {
                currentSpindownSpeed += 1;
            }
            for (int i = 0; i < 4; i++)
            {
                if (activeProfile.motors[i])
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
                if (activeProfile.motors[i] && motorArr[i].targetRPM != 0)
                {
                    int32_t rpmDrop =
                        (currentSpindownSpeed * loopTime_us + 999) / 1000; // rounded up

                    // Prevent targetRPM from going below zero
                    motorArr[i].targetRPM =
                        (motorArr[i].targetRPM > rpmDrop) ? (motorArr[i].targetRPM - rpmDrop) : 0;
                }
            }
            fromIdle = false;
        }
        break;

    case STATE_ACCELERATING:
        // clang-format off

        // If all motors are at target RPM, update the blaster's state to FULLSPEED.
        if ((!activeProfile.motors[0] || motorArr[0].motorRPM > motorArr[0].firingRPM) &&
            (!activeProfile.motors[1] || motorArr[1].motorRPM > motorArr[1].firingRPM) &&
            (!activeProfile.motors[2] || motorArr[2].motorRPM > motorArr[2].firingRPM) &&
            (!activeProfile.motors[3] || motorArr[3].motorRPM > motorArr[3].firingRPM)
        ) {
            flywheelState = STATE_FULLSPEED;
            fromIdle =  true;
            logger.info("STATE_FULLSPEED transition 1");
        } else if (loopStartTimer_us - revStartTime_us > activeProfile.rampupTimeout_ms * 1000UL) {
            flywheelState = STATE_IDLE;
            resetFWControl();
            shotsToFire = 0;
            for (int i = 0; i < 4; i++) {
                if (activeProfile.motors[i] && motorArr[i].motorRPM <= motorArr[i].firingRPM) {
                    logger.error("Motor ", i + 1, " failed to reach target speed! motorRPM=", motorArr[i].motorRPM, " firingRPM=", motorArr[i].firingRPM);
                }
            }
        }

        break;
        // clang-format on

    case STATE_FULLSPEED:
        if ((!revControlAllowed() || !revSwitch.isPressed()) && shotsToFire == 0 && !firing)
        {
            flywheelState = STATE_IDLE;
            logger.info("State transition: FULLSPEED to IDLE 1");
        }
        // Rev-safety timeout
        else if (activeProfile.revSafetyTimeout_ms > 0 && shotsToFire == 0 && !firing &&
                 time_ms - lastRevTime_ms > activeProfile.revSafetyTimeout_ms)
        {
            flywheelState = STATE_IDLE;
            revSafetyLatched = true;
            logger.error(
                "Rev safety timeout - motors held revved too long without firing, spinning down");
        }
        else if (shotsToFire > 0 || firing)
        {
            lastRevTime_ms = time_ms;

            if (shotsToFire > 0 && !firing &&
                time_ms > pusherTimer_ms + activeProfile.solenoidRetractTime_ms +
                              computePusherDwellPadding_ms())
            { // extend solenoid
                if (!deviceSettings.useRpmBaseShotCounter)
                {
                    registerShot();
                }
                else
                {
                    allowShotDetection = true;
                    for (int j = 0; j < 4; j++)
                    {
                        motorArr[j].shotsUnderThreshold = 0;
                    }
                    // logger.info("cacheIndex ", cacheIndex);
                }

                pusher->drive(100, deviceSettings.pusherReverseDirection);
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
                                activeProfile.autoTiming ? " targetDPS=" : "",
                                activeProfile.autoTiming ? activeProfile.targetDPS : 0);
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

    if (enableFwControl)
    {
        switch (activeProfile.flywheelControl)
        {
        case PID_CONTROL:
            for (int i = 0; i < 4; i++)
            {
                if (activeProfile.motors[i])
                {
                    motorArr[i].updatePID(batteryMonitor->getVoltage_mv(), loopTime_us, maxThrottle,
                                          activeProfile.EMAFilter, half, activeProfile.iThreshold,
                                          activeProfile.batteryType);
                }
            }
            break;
        case TBH_CONTROL:
            for (int i = 0; i < 4; i++)
            {
                if (activeProfile.motors[i])
                {
                    motorArr[i].updateTBH(batteryMonitor->getVoltage_mv(), flywheelState,
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
            if (activeProfile.motors[i])
            {
                motorArr[i].updateOpenLoop(batteryMonitor->getVoltage_mv(), maxThrottle);
            }
        }
    }

    logData();

    if (rpmLogger.dumpIfReady(activeProfile.motors))
    {
        logger.info("RPM log dump complete, rebooting now as part of normal RPM logging - this is "
                    "expected");
        Serial.flush();
        rp2040.reboot();
    }
    // update pusher driver
    pusher->update();

    loopTime_us = micros() - loopStartTimer_us; // 'us' is microseconds
    if (loopTime_us > targetLoopTime_us)
    {
        logger.error("Loop over time, ", loopTime_us);
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
    if (activeProfile.selectFireType == NO_SELECT_FIRE)
    {
        return;
    }
    else if (activeProfile.selectFireType == SWITCH_SELECT_FIRE)
    {
        int8_t previousFiringMode = firingMode;

        firingMode = activeProfile.defaultFiringMode;
        for (int i = 0; i < 3; i++)
        {
            if (pinDefined(selectPins[i]))
            {
                selectSwitches[i]->update();
                if (selectSwitches[i]->isPressed())
                {
                    firingMode = i;
                    break;
                }
            }
        }

        if (firingMode != previousFiringMode)
            logger.info("Select switch changed, firingMode ", firingMode);
        return;
    }
    else if (activeProfile.selectFireType == BUTTON_SELECT_FIRE)
    {
        if (pinDefined(deviceSettings.select0Pin))
        {
            select0.update();
            if (select0.pressed())
            {
                firingMode++;
                if (firingMode > 2)
                {
                    firingMode = 0;
                }
                logger.info("Select button pressed, firingMode ", firingMode);
                return;
            }
        }
    }
}

// call this function to reset PID integral values, or reset I for TBH control
void resetFWControl()
{
    for (int i = 0; i < 4; i++)
    {
        if (activeProfile.motors[i])
        {
            motorArr[i].resetControl(activeProfile.flywheelControl);
        }
    }
}

void selectRPMProfile()
{
    firingMode = 0;

    if (activeProfile.selectFireType == SWITCH_SELECT_FIRE)
    {
        for (int i = 0; i < 3; i++)
        {
            if (pinDefined(selectPins[i]))
            {
                selectSwitches[i]->update();
                if (selectSwitches[i]->isPressed())
                {
                    firingMode = i;
                    return;
                }
            }
        }
        // if no other options, set to defaultFiring
        firingMode = activeProfile.defaultFiringMode;
        return;
    }
    else if (activeProfile.selectFireType == BUTTON_SELECT_FIRE)
    {
        if (pinDefined(deviceSettings.select0Pin))
        {
            select0.update();
            if (select0.isPressed())
            {
                firingMode = 1;
                return;
            }
        }

        if (pinDefined(revSwitchPin))
        {
            revSwitch.update();
            if (revSwitch.isPressed())
            {
                firingMode = 2;
                return;
            }
        }
    }
}

void setup1()
{
    // Wait for core 0 to finish loading deviceSettings before touching displayManager.
    while (!bootSettingsLoaded)
    {
        delay(1);
    }
    displayManager.begin(deviceSettings.rotateDisplay);
}

void loop1()
{
    handleSerialCommands();

    if (deviceSettings.hasDisplay)
    {
        displayManager.flushMailbox();

        unsigned long lastUpdated = 0;
        while (showRuntimeInfo)
        {
            handleSerialCommands();

            if (menuButtonHeld())
            {
                runMenu();
                break; // menu closed - fall through and let loop1() re-enter fresh next tick
            }

            if (millis() - lastUpdated > 100 || updateRuntimeNow)
            {
                // Dart count for the HOME_FIRE_MODE animation - one per shot in the burst, except
                // Binary (one dart per trigger pull/release, shown as 2).
                uint16_t animDartCount = (activeProfile.burstModeSet[firingMode] == BINARY)
                                             ? 2
                                             : activeProfile.burstLengthSet[firingMode];
                // Real/set DPS for the home screen's optional 3rd RPM-column line - real is the
                // last measured extend-to-extend interval, set is the raw targetDPS setting.
                displayManager.renderTelemetry(
                    activeProfile.fireModeStrings[firingMode].c_str(), activeProfileIndex,
                    deviceSettings.blasterName.c_str(), motorArr, activeProfile.motors,
                    activeProfile.motorStage, displayShotCounter, batteryMonitor->isDefined(),
                    batteryMonitor->getVoltage_mv(), deviceSettings.showCurrentRpmOnHomeScreen,
                    batteryWarningActive, deviceSettings.homeScreenDisplayMode, animDartCount,
                    deviceSettings.showDpsOnHomeScreen, lastMeasuredDPS, activeProfile.targetDPS);
                updateRuntimeNow = false;
                lastUpdated = millis();
            }
        }
    }
}

void handleSerialCommands()
{
    // ESC passthrough reads raw bytes off Serial directly for the whole session - skip here so
    // this function's line-oriented reads don't steal bytes from that binary protocol.
    if (bootReason == BootReason::TO_ESC_PASSTHROUGH)
        return;

    if (!Serial.available())
        return;

    String line = Serial.readStringUntil('\n');
    line.trim();

    int spaceIdx = line.indexOf(' ');
    String command = spaceIdx == -1 ? line : line.substring(0, spaceIdx);

    bool hasIndex = false;
    int explicitIndex = -1;
    if (spaceIdx != -1)
    {
        String indexArg = line.substring(spaceIdx + 1);
        indexArg.trim();
        hasIndex = indexArg.length() > 0;
        bool allDigits = hasIndex;
        for (size_t i = 0; i < indexArg.length(); i++)
        {
            if (!isDigit(indexArg[i]))
                allDigits = false;
        }
        explicitIndex =
            allDigits ? indexArg.toInt() : -1; // -1 sentinel - caught by the range check below
    }

    if (command == "DUMP_PROFILE")
    {
        RuntimeSettings settings;
        if (hasIndex)
        {
            if (explicitIndex < 0 || explicitIndex >= ProfileStore::MAX_PROFILE_COUNT)
            {
                logger.error("DUMP_PROFILE: index out of range");
                return;
            }
            ProfileStore::loadProfile((uint8_t)explicitIndex, settings);
        }
        else
        {
            settings = activeProfile;
        }
        JsonDocument doc;
        ProfileStore::toJson(settings, doc);
        serializeJson(doc, Serial);
        Serial.println();
    }
    else if (command == "LOAD_PROFILE")
    {
        if (hasIndex && (explicitIndex < 0 || explicitIndex >= ProfileStore::MAX_PROFILE_COUNT))
        {
            logger.error("LOAD_PROFILE: index out of range");
            return;
        }
        uint8_t activeIndex = ProfileStore::loadActiveProfileIndex();
        uint8_t targetIndex = hasIndex ? (uint8_t)explicitIndex : activeIndex;

        JsonDocument doc;
        DeserializationError err = deserializeJson(doc, Serial);
        if (err)
        {
            logger.error("LOAD_PROFILE: invalid JSON, ignoring");
            return;
        }

        RuntimeSettings newSettings;
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
        ProfileStore::saveProfile(targetIndex, newSettings);

        if (targetIndex == activeIndex)
        {
            logger.info("LOAD_PROFILE: saved active profile, rebooting");
            Serial.flush();
            delay(100);
            rebootReason = BootReason::MENU;
            rp2040.reboot();
        }
        else
        {
            logger.info("LOAD_PROFILE: saved profile ", targetIndex,
                        ", no reboot needed (not active)");
        }
    }
    else if (command == "DUMP_DEVICE")
    {
        JsonDocument doc;
        DeviceStore::toJson(deviceSettings, doc);
        serializeJson(doc, Serial);
        Serial.println();
    }
    else if (command == "LOAD_DEVICE")
    {
        JsonDocument doc;
        DeserializationError err = deserializeJson(doc, Serial);
        if (err)
        {
            logger.error("LOAD_DEVICE: invalid JSON, ignoring");
            return;
        }
        DeviceSettings newSettings = deviceSettings;
        DeviceStore::fromJson(doc, newSettings);
        DeviceStore::saveDeviceSettings(newSettings);
        logger.info("LOAD_DEVICE: saved, rebooting");
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
        uint8_t buf[SplashStore::SPLASH_BYTES];
        if (!SplashStore::loadCustomSplash(buf))
        {
            logger.error("DUMP_SPLASH: no custom splash set");
            return;
        }
        Serial.write(buf, SplashStore::SPLASH_BYTES);
    }
}
