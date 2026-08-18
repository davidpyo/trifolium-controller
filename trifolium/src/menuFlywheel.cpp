#include "menuCore.h"

static const char* const flywheelControlLabels[] = {"PID", "TBH"};
static EnumItem<flywheelControlType_t>
    flywheelControlItem("Control Type", &activeProfile.flywheelControl, flywheelControlLabels, 2);
static ToggleItem variableFPSItem("Variable FPS", &activeProfile.variableFPS);
static NumericItem<uint32_t> spindownSpeedItem("Spindown Speed", &activeProfile.spindownSpeed, 1,
                                               2000, 10);
// firingRPM = max(revRPM - firingRPMTolerance, minFiringRPM) - see applyFiringRpmThresholds().
static NumericItem<int32_t> firingRpmToleranceItem("Firing RPM Tol",
                                                   &activeProfile.firingRPMTolerance, 0, 5000, 50);
static RpmTargetItem minFiringRpmItem("Min Firing RPM", &activeProfile.minFiringRPM, 500);
// Parameterizes the existing STATE_ACCELERATING abort-to-idle timeout in fwControlLoop() - doesn't
// change the transition's shape, just how long it waits before giving up. Checked live, no reboot.
static NumericItem<uint32_t> rampupTimeoutItem("Rampup Timeout (ms)",
                                               &activeProfile.rampupTimeout_ms, 100, 5000, 50);

static NumericItem<int32_t> idleRpm0Item("Motor 1", &activeProfile.idleRPM[0], 0, 20000, 100);
static NumericItem<int32_t> idleRpm1Item("Motor 2", &activeProfile.idleRPM[1], 0, 20000, 100);
static NumericItem<int32_t> idleRpm2Item("Motor 3", &activeProfile.idleRPM[2], 0, 20000, 100);
static NumericItem<int32_t> idleRpm3Item("Motor 4", &activeProfile.idleRPM[3], 0, 20000, 100);
static MenuItem* idleRpmItems[] = {&idleRpm0Item, &idleRpm1Item, &idleRpm2Item, &idleRpm3Item};
static SubmenuItem idleRpmSubmenu("Idle RPM", idleRpmItems, 4);

// Locks an entire submenu from being entered based on the profile's Mode, so Custom FPS and Ratio
// based FPS (below) are mutually exclusive at the point you'd navigate into one.
class ModeLockedSubmenuItem : public SubmenuItem
{
  public:
    ModeLockedSubmenuItem(const char* label, MenuItem* const* children, uint8_t childCount,
                          uint8_t profileIndex, rpmModeType_t requiredMode)
        : SubmenuItem(label, children, childCount), profileIndex_(profileIndex),
          requiredMode_(requiredMode)
    {
    }

    bool isEditable() const override
    {
        return activeProfile.rpmMode[profileIndex_] == requiredMode_;
    }

    String lockedMessage() const override
    {
        return requiredMode_ == RPM_CUSTOM
                   ? "Locked - profile is\nin Ratio mode. Switch\nMode to Custom first."
                   : "Locked - profile is\nin Custom mode. Switch\nMode to Ratio first.";
    }

  private:
    uint8_t profileIndex_;
    rpmModeType_t requiredMode_;
};

// Read-only - shows what Ratio mode would compute for every Stage 1 motor, live from the current
// field values so adjusting Ratio %/2nd Stage RPM previews the result before saving.
class FirstStageRpmDisplayItem : public MenuItem
{
  public:
    FirstStageRpmDisplayItem(const char* label, uint8_t profileIndex)
        : MenuItem(label), profileIndex_(profileIndex)
    {
    }

    String valueText() const override
    {
        int32_t stage1Rpm = (activeProfile.stage2Rpm[profileIndex_] *
                             activeProfile.stageRatioPercent[profileIndex_]) /
                            100;
        return String(stage1Rpm);
    }
    MenuActivation activate() override { return MenuActivation::EnterEdit; }
    bool isEditable() const override { return false; }
    String lockedMessage() const override
    {
        return "Computed: 2nd Stage\nRPM x Ratio % - not\ndirectly editable.";
    }

  private:
    uint8_t profileIndex_;
};

// RPM Profile N (boot-locked, matches fpsMode's indexing). Every item here needs a reboot -
// main.cpp's setup() reads these fields once and caches the result into motorArr[i].
static const char* const rpmModeLabels[] = {"Custom", "Ratio"};
#define RPM_PROFILE_SUBMENU(N, LABEL)                                                              \
    static EnumItem<rpmModeType_t> rpmProfile##N##ModeItem("Mode", &activeProfile.rpmMode[N],      \
                                                           rpmModeLabels, 2, true);                \
    static RpmTargetItem rpmProfile##N##Motor0Item("Motor 1 RPM", &activeProfile.revRPMset[N][0],  \
                                                   500, true);                                     \
    static RpmTargetItem rpmProfile##N##Motor1Item("Motor 2 RPM", &activeProfile.revRPMset[N][1],  \
                                                   500, true);                                     \
    static RpmTargetItem rpmProfile##N##Motor2Item("Motor 3 RPM", &activeProfile.revRPMset[N][2],  \
                                                   500, true);                                     \
    static RpmTargetItem rpmProfile##N##Motor3Item("Motor 4 RPM", &activeProfile.revRPMset[N][3],  \
                                                   500, true);                                     \
    static MenuItem* rpmProfile##N##CustomItems[] = {                                              \
        &rpmProfile##N##Motor0Item, &rpmProfile##N##Motor1Item, &rpmProfile##N##Motor2Item,        \
        &rpmProfile##N##Motor3Item};                                                               \
    static ModeLockedSubmenuItem rpmProfile##N##CustomSubmenu(                                     \
        "Custom FPS", rpmProfile##N##CustomItems, 4, N, RPM_CUSTOM);                               \
    static NumericItem<uint16_t> rpmProfile##N##RatioItem(                                         \
        "Ratio %", &activeProfile.stageRatioPercent[N], 10, 200, 5, true);                         \
    static RpmTargetItem rpmProfile##N##Stage2Item("2nd Stage RPM", &activeProfile.stage2Rpm[N],   \
                                                   500, true);                                     \
    static FirstStageRpmDisplayItem rpmProfile##N##Stage1DisplayItem("1st Stage RPM", N);          \
    static MenuItem* rpmProfile##N##RatioItems[] = {                                               \
        &rpmProfile##N##RatioItem, &rpmProfile##N##Stage2Item, &rpmProfile##N##Stage1DisplayItem}; \
    static ModeLockedSubmenuItem rpmProfile##N##RatioSubmenu(                                      \
        "Ratio based FPS", rpmProfile##N##RatioItems, 3, N, RPM_RATIO);                            \
    static NumericItem<uint32_t> rpmProfile##N##DwellItem(                                         \
        "Dwell Time (ms)", &activeProfile.dwellTimeSet_ms[N], 0, 5000, 50, true);                  \
    static NumericItem<uint32_t> rpmProfile##N##IdleItem(                                          \
        "Idle Time (ms)", &activeProfile.idleTimeSet_ms[N], 0, 300000, 1000, true);                \
    static MenuItem* rpmProfile##N##Items[] = {                                                    \
        &rpmProfile##N##ModeItem, &rpmProfile##N##CustomSubmenu, &rpmProfile##N##RatioSubmenu,     \
        &rpmProfile##N##DwellItem, &rpmProfile##N##IdleItem};                                      \
    SubmenuItem rpmProfile##N##Submenu(LABEL, rpmProfile##N##Items, 5);

RPM_PROFILE_SUBMENU(0, "RPM Profile 1")
RPM_PROFILE_SUBMENU(1, "RPM Profile 2")
RPM_PROFILE_SUBMENU(2, "RPM Profile 3")
#undef RPM_PROFILE_SUBMENU

// Additive to the exit condition already checked in fwControlLoop()'s STATE_FULLSPEED - 0
// disables. Checked live, no reboot needed.
static NumericItem<uint32_t>
    revSafetyTimeoutItem("Rev Safety TO (ms)", &activeProfile.revSafetyTimeout_ms, 0, 600000, 5000);

static MenuItem* flywheelRpmItems[] = {
    &variableFPSItem,        &rpmProfile0Submenu,   &rpmProfile1Submenu, &rpmProfile2Submenu,
    &spindownSpeedItem,      &revSafetyTimeoutItem, &idleRpmSubmenu,     &flywheelControlItem,
    &firingRpmToleranceItem, &minFiringRpmItem,     &rampupTimeoutItem,
};
// Non-static: referenced by menu.cpp's Advanced submenu assembly.
SubmenuItem flywheelRpmSubmenu("Flywheel / RPM", flywheelRpmItems, 11);
