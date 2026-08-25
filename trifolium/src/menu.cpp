#include "menuCore.h"

// Root-level assembly: shortcuts, the Advanced submenu, and rootItems[] - the tree runMenu()
// starts from. Domain items/handlers live in their own menuFlywheel.cpp/menuMotors.cpp/etc.

static ShortcutItem firingModeShortcut("Firing Mode", screenFireModeTarget);
static ShortcutItem burstLengthShortcut("Burst Length", activeFireModeBurstLengthTarget);
static ShortcutItem targetDpsShortcut("Target DPS", activeFireModeTargetDpsTarget);
static ShortcutItem rpmTimingShortcut("RPM / Timing", activeProfileRpmTarget);

// Reboot and Switch Profile are also reachable the long way (Device > Reboot, Profile > Switch
// Profile) - same instances either way.
static MenuItem* advancedItems[] = {
    &flywheelRpmSubmenu, &selectFireSubmenu, &profileAdvancedSubmenu, &motorsPidSubmenu,
    &solenoidSubmenu,    &batterySubmenu,    &deviceSubmenu,
};
static SubmenuItem advancedSubmenu("Advanced", advancedItems, 7);

MenuItem* rootItems[] = {
    &firingModeShortcut, &burstLengthShortcut,  &targetDpsShortcut, &rpmTimingShortcut,
    &profileSwitchSubmenu, &rebootSubmenu,      &advancedSubmenu,
};
const uint8_t rootItemsCount = sizeof(rootItems) / sizeof(rootItems[0]);
