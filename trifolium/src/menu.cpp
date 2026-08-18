#include "menuCore.h"

// Root-level assembly: shortcuts, the Advanced submenu, and rootItems[] - the tree runMenu()
// starts from. Domain items/handlers live in their own menuFlywheel.cpp/menuMotors.cpp/etc.

// Resolvers for root shortcuts whose target depends on a live selection - see ShortcutItem
// (menuCore.h).
static MenuItem* activeBurstModeTarget()
{
    switch (firingMode)
    {
    case 1:
        return &firingMode1BurstModeItem;
    case 2:
        return &firingMode2BurstModeItem;
    default:
        return &firingMode0BurstModeItem;
    }
}
static MenuItem* activeBurstLengthTarget()
{
    switch (firingMode)
    {
    case 1:
        return &firingMode1BurstLengthItem;
    case 2:
        return &firingMode2BurstLengthItem;
    default:
        return &firingMode0BurstLengthItem;
    }
}
static MenuItem* activeWheelRpmTarget()
{
    switch (fpsMode)
    {
    case 1:
        return &rpmProfile1Submenu;
    case 2:
        return &rpmProfile2Submenu;
    default:
        return &rpmProfile0Submenu;
    }
}
static ShortcutItem firingModeShortcut("Firing Mode", activeBurstModeTarget);
static ShortcutItem burstLengthShortcut("Burst Length", activeBurstLengthTarget);
static ShortcutItem wheelRpmShortcut("Wheel RPM", activeWheelRpmTarget);

// Reboot and Switch Profile are also reachable the long way (Device > Reboot, Profile > Switch
// Profile) - same instances either way.
static MenuItem* advancedItems[] = {
    &flywheelRpmSubmenu, &motorsPidSubmenu, &selectFireSubmenu, &batterySubmenu,
    &solenoidSubmenu,    &profileSubmenu,   &deviceSubmenu,
};
static SubmenuItem advancedSubmenu("Advanced", advancedItems, 7);

MenuItem* rootItems[] = {
    &firingModeShortcut, &burstLengthShortcut,  &wheelRpmShortcut, &targetDpsItem,
    &rebootSubmenu,      &switchProfileSubmenu, &advancedSubmenu,
};
const uint8_t rootItemsCount = sizeof(rootItems) / sizeof(rootItems[0]);
