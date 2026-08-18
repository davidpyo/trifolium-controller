#pragma once
#include "menu.h"
#include "types.h"
#include "../lib/Bounce2/src/Bounce2.h"
#include <Adafruit_SSD1306.h>
#include <cmath> // floorf()/roundf() - TargetDpsItem's integer-only display/step
#include "runtimeSettings.h"
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

extern Adafruit_SSD1306 display;
extern Bounce2::Button triggerSwitch;
extern Bounce2::Button revSwitch;

extern RuntimeSettings activeProfile;
extern DeviceSettings deviceSettings;
extern uint8_t activeProfileIndex;           // which slot activeProfile came from
extern int8_t fpsMode;                       // which RPM Profile (1-3) was locked in at boot
extern int8_t firingMode;                    // which Firing Mode (1-3) is live-selected right now
extern float solenoidVoltageTimeSlope;       // applySolenoidTimingCurve()'s output
extern int16_t solenoidVoltageTimeIntercept; // ditto
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

// Transparent proxy onto another MenuItem, resolved fresh on every call rather than bound once at
// construction - lets a root-level row track whichever underlying item is "active" right now (e.g.
// Burst Mode for whichever Firing Mode is selected) without duplicating the field. The label shown
// is this item's own; everything else forwards to the resolved target.
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
    void adjustValue(int8_t direction) override { resolver_()->adjustValue(direction); }
    void cancelEdit() override { resolver_()->cancelEdit(); }
    uint8_t optionCount() const override { return resolver_()->optionCount(); }
    String optionLabel(uint8_t index) const override { return resolver_()->optionLabel(index); }
    uint8_t currentOptionIndex() const override { return resolver_()->currentOptionIndex(); }
    bool isEditable() const override { return resolver_()->isEditable(); }
    String lockedMessage() const override { return resolver_()->lockedMessage(); }

  private:
    Resolver resolver_;
};

// Gates a leaf item's editability on a runtime condition, without a dedicated subclass per field.
// Used by the 5 manual solenoid timing fields, which go read-only while Auto Timing is on.
class ConditionalLockItem : public MenuItem
{
  public:
    using Predicate = bool (*)();
    ConditionalLockItem(MenuItem* target, Predicate lockedWhen, const char* lockedMessage)
        : MenuItem(target->label()), target_(target), lockedWhen_(lockedWhen),
          lockedMessage_(lockedMessage)
    {
    }

    const char* label() const override { return target_->label(); }
    String valueText() const override { return target_->valueText(); }
    bool showsArrow() const override { return target_->showsArrow(); }
    MenuActivation activate() override { return target_->activate(); }
    void beginEdit() override { target_->beginEdit(); }
    void adjustValue(int8_t direction) override { target_->adjustValue(direction); }
    void cancelEdit() override { target_->cancelEdit(); }
    uint8_t optionCount() const override { return target_->optionCount(); }
    String optionLabel(uint8_t index) const override { return target_->optionLabel(index); }
    uint8_t currentOptionIndex() const override { return target_->currentOptionIndex(); }
    bool isEditable() const override { return !lockedWhen_() && target_->isEditable(); }
    String lockedMessage() const override
    {
        return lockedWhen_() ? String(lockedMessage_) : target_->lockedMessage();
    }

  private:
    MenuItem* target_;
    Predicate lockedWhen_;
    const char* lockedMessage_;
};
class RpmTargetItem : public MenuItem
{
  public:
    RpmTargetItem(const char* label, int32_t* value, int32_t step, bool needsReboot = false)
        : MenuItem(label), value_(value), step_(step)
    {
        needsReboot_ = needsReboot;
    }
    String valueText() const override { return String(*value_); }
    MenuActivation activate() override { return MenuActivation::EnterEdit; }
    void beginEdit() override { entryValue_ = *value_; }
    void adjustValue(int8_t direction) override
    {
        int64_t next = (int64_t)*value_ + (int64_t)direction * (int64_t)step_;
        if (next > (int64_t)deviceSettings.maxRpmCap)
            next = (int64_t)deviceSettings.maxRpmCap;
        if (next < 0)
            next = 0;
        *value_ = (int32_t)next;
    }
    void cancelEdit() override { *value_ = entryValue_; }

  private:
    int32_t* value_;
    int32_t step_;
    int32_t entryValue_ = 0;
};

// Target DPS / Auto Timing: an alternative front-end onto the same voltage-compensated
// extend/retract cycle the 5 manual solenoid fields drive - editable while Auto Timing is on,
// read-only computed display while it's off. Defined here (not menuSolenoid.cpp) because the
// root-level Target DPS shortcut (menu.cpp) needs the concrete type to take its address.
class TargetDpsItem : public MenuItem
{
  public:
    explicit TargetDpsItem(const char* label) : MenuItem(label) {}

    // Whole numbers only - a fractional dart rate isn't meaningful to dial in by hand.
    String valueText() const override
    {
        if (!activeProfile.autoTiming)
            return String(achievedDPS(), 1); // achieved-DPS display, not a user-set target
        int hardwareMaxInt = (int)floorf(achievedDPS());
        int value = (int)roundf(activeProfile.targetDPS);
        String text = String(value);
        if (value >= hardwareMaxInt)
            text += " (max)";
        return text;
    }
    // "(max)" pushes this value's rendered width past what size-3 fits at any 2-digit value.
    uint8_t editValueTextSize() const override { return 2; }
    MenuActivation activate() override { return MenuActivation::EnterEdit; }
    bool isEditable() const override { return activeProfile.autoTiming; }
    String lockedMessage() const override
    {
        return "Computed from manual\nsolenoid timing - see\nAdvanced > Solenoid /\nPusher > Auto "
               "Timing.";
    }
    void beginEdit() override { entryValue_ = activeProfile.targetDPS; }
    void adjustValue(int8_t direction) override
    {
        float next = roundf(activeProfile.targetDPS) + direction * 1.0f;
        if (next < 1.0f)
            next = 1.0f;
        float hardwareMax = floorf(achievedDPS());
        if (next > hardwareMax)
            next = hardwareMax;
        activeProfile.targetDPS = next;
    }
    void cancelEdit() override { activeProfile.targetDPS = entryValue_; }

  private:
    static float achievedDPS()
    {
        float extendAtVoltage_ms = batteryMonitor->getVoltage_mv() * solenoidVoltageTimeSlope +
                                   solenoidVoltageTimeIntercept;
        float cycle_ms = extendAtVoltage_ms + activeProfile.solenoidRetractTime_ms;
        return cycle_ms > 0 ? 1000.0f / cycle_ms : 0;
    }
    float entryValue_ = 0;
};

extern TargetDpsItem targetDpsItem;

// The root menu's item list (menu.cpp) and its element count.
extern MenuItem* rootItems[];
extern const uint8_t rootItemsCount;
