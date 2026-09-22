#pragma once
#include <Arduino.h>
#include <cmath> // llroundf() - FloatItem::bounds() scaling
#include "types.h" // burstFireType_t, etc. - needed by the domain-item extern declarations below
#include "pinCapabilities.h" // adcPinUsable() - AdcPinItem::clampToBounds()

template <typename T> struct NoDeduceHelper
{
    using Type = T;
};
template <typename T> using NoDeduce = typename NoDeduceHelper<T>::Type;

// Steps `value` to the next multiple of `step` in the direction of travel, clamped to [lo, hi]
inline int64_t steppedToGrid(int64_t value, int8_t direction, int64_t step, int64_t lo, int64_t hi,
                             bool wrap)
{
    if (step <= 0 || direction == 0)
        return value;
    auto floorDiv = [](int64_t a, int64_t b)
    {
        int64_t q = a / b;
        return (a % b != 0 && (a < 0) != (b < 0)) ? q - 1 : q;
    };
    lo = -floorDiv(-lo, step) * step;
    hi = floorDiv(hi, step) * step;

    int64_t next =
        (direction > 0) ? (floorDiv(value, step) + 1) * step : floorDiv(value - 1, step) * step;
    if (next > hi)
        next = wrap ? lo : hi;
    if (next < lo)
        next = wrap ? hi : lo;
    return next;
}

// A visibility rule stated as data, so the console can re-evaluate it as the user edits instead of
// waiting for the next DUMP_SCHEMA. Only stored settings: a rule reading a resolved pin carries no
// condition, which tells the console to leave that row alone.
struct VisibilityTerm
{
    const char* key;   // "device:flywheelControl"
    const char* value; // the stored id, or "true"/"false" for a bool
    bool negate;       // true for !=
};

struct VisibilityCondition
{
    const VisibilityTerm* terms;
    uint8_t count;
};

// Attach the menu button pin (no-op if menuButtonPin is PIN_NOT_USED). Call once from setup().
void setupMenuButton();

enum class MenuButtonPress : uint8_t
{
    None,
    Tap,
    Hold,
};
MenuButtonPress pollMenuButton();

bool menuButtonDrivesModeCycle();

void runMenu();

bool menuIsOpen();

enum class MenuActivation : uint8_t
{
    None,
    EnterSubmenu,
    EnterEdit,
    PopBack,
};

enum class ItemKind : uint8_t
{
    Submenu,
    Action,
    Bool,
    Int,
    Float,
    Enum,
    Text,
};

// What an item's value actually is, which is what says whether a missing jsonKey() is a mistake.
enum class ItemStorage : uint8_t
{
    Config,  // backed by the stored field jsonKey() names - the default, and the only kind with a key
    Derived, // an editing view over fields other items already expose (see StageRpmItem)
    Live,    // runtime state that is never persisted (see ScreenFireModeItem)
};

// Everything needed to render and validate one editable field.
struct ItemBounds
{
    int64_t lo = 0;
    int64_t hi = 0;
    int64_t step = 1;
    uint8_t decimals = 0;
};

// Base class for every menu item - the engine only talks to items through this interface.
class MenuItem
{
  public:
    explicit MenuItem(const char* label, const char* key = nullptr) : label_(label), key_(key) {}
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
    virtual void beginEdit() {} // snapshot for cancel-revert

    virtual void adjust(int8_t direction, bool wrap) {}

    virtual void cancelEdit() {} // long-press: revert to snapshot

    // Text size for the big centered value on the edit screen - smaller than the default 3 for
    // items whose valueText() can grow a suffix (e.g. TargetDpsItem's "(max)").
    virtual uint8_t editValueTextSize() const { return 3; }

    // Non-zero only for items with a small, discrete, ordered option set (EnumItem) - rendered
    // as a scrollable list instead of the single-big-value edit screen.
    virtual uint8_t optionCount() const { return 0; }
    virtual String optionLabel(uint8_t index) const { return String(); }
    virtual uint8_t currentOptionIndex() const { return 0; }

    // The stored id for an option, emitted as `optionValues` so the console writes a name rather
    // than an ordinal. Null means the value really is its number.
    virtual const char* optionValue(uint8_t index) const { return nullptr; }

    // False for an item whose edit would be pointless right now - shows lockedMessage() instead
    // of opening the editor, rather than hiding the row.
    virtual bool isEditable() const { return !editableWhen_ || editableWhen_(); }
    virtual String lockedMessage() const
    {
        if (lockedMessage_)
            return lockedMessage_;
        return "This setting can't be\nedited right now.\nany press = back";
    }

    // False to skip this row entirely - not counted, not rendered, not selectable, unlike
    // isEditable(), which still shows it. Checked by visibleCount()/visibleItemAt(), not raw indexing.
    virtual bool isVisible() const { return !visibleWhen_ || visibleWhen_(); }

    using VisibilityPredicate = bool (*)();
    void setVisibleWhen(VisibilityPredicate pred) { visibleWhen_ = pred; }

    // Same rule, stated twice: `pred` is what the device evaluates, `cond` is what the console
    // gets. Pass both only where the rule reads a stored setting - see VisibilityCondition.
    void setVisibleWhen(VisibilityPredicate pred, const VisibilityCondition* cond)
    {
        visibleWhen_ = pred;
        visibleWhenData_ = cond;
    }

    // For rules that live in an isVisible() override rather than a predicate.
    void setVisibleWhenData(const VisibilityCondition* cond) { visibleWhenData_ = cond; }

    // Virtual like isVisible(): ShortcutItem forwards both, and a shortcut publishing its own
    // absent rule would tell the console not to re-evaluate a row the real item says it should.
    virtual const VisibilityCondition* visibleWhenData() const { return visibleWhenData_; }

    // Keeps the row visible but refuses activation with `message` while pred() is false.
    void setEditableWhen(VisibilityPredicate pred, const char* message)
    {
        editableWhen_ = pred;
        lockedMessage_ = message;
    }

    // Drops the OLED row while leaving the field live in the schema and over serial. Not
    // setEditableWhen(): that reaches the console as editable:false and disables its editor too.
    void setOffDevice() { onDevice_ = false; }

    // True for settings that only take effect after a reboot.
    bool needsReboot() const { return needsReboot_; }

    // Text limits for rows the on-device editor's own are wrong for. 0/null means use the editor's;
    // a field a host writes is not bound by what fits on a 128x64 screen.
    virtual uint16_t textMaxLen() const { return 0; }
    virtual const char* textCharset() const { return nullptr; }

    virtual ItemKind kind() const { return ItemKind::Action; }
    virtual const char* jsonKey() const { return key_; }
    virtual ItemStorage storage() const { return ItemStorage::Config; }
    virtual bool bounds(ItemBounds& out) const { return false; }
    virtual const char* displayHint() const { return nullptr; }
    virtual void selectContext() {}
    virtual void clampToBounds() {}
    bool onDevice() const { return onDevice_; }

  protected:
    const char* label_;
    const char* key_ = nullptr;
    bool needsReboot_ = false;
    bool onDevice_ = true;

    // Shared by every integer-backed clampToBounds() override.
    template <typename T> static void clampInto(T* value, const ItemBounds& b)
    {
        if ((int64_t)*value < b.lo)
            *value = (T)b.lo;
        else if ((int64_t)*value > b.hi)
            *value = (T)b.hi;
    }

  private:
    VisibilityPredicate visibleWhen_ = nullptr;
    const VisibilityCondition* visibleWhenData_ = nullptr;
    VisibilityPredicate editableWhen_ = nullptr;
    const char* lockedMessage_ = nullptr;
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
    ItemKind kind() const override { return ItemKind::Submenu; }

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

class PopBackActionItem : public MenuItem
{
  public:
    PopBackActionItem(const char* label, MenuAction action) : MenuItem(label), action_(action) {}

    MenuActivation activate() override
    {
        if (action_)
            action_();
        return MenuActivation::PopBack;
    }

  private:
    MenuAction action_;
};

class ToggleItem : public MenuItem
{
  public:
    ToggleItem(const char* label, const char* key, bool* value, bool needsReboot = false)
        : MenuItem(label, key), value_(value)
    {
        needsReboot_ = needsReboot;
    }

    String valueText() const override { return *value_ ? "ON" : "OFF"; }
    MenuActivation activate() override
    {
        *value_ = !*value_;
        return MenuActivation::None;
    }
    ItemKind kind() const override { return ItemKind::Bool; }

  private:
    bool* value_;
};

// Templated so it can bind directly to a field of its real width instead of forcing everything
// to int32_t. min/max/step use NoDeduce so callers can pass plain integer literals.
template <typename T> class NumericItem : public MenuItem
{
  public:
    NumericItem(const char* label, const char* key, T* value, NoDeduce<T> minValue,
                NoDeduce<T> maxValue, NoDeduce<T> step, bool needsReboot = false)
        : MenuItem(label, key), value_(value), min_(minValue), max_(maxValue), step_(step)
    {
        needsReboot_ = needsReboot;
    }

    String valueText() const override { return String(*value_); }
    MenuActivation activate() override { return MenuActivation::EnterEdit; }
    void beginEdit() override { entryValue_ = *value_; }
    void adjust(int8_t direction, bool wrap) override
    {
        *value_ = (T)steppedToGrid(*value_, direction, step_, min_, max_, wrap);
    }
    void cancelEdit() override { *value_ = entryValue_; }

    ItemKind kind() const override { return ItemKind::Int; }
    bool bounds(ItemBounds& out) const override
    {
        out = {(int64_t)min_, (int64_t)max_, (int64_t)step_, 0};
        return true;
    }
    void clampToBounds() override
    {
        ItemBounds b;
        bounds(b);
        clampInto(value_, b);
    }

  private:
    T* value_;
    T min_;
    T max_;
    T step_;
    T entryValue_{};
};

// A GPIO number, or PIN_NOT_USED. Always off-device: a pin set from the OLED could take away the
// button being used to set it. The range is the chip's, not the board's - clampAllSettings() runs
// after every LOAD_*, so a board-dependent range would clear a stored pin and persist the loss.
class PinItem : public MenuItem
{
  public:
    PinItem(const char* label, const char* key, uint8_t* value)
        : MenuItem(label, key), value_(value)
    {
        needsReboot_ = true; // pins are attached once, in setup()
        setOffDevice();
    }

    String valueText() const override
    {
        return pinDefinedValue() ? String(*value_) : String("unused");
    }
    MenuActivation activate() override { return MenuActivation::EnterEdit; }
    void beginEdit() override { entryValue_ = *value_; }
    void adjust(int8_t direction, bool wrap) override
    {
        // "unused" sits one past the last GPIO so it is reachable by stepping rather than being a
        // value the editor would have to skip 225 of.
        const int64_t slot = pinDefinedValue() ? *value_ : kUnusedSlot;
        const int64_t next = steppedToGrid(slot, direction, 1, 0, kUnusedSlot, wrap);
        *value_ = (next >= kUnusedSlot) ? PIN_NOT_USED : (uint8_t)next;
    }
    void cancelEdit() override { *value_ = entryValue_; }

    ItemKind kind() const override { return ItemKind::Int; }
    const char* displayHint() const override { return "pin"; }
    bool bounds(ItemBounds& out) const override
    {
        out = {0, PIN_NOT_USED, 1, 0};
        return true;
    }
    // 30..254 is the dangerous range: in bounds for the schema, but silently ignored by pinMode,
    // so it must not survive a load.
    void clampToBounds() override
    {
        if (*value_ > MAX_GPIO_PIN)
            *value_ = PIN_NOT_USED;
    }

  protected:
    static const int64_t kUnusedSlot = MAX_GPIO_PIN + 1;
    bool pinDefinedValue() const { return *value_ <= MAX_GPIO_PIN; }
    uint8_t* value_;
    uint8_t entryValue_ = PIN_NOT_USED;
};

// A pin that has to be an ADC input - the one place a capability narrows a stored pin, and it may
// because ADC is GPIO 26-29 in silicon. The fold is to unused rather than the nearest ADC pin: a
// voltage read off a pin with no ADC channel is noise, and the low-voltage cutoff acts on it.
class AdcPinItem : public PinItem
{
  public:
    AdcPinItem(const char* label, const char* key, uint8_t* value) : PinItem(label, key, value) {}

    void clampToBounds() override
    {
        if (*value_ > MAX_GPIO_PIN || !adcPinUsable(*value_))
            *value_ = PIN_NOT_USED;
    }
};

class FloatItem : public MenuItem
{
  public:
    FloatItem(const char* label, const char* key, float* value, float minValue, float maxValue,
              float step, uint8_t decimals = 2, bool needsReboot = false)
        : MenuItem(label, key), value_(value), min_(minValue), max_(maxValue), step_(step),
          decimals_(decimals)
    {
        needsReboot_ = needsReboot;
    }

    String valueText() const override { return String(*value_, decimals_); }
    MenuActivation activate() override { return MenuActivation::EnterEdit; }
    void beginEdit() override { entryValue_ = *value_; }
    void adjust(int8_t direction, bool wrap) override
    {
        float next = *value_ + direction * step_;
        if (next > max_)
            next = wrap ? min_ : max_;
        if (next < min_)
            next = wrap ? max_ : min_;
        *value_ = next;
    }
    void cancelEdit() override { *value_ = entryValue_; }

    ItemKind kind() const override { return ItemKind::Float; }
    bool bounds(ItemBounds& out) const override
    {
        int64_t scale = 1;
        for (uint8_t i = 0; i < decimals_; i++)
            scale *= 10;
        out = {(int64_t)llroundf(min_ * scale), (int64_t)llroundf(max_ * scale),
               (int64_t)llroundf(step_ * scale), decimals_};
        return true;
    }
    void clampToBounds() override
    {
        if (*value_ < min_)
            *value_ = min_;
        else if (*value_ > max_)
            *value_ = max_;
    }

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
    EnumItem(const char* label, const char* key, E* value, const char* const* labels,
             const char* const* ids, uint8_t count, bool needsReboot = false)
        : MenuItem(label, key), value_(value), labels_(labels), ids_(ids), count_(count)
    {
        needsReboot_ = needsReboot;
    }

    String valueText() const override { return labels_[currentOptionIndex()]; }
    MenuActivation activate() override { return MenuActivation::EnterEdit; }
    void beginEdit() override { entryValue_ = *value_; }
    void adjust(int8_t direction, bool wrap) override
    {
        int next = (int)*value_ + direction;
        if (next < 0)
            next = wrap ? (int)count_ - 1 : 0;
        if (next >= (int)count_)
            next = wrap ? 0 : (int)count_ - 1;
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

    const char* optionValue(uint8_t index) const override
    {
        return (ids_ && index < count_) ? ids_[index] : nullptr;
    }

    ItemKind kind() const override { return ItemKind::Enum; }
    bool bounds(ItemBounds& out) const override
    {
        out = {0, (int64_t)count_ - 1, 1, 0};
        return true;
    }
    void clampToBounds() override { *value_ = (E)currentOptionIndex(); }

  protected:
    E* value_;
    const char* const* labels_;
    const char* const* ids_;
    uint8_t count_;
    E entryValue_{};
};

// menuFlywheel.cpp
extern SubmenuItem flywheelRpmSubmenu;
MenuItem* activeProfileRpmTarget();

// menuMotors.cpp
extern SubmenuItem motorsPidSubmenu;

// menuSelectFire.cpp
extern SubmenuItem selectFireSubmenu;
MenuItem* screenFireModeTarget();
MenuItem* activeFireModeBurstLengthTarget();
MenuItem* activeFireModeTargetDpsTarget();

// menuBattery.cpp
extern SubmenuItem batterySubmenu;

// menuSolenoid.cpp
extern SubmenuItem solenoidSubmenu;

// menuProfile.cpp
extern SubmenuItem profileSwitchSubmenu;
extern SubmenuItem profileAdvancedSubmenu;

// menuDevice.cpp
extern SubmenuItem deviceSubmenu;
extern SubmenuItem rebootSubmenu;
