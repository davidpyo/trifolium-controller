#pragma once
#include "menu.h"
#include "types.h"
#include "../lib/Bounce2/src/Bounce2.h"
#include <Adafruit_SSD1306.h>
#include <cmath>
#include "shotProfile.h"
#include "deviceSettings.h"
#include "batteryMonitor.h"
#include "displayManager.h"
#include "flywheelMotor.h"

// Shared engine pieces every menu.cpp domain file needs: hardware/global externs, blocking-action
// helpers, and the reusable non-domain-specific MenuItem subclasses. The navigation engine itself
// lives in menuCore.cpp.

extern uint8_t menuButtonPin;
extern bool menuButtonNormallyClosed;
extern uint16_t debounceTime_ms;
extern uint8_t triggerSwitchPin;
extern uint8_t revSwitchPin;
extern uint8_t selectPins[3];

extern Adafruit_SSD1306 display;
extern Bounce2::Button triggerSwitch;
extern Bounce2::Button revSwitch;

extern ShotProfile activeProfile;
extern DeviceSettings deviceSettings;
extern uint8_t activeProfileIndex;           // which of the 3 named profiles activeProfile came from
extern int8_t firingMode;                    // which Firing Mode (1-3) is live-selected right now
extern int8_t screenOverrideMode;
extern float solenoidVoltageTimeSlope;       // applySolenoidTimingCurve()'s output
extern int16_t solenoidVoltageTimeIntercept; // ditto
extern float maxAchievableDPS;                // applyMaxAchievableDps()'s output
extern BatteryMonitor* batteryMonitor;
extern DisplayManager displayManager;
extern FlywheelMotor motorArr[4];
extern volatile bool directMotorControlActive; // see fwControlLoop()
extern bool escDashboardOpen;                  // lets Rev spin flywheels while this screen is open

bool pinDefined(uint8_t pin);
void handleSerialCommands();

// Shared list-layout constants - menuCore.cpp's renderList() and menuTextEditor.cpp's
// Save/Cancel screen both use these to keep the same list-row look.
static const uint8_t OLED_WIDTH = 128;
static const int16_t LIST_TOP_Y = 14;
static const uint8_t ROW_HEIGHT = 10;

// The single Menu button every blocking action handler across every domain file polls.
extern Bounce2::Button menuButton;

inline bool revUsableForNav()
{
    return pinDefined(revSwitchPin) && !deviceSettings.dualStageTrigger;
}

inline bool revNavPressed()
{
    return revUsableForNav() && revSwitch.isPressed();
}

inline int8_t soloTriggerListDir()
{
    return revUsableForNav() ? -1 : +1;
}

// Detects a dismiss gesture on menuButton (short press-and-release, or a long press-and-hold past
// deviceSettings.menuButtonHoldTime_ms), pollable instead of blocking. A short press only reports
// true once the release has actually happened, not on press-down - otherwise runMenu()'s outer
// loop would see that release fresh afterward and misinterpret it as a new short-press.
struct DismissDetector
{
    bool longPressWasActive = menuButton.isPressed() &&
                              menuButton.currentDuration() >= deviceSettings.menuButtonHoldTime_ms;

    bool poll()
    {
        bool longPressNow = menuButton.isPressed() &&
                            menuButton.currentDuration() >= deviceSettings.menuButtonHoldTime_ms;
        bool longPress = longPressNow && !longPressWasActive;
        longPressWasActive = longPressNow;
        bool shortPress = menuButton.released() &&
                          menuButton.previousDuration() < deviceSettings.menuButtonHoldTime_ms;
        return longPress || shortPress;
    }
};

// Tracks a button's held state to drive fast-adjust while editing a value: fires once on a fresh
// press, then again every REPEAT_INTERVAL_MS once held past REPEAT_DELAY_MS. Shared by runMenu()
// (menuCore.cpp) and runTextEditor() (menuTextEditor.cpp).
struct HeldRepeat
{
    static const unsigned long REPEAT_DELAY_MS = 500;
    static const unsigned long REPEAT_INTERVAL_MS = 150;

    bool wasPressed = false;
    unsigned long pressStart_ms = 0;
    unsigned long lastRepeat_ms = 0;

    bool poll(bool isPressed)
    {
        unsigned long now = millis();
        if (isPressed && !wasPressed)
        {
            wasPressed = true;
            pressStart_ms = now;
            lastRepeat_ms = now;
            return true; // fresh press - same as a plain edge
        }
        if (isPressed && wasPressed)
        {
            if (now - pressStart_ms >= REPEAT_DELAY_MS && now - lastRepeat_ms >= REPEAT_INTERVAL_MS)
            {
                lastRepeat_ms = now;
                return true;
            }
            return false;
        }
        wasPressed = false;
        return false;
    }
};

// Blocking full-screen message-and-wait helpers (menuCore.cpp).
bool showTrapdoor(const String& message);
bool waitForTrapdoorPress();

// Opens the on-device character-by-character editor - shared by Blaster Name and each Select-Fire
// > Mode N > Display Name.
bool runTextEditor(const char* title, String& value);

// Like ActionItem, but shows the live String value inline and opens runTextEditor() when selected.
class TextEditItem : public MenuItem
{
  public:
    TextEditItem(const char* label, String* value) : MenuItem(label), value_(value) {}
    String valueText() const override { return *value_; }
    MenuActivation activate() override
    {
        runTextEditor(label(), *value_);
        return MenuActivation::None;
    }

  private:
    String* value_;
};


class ShortcutItem : public MenuItem
{
  public:
    using Resolver = MenuItem* (*)();
    ShortcutItem(const char* label, Resolver resolver) : MenuItem(label), resolver_(resolver) {}

    String valueText() const override { return resolver_()->valueText(); }
    bool showsArrow() const override { return resolver_()->showsArrow(); }
    MenuActivation activate() override { return resolver_()->activate(); }
    MenuItem* const* children() const override { return resolver_()->children(); }
    uint8_t childCount() const override { return resolver_()->childCount(); }
    void beginEdit() override { resolver_()->beginEdit(); }
    void adjust(int8_t direction, bool wrap) override { resolver_()->adjust(direction, wrap); }
    void cancelEdit() override { resolver_()->cancelEdit(); }
    uint8_t optionCount() const override { return resolver_()->optionCount(); }
    String optionLabel(uint8_t index) const override { return resolver_()->optionLabel(index); }
    uint8_t currentOptionIndex() const override { return resolver_()->currentOptionIndex(); }
    bool isEditable() const override { return resolver_()->isEditable(); }
    String lockedMessage() const override { return resolver_()->lockedMessage(); }
    bool isVisible() const override { return resolver_()->isVisible(); }

  private:
    Resolver resolver_;
};
static const uint8_t RPM_TARGET_ALL_MOTORS = 0xFF;

inline int32_t motorRpmCeiling(uint8_t motorIndex)
{
    const MotorConfig& mc = deviceSettings.motorConfig[motorIndex];
    int64_t theoreticalMax =
        (int64_t)mc.motorKv * batteryVoltageMax_mv[deviceSettings.batteryType] / 1000;
    int64_t margin = (int64_t)cellCount(deviceSettings.batteryType) * mc.motorKv / 2;
    return (int32_t)(theoreticalMax - margin);
}

inline int32_t motorRpmFloor(uint8_t motorIndex)
{
    return 2 * deviceSettings.motorConfig[motorIndex].motorKv;
}

inline int8_t highestKvEnabledMotor(const uint8_t* candidates, uint8_t count)
{
    int8_t best = -1;
    for (uint8_t i = 0; i < count; i++)
    {
        uint8_t idx = candidates[i];
        if (deviceSettings.motorConfig[idx].enabled &&
            (best < 0 ||
             deviceSettings.motorConfig[idx].motorKv > deviceSettings.motorConfig[best].motorKv))
        {
            best = (int8_t)idx;
        }
    }
    return best;
}

class RpmTargetItem : public MenuItem
{
  public:
    RpmTargetItem(const char* label, int32_t* value, uint8_t motorIndex, int32_t step,
                 bool needsReboot = false)
        : MenuItem(label), value_(value), motorIndex_(motorIndex), step_(step)
    {
        needsReboot_ = needsReboot;
    }
    String valueText() const override { return String(*value_); }
    MenuActivation activate() override { return MenuActivation::EnterEdit; }
    void beginEdit() override { entryValue_ = *value_; }
    void adjust(int8_t direction, bool wrap) override
    {
        int32_t floor = 0;
        int32_t ceiling = 100000; // fallback if no motor in scope is enabled
        int8_t ref = referenceMotor();
        if (ref >= 0)
        {
            floor = motorRpmFloor((uint8_t)ref);
            ceiling = motorRpmCeiling((uint8_t)ref);
        }
        int64_t next = (int64_t)*value_ + (int64_t)direction * (int64_t)step_;
        if (next > (int64_t)ceiling)
            next = wrap ? (int64_t)floor : (int64_t)ceiling;
        if (next < (int64_t)floor)
            next = wrap ? (int64_t)ceiling : (int64_t)floor;
        *value_ = (int32_t)next;
    }
    void cancelEdit() override { *value_ = entryValue_; }

  private:
    int8_t referenceMotor() const
    {
        if (motorIndex_ != RPM_TARGET_ALL_MOTORS)
            return deviceSettings.motorConfig[motorIndex_].enabled ? (int8_t)motorIndex_ : -1;
        static const uint8_t allMotors[4] = {0, 1, 2, 3};
        return highestKvEnabledMotor(allMotors, 4);
    }

    int32_t* value_;
    uint8_t motorIndex_;
    int32_t step_;
    int32_t entryValue_ = 0;
};

inline String formatSecondsMs(uint32_t valueMs, uint32_t granularityMs)
{
    if (granularityMs >= 1000)
        return String(valueMs / 1000) + "s";
    return String(valueMs / 1000.0f, 1) + "s";
}

class SecondsDisplayItem : public MenuItem
{
  public:
    SecondsDisplayItem(const char* label, uint32_t* value_ms, uint32_t minMs, uint32_t maxMs,
                       uint32_t granularityMs, bool needsReboot = false)
        : MenuItem(label), value_(value_ms), min_(minMs), max_(maxMs), granularity_(granularityMs)
    {
        needsReboot_ = needsReboot;
    }

    String valueText() const override { return formatSecondsMs(*value_, granularity_); }
    MenuActivation activate() override { return MenuActivation::EnterEdit; }
    void beginEdit() override { entryValue_ = *value_; }
    void adjust(int8_t direction, bool wrap) override
    {
        int64_t next = (int64_t)*value_ + (int64_t)direction * (int64_t)granularity_;
        if (next > (int64_t)max_)
            next = wrap ? (int64_t)min_ : (int64_t)max_;
        if (next < (int64_t)min_)
            next = wrap ? (int64_t)max_ : (int64_t)min_;
        *value_ = (uint32_t)next;
    }
    void cancelEdit() override { *value_ = entryValue_; }

  private:
    uint32_t* value_;
    uint32_t min_;
    uint32_t max_;
    uint32_t granularity_;
    uint32_t entryValue_ = 0;
};

// The root menu's item list (menu.cpp) and its element count.
extern MenuItem* rootItems[];
extern const uint8_t rootItemsCount;
