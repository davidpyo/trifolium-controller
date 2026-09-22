#include "menuCore.h"
#include "enumIds.h"
#include "bitmaps.h" // trollface - the "Coming Soon" placeholder's image
#include <PIO_DShot.h> // DSHOT_CMD_* for the ESC direction actions

static const int32_t FLYWHEEL_TEST_THROTTLE = 400; // modest throttle (~20% of maxThrottle) - enough
                                                   // to visibly/audibly spin without excessive draw
static const unsigned long FLYWHEEL_TEST_DURATION_MS = 2000;

// The gate for "this motor has an ESC object", which is not motorConfig[].enabled: attachEsc() runs
// only for motorsEnabled[], and boot clears that for a pusher-channel collision or an undefined ESC
// pin. sendThrottle() does not null-check.
extern bool motorsEnabled[4];

static bool testOneMotor(int motorIndex)
{
    display.clearDisplay();
    display.setTextSize(2);
    display.setCursor(0, 20);
    display.print("Motor " + String(motorIndex + 1));
    display.setTextSize(1);
    display.setCursor(0, 56);
    display.print("any press = stop");
    display.display();

    DismissDetector dismiss;
    unsigned long testStart = millis();
    while (millis() - testStart < FLYWHEEL_TEST_DURATION_MS)
    {
        handleSerialCommands();
        menuButton.update();
        for (int j = 0; j < 4; j++)
        {
            if (motorsEnabled[j]) // already excludes the pusher channel - boot cleared it
                motorArr[j].sendThrottle(j == motorIndex ? FLYWHEEL_TEST_THROTTLE : 0);
        }
        if (dismiss.poll())
            return true;
        delay(2);
    }
    return false;
}

// DShot 7 and 8 set the ESC's stored direction and 12 commits it; 20 and 21 move only the runtime
// direction. 7/8 are absolute rather than a toggle, which makes repeating them harmless - AM32
// implements no SETTINGS_REQUEST, so the direction cannot be read back to toggle from.
static const int ESC_CMD_REPEATS = 10;
static const int ESC_SETTLE_FRAMES = 100; // at 2 ms, either side of the write

static void holdAllMotorsStopped(int frames)
{
    // The ESC drops out of its command window if throttle is not zero, and wants a frame every
    // couple of ms regardless, so settling is a send loop rather than a delay.
    for (int i = 0; i < frames; i++)
    {
        for (int j = 0; j < 4; j++)
            if (motorsEnabled[j]) // already excludes the pusher channel - boot cleared it
                motorArr[j].sendThrottle(0);
        delay(2);
    }
}

// Which value the next press writes. Never shown as the ESC's state: dir_reversed is not ground
// truth about which way a wheel turns - swapping two phase wires reverses a motor without touching
// it. This only decides which absolute command comes next; the spin at the end is the arbiter.
static bool nextDirectionReversed[4] = {false, false, false, false};

static void changeEscDirection(int motorIndex)
{
    const bool reversed = nextDirectionReversed[motorIndex];
    nextDirectionReversed[motorIndex] = !reversed;

    display.clearDisplay();
    display.setTextSize(2);
    display.setCursor(0, 8);
    display.print("Motor " + String(motorIndex + 1));
    display.setTextSize(1);
    display.setCursor(0, 32);
    // Says what was just written, never what the ESC had. The difference matters: the second is
    // something nothing on this blaster can know.
    display.print(reversed ? "Set: Reversed" : "Set: Normal");
    display.setCursor(0, 48);
    display.print("writing to ESC...");
    display.display();

    directMotorControlActive = true;
    holdAllMotorsStopped(ESC_SETTLE_FRAMES);

    for (int rep = 0; rep < ESC_CMD_REPEATS; rep++)
    {
        motorArr[motorIndex].esc->sendRaw11Bit(reversed ? DSHOT_CMD_SPIN_DIRECTION_2
                                                        : DSHOT_CMD_SPIN_DIRECTION_1);
        delayMicroseconds(1000);
    }
    for (int rep = 0; rep < ESC_CMD_REPEATS; rep++)
    {
        motorArr[motorIndex].esc->sendRaw11Bit(DSHOT_CMD_SAVE_SETTINGS);
        delayMicroseconds(1000);
    }

    // Command 12 writes the ESC's own flash, so keep the stream up until it is done.
    holdAllMotorsStopped(ESC_SETTLE_FRAMES);

    // The spin is the readback. It is the only thing that says which way this wiring actually
    // turns, which is the question the user has - not what dir_reversed now holds.
    testOneMotor(motorIndex);
    holdAllMotorsStopped(1);
    directMotorControlActive = false;
}

static const char* const motorStageLabels[] = {"Stage 1", "Stage 2"};
static_assert(sizeof(motorStageLabels) / sizeof(motorStageLabels[0]) == kMotorStageIdCount, "motorStageLabels is out of step");

static const char* const kPusherChannelLocked =
    "Pusher channel - not\nusable as a flywheel\nany press = back";

#define MOTOR_SUBMENU(N, LABEL)                                                                    \
    static bool motor##N##Runnable()                                                               \
    {                                                                                              \
        return !isPusherEscChannel(N);                                                             \
    }                                                                                              \
    static ToggleItem motor##N##EnabledItem("Enabled", "device:motorConfig[" #N "].enabled",       \
                                            &deviceSettings.motorConfig[N].enabled, true);         \
    static EnumItem<motorStage_t> motor##N##StageItem(                                             \
        "Stage", "device:motorConfig[" #N "].stage", &deviceSettings.motorConfig[N].stage,         \
        motorStageLabels, kMotorStageIds, kMotorStageIdCount, true);                               \
    static FloatItem motor##N##KPItem("KP", "device:motorConfig[" #N "].kp",                       \
                                      &deviceSettings.motorConfig[N].kp, 0.0f, 2.0f, 0.1f, 2);     \
    static FloatItem motor##N##KIItem("KI", "device:motorConfig[" #N "].ki",                       \
                                      &deviceSettings.motorConfig[N].ki, 0.0f, 4.0f, 0.1f, 2);     \
    static NumericItem<int16_t> motor##N##PolesItem(                                               \
        "Poles/2", "device:motorConfig[" #N "].motorPolesDiv2",                                    \
        &deviceSettings.motorConfig[N].motorPolesDiv2, 1, 10, 1);                                  \
    static NumericItem<int32_t> motor##N##KvItem(                                                  \
        "Kv", "device:motorConfig[" #N "].motorKv", &deviceSettings.motorConfig[N].motorKv, 500,   \
        5000, 10);                                                                                 \
    static void motor##N##TestFired()                                                              \
    {                                                                                              \
        if (!motorsEnabled[N])                                                                     \
            return;                                                                                \
        directMotorControlActive = true;                                                           \
        testOneMotor(N);                                                                           \
        holdAllMotorsStopped(1);                                                                   \
        directMotorControlActive = false;                                                          \
    }                                                                                              \
    static ActionItem motor##N##TestItem("Test This Motor", motor##N##TestFired);                  \
    static void motor##N##DirectionFired()                                                         \
    {                                                                                              \
        if (motorsEnabled[N])                                                                      \
            changeEscDirection(N);                                                                 \
    }                                                                                              \
    static ActionItem motor##N##DirectionItem("Change Direction", motor##N##DirectionFired);       \
    static MenuItem* motor##N##Items[] = {                                                         \
        &motor##N##EnabledItem, &motor##N##StageItem, &motor##N##KPItem,                           \
        &motor##N##KIItem,      &motor##N##PolesItem, &motor##N##KvItem,                           \
        &motor##N##DirectionItem, &motor##N##TestItem};                                            \
    static SubmenuItem motor##N##Submenu(LABEL, motor##N##Items, 8);                               \
    static struct Motor##N##Init                                                                   \
    {                                                                                              \
        Motor##N##Init()                                                                           \
        {                                                                                          \
            motor##N##EnabledItem.setEditableWhen(motor##N##Runnable, kPusherChannelLocked);       \
            motor##N##TestItem.setEditableWhen(motor##N##Runnable, kPusherChannelLocked);          \
            motor##N##DirectionItem.setEditableWhen(motor##N##Runnable, kPusherChannelLocked);     \
        }                                                                                          \
    } motor##N##Init;

MOTOR_SUBMENU(0, "Motor 1")
MOTOR_SUBMENU(1, "Motor 2")
MOTOR_SUBMENU(2, "Motor 3")
MOTOR_SUBMENU(3, "Motor 4")
#undef MOTOR_SUBMENU

static const char* const flywheelControlLabels[] = {"PID", "TBH"};
static_assert(sizeof(flywheelControlLabels) / sizeof(flywheelControlLabels[0]) == kFlywheelControlIdCount, "flywheelControlLabels is out of step");
static EnumItem<flywheelControlType_t> flywheelControlItem("Control Type", "device:flywheelControl",
                                                           &deviceSettings.flywheelControl,
                                                           flywheelControlLabels,
                                                           kFlywheelControlIds,
                                                           kFlywheelControlIdCount);

// The DShot bit rate every ESC on the board is driven at - the four flywheel channels and, on an
// ESC_DRIVER board, the pusher. Read once when those are constructed, hence reboot-required.
static const char* const dshotModeLabels[] = {"DShot300", "DShot600", "DShot1200"};
static_assert(sizeof(dshotModeLabels) / sizeof(dshotModeLabels[0]) == kDshotModeIdCount,
              "dshotModeLabels is out of step");
static EnumItem<dshot_mode_t> dshotModeItem("DShot Rate", "device:dshotMode",
                                            &deviceSettings.dshotMode, dshotModeLabels,
                                            kDshotModeIds, kDshotModeIdCount,
                                            /*needsReboot=*/true);

static bool controlIsPid()
{
    return deviceSettings.flywheelControl == PID_CONTROL;
}
static constexpr VisibilityTerm kControlIsPidTerms[] = {{"device:flywheelControl", "pid", false}};
static constexpr VisibilityCondition kControlIsPid = {kControlIsPidTerms, 1};

static bool controlIsTbh()
{
    return deviceSettings.flywheelControl == TBH_CONTROL;
}
static constexpr VisibilityTerm kControlIsTbhTerms[] = {{"device:flywheelControl", "tbh", false}};
static constexpr VisibilityCondition kControlIsTbh = {kControlIsTbhTerms, 1};

// The actual EMA smoothing math uses `half` (1 << (EMAFilter - 1)), not activeProfile.EMAFilter
// directly - applyEmaFilterConstant() (runMenu()'s post-save hook) recomputes it live.
static NumericItem<uint8_t> emaFilterItem("EMA Filter", "device:EMAFilter",
                                          &deviceSettings.EMAFilter, 1, 4, 1);
static NumericItem<uint16_t> iThresholdItem("I Threshold", "device:iThreshold",
                                            &deviceSettings.iThreshold, 0, 500, 10);
static NumericItem<uint16_t> throttleCapItem("Throttle Cap", "device:throttleCap",
                                             &deviceSettings.throttleCap, 0, 2000, 10);
struct MotorItemsInit
{
    MotorItemsInit()
    {
        emaFilterItem.setVisibleWhen(controlIsPid, &kControlIsPid);
        iThresholdItem.setVisibleWhen(controlIsPid, &kControlIsPid);
        throttleCapItem.setVisibleWhen(controlIsTbh, &kControlIsTbh);
    }
} motorItemsInit;

// Placeholder pending a fresh design
static void autoTunePidComingSoon()
{
    display.clearDisplay();
    display.drawBitmap(0, 0, trollface, 128, 64, SSD1306_WHITE);
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 56); // trollface leaves this row blank by design - see bitmaps.h
    display.print("any press = back");
    display.display();
    waitForTrapdoorPress();
}
static ActionItem autoTunePidItem("Auto-Tune PID", autoTunePidComingSoon);

static void escDashboardFired()
{
    escDashboardOpen = true;
    DismissDetector dismiss;
    while (true)
    {
        handleSerialCommands();
        menuButton.update();

        display.clearDisplay();
        display.setTextWrap(false); // clip long lines rather than let them corrupt the next row
        display.setTextSize(1);
        display.setCursor(0, 0);
        display.println("ESC Dashboard");
        display.drawFastHLine(0, 10, 128, 1);
        int16_t y = 14;
        for (int i = 0; i < 4; i++)
        {
            if (!deviceSettings.motorConfig[i].enabled)
                continue;
            String line = "M" + String(i + 1) + " ";
            line += motorArr[i].telemetryVoltageSeen
                        ? String(motorArr[i].telemetryVoltageRaw / 4.0, 1) + "V "
                        : "--V ";
            line += motorArr[i].telemetryCurrentSeen
                        ? String(motorArr[i].telemetryCurrentRaw) + "A "
                        : "--A ";
            line += motorArr[i].telemetryTempSeen ? String(motorArr[i].telemetryTempRaw) + "C "
                                                  : "--C ";
            line += motorArr[i].telemetryStressSeen ? String(motorArr[i].telemetryStressRaw) : "--";
            display.setCursor(0, y);
            display.print(line);
            y += 10;
        }
        display.setCursor(0, 56);
        display.print("any press = back");
        display.display();

        if (dismiss.poll())
            break;
        delay(100);
    }
    escDashboardOpen = false;
}
static ActionItem escDashboardItem("ESC Dashboard", escDashboardFired);

// Defined in menuDevice.cpp beside the capture length it arms; shown here, where the motors
// it records are configured.
extern ToggleItem rpmLoggingItem;

static MenuItem* motorsPidItems[] = {
    &motor0Submenu,   &motor1Submenu,   &motor2Submenu,    &motor3Submenu, &flywheelControlItem,
    &emaFilterItem,   &iThresholdItem,  &throttleCapItem,  &dshotModeItem, &autoTunePidItem,
    &escDashboardItem, &rpmLoggingItem,
};
// Non-static: referenced by menu.cpp's Advanced submenu assembly.
SubmenuItem motorsPidSubmenu("Motors & PID", motorsPidItems, 12);
