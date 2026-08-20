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

// One global setting, applies to Idle RPM and all 3 RPM profiles: whether the menu exposes a
// per-motor editor or a per-stage editor. Storage is always the same per-motor arrays
// (idleRPM[4] / revRPMset[N][4]) either way - this only picks which submenu is unlocked.
static const char* const rpmModeLabels[] = {"Custom", "Stage"};
static EnumItem<rpmModeType_t> rpmModeItem("RPM Mode", &activeProfile.rpmMode, rpmModeLabels, 2);

// Locks a submenu based on the global RPM Mode, so the per-motor and per-stage editors for a
// given section (Idle RPM or one RPM profile) are mutually exclusive at the point you'd navigate
// into one.
class ModeLockedSubmenuItem : public SubmenuItem
{
  public:
    ModeLockedSubmenuItem(const char* label, MenuItem* const* children, uint8_t childCount,
                          rpmModeType_t requiredMode)
        : SubmenuItem(label, children, childCount), requiredMode_(requiredMode)
    {
    }

    bool isEditable() const override { return activeProfile.rpmMode == requiredMode_; }

    String lockedMessage() const override
    {
        return requiredMode_ == RPM_CUSTOM
                   ? "Locked - RPM Mode is\nStage. Switch RPM\nMode to Custom first."
                   : "Locked - RPM Mode is\nCustom. Switch RPM\nMode to Stage first.";
    }

  private:
    rpmModeType_t requiredMode_;
};

// Writes the same RPM to every motor whose motorStage matches - a "edit by stage instead of by
// motor" convenience over the real per-motor storage (revRPMset[N] or idleRPM), not separate
// stored data of its own. Shows the first matching motor's current value; if motors in the same
// stage have diverged (e.g. edited individually via Custom), editing here overwrites all of them
// to match.
class StageRpmItem : public MenuItem
{
  public:
    StageRpmItem(const char* label, int32_t* perMotorArray, motorStage_t stage, int32_t step,
                 bool needsReboot = false)
        : MenuItem(label), values_(perMotorArray), stage_(stage), step_(step)
    {
        needsReboot_ = needsReboot;
    }

    String valueText() const override { return String(currentValue()); }
    MenuActivation activate() override { return MenuActivation::EnterEdit; }
    void beginEdit() override { entryValue_ = currentValue(); }
    void adjustValue(int8_t direction) override
    {
        int64_t next = (int64_t)currentValue() + (int64_t)direction * (int64_t)step_;
        if (next > (int64_t)deviceSettings.maxRpmCap)
            next = (int64_t)deviceSettings.maxRpmCap;
        if (next < 0)
            next = 0;
        setAll((int32_t)next);
    }
    void cancelEdit() override { setAll(entryValue_); }

  private:
    int32_t currentValue() const
    {
        for (int i = 0; i < 4; i++)
            if (activeProfile.motors[i] && activeProfile.motorStage[i] == stage_)
                return values_[i];
        return 0;
    }
    void setAll(int32_t value)
    {
        for (int i = 0; i < 4; i++)
            if (activeProfile.motors[i] && activeProfile.motorStage[i] == stage_)
                values_[i] = value;
    }

    int32_t* values_;
    motorStage_t stage_;
    int32_t step_;
    int32_t entryValue_ = 0;
};

static NumericItem<int32_t> idleRpm0Item("Motor 1", &activeProfile.idleRPM[0], 0, 20000, 100);
static NumericItem<int32_t> idleRpm1Item("Motor 2", &activeProfile.idleRPM[1], 0, 20000, 100);
static NumericItem<int32_t> idleRpm2Item("Motor 3", &activeProfile.idleRPM[2], 0, 20000, 100);
static NumericItem<int32_t> idleRpm3Item("Motor 4", &activeProfile.idleRPM[3], 0, 20000, 100);
static MenuItem* idleRpmCustomItems[] = {&idleRpm0Item, &idleRpm1Item, &idleRpm2Item,
                                         &idleRpm3Item};
static ModeLockedSubmenuItem idleRpmCustomSubmenu("Custom", idleRpmCustomItems, 4, RPM_CUSTOM);

static StageRpmItem idleRpmStage1Item("Stage 1", activeProfile.idleRPM, STAGE_1, 100);
static StageRpmItem idleRpmStage2Item("Stage 2", activeProfile.idleRPM, STAGE_2, 100);
static MenuItem* idleRpmStageItems[] = {&idleRpmStage1Item, &idleRpmStage2Item};
static ModeLockedSubmenuItem idleRpmStageSubmenu("Stage", idleRpmStageItems, 2, RPM_STAGE);

static MenuItem* idleRpmItems[] = {&idleRpmCustomSubmenu, &idleRpmStageSubmenu};
static SubmenuItem idleRpmSubmenu("Idle RPM", idleRpmItems, 2);

// RPM Profile N (boot-locked, matches fpsMode's indexing). Every item here needs a reboot -
// main.cpp's setup() reads these fields once and caches the result into motorArr[i]. Which of
// Custom FPS / Stage RPM is unlocked is gated by the single global RPM Mode above.
#define RPM_PROFILE_SUBMENU(N, LABEL)                                                              \
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
        "Custom FPS", rpmProfile##N##CustomItems, 4, RPM_CUSTOM);                                  \
    static StageRpmItem rpmProfile##N##Stage1Item("1st Stage RPM", activeProfile.revRPMset[N],     \
                                                  STAGE_1, 500, true);                             \
    static StageRpmItem rpmProfile##N##Stage2Item("2nd Stage RPM", activeProfile.revRPMset[N],     \
                                                  STAGE_2, 500, true);                             \
    static MenuItem* rpmProfile##N##StageItems[] = {&rpmProfile##N##Stage1Item,                    \
                                                    &rpmProfile##N##Stage2Item};                   \
    static ModeLockedSubmenuItem rpmProfile##N##StageSubmenu(                                      \
        "Stage RPM", rpmProfile##N##StageItems, 2, RPM_STAGE);                                     \
    static NumericItem<uint32_t> rpmProfile##N##DwellItem(                                         \
        "Dwell Time (ms)", &activeProfile.dwellTimeSet_ms[N], 0, 5000, 50, true);                  \
    static NumericItem<uint32_t> rpmProfile##N##IdleItem(                                          \
        "Idle Time (ms)", &activeProfile.idleTimeSet_ms[N], 0, 300000, 1000, true);                \
    static MenuItem* rpmProfile##N##Items[] = {                                                    \
        &rpmProfile##N##CustomSubmenu, &rpmProfile##N##StageSubmenu, &rpmProfile##N##DwellItem,    \
        &rpmProfile##N##IdleItem};                                                                 \
    SubmenuItem rpmProfile##N##Submenu(LABEL, rpmProfile##N##Items, 4);

RPM_PROFILE_SUBMENU(0, "RPM Profile 1")
RPM_PROFILE_SUBMENU(1, "RPM Profile 2")
RPM_PROFILE_SUBMENU(2, "RPM Profile 3")
#undef RPM_PROFILE_SUBMENU

// Additive to the exit condition already checked in fwControlLoop()'s STATE_FULLSPEED - 0
// disables. Checked live, no reboot needed.
static NumericItem<uint32_t>
    revSafetyTimeoutItem("Rev Safety TO (ms)", &activeProfile.revSafetyTimeout_ms, 0, 600000, 5000);

static MenuItem* flywheelRpmItems[] = {
    &rpmModeItem,         &variableFPSItem,        &rpmProfile0Submenu,   &rpmProfile1Submenu,
    &rpmProfile2Submenu,  &spindownSpeedItem,      &revSafetyTimeoutItem, &idleRpmSubmenu,
    &flywheelControlItem, &firingRpmToleranceItem, &minFiringRpmItem,     &rampupTimeoutItem,
};
// Non-static: referenced by menu.cpp's Advanced submenu assembly.
SubmenuItem flywheelRpmSubmenu("Flywheel / RPM", flywheelRpmItems, 12);
