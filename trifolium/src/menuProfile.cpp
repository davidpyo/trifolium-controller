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

class DefaultProfileItem : public MenuItem
{
  public:
    DefaultProfileItem(const char* label, uint8_t* value) : MenuItem(label), value_(value) {}

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
        return deviceSettings.variableFPS && deviceSettings.selectFireType == SWITCH_SELECT_FIRE;
    }

  private:
    uint8_t* value_;
    uint8_t entryValue_ = 0;
};
static DefaultProfileItem defaultProfileIndexItem("Default Profile",
                                                  &deviceSettings.defaultProfileIndex);

static MenuItem* profileAdvancedItems[] = {
    &profileSwitchSubmenu,
    &copyProfileSubmenu,
    &defaultProfileIndexItem,
    &resetProfileSubmenu,
};
// Non-static: referenced by menu.cpp's Advanced submenu assembly.
SubmenuItem profileAdvancedSubmenu("Profile", profileAdvancedItems, 4);
