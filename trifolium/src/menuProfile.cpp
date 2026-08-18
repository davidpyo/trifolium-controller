#include "menuCore.h"
#include "global.h" // BootReason/rebootReason - set before the reboot-warning's reboot
#include "profileStore.h"

static void switchToProfile0()
{
    ProfileStore::switchActiveProfile(0);
}
static void switchToProfile1()
{
    ProfileStore::switchActiveProfile(1);
}
static void switchToProfile2()
{
    ProfileStore::switchActiveProfile(2);
}
static void switchToProfile3()
{
    ProfileStore::switchActiveProfile(3);
}
static ActionItem switchProfile0Item("Slot 1", switchToProfile0);
static ActionItem switchProfile1Item("Slot 2", switchToProfile1);
static ActionItem switchProfile2Item("Slot 3", switchToProfile2);
static ActionItem switchProfile3Item("Slot 4", switchToProfile3);
static MenuItem* switchProfileItems[] = {&switchProfile0Item, &switchProfile1Item,
                                         &switchProfile2Item, &switchProfile3Item};
SubmenuItem switchProfileSubmenu("Switch Profile", switchProfileItems, 4);

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
static void copyToProfile3()
{
    copyToProfileAndConfirm(3);
}
static ActionItem copyProfile0Item("Slot 1", copyToProfile0);
static ActionItem copyProfile1Item("Slot 2", copyToProfile1);
static ActionItem copyProfile2Item("Slot 3", copyToProfile2);
static ActionItem copyProfile3Item("Slot 4", copyToProfile3);
static MenuItem* copyProfileItems[] = {&copyProfile0Item, &copyProfile1Item, &copyProfile2Item,
                                       &copyProfile3Item};
static SubmenuItem copyProfileSubmenu("Copy To", copyProfileItems, 4);

// 1-item confirm submenu - the engine's own implicit "< Back" row is the free Cancel path, so
// this needs no new engine primitive.
static void resetProfileConfirmed()
{
    ProfileStore::saveProfile(activeProfileIndex, ProfileStore::defaultProfile());
    rebootReason = BootReason::MENU;
    delay(100);
    rp2040.reboot();
}
static ActionItem resetProfileConfirmItem("Yes, Reset", resetProfileConfirmed);
static MenuItem* resetProfileItems[] = {&resetProfileConfirmItem};
static SubmenuItem resetProfileSubmenu("Factory Reset Profile", resetProfileItems, 1);

static MenuItem* profileItems[] = {
    &switchProfileSubmenu,
    &copyProfileSubmenu,
    &resetProfileSubmenu,
};
// Non-static: referenced by menu.cpp's Advanced submenu assembly.
SubmenuItem profileSubmenu("Profile", profileItems, 3);
