#include "menuCore.h"
#include "enumIds.h"

static NumericItem<uint16_t> solenoidExtendHighItem("Extend @ High V (ms)",
                                                    "device:solenoidExtendTimeHigh_ms",
                                                    &deviceSettings.solenoidExtendTimeHigh_ms, 0,
                                                    60, 1);
static NumericItem<uint16_t> solenoidExtendLowItem("Extend @ Low V (ms)",
                                                   "device:solenoidExtendTimeLow_ms",
                                                   &deviceSettings.solenoidExtendTimeLow_ms, 0, 60,
                                                   1);

class SolenoidThresholdItem : public MenuItem
{
  public:
    SolenoidThresholdItem(const char* label, const char* key, uint32_t* value, bool isHigh)
        : MenuItem(label, key), value_(value), isHigh_(isHigh)
    {
    }

    String valueText() const override { return String(*value_); }
    MenuActivation activate() override { return MenuActivation::EnterEdit; }
    void beginEdit() override { entryValue_ = *value_; }
    void adjust(int8_t direction, bool wrap) override
    {
        ItemBounds b;
        bounds(b);
        *value_ = (uint32_t)steppedToGrid(*value_, direction, b.step, b.lo, b.hi, wrap);
    }
    void cancelEdit() override { *value_ = entryValue_; }

    ItemKind kind() const override { return ItemKind::Int; }
    bool bounds(ItemBounds& out) const override
    {
        const int64_t cells = cellCount(deviceSettings.batteryType);
        const int64_t cutoff = (int64_t)deviceSettings.lowVoltageCutoffPerCell_mv;
        const int64_t packMax = batteryVoltageMax_mv[deviceSettings.batteryType];

        int64_t lo, hi;
        if (isHigh_)
        {
            lo = cells * cutoff;
            hi = packMax;
        }
        else
        {
            lo = cells * (cutoff - 1000);
            hi = (int64_t)deviceSettings.solenoidExtendTimeHighVoltage_mv - kStep;
        }
        if (hi < lo) // only reachable from an out-of-range High that hasn't been clamped yet
            hi = lo;
        out = {lo, hi, kStep, 0};
        return true;
    }
    void clampToBounds() override
    {
        ItemBounds b;
        bounds(b);
        clampInto(value_, b);
    }

  private:
    static const int64_t kStep = 10;
    uint32_t* value_;
    bool isHigh_;
    uint32_t entryValue_ = 0;
};

static SolenoidThresholdItem
    solenoidHighVoltageItem("High V Threshold (mV)", "device:solenoidExtendTimeHighVoltage_mv",
                            &deviceSettings.solenoidExtendTimeHighVoltage_mv, true);
static SolenoidThresholdItem
    solenoidLowVoltageItem("Low V Threshold (mV)", "device:solenoidExtendTimeLowVoltage_mv",
                           &deviceSettings.solenoidExtendTimeLowVoltage_mv, false);

static NumericItem<uint16_t> solenoidRetractItem("Retract Time (ms)",
                                                 "device:solenoidRetractTime_ms",
                                                 &deviceSettings.solenoidRetractTime_ms, 0, 100, 1);
static NumericItem<uint16_t> vibrationPulseItem("Vibration Pulse (ms)", "device:vibrationPulseMs",
                                                &deviceSettings.vibrationPulseMs, 0, 20, 1);

static const char* const pusherTypeLabels[] = {"None", "Solenoid"};
static_assert(sizeof(pusherTypeLabels) / sizeof(pusherTypeLabels[0]) == kPusherTypeIdCount, "pusherTypeLabels is out of step");
static EnumItem<pusherType_t> pusherTypeItem("Pusher Type", "device:pusherType",
                                             &deviceSettings.pusherType, pusherTypeLabels,
                                             kPusherTypeIds, kPusherTypeIdCount,
                                             true /* needsReboot */);
static ToggleItem pusherReverseItem("Reverse Direction", "device:pusherReverseDirection",
                                    &deviceSettings.pusherReverseDirection);
static NumericItem<uint16_t> pusherDebounceItem("Debounce (ms)", "device:pusherDebounceTime_ms",
                                                &deviceSettings.pusherDebounceTime_ms, 0, 200, 1);

static bool pusherIsSolenoid()
{
    return deviceSettings.pusherType == PUSHER_SOLENOID_OPENLOOP;
}
static constexpr VisibilityTerm kPusherIsSolenoidTerms[] = {
    {"device:pusherType", "solenoid_openloop", false}};
static constexpr VisibilityCondition kPusherIsSolenoid = {kPusherIsSolenoidTerms, 1};
struct SolenoidItemsInit
{
    SolenoidItemsInit()
    {
        solenoidExtendHighItem.setVisibleWhen(pusherIsSolenoid, &kPusherIsSolenoid);
        solenoidHighVoltageItem.setVisibleWhen(pusherIsSolenoid, &kPusherIsSolenoid);
        solenoidExtendLowItem.setVisibleWhen(pusherIsSolenoid, &kPusherIsSolenoid);
        solenoidLowVoltageItem.setVisibleWhen(pusherIsSolenoid, &kPusherIsSolenoid);
    }
} solenoidItemsInit;

// The five that always apply come first. The four extend-time rows below are solenoid-only, so
// leading with them left the top half of the menu blank on any other pusher type.
static MenuItem* solenoidItems[] = {
    &pusherTypeItem,          &pusherReverseItem,      &pusherDebounceItem,
    &solenoidRetractItem,     &solenoidExtendHighItem, &solenoidHighVoltageItem,
    &solenoidExtendLowItem,   &solenoidLowVoltageItem, &vibrationPulseItem,
};
// Non-static: referenced by menu.cpp's Advanced submenu assembly.
SubmenuItem solenoidSubmenu("Solenoid / Pusher", solenoidItems, 9);
