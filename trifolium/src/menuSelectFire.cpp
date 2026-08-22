#include "menuCore.h"

static const char* const selectFireTypeLabels[] = {"Off", "Switch", "Button", "Screen"};
static EnumItem<selectFireType_t>
    selectFireTypeItem("Select-Fire Type", &deviceSettings.selectFireType, selectFireTypeLabels, 4,
                       true);

class DefaultModeItem : public MenuItem
{
  public:
    DefaultModeItem(const char* label, uint8_t* value) : MenuItem(label), value_(value) {}

    String valueText() const override
    {
        return activeProfile.fireModes[currentOptionIndex()].effectiveName();
    }
    MenuActivation activate() override { return MenuActivation::EnterEdit; }
    void beginEdit() override { entryValue_ = *value_; }
    void adjustValue(int8_t direction) override
    {
        int next = (int)*value_ + direction;
        if (next < 0)
            next = 0;
        if (next > 2)
            next = 2;
        *value_ = (uint8_t)next;
    }
    void adjustValueWrapping(int8_t direction) override
    {
        int next = (int)*value_ + direction;
        if (next < 0)
            next = 2;
        if (next > 2)
            next = 0;
        *value_ = (uint8_t)next;
    }
    void cancelEdit() override { *value_ = entryValue_; }

    uint8_t optionCount() const override { return 3; }
    String optionLabel(uint8_t index) const override
    {
        return index < 3 ? activeProfile.fireModes[index].effectiveName() : String();
    }
    uint8_t currentOptionIndex() const override { return *value_ > 2 ? 2 : *value_; }

    bool isVisible() const override
    {
        return deviceSettings.selectFireType == SWITCH_SELECT_FIRE;
    }

  private:
    uint8_t* value_;
    uint8_t entryValue_ = 0;
};
static DefaultModeItem defaultModeItem("Default Mode", &activeProfile.defaultFiringMode);

class ScreenFireModeItem : public MenuItem
{
  public:
    ScreenFireModeItem(const char* label, int8_t* value) : MenuItem(label), value_(value) {}

    String valueText() const override
    {
        return activeProfile.fireModes[currentOptionIndex()].effectiveName();
    }
    MenuActivation activate() override { return MenuActivation::EnterEdit; }
    void beginEdit() override { entryValue_ = *value_; }
    void adjustValue(int8_t direction) override
    {
        int next = (int)*value_ + direction;
        if (next < 0)
            next = 0;
        if (next > 2)
            next = 2;
        *value_ = (int8_t)next;
    }
    void adjustValueWrapping(int8_t direction) override
    {
        int next = (int)*value_ + direction;
        if (next < 0)
            next = 2;
        if (next > 2)
            next = 0;
        *value_ = (int8_t)next;
    }
    void cancelEdit() override { *value_ = entryValue_; }

    uint8_t optionCount() const override { return 3; }
    String optionLabel(uint8_t index) const override
    {
        return index < 3 ? activeProfile.fireModes[index].effectiveName() : String();
    }
    uint8_t currentOptionIndex() const override { return *value_ > 2 ? 2 : (uint8_t)*value_; }

    bool isVisible() const override
    {
        return deviceSettings.selectFireType == SCREEN_SELECT_FIRE;
    }

  private:
    int8_t* value_;
    int8_t entryValue_ = 0;
};
static ScreenFireModeItem screenFireModeItem("Switch Fire Mode", &firingMode);
// Non-static: menu.cpp's root shortcut resolves straight to this fixed target (unlike the other
// root shortcuts, this one never varies at runtime - it's always the same item).
MenuItem* screenFireModeTarget()
{
    return &screenFireModeItem;
}

static NumericItem<uint32_t> binaryTriggerTimeoutItem("Binary Timeout (ms)",
                                                      &activeProfile.binaryTriggerTimeout_ms, 0,
                                                      10000, 100);
static bool anyModeIsBinary()
{
    for (int i = 0; i < 3; i++)
        if (activeProfile.fireModes[i].burstMode == BINARY)
            return true;
    return false;
}
struct SelectFireItemsInit
{
    SelectFireItemsInit()
    {
        binaryTriggerTimeoutItem.setVisibleWhen(anyModeIsBinary);
    }
} selectFireItemsInit;

static const char* const burstModeLabels[] = {"AUTO", "BURST", "BINARY", "SAFE", "SEMI"};

#define FIRING_MODE_SUBMENU(N, LABEL)                                                              \
    EnumItem<burstFireType_t> firingMode##N##BurstModeItem(                                        \
        "Burst Mode", &activeProfile.fireModes[N].burstMode, burstModeLabels, 5);                  \
    NumericItem<uint32_t> firingMode##N##BurstLengthItem(                                          \
        "Burst Length", &activeProfile.fireModes[N].burstLength, 1, 500, 1);                       \
    TargetDpsItem firingMode##N##TargetDpsItem("Target DPS",                                       \
                                                &activeProfile.fireModes[N].targetDPS);             \
    static TextEditItem firingMode##N##DisplayNameItem("Name Override",                            \
                                                       &activeProfile.fireModes[N].name);           \
    static bool firingMode##N##NotSafe()                                                           \
    {                                                                                               \
        return activeProfile.fireModes[N].burstMode != SAFE;                                       \
    }                                                                                                \
    static bool firingMode##N##BurstLengthEditable()                                               \
    {                                                                                               \
        burstFireType_t mode = activeProfile.fireModes[N].burstMode;                               \
        return mode != SAFE && mode != SEMI;                                                       \
    }                                                                                                \
    struct FiringMode##N##Init                                                                      \
    {                                                                                               \
        FiringMode##N##Init()                                                                       \
        {                                                                                           \
            firingMode##N##BurstLengthItem.setVisibleWhen(firingMode##N##BurstLengthEditable);     \
            firingMode##N##TargetDpsItem.setVisibleWhen(firingMode##N##NotSafe);                   \
        }                                                                                           \
    } firingMode##N##Init;                                                                          \
    static MenuItem* firingMode##N##Items[] = {                                                    \
        &firingMode##N##BurstModeItem, &firingMode##N##BurstLengthItem,                            \
        &firingMode##N##TargetDpsItem, &firingMode##N##DisplayNameItem};                           \
    static SubmenuItem firingMode##N##Submenu(LABEL, firingMode##N##Items, 4);

FIRING_MODE_SUBMENU(0, "Mode 1")
FIRING_MODE_SUBMENU(1, "Mode 2")
FIRING_MODE_SUBMENU(2, "Mode 3")
#undef FIRING_MODE_SUBMENU

static MenuItem* selectFireItems[] = {
    &firingMode0Submenu, &firingMode1Submenu,      &firingMode2Submenu, &defaultModeItem,
    &screenFireModeItem, &selectFireTypeItem, &binaryTriggerTimeoutItem,
};
// Non-static: referenced by menu.cpp's Advanced submenu assembly.
SubmenuItem selectFireSubmenu("Select-Fire", selectFireItems, 7);
