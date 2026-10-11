#include "menuCore.h"
#include "global.h" // BootReason/rebootReason - set before the reboot-warning's reboot
#include "profileStore.h"

static String profileNameAtIndex(uint8_t index)
{
    if (index == activeProfileIndex)
        return activeProfile.name;
    ShotProfile other;
    ProfileStore::loadProfile(index, other);
    return other.name;
}

class ProfileRowItem : public MenuItem
{
  public:
    ProfileRowItem(const char* label, uint8_t index) : MenuItem(label), index_(index) {}

    String valueText() const override { return profileNameAtIndex(index_); }

  protected:
    uint8_t index_;
};

class SwitchProfileRowItem : public ProfileRowItem
{
  public:
    using ProfileRowItem::ProfileRowItem;
    MenuActivation activate() override
    {
        if (index_ != activeProfileIndex)
            ProfileStore::switchActiveProfile(index_); // reboots
        return MenuActivation::None;
    }
};

static SwitchProfileRowItem switchProfile0Item("Slot 1", 0);
static SwitchProfileRowItem switchProfile1Item("Slot 2", 1);
static SwitchProfileRowItem switchProfile2Item("Slot 3", 2);
static MenuItem* switchProfileItems[] = {&switchProfile0Item, &switchProfile1Item,
                                         &switchProfile2Item};
SubmenuItem profileSwitchSubmenu("Switch Profile", switchProfileItems, 3);

static void copyToProfileAndConfirm(uint8_t targetSlot)
{
    bool ok = ProfileStore::copyProfile(activeProfileIndex, targetSlot);
    showTrapdoor(ok ? "Copied to Slot " + String(targetSlot + 1) + "\nany press = back"
                    : "Copy failed\nany press = back");
}
static void copyToProfile0()
{
    copyToProfileAndConfirm(0);
}
static void copyToProfile1()
{
    copyToProfileAndConfirm(1);
}
static void copyToProfile2()
{
    copyToProfileAndConfirm(2);
}

class CopyProfileRowItem : public ProfileRowItem
{
  public:
    CopyProfileRowItem(const char* label, uint8_t index, MenuAction action)
        : ProfileRowItem(label, index), action_(action)
    {
    }
    MenuActivation activate() override
    {
        if (action_)
            action_();
        return MenuActivation::None;
    }

  private:
    MenuAction action_;
};

static CopyProfileRowItem copyProfile0Item("Slot 1", 0, copyToProfile0);
static CopyProfileRowItem copyProfile1Item("Slot 2", 1, copyToProfile1);
static CopyProfileRowItem copyProfile2Item("Slot 3", 2, copyToProfile2);
static MenuItem* copyProfileItems[] = {&copyProfile0Item, &copyProfile1Item, &copyProfile2Item};
static SubmenuItem copyProfileSubmenu("Copy To", copyProfileItems, 3);

// 1-item confirm submenu - the engine's own implicit "< Back" row is the free Cancel path, so
// this needs no new engine primitive.
static void resetProfileConfirmed()
{
    ProfileStore::resetProfile(activeProfileIndex);
    rebootReason = BootReason::MENU;
    delay(100);
    rp2040.reboot();
}
static ActionItem resetProfileConfirmItem("Yes, Reset", resetProfileConfirmed);
static MenuItem* resetProfileItems[] = {&resetProfileConfirmItem};
static SubmenuItem resetProfileSubmenu("Factory Reset Profile", resetProfileItems, 1);

// Variable FPS, and a select type whose lines pick a position - switch or encoder, said as what it
// is not because a condition's terms can only be ANDed. See VisibilityCondition in menu.h.
static constexpr VisibilityTerm kProfileRowVisibleTerms[] = {
    {"device:variableFPS", "true", false},
    {"device:selectFireType", "off", true},
    {"device:selectFireType", "button", true},
    {"device:selectFireType", "screen", true},
};
static constexpr VisibilityCondition kProfileRowVisible = {kProfileRowVisibleTerms, 4};

static bool selectorPicksProfile()
{
    return deviceSettings.variableFPS && deviceSettings.selectFireType != NO_SELECT_FIRE &&
           deviceSettings.selectFireType != BUTTON_SELECT_FIRE &&
           deviceSettings.selectFireType != SCREEN_SELECT_FIRE;
}

class DefaultProfileItem : public MenuItem
{
  public:
    DefaultProfileItem(const char* label, const char* key, uint8_t* value)
        : MenuItem(label, key), value_(value)
    {
        setVisibleWhenData(&kProfileRowVisible);
    }

    String valueText() const override { return profileNameAtIndex(currentOptionIndex()); }
    MenuActivation activate() override { return MenuActivation::EnterEdit; }
    void beginEdit() override { entryValue_ = *value_; }
    void adjust(int8_t direction, bool wrap) override
    {
        int next = (int)*value_ + direction;
        if (next < 0)
            next = wrap ? 2 : 0;
        if (next > 2)
            next = wrap ? 0 : 2;
        *value_ = (uint8_t)next;
    }
    void cancelEdit() override { *value_ = entryValue_; }

    uint8_t optionCount() const override { return 3; }
    String optionLabel(uint8_t index) const override { return profileNameAtIndex(index); }
    uint8_t currentOptionIndex() const override { return *value_ > 2 ? 2 : *value_; }

    bool isVisible() const override
    {
        return deviceSettings.variableFPS && deviceSettings.selectFireType != NO_SELECT_FIRE &&
               deviceSettings.selectFireType != BUTTON_SELECT_FIRE &&
               deviceSettings.selectFireType != SCREEN_SELECT_FIRE;
    }

    ItemKind kind() const override { return ItemKind::Enum; }
    bool bounds(ItemBounds& out) const override
    {
        out = {0, ProfileStore::MAX_PROFILE_COUNT - 1, 1, 0};
        return true;
    }
    void clampToBounds() override { *value_ = currentOptionIndex(); }

  private:
    uint8_t* value_;
    uint8_t entryValue_ = 0;
};
static DefaultProfileItem defaultProfileIndexItem("Default Profile", "device:defaultProfileIndex",
                                                  &deviceSettings.defaultProfileIndex);

// The slot one selector position boots with Variable FPS on. Option 0 is "Default", stored as
// NO_PROFILE: that position boots the Default Profile, as no line grounded does.
class PositionProfileItem : public MenuItem
{
  public:
    PositionProfileItem(const char* label, const char* key, uint8_t position)
        : MenuItem(label, key), position_(position)
    {
    }

    String valueText() const override { return optionLabel(currentOptionIndex()); }
    MenuActivation activate() override { return MenuActivation::EnterEdit; }
    void beginEdit() override { entryValue_ = stored(); }
    void adjust(int8_t direction, bool wrap) override
    {
        int next = (int)currentOptionIndex() + direction;
        const int last = ProfileStore::MAX_PROFILE_COUNT;
        if (next < 0)
            next = wrap ? last : 0;
        if (next > last)
            next = wrap ? 0 : last;
        stored() = (int8_t)(next - 1);
    }
    void cancelEdit() override { stored() = entryValue_; }

    uint8_t optionCount() const override { return 1 + ProfileStore::MAX_PROFILE_COUNT; }
    String optionLabel(uint8_t index) const override
    {
        if (index == 0)
            return "Default";
        const String name = profileNameAtIndex(index - 1);
        return name.length() ? name : "Slot " + String(index);
    }
    uint8_t currentOptionIndex() const override
    {
        const int8_t slot = stored();
        return slot >= 0 && slot < ProfileStore::MAX_PROFILE_COUNT ? (uint8_t)(slot + 1) : 0;
    }

    bool isVisible() const override { return selectorReaches(position_); }

    ItemKind kind() const override { return ItemKind::Enum; }
    bool bounds(ItemBounds& out) const override
    {
        out = {NO_PROFILE, ProfileStore::MAX_PROFILE_COUNT - 1, 1, 0};
        return true;
    }
    void clampToBounds() override { stored() = (int8_t)(currentOptionIndex() - 1); }

  private:
    int8_t& stored() const { return deviceSettings.switchPositionProfile[position_]; }

    uint8_t position_;
    int8_t entryValue_ = NO_PROFILE;
};
static PositionProfileItem positionProfile0Item("Position 1", "device:switchPositionProfile[0]", 0);
static PositionProfileItem positionProfile1Item("Position 2", "device:switchPositionProfile[1]", 1);
static PositionProfileItem positionProfile2Item("Position 3", "device:switchPositionProfile[2]", 2);
static PositionProfileItem positionProfile3Item("Position 4", "device:switchPositionProfile[3]", 3);
static PositionProfileItem positionProfile4Item("Position 5", "device:switchPositionProfile[4]", 4);
static PositionProfileItem positionProfile5Item("Position 6", "device:switchPositionProfile[5]", 5);
static PositionProfileItem positionProfile6Item("Position 7", "device:switchPositionProfile[6]", 6);

static MenuItem* positionProfileItems[] = {
    &positionProfile0Item, &positionProfile1Item, &positionProfile2Item, &positionProfile3Item,
    &positionProfile4Item, &positionProfile5Item, &positionProfile6Item,
};
static_assert(sizeof(positionProfileItems) / sizeof(positionProfileItems[0]) == SELECTOR_POSITIONS,
              "a row per selector position");
static SubmenuItem positionProfilesSubmenu("Selector Profiles", positionProfileItems,
                                           sizeof(positionProfileItems) /
                                               sizeof(positionProfileItems[0]));
struct PositionProfilesInit
{
    PositionProfilesInit()
    {
        positionProfilesSubmenu.setVisibleWhen(selectorPicksProfile, &kProfileRowVisible);
    }
} positionProfilesInit;

// Edits the slot that is loaded, which is the only one whose name is in RAM - the other two are
// read off flash by profileNameAtIndex() and are not editable from here for that reason.
static TextEditItem profileNameItem("Profile Name", "profile:name", &activeProfile.name);

static MenuItem* profileAdvancedItems[] = {
    &profileNameItem,
    &profileSwitchSubmenu,
    &copyProfileSubmenu,
    &defaultProfileIndexItem,
    &positionProfilesSubmenu,
    &resetProfileSubmenu,
};
// Non-static: referenced by menu.cpp's Advanced submenu assembly.
SubmenuItem profileAdvancedSubmenu("Profile", profileAdvancedItems,
                                   sizeof(profileAdvancedItems) / sizeof(profileAdvancedItems[0]));
