#include "menuCore.h"

static const char* const selectFireTypeLabels[] = {"Off", "Switch", "Button"};
static EnumItem<selectFireType_t>
    selectFireTypeItem("Select-Fire Type", &deviceSettings.selectFireType, selectFireTypeLabels, 3,
                       true);

class DefaultModeItem : public MenuItem
{
  public:
    DefaultModeItem(const char* label, uint8_t* value) : MenuItem(label), value_(value) {}

    String valueText() const override
    {
        return activeProfile.fireModes[currentOptionIndex()].name;
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
        return index < 3 ? activeProfile.fireModes[index].name : String();
    }
    uint8_t currentOptionIndex() const override { return *value_ > 2 ? 2 : *value_; }

  private:
    uint8_t* value_;
    uint8_t entryValue_ = 0;
};
static DefaultModeItem defaultModeItem("Default Mode", &activeProfile.defaultFiringMode);

static NumericItem<uint32_t> binaryTriggerTimeoutItem("Binary Timeout (ms)",
                                                      &activeProfile.binaryTriggerTimeout_ms, 0,
                                                      10000, 100);

static const char* const burstModeLabels[] = {"AUTO", "BURST", "BINARY", "SAFE"};


#define FIRING_MODE_SUBMENU(N, LABEL)                                                              \
    EnumItem<burstFireType_t> firingMode##N##BurstModeItem(                                        \
        "Burst Mode", &activeProfile.fireModes[N].burstMode, burstModeLabels, 4);                  \
    NumericItem<uint32_t> firingMode##N##BurstLengthItem(                                          \
        "Burst Length", &activeProfile.fireModes[N].burstLength, 1, 500, 1);                       \
    TargetDpsItem firingMode##N##TargetDpsItem("Target DPS",                                       \
                                                &activeProfile.fireModes[N].targetDPS);             \
    static TextEditItem firingMode##N##DisplayNameItem("Display Name",                             \
                                                       &activeProfile.fireModes[N].name);           \
    static MenuItem* firingMode##N##Items[] = {                                                    \
        &firingMode##N##BurstModeItem, &firingMode##N##BurstLengthItem,                            \
        &firingMode##N##TargetDpsItem, &firingMode##N##DisplayNameItem};                           \
    static SubmenuItem firingMode##N##Submenu(LABEL, firingMode##N##Items, 4);

FIRING_MODE_SUBMENU(0, "Mode 1")
FIRING_MODE_SUBMENU(1, "Mode 2")
FIRING_MODE_SUBMENU(2, "Mode 3")
#undef FIRING_MODE_SUBMENU

static MenuItem* selectFireItems[] = {
    &firingMode0Submenu, &firingMode1Submenu, &firingMode2Submenu,
    &defaultModeItem,    &selectFireTypeItem, &binaryTriggerTimeoutItem,
};
// Non-static: referenced by menu.cpp's Advanced submenu assembly.
SubmenuItem selectFireSubmenu("Select-Fire", selectFireItems, 6);
