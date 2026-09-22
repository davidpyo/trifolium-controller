#include "menuCore.h"
#include "enumIds.h"

static const char* const selectFireTypeLabels[] = {"Off", "Switch", "Button", "Screen"};
static_assert(sizeof(selectFireTypeLabels) / sizeof(selectFireTypeLabels[0]) == kSelectFireTypeIdCount, "selectFireTypeLabels is out of step");
static EnumItem<selectFireType_t> selectFireTypeItem("Select-Fire Type", "device:selectFireType",
                                                     &deviceSettings.selectFireType,
                                                     selectFireTypeLabels, kSelectFireTypeIds,
                                                     kSelectFireTypeIdCount, true);

static const char* const burstModeLabels[] = {"AUTO", "BURST",    "BINARY", "SAFE",
                                              "SEMI", "DEVOTION", "PLASMA"};
static const uint8_t kSelectableBurstModeCount = 7;
static_assert(sizeof(burstModeLabels) / sizeof(burstModeLabels[0]) == kBurstModeIdCount,
              "burstModeLabels is out of step");
static_assert(kSelectableBurstModeCount == kBurstModeIdCount,
              "every selectable burst mode needs a stored id");

// Up here rather than beside selectFireTypeIsSwitch() near the bottom, because DefaultModeItem
// below is the first of the two users and a condition has to be declared before it is pointed at.
static constexpr VisibilityTerm kSelectFireIsSwitchTerms[] = {
    {"device:selectFireType", "switch", false}};
static constexpr VisibilityCondition kSelectFireIsSwitch = {kSelectFireIsSwitchTerms, 1};

class DefaultModeItem : public MenuItem
{
  public:
    DefaultModeItem(const char* label, const char* key, uint8_t* value)
        : MenuItem(label, key), value_(value)
    {
        setVisibleWhenData(&kSelectFireIsSwitch);
    }

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

    ItemKind kind() const override { return ItemKind::Enum; }
    bool bounds(ItemBounds& out) const override
    {
        out = {0, lastIndex(), 1, 0};
        return true;
    }
    void clampToBounds() override { *value_ = currentOptionIndex(); }

  private:
    static uint8_t lastIndex() { return activeProfile.activeModeCount - 1; }
    uint8_t* value_;
    uint8_t entryValue_ = 0;
};
static DefaultModeItem defaultModeItem("Default Mode", "profile:defaultFiringMode",
                                       &activeProfile.defaultFiringMode);

class ScreenFireModeItem : public MenuItem
{
  public:
    // No jsonKey: `firingMode` is the live selection, not a persisted setting.
    ScreenFireModeItem(const char* label, int8_t* value) : MenuItem(label), value_(value) {}

    // Names the effective mode, not the selection, because this row is what a person reads to
    // find out what the blaster will do. The selection underneath is untouched and comes back the
    // moment the switch releases.
    String valueText() const override
    {
        if (safetyEngaged)
            return String("SAFE (switch)");
        return activeProfile.fireModes[currentOptionIndex()].effectiveName();
    }

    // Locked rather than hidden: picking a mode that the switch would immediately override reads
    // as the blaster ignoring the panel. isEditable(), so the console disables its editor too.
    bool isEditable() const override { return !safetyEngaged; }
    String lockedMessage() const override
    {
        return "Safety switch engaged.\nRelease it to choose\na firing mode.";
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

    ItemKind kind() const override { return ItemKind::Enum; }
    ItemStorage storage() const override { return ItemStorage::Live; }
    bool bounds(ItemBounds& out) const override
    {
        out = {0, lastIndex(), 1, 0};
        return true;
    }

  private:
    static uint8_t lastIndex() { return activeProfile.activeModeCount - 1; }
    void syncOverride()
    {
        // On a switch build the switch owns the mode; this is a temporary override that
        // updateFiringMode() discards when the switch next moves. Nothing to do otherwise -
        // persistFiringModeWhenIdle() already stores the live selection to /modeN.cfg.
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

uint8_t fireModeEditorIndex()
{
    return editingFireModeIndex;
}
void setFireModeEditorIndex(uint8_t index)
{
    editingFireModeIndex = index < MAX_FIRE_MODES ? index : 0;
}

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

    ItemKind kind() const override { return ItemKind::Enum; }
    bool bounds(ItemBounds& out) const override
    {
        out = {0, (int64_t)kSelectableBurstModeCount - 1, 1, 0};
        return true;
    }
    void clampToBounds() override { editingFireMode().burstMode = (burstFireType_t)currentOptionIndex(); }

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
    const char* optionValue(uint8_t index) const override
    {
        return index < kBurstModeIdCount ? kBurstModeIds[index] : nullptr;
    }

  private:
    burstFireType_t entryValue_ = AUTO;
};
static FireModeBurstModeItem fireModeBurstModeItem("Firing Mode", "profile:fireModes[*].burstMode");

class FireModeBurstLengthItem : public MenuItem
{
  public:
    using MenuItem::MenuItem;

    String valueText() const override { return String(editingFireMode().burstLength); }
    MenuActivation activate() override { return MenuActivation::EnterEdit; }
    void beginEdit() override { entryValue_ = editingFireMode().burstLength; }
    void adjust(int8_t direction, bool wrap) override
    {
        ItemBounds b;
        bounds(b);
        int64_t next = (int64_t)editingFireMode().burstLength + direction;
        if (next > b.hi)
            next = wrap ? b.lo : b.hi;
        if (next < b.lo)
            next = wrap ? b.hi : b.lo;
        editingFireMode().burstLength = (uint32_t)next;
    }
    void cancelEdit() override { editingFireMode().burstLength = entryValue_; }

    ItemKind kind() const override { return ItemKind::Int; }
    bool bounds(ItemBounds& out) const override
    {
        const burstFireType_t mode = editingFireMode().burstMode;
        const bool isAuto = mode == AUTO;
        out = {isAuto || mode == BINARY ? 1 : 2, isAuto ? 500 : 10, 1, 0};
        return true;
    }
    void clampToBounds() override
    {
        ItemBounds b;
        bounds(b);
        clampInto(&editingFireMode().burstLength, b);
    }

  private:
    uint32_t entryValue_ = 1;
};
static FireModeBurstLengthItem fireModeBurstLengthItem("Burst Length",
                                                       "profile:fireModes[*].burstLength");

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

    ItemKind kind() const override { return ItemKind::Int; }
    bool bounds(ItemBounds& out) const override
    {
        out = {1, (int64_t)floorf(maxAchievableDPS), 1, 0};
        if (out.hi < out.lo)
            out.hi = out.lo;
        return true;
    }
    void clampToBounds() override {}

  private:
    float entryValue_ = 0;
};
static FireModeTargetDpsItem fireModeTargetDpsItem("Target DPS", "profile:fireModes[*].targetDPS");

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
    ItemKind kind() const override { return ItemKind::Bool; }
};
static FireModeReversibleItem fireModeReversibleItem("Reversible",
                                                     "profile:fireModes[*].reversible");

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

    ItemKind kind() const override { return ItemKind::Int; }
    const char* displayHint() const override { return "seconds"; }
    bool bounds(ItemBounds& out) const override
    {
        out = {0, 5000, 1000, 0};
        return true;
    }
    void clampToBounds() override
    {
        ItemBounds b;
        bounds(b);
        clampInto(&editingFireMode().binaryTriggerTimeout_ms, b);
    }

  private:
    uint32_t entryValue_ = 2000;
};
static FireModeBinaryTimeoutItem
    fireModeBinaryTimeoutItem("Binary Timeout", "profile:fireModes[*].binaryTriggerTimeout_ms");

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
    ItemKind kind() const override { return ItemKind::Bool; }
};
static FireModeIncludeInCycleItem
    fireModeIncludeInCycleItem("Include In Cycle", "profile:fireModes[*].includeInCycle");

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
    ItemKind kind() const override { return ItemKind::Text; }
};
static FireModeNameItem fireModeNameItem("Name Override", "profile:fireModes[*].name");

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
static constexpr VisibilityTerm kSelectFireIsButtonTerms[] = {
    {"device:selectFireType", "button", false}};
static constexpr VisibilityCondition kSelectFireIsButton = {kSelectFireIsButtonTerms, 1};

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
        fireModeIncludeInCycleItem.setVisibleWhen(selectFireTypeIsButton, &kSelectFireIsButton);
    }
} fireModeEditorInit;
static const uint8_t fireModeEditorItemsCount =
    sizeof(fireModeEditorItems) / sizeof(fireModeEditorItems[0]);

uint8_t fireModeEditorFieldCount()
{
    return fireModeEditorItemsCount;
}
MenuItem* fireModeEditorField(uint8_t index)
{
    return index < fireModeEditorItemsCount ? fireModeEditorItems[index] : nullptr;
}
uint8_t selectableBurstModeCount()
{
    return kSelectableBurstModeCount;
}

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
    // Every Mode N row shares fireModeEditorItems, so pointing the editor at this row is what makes
    // the children read and write this mode. activate() does the same for the on-device path.
    void selectContext() override { editingFireModeIndex = index_; }

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
    SwitchPositionItem(const char* label, const char* key, uint8_t position)
        : MenuItem(label, key), position_(position)
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

    ItemKind kind() const override { return ItemKind::Enum; }
    bool bounds(ItemBounds& out) const override
    {
        out = {NO_FIRE_MODE, (int64_t)activeProfile.activeModeCount - 1, 1, 0};
        return true;
    }
    void clampToBounds() override
    {
        int8_t& assigned = activeProfile.switchPositionAssignment[position_];
        if (!isUsable(assigned))
            assigned = NO_FIRE_MODE;
    }

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
static SwitchPositionItem switchPosition0Item("Position 1", "profile:switchPositionAssignment[0]",
                                              0);
static SwitchPositionItem switchPosition1Item("Position 2", "profile:switchPositionAssignment[1]",
                                              1);
static SwitchPositionItem switchPosition2Item("Position 3", "profile:switchPositionAssignment[2]",
                                              2);

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
    SwitchPositionsInit()
    {
        switchPositionsSubmenu.setVisibleWhen(selectFireTypeIsSwitch, &kSelectFireIsSwitch);
    }

} switchPositionsInit;

static MenuItem* selectFireItems[] = {
    &fireModeListSubmenu,    &defaultModeItem,    &screenFireModeItem,
    &switchPositionsSubmenu, &selectFireTypeItem,
};
// Non-static: referenced by menu.cpp's Advanced submenu assembly.
SubmenuItem selectFireSubmenu("Select-Fire", selectFireItems,
                              sizeof(selectFireItems) / sizeof(selectFireItems[0]));
