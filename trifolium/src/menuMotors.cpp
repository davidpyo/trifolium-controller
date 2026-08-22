#include "menuCore.h"
#include "bitmaps.h" // trollface - the "Coming Soon" placeholder's image

static const int32_t FLYWHEEL_TEST_THROTTLE = 400; // modest throttle (~20% of maxThrottle) - enough
                                                   // to visibly/audibly spin without excessive draw
static const unsigned long FLYWHEEL_TEST_DURATION_MS = 2000;

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
            if (deviceSettings.motorConfig[j].enabled)
                motorArr[j].sendThrottle(j == motorIndex ? FLYWHEEL_TEST_THROTTLE : 0);
        }
        if (dismiss.poll())
            return true;
        delay(2);
    }
    return false;
}

static const char* const motorStageLabels[] = {"Stage 1", "Stage 2"};
#define MOTOR_SUBMENU(N, LABEL)                                                                    \
    static ToggleItem motor##N##EnabledItem("Enabled", &deviceSettings.motorConfig[N].enabled,     \
                                            true);                                                 \
    static EnumItem<motorStage_t> motor##N##StageItem(                                             \
        "Stage", &deviceSettings.motorConfig[N].stage, motorStageLabels, 2, true);                 \
    static FloatItem motor##N##KPItem("KP", &deviceSettings.motorConfig[N].kp, 0.0f, 5.0f, 0.01f,  \
                                      2);                                                          \
    static FloatItem motor##N##KIItem("KI", &deviceSettings.motorConfig[N].ki, 0.0f, 5.0f, 0.01f,  \
                                      2);                                                          \
    static NumericItem<int16_t> motor##N##PolesItem(                                               \
        "Poles/2", &deviceSettings.motorConfig[N].motorPolesDiv2, 1, 20, 1);                       \
    static NumericItem<int32_t> motor##N##KvItem("Kv", &deviceSettings.motorConfig[N].motorKv, 100, \
                                                  5000, 50);                                       \
    static void motor##N##TestFired()                                                              \
    {                                                                                              \
        if (!deviceSettings.motorConfig[N].enabled)                                                \
            return;                                                                                \
        directMotorControlActive = true;                                                           \
        testOneMotor(N);                                                                           \
        for (int j = 0; j < 4; j++)                                                                \
            if (deviceSettings.motorConfig[j].enabled)                                              \
                motorArr[j].sendThrottle(0);                                                       \
        directMotorControlActive = false;                                                          \
    }                                                                                              \
    static ActionItem motor##N##TestItem("Test This Motor", motor##N##TestFired);                  \
    static MenuItem* motor##N##Items[] = {                                                         \
        &motor##N##EnabledItem, &motor##N##StageItem, &motor##N##KPItem,                           \
        &motor##N##KIItem,      &motor##N##PolesItem, &motor##N##KvItem, &motor##N##TestItem};     \
    static SubmenuItem motor##N##Submenu(LABEL, motor##N##Items, 7);

MOTOR_SUBMENU(0, "Motor 1")
MOTOR_SUBMENU(1, "Motor 2")
MOTOR_SUBMENU(2, "Motor 3")
MOTOR_SUBMENU(3, "Motor 4")
#undef MOTOR_SUBMENU

static const char* const flywheelControlLabels[] = {"PID", "TBH"};
static EnumItem<flywheelControlType_t>
    flywheelControlItem("Control Type", &deviceSettings.flywheelControl, flywheelControlLabels, 2);

static bool controlIsPid()
{
    return deviceSettings.flywheelControl == PID_CONTROL;
}
static bool controlIsTbh()
{
    return deviceSettings.flywheelControl == TBH_CONTROL;
}

// The actual EMA smoothing math uses `half` (1 << (EMAFilter - 1)), not activeProfile.EMAFilter
// directly - applyEmaFilterConstant() (runMenu()'s post-save hook) recomputes it live.
static NumericItem<uint8_t> emaFilterItem("EMA Filter", &deviceSettings.EMAFilter, 1, 8, 1);
static NumericItem<uint8_t> iThresholdItem("I Threshold", &deviceSettings.iThreshold, 0, 255, 5);
static NumericItem<uint16_t> throttleCapItem("Throttle Cap", &deviceSettings.throttleCap, 0, 2000,
                                             10);
struct MotorItemsInit
{
    MotorItemsInit()
    {
        emaFilterItem.setVisibleWhen(controlIsPid);
        iThresholdItem.setVisibleWhen(controlIsPid);
        throttleCapItem.setVisibleWhen(controlIsTbh);
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

static MenuItem* motorsPidItems[] = {
    &motor0Submenu,       &motor1Submenu,   &motor2Submenu,   &motor3Submenu, &flywheelControlItem,
    &emaFilterItem,       &iThresholdItem,  &throttleCapItem, &autoTunePidItem,
    &escDashboardItem,
};
// Non-static: referenced by menu.cpp's Advanced submenu assembly.
SubmenuItem motorsPidSubmenu("Motors & PID", motorsPidItems, 10);
