#pragma once
#include <Arduino.h>
#include "types.h" // burstFireType_t, etc. - needed by the domain-item extern declarations below

template <typename T> struct NoDeduceHelper
{
    using Type = T;
};
template <typename T> using NoDeduce = typename NoDeduceHelper<T>::Type;

// Attach the menu button pin (no-op if menuButtonPin is PIN_NOT_USED). Call once from setup().
void setupMenuButton();

bool menuButtonHeld();

void runMenu();

bool menuIsOpen();

enum class MenuActivation : uint8_t
{
    None,
    EnterSubmenu,
    EnterEdit,
};

// Base class for every menu item - the engine only talks to items through this interface.
class MenuItem
{
  public:
    explicit MenuItem(const char* label) : label_(label) {}
    virtual ~MenuItem() = default;

    // Virtual so a leaf class can return a live String's c_str() instead of a fixed pointer
    // captured once at construction.
    virtual const char* label() const { return label_; }

    // Text shown after "label: " in the list and as the big value in edit mode. Empty (the
    // default) means no value is shown - used by Submenu/Action items.
    virtual String valueText() const { return String(); }

    // Whether this item gets the " >" suffix in the list (true only for Submenu).
    virtual bool showsArrow() const { return false; }

    // What a short-press does - the engine just acts on the returned enum.
    virtual MenuActivation activate() = 0;

    // Only meaningful for Submenu items.
    virtual MenuItem* const* children() const { return nullptr; }
    virtual uint8_t childCount() const { return 0; }

    // Edit-mode lifecycle, only meaningful for items that return EnterEdit above.
    virtual void beginEdit() {}                   // snapshot for cancel-revert
    virtual void adjustValue(int8_t direction) {} // trigger/rev while editing
    virtual void cancelEdit() {}                  // long-press: revert to snapshot

    // Text size for the big centered value on the edit screen - smaller than the default 3 for
    // items whose valueText() can grow a suffix (e.g. TargetDpsItem's "(max)").
    virtual uint8_t editValueTextSize() const { return 3; }

    // Non-zero only for items with a small, discrete, ordered option set (EnumItem) - rendered
    // as a scrollable list instead of the single-big-value edit screen.
    virtual uint8_t optionCount() const { return 0; }
    virtual String optionLabel(uint8_t index) const { return String(); }
    virtual uint8_t currentOptionIndex() const { return 0; }

    // False for an item whose edit would be pointless right now - shows lockedMessage() instead
    // of opening the editor, rather than hiding the row.
    virtual bool isEditable() const { return true; }
    virtual String lockedMessage() const
    {
        return "This setting can't be\nedited right now.\nany press = back";
    }

    // True for settings that only take effect after a reboot.
    bool needsReboot() const { return needsReboot_; }

  protected:
    const char* label_;
    bool needsReboot_ = false;
};

class SubmenuItem : public MenuItem
{
  public:
    SubmenuItem(const char* label, MenuItem* const* children, uint8_t childCount)
        : MenuItem(label), children_(children), childCount_(childCount)
    {
    }

    bool showsArrow() const override { return true; }
    MenuActivation activate() override { return MenuActivation::EnterSubmenu; }
    MenuItem* const* children() const override { return children_; }
    uint8_t childCount() const override { return childCount_; }

  private:
    MenuItem* const* children_;
    uint8_t childCount_;
};

typedef void (*MenuAction)();

class ActionItem : public MenuItem
{
  public:
    ActionItem(const char* label, MenuAction action) : MenuItem(label), action_(action) {}

    MenuActivation activate() override
    {
        if (action_)
            action_();
        return MenuActivation::None;
    }

  private:
    MenuAction action_;
};

class ToggleItem : public MenuItem
{
  public:
    ToggleItem(const char* label, bool* value, bool needsReboot = false)
        : MenuItem(label), value_(value)
    {
        needsReboot_ = needsReboot;
    }

    String valueText() const override { return *value_ ? "ON" : "OFF"; }
    MenuActivation activate() override
    {
        *value_ = !*value_;
        return MenuActivation::None;
    }

  private:
    bool* value_;
};

// Templated so it can bind directly to a field of its real width instead of forcing everything
// to int32_t. min/max/step use NoDeduce so callers can pass plain integer literals.
template <typename T> class NumericItem : public MenuItem
{
  public:
    NumericItem(const char* label, T* value, NoDeduce<T> minValue, NoDeduce<T> maxValue,
                NoDeduce<T> step, bool needsReboot = false)
        : MenuItem(label), value_(value), min_(minValue), max_(maxValue), step_(step)
    {
        needsReboot_ = needsReboot;
    }

    String valueText() const override { return String(*value_); }
    MenuActivation activate() override { return MenuActivation::EnterEdit; }
    void beginEdit() override { entryValue_ = *value_; }
    void adjustValue(int8_t direction) override
    {
        // wide intermediate type so a narrow field can't wrap mid-calculation
        int64_t next = (int64_t)*value_ + (int64_t)direction * (int64_t)step_;
        if (next > (int64_t)max_)
            next = (int64_t)max_;
        if (next < (int64_t)min_)
            next = (int64_t)min_;
        *value_ = (T)next;
    }
    void cancelEdit() override { *value_ = entryValue_; }

  private:
    T* value_;
    T min_;
    T max_;
    T step_;
    T entryValue_{};
};

class FloatItem : public MenuItem
{
  public:
    FloatItem(const char* label, float* value, float minValue, float maxValue, float step,
              uint8_t decimals = 2, bool needsReboot = false)
        : MenuItem(label), value_(value), min_(minValue), max_(maxValue), step_(step),
          decimals_(decimals)
    {
        needsReboot_ = needsReboot;
    }

    String valueText() const override { return String(*value_, decimals_); }
    MenuActivation activate() override { return MenuActivation::EnterEdit; }
    void beginEdit() override { entryValue_ = *value_; }
    void adjustValue(int8_t direction) override
    {
        float next = *value_ + direction * step_;
        if (next > max_)
            next = max_;
        if (next < min_)
            next = min_;
        *value_ = next;
    }
    void cancelEdit() override { *value_ = entryValue_; }

  private:
    float* value_;
    float min_;
    float max_;
    float step_;
    uint8_t decimals_;
    float entryValue_ = 0;
};

template <typename E> class EnumItem : public MenuItem
{
  public:
    EnumItem(const char* label, E* value, const char* const* labels, uint8_t count,
             bool needsReboot = false)
        : MenuItem(label), value_(value), labels_(labels), count_(count)
    {
        needsReboot_ = needsReboot;
    }

    String valueText() const override { return labels_[currentOptionIndex()]; }
    MenuActivation activate() override { return MenuActivation::EnterEdit; }
    void beginEdit() override { entryValue_ = *value_; }
    void adjustValue(int8_t direction) override
    {
        int next = (int)*value_ + direction;
        if (next < 0)
            next = 0;
        if (next >= (int)count_)
            next = (int)count_ - 1;
        *value_ = (E)next;
    }
    void cancelEdit() override { *value_ = entryValue_; }

    uint8_t optionCount() const override { return count_; }
    String optionLabel(uint8_t index) const override
    {
        return index < count_ ? String(labels_[index]) : String();
    }
    uint8_t currentOptionIndex() const override
    {
        int idx = (int)*value_;
        if (idx < 0)
            idx = 0;
        if (idx >= (int)count_)
            idx = count_ - 1;
        return (uint8_t)idx;
    }

  private:
    E* value_;
    const char* const* labels_;
    uint8_t count_;
    E entryValue_{};
};

// menuFlywheel.cpp
extern SubmenuItem flywheelRpmSubmenu;
extern SubmenuItem rpmProfile0Submenu;
extern SubmenuItem rpmProfile1Submenu;
extern SubmenuItem rpmProfile2Submenu;

// menuMotors.cpp
extern SubmenuItem motorsPidSubmenu;

// menuSelectFire.cpp
extern SubmenuItem selectFireSubmenu;
extern EnumItem<burstFireType_t> firingMode0BurstModeItem;
extern EnumItem<burstFireType_t> firingMode1BurstModeItem;
extern EnumItem<burstFireType_t> firingMode2BurstModeItem;
extern NumericItem<uint32_t> firingMode0BurstLengthItem;
extern NumericItem<uint32_t> firingMode1BurstLengthItem;
extern NumericItem<uint32_t> firingMode2BurstLengthItem;

// menuBattery.cpp
extern SubmenuItem batterySubmenu;

// menuSolenoid.cpp
extern SubmenuItem solenoidSubmenu;
// targetDpsItem itself is declared in menuCore.h.

// menuProfile.cpp
extern SubmenuItem profileSubmenu;
extern SubmenuItem switchProfileSubmenu;

// menuDevice.cpp
extern SubmenuItem deviceSubmenu;
extern SubmenuItem rebootSubmenu;
