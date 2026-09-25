#include "menuCore.h"
#include "enumIds.h"

static NumericItem<uint32_t> spindownSpeedItem("Spindown Speed", "profile:spindownSpeed",
                                               &activeProfile.spindownSpeed, 10, 200, 10);
// "At speed" = max(targetRPM - firingRPMTolerance, minFiringRPM) - see atSpeedRpm() in main.cpp.
static NumericItem<int32_t> firingRpmToleranceItem("Firing RPM Tol", "device:firingRPMTolerance",
                                                   &deviceSettings.firingRPMTolerance, 0, 10000,
                                                   500);
static RpmTargetItem minFiringRpmItem("Min Firing RPM", "device:minFiringRPM",
                                      &deviceSettings.minFiringRPM, RPM_TARGET_ALL_MOTORS, 1000,
                                      RPM_FLOOR_ZERO);
// Parameterizes the existing STATE_ACCELERATING abort-to-idle timeout in fwControlLoop() - doesn't
// change the transition's shape, just how long it waits before giving up. Checked live, no reboot.
static NumericItem<uint32_t> rampupTimeoutItem("Rampup Timeout (ms)", "device:rampupTimeout_ms",
                                               &deviceSettings.rampupTimeout_ms, 100, 5000, 50);
static ToggleItem variableFPSItem("Variable FPS", "device:variableFPS", &deviceSettings.variableFPS,
                                  true);

static bool selectFireIsWired()
{
    return deviceSettings.selectFireType != NO_SELECT_FIRE;
}
static constexpr VisibilityTerm kSelectFireIsWiredTerms[] = {
    {"device:selectFireType", "off", true}};
static constexpr VisibilityCondition kSelectFireIsWired = {kSelectFireIsWiredTerms, 1};

struct FlywheelItemsInit
{
    FlywheelItemsInit() { variableFPSItem.setVisibleWhen(selectFireIsWired, &kSelectFireIsWired); }
} flywheelItemsInit;

static const char* const rpmModeLabels[] = {"Custom", "Stage"};
static_assert(sizeof(rpmModeLabels) / sizeof(rpmModeLabels[0]) == kRpmModeIdCount, "rpmModeLabels is out of step");
static EnumItem<rpmModeType_t> rpmModeItem("RPM Mode", "profile:rpmMode", &activeProfile.rpmMode,
                                           rpmModeLabels, kRpmModeIds, kRpmModeIdCount);

// The rule below, as data. Two fixed conditions rather than one built per instance: a constructor
// cannot hand out a pointer to something with its own lifetime, and there are only ever two modes.
static constexpr VisibilityTerm kRpmModeIsCustomTerms[] = {{"profile:rpmMode", "custom", false}};
static constexpr VisibilityCondition kRpmModeIsCustom = {kRpmModeIsCustomTerms, 1};
static constexpr VisibilityTerm kRpmModeIsStageTerms[] = {{"profile:rpmMode", "stage", false}};
static constexpr VisibilityCondition kRpmModeIsStage = {kRpmModeIsStageTerms, 1};

// Hides a submenu entirely unless the global RPM Mode matches.
class ModeVisibleSubmenuItem : public SubmenuItem
{
  public:
    ModeVisibleSubmenuItem(const char* label, MenuItem* const* children, uint8_t childCount,
                           rpmModeType_t requiredMode)
        : SubmenuItem(label, children, childCount), requiredMode_(requiredMode)
    {
        setVisibleWhenData(requiredMode == RPM_STAGE ? &kRpmModeIsStage : &kRpmModeIsCustom);
    }

    bool isVisible() const override { return activeProfile.rpmMode == requiredMode_; }

  private:
    rpmModeType_t requiredMode_;
};

// Writes the same RPM to every motor whose motorStage matches - a convenience over the real
// per-motor storage, not stored data of its own. Shows the first matching motor's value; if motors
// in a stage have diverged, editing here overwrites all of them.
class StageRpmItem : public MenuItem
{
  public:
    StageRpmItem(const char* label, int32_t* perMotorArray, motorStage_t stage, int32_t step,
                 rpmFloorType_t floorType, bool needsReboot = false)
        : MenuItem(label), values_(perMotorArray), stage_(stage), step_(step), floorType_(floorType)
    {
        needsReboot_ = needsReboot;
    }

    String valueText() const override { return String(currentValue()); }
    MenuActivation activate() override { return MenuActivation::EnterEdit; }
    void beginEdit() override { entryValue_ = currentValue(); }
    void adjust(int8_t direction, bool wrap) override
    {
        ItemBounds b;
        bounds(b);
        setAll((int32_t)steppedToGrid(currentValue(), direction, b.step, b.lo, b.hi, wrap));
    }
    void cancelEdit() override { setAll(entryValue_); }

    ItemKind kind() const override { return ItemKind::Int; }
    ItemStorage storage() const override { return ItemStorage::Derived; }
    bool bounds(ItemBounds& out) const override
    {
        int8_t ref = referenceMotor();
        out = {(floorType_ == RPM_FLOOR_ZERO) ? 0 : motorRpmFloor(ref), motorRpmCeiling(ref), step_,
               0};
        return true;
    }
    void clampToBounds() override {}

  private:
    int8_t referenceMotor() const
    {
        uint8_t candidates[4];
        uint8_t count = 0;
        for (uint8_t i = 0; i < 4; i++)
            if (deviceSettings.motorConfig[i].stage == stage_)
                candidates[count++] = i;
        return highestKvEnabledMotor(candidates, count);
    }

    int32_t currentValue() const
    {
        for (int i = 0; i < 4; i++)
            if (deviceSettings.motorConfig[i].enabled &&
                deviceSettings.motorConfig[i].stage == stage_)
                return values_[i];
        return 0;
    }
    void setAll(int32_t value)
    {
        for (int i = 0; i < 4; i++)
            if (deviceSettings.motorConfig[i].enabled &&
                deviceSettings.motorConfig[i].stage == stage_)
                values_[i] = value;
    }

    int32_t* values_;
    motorStage_t stage_;
    int32_t step_;
    rpmFloorType_t floorType_;
    int32_t entryValue_ = 0;
};

static RpmTargetItem idleRpm0Item("Motor 1", "profile:idleRPM[0]", &activeProfile.idleRPM[0], 0,
                                  1000, RPM_FLOOR_ZERO);
static RpmTargetItem idleRpm1Item("Motor 2", "profile:idleRPM[1]", &activeProfile.idleRPM[1], 1,
                                  1000, RPM_FLOOR_ZERO);
static RpmTargetItem idleRpm2Item("Motor 3", "profile:idleRPM[2]", &activeProfile.idleRPM[2], 2,
                                  1000, RPM_FLOOR_ZERO);
static RpmTargetItem idleRpm3Item("Motor 4", "profile:idleRPM[3]", &activeProfile.idleRPM[3], 3,
                                  1000, RPM_FLOOR_ZERO);
static MenuItem* idleRpmCustomItems[] = {&idleRpm0Item, &idleRpm1Item, &idleRpm2Item,
                                         &idleRpm3Item};
static ModeVisibleSubmenuItem idleRpmCustomSubmenu("Idle RPM (Custom)", idleRpmCustomItems, 4,
                                                   RPM_CUSTOM);

static StageRpmItem idleRpmStage1Item("Stage 1", activeProfile.idleRPM, STAGE_1, 100,
                                      RPM_FLOOR_ZERO);
static StageRpmItem idleRpmStage2Item("Stage 2", activeProfile.idleRPM, STAGE_2, 100,
                                      RPM_FLOOR_ZERO);
static MenuItem* idleRpmStageItems[] = {&idleRpmStage1Item, &idleRpmStage2Item};
static ModeVisibleSubmenuItem idleRpmStageSubmenu("Idle RPM (Stage)", idleRpmStageItems, 2,
                                                  RPM_STAGE);

static RpmTargetItem profileRpmMotor0Item("Motor 1 RPM", "profile:revRPM[0]",
                                          &activeProfile.revRPM[0], 0, 500, RPM_FLOOR_MOTOR_MIN,
                                          true);
static RpmTargetItem profileRpmMotor1Item("Motor 2 RPM", "profile:revRPM[1]",
                                          &activeProfile.revRPM[1], 1, 500, RPM_FLOOR_MOTOR_MIN,
                                          true);
static RpmTargetItem profileRpmMotor2Item("Motor 3 RPM", "profile:revRPM[2]",
                                          &activeProfile.revRPM[2], 2, 500, RPM_FLOOR_MOTOR_MIN,
                                          true);
static RpmTargetItem profileRpmMotor3Item("Motor 4 RPM", "profile:revRPM[3]",
                                          &activeProfile.revRPM[3], 3, 500, RPM_FLOOR_MOTOR_MIN,
                                          true);
static MenuItem* profileRpmCustomItems[] = {&profileRpmMotor0Item, &profileRpmMotor1Item,
                                            &profileRpmMotor2Item, &profileRpmMotor3Item};
static ModeVisibleSubmenuItem profileRpmCustomSubmenu("Per Motor RPM", profileRpmCustomItems, 4,
                                                      RPM_CUSTOM);
static StageRpmItem profileRpmStage1Item("1st Stage RPM", activeProfile.revRPM, STAGE_1, 500,
                                         RPM_FLOOR_MOTOR_MIN, true);
static StageRpmItem profileRpmStage2Item("2nd Stage RPM", activeProfile.revRPM, STAGE_2, 500,
                                         RPM_FLOOR_MOTOR_MIN, true);
static MenuItem* profileRpmStageItems[] = {&profileRpmStage1Item, &profileRpmStage2Item};
static ModeVisibleSubmenuItem profileRpmStageSubmenu("Per Stage RPM", profileRpmStageItems, 2,
                                                     RPM_STAGE);

MenuItem* activeProfileRpmTarget()
{
    return activeProfile.rpmMode == RPM_STAGE ? &profileRpmStageSubmenu : &profileRpmCustomSubmenu;
}
static SecondsDisplayItem profileDwellItem("Dwell Time", "profile:dwellTime_ms",
                                           &activeProfile.dwellTime_ms, 0, 10000, 1000, true);
static SecondsDisplayItem profileIdleItem("Idle Time", "profile:idleTime_ms",
                                          &activeProfile.idleTime_ms, 0, 60000, 1000, true);

// Additive to the exit condition already checked in fwControlLoop()'s STATE_FULLSPEED - 0
// disables. Checked live, no reboot needed.
static SecondsDisplayItem revSafetyTimeoutItem("Rev Safety TO", "profile:revSafetyTimeout_ms",
                                               &activeProfile.revSafetyTimeout_ms, 0, 60000, 1000);

static MenuItem* flywheelRpmItems[] = {
    &rpmModeItem,          &profileRpmStageSubmenu, &profileRpmCustomSubmenu,
    &idleRpmCustomSubmenu, &idleRpmStageSubmenu,    &profileDwellItem,
    &profileIdleItem,      &spindownSpeedItem,
    &revSafetyTimeoutItem, &firingRpmToleranceItem, &minFiringRpmItem,        &rampupTimeoutItem,
    &variableFPSItem,
};
// Non-static: referenced by menu.cpp's Advanced submenu assembly.
SubmenuItem flywheelRpmSubmenu("Flywheel / RPM", flywheelRpmItems, 13);
