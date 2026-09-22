#include "menuCore.h"
#include "bootStatus.h"

// Root-level assembly: shortcuts, the Advanced submenu, and rootItems[] - the tree runMenu()
// starts from. Domain items/handlers live in their own menuFlywheel.cpp/menuMotors.cpp/etc.

static ShortcutItem firingModeShortcut("Firing Mode", screenFireModeTarget);
static ShortcutItem burstLengthShortcut("Burst Length", activeFireModeBurstLengthTarget);
static ShortcutItem targetDpsShortcut("Target DPS", activeFireModeTargetDpsTarget);
static ShortcutItem rpmTimingShortcut("RPM / Timing", activeProfileRpmTarget);

// Root-level, live-only: the same flag BOOT_ACTION_IDLE_HOLD can latch at boot, so this toggle and
// a held switch at power-on both drive the one flag STATE_IDLE reads. No jsonKey - never persisted.
class IdleModeItem : public MenuItem
{
  public:
    IdleModeItem(const char* label, bool* value) : MenuItem(label), value_(value) {}
    String valueText() const override { return *value_ ? "ON" : "OFF"; }
    MenuActivation activate() override
    {
        *value_ = !*value_;
        BootStatus::recordIdleHold(*value_);
        return MenuActivation::None;
    }
    ItemKind kind() const override { return ItemKind::Bool; }
    ItemStorage storage() const override { return ItemStorage::Live; }

  private:
    bool* value_;
};

static IdleModeItem idleModeItem("Idle Mode", &idleHoldActive);

// Reboot and Switch Profile are also reachable the long way (Device > Reboot, Profile > Switch
// Profile) - same instances either way.
static MenuItem* advancedItems[] = {
    &flywheelRpmSubmenu, &selectFireSubmenu, &profileAdvancedSubmenu, &motorsPidSubmenu,
    &solenoidSubmenu,    &batterySubmenu,    &deviceSubmenu,
};
static SubmenuItem advancedSubmenu("Advanced", advancedItems, 7);

MenuItem* rootItems[] = {
    &firingModeShortcut, &burstLengthShortcut,  &targetDpsShortcut, &rpmTimingShortcut,
    &idleModeItem,         &profileSwitchSubmenu, &rebootSubmenu,    &advancedSubmenu,
};
const uint8_t rootItemsCount = sizeof(rootItems) / sizeof(rootItems[0]);
