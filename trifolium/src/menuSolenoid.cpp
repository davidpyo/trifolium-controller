#include "menuCore.h"

static NumericItem<uint16_t> solenoidExtendHighItem("Extend @ High V (ms)",
                                                    &activeProfile.solenoidExtendTimeHigh_ms, 0,
                                                    200, 1);
static NumericItem<uint32_t>
    solenoidHighVoltageItem("High V Threshold (mV)",
                            &activeProfile.solenoidExtendTimeHighVoltage_mv, 0, 30000, 100);
static NumericItem<uint16_t> solenoidExtendLowItem("Extend @ Low V (ms)",
                                                   &activeProfile.solenoidExtendTimeLow_ms, 0, 200,
                                                   1);
static NumericItem<uint32_t> solenoidLowVoltageItem("Low V Threshold (mV)",
                                                    &activeProfile.solenoidExtendTimeLowVoltage_mv,
                                                    0, 30000, 100);
static NumericItem<uint16_t> solenoidRetractItem("Retract Time (ms)",
                                                 &activeProfile.solenoidRetractTime_ms, 0, 200, 1);

// TargetDpsItem itself is defined in menuCore.h (needs to be visible at its full type where the
// root Target DPS shortcut takes its address, in menu.cpp) - only the instance lives here.
static bool autoTimingLocked()
{
    return activeProfile.autoTiming;
}
static const char* const AUTO_TIMING_LOCKED_MSG =
    "Locked - Auto Timing\nis on. Turn it off to\nset solenoid timing\nmanually.";

static ConditionalLockItem solenoidExtendHighLockItem(&solenoidExtendHighItem, autoTimingLocked,
                                                      AUTO_TIMING_LOCKED_MSG);
static ConditionalLockItem solenoidHighVoltageLockItem(&solenoidHighVoltageItem, autoTimingLocked,
                                                       AUTO_TIMING_LOCKED_MSG);
static ConditionalLockItem solenoidExtendLowLockItem(&solenoidExtendLowItem, autoTimingLocked,
                                                     AUTO_TIMING_LOCKED_MSG);
static ConditionalLockItem solenoidLowVoltageLockItem(&solenoidLowVoltageItem, autoTimingLocked,
                                                      AUTO_TIMING_LOCKED_MSG);
static ConditionalLockItem solenoidRetractLockItem(&solenoidRetractItem, autoTimingLocked,
                                                   AUTO_TIMING_LOCKED_MSG);

static ToggleItem autoTimingItem("Auto Timing", &activeProfile.autoTiming);
// Non-static: the root-level Target DPS shortcut (menu.cpp) references this instance directly.
TargetDpsItem targetDpsItem("Target DPS");

static MenuItem* solenoidItems[] = {
    &autoTimingItem,
    &targetDpsItem,
    &solenoidExtendHighLockItem,
    &solenoidHighVoltageLockItem,
    &solenoidExtendLowLockItem,
    &solenoidLowVoltageLockItem,
    &solenoidRetractLockItem,
};
// Non-static: referenced by menu.cpp's Advanced submenu assembly.
SubmenuItem solenoidSubmenu("Solenoid / Pusher", solenoidItems, 7);
