#include "menuCore.h"

static NumericItem<uint16_t> solenoidExtendHighItem("Extend @ High V (ms)",
                                                    &deviceSettings.solenoidExtendTimeHigh_ms, 0,
                                                    200, 1);
static NumericItem<uint32_t>
    solenoidHighVoltageItem("High V Threshold (mV)",
                            &deviceSettings.solenoidExtendTimeHighVoltage_mv, 0, 30000, 100);
static NumericItem<uint16_t> solenoidExtendLowItem("Extend @ Low V (ms)",
                                                   &deviceSettings.solenoidExtendTimeLow_ms, 0, 200,
                                                   1);
static NumericItem<uint32_t> solenoidLowVoltageItem("Low V Threshold (mV)",
                                                    &deviceSettings.solenoidExtendTimeLowVoltage_mv,
                                                    0, 30000, 100);
static NumericItem<uint16_t> solenoidRetractItem("Retract Time (ms)",
                                                 &deviceSettings.solenoidRetractTime_ms, 0, 200, 1);

static const char* const pusherTypeLabels[] = {"None", "Solenoid"};
static EnumItem<pusherType_t> pusherTypeItem("Pusher Type", &deviceSettings.pusherType,
                                             pusherTypeLabels, 2, true /* needsReboot */);
static ToggleItem pusherReverseItem("Reverse Direction", &deviceSettings.pusherReverseDirection);
// cycleSwitch.interval(deviceSettings.pusherDebounceTime_ms) is only called once, at attach time
// in main.cpp's setup().
static NumericItem<uint16_t> pusherDebounceItem("Debounce (ms)",
                                                &deviceSettings.pusherDebounceTime_ms, 0, 200, 1,
                                                true /* needsReboot */);

static bool pusherIsSolenoid()
{
    return deviceSettings.pusherType == PUSHER_SOLENOID_OPENLOOP;
}
struct SolenoidItemsInit
{
    SolenoidItemsInit()
    {
        solenoidExtendHighItem.setVisibleWhen(pusherIsSolenoid);
        solenoidHighVoltageItem.setVisibleWhen(pusherIsSolenoid);
        solenoidExtendLowItem.setVisibleWhen(pusherIsSolenoid);
        solenoidLowVoltageItem.setVisibleWhen(pusherIsSolenoid);
    }
} solenoidItemsInit;

static MenuItem* solenoidItems[] = {
    &solenoidExtendHighItem,
    &solenoidHighVoltageItem,
    &solenoidExtendLowItem,
    &solenoidLowVoltageItem,
    &solenoidRetractItem,
    &pusherTypeItem,
    &pusherReverseItem,
    &pusherDebounceItem,
};
// Non-static: referenced by menu.cpp's Advanced submenu assembly.
SubmenuItem solenoidSubmenu("Solenoid / Pusher", solenoidItems, 8);
