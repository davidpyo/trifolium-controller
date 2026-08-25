#include "menuCore.h"

static const char* const selectFireTypeLabels[] = {"Off", "Switch", "Button", "Screen"};
static EnumItem<selectFireType_t> selectFireTypeItem("Select-Fire Type",
                                                     &deviceSettings.selectFireType,
                                                     selectFireTypeLabels, 4, true);

static const char* const burstModeLabels[] = {"AUTO", "BURST",    "BINARY", "SAFE",
                                              "SEMI", "DEVOTION", "PLASMA"};
// DEVOTION/PLASMA stay out of the menu (count 5, not 7) until their animations are finished -
// behaviorFor()/the enum are untouched, so this is just a selection-count change. Bump back to 7
// to re-expose them.
static const uint8_t kSelectableBurstModeCount = 7;

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
    void adjust(int8_t direction, bool wrap) override
    {
        int next = (int)*value_ + direction;
        if (next < 0)
            next = wrap ? lastIndex() : 0;
        if (next > lastIndex())
            next = wrap ? 0 : lastIndex();
        *value_ = (uint8_t)next;
    }
    void cancelEdit() override { *value_ = entryValue_; }

    uint8_t optionCount() const override { return activeProfile.activeModeCount; }
    String optionLabel(uint8_t index) const override
    {
        return index < activeProfile.activeModeCount
                   ? activeProfile.fireModes[index].effectiveName()
                   : String();
    }
    uint8_t currentOptionIndex() const override
    {
        return *value_ > lastIndex() ? lastIndex() : *value_;
    }

    bool isVisible() const override { return deviceSettings.selectFireType == SWITCH_SELECT_FIRE; }

  private:
    static uint8_t lastIndex() { return activeProfile.activeModeCount - 1; }
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
    void adjust(int8_t direction, bool wrap) override
    {
        int next = (int)*value_ + direction;
        if (next < 0)
            next = wrap ? lastIndex() : 0;
        if (next > lastIndex())
            next = wrap ? 0 : lastIndex();
        *value_ = (int8_t)next;
        syncOverride();
    }
    void cancelEdit() override
    {
        *value_ = entryValue_;
        syncOverride();
    }

    uint8_t optionCount() const override { return activeProfile.activeModeCount; }
    String optionLabel(uint8_t index) const override
    {
        return index < activeProfile.activeModeCount
                   ? activeProfile.fireModes[index].effectiveName()
                   : String();
    }
    uint8_t currentOptionIndex() const override
    {
        return *value_ > lastIndex() ? lastIndex() : (uint8_t)*value_;
    }

  private:
    static uint8_t lastIndex() { return activeProfile.activeModeCount - 1; }
    void syncOverride()
    {
        if (deviceSettings.selectFireType == SWITCH_SELECT_FIRE)
            screenOverrideMode = *value_;
    }
    int8_t* value_;
    int8_t entryValue_ = 0;
};
static ScreenFireModeItem screenFireModeItem("Active Firing Mode", &firingMode);
// Non-static: menu.cpp's root shortcut resolves straight to this fixed target (unlike the other
// root shortcuts, this one never varies at runtime - it's always the same item).
MenuItem* screenFireModeTarget()
{
    return &screenFireModeItem;
}

static uint8_t editingFireModeIndex = 0;

static FireModeConfig& editingFireMode()
{
    return activeProfile.fireModes[editingFireModeIndex];
}

static bool editingFireModeSupportsBurstLength()
{
    return behaviorFor(editingFireMode().burstMode).supportsBurstLength();
}
static bool editingFireModeSupportsTargetDps()
{
    return behaviorFor(editingFireMode().burstMode).supportsTargetDps();
}
static bool editingFireModeSupportsReversible()
{
    return behaviorFor(editingFireMode().burstMode).supportsReversible();
}

class FireModeBurstModeItem : public MenuItem
{
  public:
    using MenuItem::MenuItem;

    String valueText() const override { return burstModeLabels[currentOptionIndex()]; }
    MenuActivation activate() override { return MenuActivation::EnterEdit; }
    void beginEdit() override { entryValue_ = editingFireMode().burstMode; }
    void adjust(int8_t direction, bool wrap) override
    {
        int next = (int)editingFireMode().burstMode + direction;
        if (next < 0)
            next = wrap ? kSelectableBurstModeCount - 1 : 0;
        if (next >= (int)kSelectableBurstModeCount)
            next = wrap ? 0 : kSelectableBurstModeCount - 1;
        editingFireMode().burstMode = (burstFireType_t)next;
    }
    void cancelEdit() override { editingFireMode().burstMode = entryValue_; }

    uint8_t optionCount() const override { return kSelectableBurstModeCount; }
    String optionLabel(uint8_t index) const override
    {
        return index < kSelectableBurstModeCount ? String(burstModeLabels[index]) : String();
    }
    uint8_t currentOptionIndex() const override
    {
        int idx = (int)editingFireMode().burstMode;
        if (idx < 0)
            idx = 0;
        if (idx >= (int)kSelectableBurstModeCount)
            idx = kSelectableBurstModeCount - 1;
        return (uint8_t)idx;
    }

  private:
    burstFireType_t entryValue_ = AUTO;
};
static FireModeBurstModeItem fireModeBurstModeItem("Firing Mode");

class FireModeBurstLengthItem : public MenuItem
{
  public:
    using MenuItem::MenuItem;

    String valueText() const override { return String(editingFireMode().burstLength); }
    MenuActivation activate() override { return MenuActivation::EnterEdit; }
    void beginEdit() override { entryValue_ = editingFireMode().burstLength; }
    void adjust(int8_t direction, bool wrap) override
    {
        bool isAuto = editingFireMode().burstMode == AUTO;
        uint32_t minBound = isAuto ? 1 : (editingFireMode().burstMode == BINARY ? 1 : 2);
        uint32_t maxBound = isAuto ? 500 : 10;
        int64_t next = (int64_t)editingFireMode().burstLength + direction;
        if (next > (int64_t)maxBound)
            next = wrap ? (int64_t)minBound : (int64_t)maxBound;
        if (next < (int64_t)minBound)
            next = wrap ? (int64_t)maxBound : (int64_t)minBound;
        editingFireMode().burstLength = (uint32_t)next;
    }
    void cancelEdit() override { editingFireMode().burstLength = entryValue_; }

  private:
    uint32_t entryValue_ = 1;
};
static FireModeBurstLengthItem fireModeBurstLengthItem("Burst Length");

class FireModeTargetDpsItem : public MenuItem
{
  public:
    using MenuItem::MenuItem;

    String valueText() const override
    {
        int hardwareMaxInt = (int)floorf(maxAchievableDPS);
        int value = (int)roundf(editingFireMode().targetDPS);
        String text = String(value);
        if (value >= hardwareMaxInt)
            text += " (max)";
        return text;
    }
    // "(max)" pushes this value's rendered width past what size-3 fits at any 2-digit value.
    uint8_t editValueTextSize() const override { return 2; }
    MenuActivation activate() override { return MenuActivation::EnterEdit; }
    void beginEdit() override { entryValue_ = editingFireMode().targetDPS; }
    void adjust(int8_t direction, bool wrap) override
    {
        float hardwareMax = floorf(maxAchievableDPS);
        float next = roundf(editingFireMode().targetDPS) + direction * 1.0f;
        if (next < 1.0f)
            next = wrap ? hardwareMax : 1.0f;
        if (next > hardwareMax)
            next = wrap ? 1.0f : hardwareMax;
        editingFireMode().targetDPS = next;
    }
    void cancelEdit() override { editingFireMode().targetDPS = entryValue_; }

  private:
    float entryValue_ = 0;
};
static FireModeTargetDpsItem fireModeTargetDpsItem("Target DPS");

class FireModeReversibleItem : public MenuItem
{
  public:
    using MenuItem::MenuItem;

    String valueText() const override { return editingFireMode().reversible ? "ON" : "OFF"; }
    MenuActivation activate() override
    {
        editingFireMode().reversible = !editingFireMode().reversible;
        return MenuActivation::None;
    }
};
static FireModeReversibleItem fireModeReversibleItem("Reversible");

static bool editingFireModeIsBinary()
{
    return editingFireMode().burstMode == BINARY;
}

class FireModeBinaryTimeoutItem : public MenuItem
{
  public:
    using MenuItem::MenuItem;

    String valueText() const override
    {
        return formatSecondsMs(editingFireMode().binaryTriggerTimeout_ms, 1000);
    }
    MenuActivation activate() override { return MenuActivation::EnterEdit; }
    void beginEdit() override { entryValue_ = editingFireMode().binaryTriggerTimeout_ms; }
    void adjust(int8_t direction, bool wrap) override
    {
        int64_t next = (int64_t)editingFireMode().binaryTriggerTimeout_ms + direction * 1000;
        if (next > 5000)
            next = wrap ? 0 : 5000;
        if (next < 0)
            next = wrap ? 5000 : 0;
        editingFireMode().binaryTriggerTimeout_ms = (uint32_t)next;
    }
    void cancelEdit() override { editingFireMode().binaryTriggerTimeout_ms = entryValue_; }

  private:
    uint32_t entryValue_ = 2000;
};
static FireModeBinaryTimeoutItem fireModeBinaryTimeoutItem("Binary Timeout");

class FireModeIncludeInCycleItem : public MenuItem
{
  public:
    using MenuItem::MenuItem;

    String valueText() const override { return editingFireMode().includeInCycle ? "ON" : "OFF"; }
    MenuActivation activate() override
    {
        editingFireMode().includeInCycle = !editingFireMode().includeInCycle;
        return MenuActivation::None;
    }
};
static FireModeIncludeInCycleItem fireModeIncludeInCycleItem("Include In Cycle");

class FireModeNameItem : public MenuItem
{
  public:
    using MenuItem::MenuItem;

    String valueText() const override { return editingFireMode().name; }
    MenuActivation activate() override
    {
        runTextEditor(label(), editingFireMode().name);
        return MenuActivation::None;
    }
};
static FireModeNameItem fireModeNameItem("Name Override");

static void duplicateFireMode()
{
    if (activeProfile.activeModeCount >= MAX_FIRE_MODES)
    {
        showTrapdoor("Fire mode list full\nany press = back");
        return;
    }
    activeProfile.fireModes[activeProfile.activeModeCount] = editingFireMode();
    activeProfile.activeModeCount++;
}

static void deleteFireMode()
{
    if (activeProfile.activeModeCount <= 1)
    {
        showTrapdoor("Can't delete the\nlast fire mode\nany press = back");
        return;
    }
    uint8_t removed = editingFireModeIndex;
    for (uint8_t i = removed; i + 1 < activeProfile.activeModeCount; i++)
        activeProfile.fireModes[i] = activeProfile.fireModes[i + 1];
    activeProfile.activeModeCount--;

    if (activeProfile.defaultFiringMode == removed)
        activeProfile.defaultFiringMode = 0;
    else if (activeProfile.defaultFiringMode > removed)
        activeProfile.defaultFiringMode--;

    for (int i = 0; i < 3; i++)
    {
        if (activeProfile.switchPositionAssignment[i] == (int8_t)removed)
            activeProfile.switchPositionAssignment[i] = NO_FIRE_MODE;
        else if (activeProfile.switchPositionAssignment[i] > (int8_t)removed)
            activeProfile.switchPositionAssignment[i]--;
    }

    if (firingMode == (int8_t)removed)
        firingMode = 0;
    else if (firingMode > (int8_t)removed)
        firingMode--;
}

static PopBackActionItem duplicateFireModeItem("Duplicate", duplicateFireMode);
static PopBackActionItem deleteFireModeItem("Delete", deleteFireMode);

static bool selectFireTypeIsButton()
{
    return deviceSettings.selectFireType == BUTTON_SELECT_FIRE;
}

static MenuItem* fireModeEditorItems[] = {
    &fireModeBurstModeItem,  &fireModeBurstLengthItem,   &fireModeTargetDpsItem,
    &fireModeReversibleItem, &fireModeBinaryTimeoutItem, &fireModeIncludeInCycleItem,
    &fireModeNameItem,       &duplicateFireModeItem,     &deleteFireModeItem,
};
struct FireModeEditorInit
{
    FireModeEditorInit()
    {
        fireModeBurstLengthItem.setVisibleWhen(editingFireModeSupportsBurstLength);
        fireModeTargetDpsItem.setVisibleWhen(editingFireModeSupportsTargetDps);
        fireModeReversibleItem.setVisibleWhen(editingFireModeSupportsReversible);
        fireModeBinaryTimeoutItem.setVisibleWhen(editingFireModeIsBinary);
        fireModeIncludeInCycleItem.setVisibleWhen(selectFireTypeIsButton);
    }
} fireModeEditorInit;
static const uint8_t fireModeEditorItemsCount =
    sizeof(fireModeEditorItems) / sizeof(fireModeEditorItems[0]);

class FireModeRowItem : public MenuItem
{
  public:
    FireModeRowItem(const char* label, uint8_t index) : MenuItem(label), index_(index) {}

    String valueText() const override { return activeProfile.fireModes[index_].effectiveName(); }
    bool showsArrow() const override { return true; }
    bool isVisible() const override { return index_ < activeProfile.activeModeCount; }
    MenuActivation activate() override
    {
        editingFireModeIndex = index_;
        return MenuActivation::EnterSubmenu;
    }
    MenuItem* const* children() const override { return fireModeEditorItems; }
    uint8_t childCount() const override { return fireModeEditorItemsCount; }

  private:
    uint8_t index_;
};

static void addFireMode()
{
    if (activeProfile.activeModeCount >= MAX_FIRE_MODES)
    {
        showTrapdoor("Fire mode list full\nany press = back");
        return;
    }
    activeProfile.fireModes[activeProfile.activeModeCount] = fireMode(1, AUTO, 0);
    activeProfile.activeModeCount++;
}

static FireModeRowItem fireModeRow0("Mode 1", 0);
static FireModeRowItem fireModeRow1("Mode 2", 1);
static FireModeRowItem fireModeRow2("Mode 3", 2);
static FireModeRowItem fireModeRow3("Mode 4", 3);
static FireModeRowItem fireModeRow4("Mode 5", 4);
static FireModeRowItem fireModeRow5("Mode 6", 5);
static FireModeRowItem fireModeRow6("Mode 7", 6);
static FireModeRowItem fireModeRow7("Mode 8", 7);
static FireModeRowItem fireModeRow8("Mode 9", 8);
static FireModeRowItem fireModeRow9("Mode 10", 9);
static ActionItem addFireModeItem("New Fire Mode", addFireMode);

static MenuItem* fireModeListItems[] = {
    &fireModeRow0, &fireModeRow1, &fireModeRow2, &fireModeRow3, &fireModeRow4,    &fireModeRow5,
    &fireModeRow6, &fireModeRow7, &fireModeRow8, &fireModeRow9, &addFireModeItem,
};
static SubmenuItem fireModeListSubmenu("Fire Modes", fireModeListItems,
                                       sizeof(fireModeListItems) / sizeof(fireModeListItems[0]));

MenuItem* activeFireModeBurstLengthTarget()
{
    editingFireModeIndex = (uint8_t)firingMode;
    return &fireModeBurstLengthItem;
}
MenuItem* activeFireModeTargetDpsTarget()
{
    editingFireModeIndex = (uint8_t)firingMode;
    return &fireModeTargetDpsItem;
}

class SwitchPositionItem : public MenuItem
{
  public:
    SwitchPositionItem(const char* label, uint8_t position) : MenuItem(label), position_(position)
    {
    }

    String valueText() const override
    {
        int8_t assigned = activeProfile.switchPositionAssignment[position_];
        return isUsable(assigned) ? activeProfile.fireModes[assigned].effectiveName() : "Default";
    }
    MenuActivation activate() override { return MenuActivation::EnterEdit; }
    void beginEdit() override { entryValue_ = activeProfile.switchPositionAssignment[position_]; }
    void adjust(int8_t direction, bool wrap) override
    {
        int next = (int)currentOptionIndex() + direction;
        if (next < 0)
            next = wrap ? lastOptionIndex() : 0;
        if (next > (int)lastOptionIndex())
            next = wrap ? 0 : lastOptionIndex();
        activeProfile.switchPositionAssignment[position_] = optionToFireModeIndex((uint8_t)next);
    }
    void cancelEdit() override { activeProfile.switchPositionAssignment[position_] = entryValue_; }

    uint8_t optionCount() const override { return 1 + activeProfile.activeModeCount; }
    String optionLabel(uint8_t index) const override
    {
        if (index == 0)
            return "Default";
        int8_t modeIndex = optionToFireModeIndex(index);
        return modeIndex >= 0 ? activeProfile.fireModes[modeIndex].effectiveName() : String();
    }
    uint8_t currentOptionIndex() const override
    {
        int8_t assigned = activeProfile.switchPositionAssignment[position_];
        return isUsable(assigned) ? (uint8_t)(assigned + 1) : 0;
    }

    bool isVisible() const override { return pinDefined(selectPins[position_]); }

  private:
    static bool isUsable(int8_t modeIndex)
    {
        return modeIndex >= 0 && modeIndex < (int8_t)activeProfile.activeModeCount;
    }
    static uint8_t lastOptionIndex() { return activeProfile.activeModeCount; } // option 0 = Default
    static int8_t optionToFireModeIndex(uint8_t option)
    {
        return option == 0 ? NO_FIRE_MODE : (int8_t)(option - 1);
    }

    uint8_t position_;
    int8_t entryValue_ = NO_FIRE_MODE;
};
static SwitchPositionItem switchPosition0Item("Position 1", 0);
static SwitchPositionItem switchPosition1Item("Position 2", 1);
static SwitchPositionItem switchPosition2Item("Position 3", 2);

static MenuItem* switchPositionItems[] = {
    &switchPosition0Item,
    &switchPosition1Item,
    &switchPosition2Item,
};
static SubmenuItem switchPositionsSubmenu("Set Selector Switch Modes", switchPositionItems,
                                          sizeof(switchPositionItems) /
                                              sizeof(switchPositionItems[0]));

static bool selectFireTypeIsSwitch()
{
    return deviceSettings.selectFireType == SWITCH_SELECT_FIRE;
}
struct SwitchPositionsInit
{
    SwitchPositionsInit() { switchPositionsSubmenu.setVisibleWhen(selectFireTypeIsSwitch); }
} switchPositionsInit;

static MenuItem* selectFireItems[] = {
    &fireModeListSubmenu,    &defaultModeItem,    &screenFireModeItem,
    &switchPositionsSubmenu, &selectFireTypeItem,
};
// Non-static: referenced by menu.cpp's Advanced submenu assembly.
SubmenuItem selectFireSubmenu("Select-Fire", selectFireItems,
                              sizeof(selectFireItems) / sizeof(selectFireItems[0]));
