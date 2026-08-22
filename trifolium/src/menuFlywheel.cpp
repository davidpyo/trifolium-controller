#include "menuCore.h"

static NumericItem<uint32_t> spindownSpeedItem("Spindown Speed", &activeProfile.spindownSpeed, 1,
                                               2000, 10);
// firingRPM = max(revRPM - firingRPMTolerance, minFiringRPM) - see applyFiringRpmThresholds().
static NumericItem<int32_t> firingRpmToleranceItem("Firing RPM Tol",
                                                   &deviceSettings.firingRPMTolerance, 0, 5000, 50);
static RpmTargetItem minFiringRpmItem("Min Firing RPM", &deviceSettings.minFiringRPM, 500);
// Parameterizes the existing STATE_ACCELERATING abort-to-idle timeout in fwControlLoop() - doesn't
// change the transition's shape, just how long it waits before giving up. Checked live, no reboot.
static NumericItem<uint32_t> rampupTimeoutItem("Rampup Timeout (ms)",
                                               &deviceSettings.rampupTimeout_ms, 100, 5000, 50);
static ToggleItem variableFPSItem("Variable FPS", &deviceSettings.variableFPS, true);

static bool selectFireIsWired()
{
    return deviceSettings.selectFireType != NO_SELECT_FIRE;
}
struct FlywheelItemsInit
{
    FlywheelItemsInit()
    {
        variableFPSItem.setVisibleWhen(selectFireIsWired);
    }
} flywheelItemsInit;

static const char* const rpmModeLabels[] = {"Custom", "Stage"};
static EnumItem<rpmModeType_t> rpmModeItem("RPM Mode", &activeProfile.rpmMode, rpmModeLabels, 2);

// Hides a submenu entirely unless the global RPM Mode matches.
class ModeVisibleSubmenuItem : public SubmenuItem
{
  public:
    ModeVisibleSubmenuItem(const char* label, MenuItem* const* children, uint8_t childCount,
                           rpmModeType_t requiredMode)
        : SubmenuItem(label, children, childCount), requiredMode_(requiredMode)
    {
    }

    bool isVisible() const override { return activeProfile.rpmMode == requiredMode_; }

  private:
    rpmModeType_t requiredMode_;
};

// Writes the same RPM to every motor whose motorStage matches - a "edit by stage instead of by
// motor" convenience over the real per-motor storage (revRPM or idleRPM), not separate
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
            if (deviceSettings.motorConfig[i].enabled && deviceSettings.motorConfig[i].stage == stage_)
                return values_[i];
        return 0;
    }
    void setAll(int32_t value)
    {
        for (int i = 0; i < 4; i++)
            if (deviceSettings.motorConfig[i].enabled && deviceSettings.motorConfig[i].stage == stage_)
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
static ModeVisibleSubmenuItem idleRpmCustomSubmenu("Idle RPM (Custom)", idleRpmCustomItems, 4,
                                                   RPM_CUSTOM);

static StageRpmItem idleRpmStage1Item("Stage 1", activeProfile.idleRPM, STAGE_1, 100);
static StageRpmItem idleRpmStage2Item("Stage 2", activeProfile.idleRPM, STAGE_2, 100);
static MenuItem* idleRpmStageItems[] = {&idleRpmStage1Item, &idleRpmStage2Item};
static ModeVisibleSubmenuItem idleRpmStageSubmenu("Idle RPM (Stage)", idleRpmStageItems, 2,
                                                  RPM_STAGE);

static RpmTargetItem profileRpmMotor0Item("Motor 1 RPM", &activeProfile.revRPM[0], 500, true);
static RpmTargetItem profileRpmMotor1Item("Motor 2 RPM", &activeProfile.revRPM[1], 500, true);
static RpmTargetItem profileRpmMotor2Item("Motor 3 RPM", &activeProfile.revRPM[2], 500, true);
static RpmTargetItem profileRpmMotor3Item("Motor 4 RPM", &activeProfile.revRPM[3], 500, true);
static MenuItem* profileRpmCustomItems[] = {&profileRpmMotor0Item, &profileRpmMotor1Item,
                                            &profileRpmMotor2Item, &profileRpmMotor3Item};
static ModeVisibleSubmenuItem profileRpmCustomSubmenu("Per Motor RPM", profileRpmCustomItems, 4,
                                                      RPM_CUSTOM);
static StageRpmItem profileRpmStage1Item("1st Stage RPM", activeProfile.revRPM, STAGE_1, 500, true);
static StageRpmItem profileRpmStage2Item("2nd Stage RPM", activeProfile.revRPM, STAGE_2, 500, true);
static MenuItem* profileRpmStageItems[] = {&profileRpmStage1Item, &profileRpmStage2Item};
static ModeVisibleSubmenuItem profileRpmStageSubmenu("Per Stage RPM", profileRpmStageItems, 2,
                                                     RPM_STAGE);

MenuItem* activeProfileRpmTarget()
{
    return activeProfile.rpmMode == RPM_STAGE ? &profileRpmStageSubmenu : &profileRpmCustomSubmenu;
}
static NumericItem<uint32_t> profileDwellItem("Dwell Time (ms)", &activeProfile.dwellTime_ms, 0,
                                              5000, 50, true);
static NumericItem<uint32_t> profileIdleItem("Idle Time (ms)", &activeProfile.idleTime_ms, 0,
                                             300000, 1000, true);

// Additive to the exit condition already checked in fwControlLoop()'s STATE_FULLSPEED - 0
// disables. Checked live, no reboot needed.
static NumericItem<uint32_t>
    revSafetyTimeoutItem("Rev Safety TO (ms)", &activeProfile.revSafetyTimeout_ms, 0, 600000, 5000);

static MenuItem* flywheelRpmItems[] = {
    &rpmModeItem,          &profileRpmStageSubmenu, &profileRpmCustomSubmenu, &profileDwellItem,
    &profileIdleItem,      &idleRpmCustomSubmenu,   &idleRpmStageSubmenu,     &spindownSpeedItem,
    &revSafetyTimeoutItem, &firingRpmToleranceItem, &minFiringRpmItem,        &rampupTimeoutItem,
    &variableFPSItem,
};
// Non-static: referenced by menu.cpp's Advanced submenu assembly.
SubmenuItem flywheelRpmSubmenu("Flywheel / RPM", flywheelRpmItems, 13);
