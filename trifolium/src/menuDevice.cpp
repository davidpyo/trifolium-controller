#include "menuCore.h"
#include "global.h" // BootReason/rebootReason - set before the reboot-warning's reboot
#include "profileStore.h"
#include "deviceStore.h"
#include "hwDiag.h"
#include "enumIds.h"
#include "CONFIGURATION.h" // MAX_RPM_LOG_LENGTH - the same ceiling startCapture() allocates against

static const unsigned long HW_DIAG_HOLD_MS = 1500;

static void aboutFired()
{
    // The provenance id, or a plain word when there is none: with no board table there is no
    // display name to look up, and a wiring nobody based on a preset is not nameless, it is custom.
    const String wiring = deviceSettings.boardId.length() ? deviceSettings.boardId
                          : deviceSettings.wiringConfigured ? String("custom wiring")
                                                            : String("no wiring");
    String message = deviceSettings.blasterName + "\n" +
                     "Profile: " + activeProfile.name + "\n" + "v" + String(MAJOR_VERSION) + "." +
                     String(MINOR_VERSION) + "." + String(PATCH_VERSION) + "\n" +
                     wiring + "\n" + "any press = back";
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.println(message);
    display.display();

    unsigned long triggerHeldSince = 0;
    bool triggerWasPressed = pinDefined(triggerSwitchPin) && triggerSwitch.isPressed();
    if (triggerWasPressed)
        triggerHeldSince = millis();
    bool longPressWasActive = menuButton.isPressed() &&
                              menuButton.currentDuration() >= deviceSettings.menuButtonHoldTime_ms;
    while (true)
    {
        handleSerialCommands();
        menuButton.update();

        bool triggerIsPressed = pinDefined(triggerSwitchPin) && triggerSwitch.isPressed();
        if (triggerIsPressed && !triggerWasPressed)
            triggerHeldSince = millis();
        triggerWasPressed = triggerIsPressed;
        if (triggerIsPressed && millis() - triggerHeldSince >= HW_DIAG_HOLD_MS)
        {
            hwDiagFired();
            return;
        }

        bool longPressNow = menuButton.isPressed() &&
                            menuButton.currentDuration() >= deviceSettings.menuButtonHoldTime_ms;
        bool longPress = longPressNow && !longPressWasActive;
        longPressWasActive = longPressNow;
        bool shortPress = menuButton.released() &&
                          menuButton.previousDuration() < deviceSettings.menuButtonHoldTime_ms;
        if (longPress || shortPress)
            return;

        delay(10);
    }
}
static ActionItem aboutItem("About", aboutFired);

static void rebootNow()
{
    rebootReason = BootReason::MENU;
    delay(100);
    rp2040.reboot();
}
static ActionItem rebootItem("Reboot", rebootNow);

static void resetEverythingConfirmed()
{
    // Every slot, not just the active one - the row says "All".
    for (uint8_t i = 0; i < ProfileStore::MAX_PROFILE_COUNT; i++)
        ProfileStore::resetProfile(i);
    DeviceStore::saveDeviceSettings(DeviceStore::factoryResetSettings());
    rebootReason = BootReason::MENU;
    delay(100);
    rp2040.reboot();
}
static ActionItem resetEverythingConfirmItem("Yes, Reset", resetEverythingConfirmed);
static MenuItem* resetEverythingItems[] = {&resetEverythingConfirmItem};
static SubmenuItem resetEverythingSubmenu("Factory Reset All", resetEverythingItems, 1);

static void escPassthroughFired()
{
    // Reuses the boot-time TO_ESC_PASSTHROUGH handling in main.cpp's setup(). The menu button is
    // the way out: whoever reached this row is standing at a device with a working one.
    rebootPassthroughExit = BOOT_BTN_MENU;
    rebootReason = BootReason::TO_ESC_PASSTHROUGH;
    delay(100);
    rp2040.reboot();
}
static ActionItem escPassthroughItem("ESC Passthrough", escPassthroughFired);

static void bootloaderFired()
{
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 20);
    display.println("Entering Bootloader...");
    display.setCursor(0, 36);
    display.println("Screen stays here.");
    display.setCursor(0, 46);
    display.println("Unplug or reflash");
    display.setCursor(0, 54);
    display.println("to leave this mode.");
    display.display();
    delay(200); // let the message actually reach the panel before execution halts
    rp2040.rebootToBootloader();
}
static ActionItem bootloaderItem("Bootloader", bootloaderFired);

// Factory Reset last - the destructive/rare action sits away from the common ones (Reboot, ESC
// Passthrough, Bootloader) to reduce the odds of selecting it by accident while scrolling.
static MenuItem* rebootMenuItems[] = {&rebootItem, &escPassthroughItem, &bootloaderItem,
                                      &resetEverythingSubmenu};
// Non-static: referenced directly by menu.cpp's rootItems[] (Reboot is also a root shortcut, not
// just reachable via Advanced > Device).
SubmenuItem rebootSubmenu("Reboot", rebootMenuItems, 4);

// Inert if the panel never came up: beginTransmission() returns immediately on a bus never begun.
static void setDisplayContrast(uint8_t value)
{
    display.ssd1306_command(SSD1306_SETCONTRAST);
    display.ssd1306_command(value);
}

class BrightnessItem : public MenuItem
{
  public:
    BrightnessItem(const char* label, const char* key, uint8_t* value)
        : MenuItem(label, key), value_(value)
    {
    }

    String valueText() const override { return String(*value_); }
    MenuActivation activate() override { return MenuActivation::EnterEdit; }
    void beginEdit() override { entryValue_ = *value_; }
    void adjust(int8_t direction, bool wrap) override
    {
        int next = (int)*value_ + direction * 5;
        if (next > 255)
            next = wrap ? 5 : 255;
        if (next < 5) // keep a floor so the screen never goes fully unreadable while adjusting
            next = wrap ? 255 : 5;
        *value_ = (uint8_t)next;
        setDisplayContrast(*value_);
    }
    void cancelEdit() override
    {
        *value_ = entryValue_;
        setDisplayContrast(*value_);
    }

    ItemKind kind() const override { return ItemKind::Int; }
    bool bounds(ItemBounds& out) const override
    {
        out = {kFloor, 255, 5, 0};
        return true;
    }
    void clampToBounds() override
    {
        ItemBounds b;
        bounds(b);
        clampInto(value_, b);
    }

  private:
    static const int64_t kFloor = 5; // never let the screen go fully unreadable
    uint8_t* value_;
    uint8_t entryValue_ = 0;
};
static BrightnessItem brightnessItem("Brightness", "device:displayBrightness",
                                    &deviceSettings.displayBrightness);

class RotateDisplayItem : public MenuItem
{
  public:
    RotateDisplayItem(const char* label, const char* key, bool* value)
        : MenuItem(label, key), value_(value)
    {
    }
    String valueText() const override { return *value_ ? "ON" : "OFF"; }
    MenuActivation activate() override
    {
        *value_ = !*value_;
        displayManager.setRotation(*value_);
        return MenuActivation::None;
    }
    ItemKind kind() const override { return ItemKind::Bool; }

  private:
    bool* value_;
};
static RotateDisplayItem rotateDisplayItem("Rotate Display", "device:rotateDisplay",
                                           &deviceSettings.rotateDisplay);
static ToggleItem showCurrentRpmItem("Show Current RPM", "device:showCurrentRpmOnHomeScreen",
                                     &deviceSettings.showCurrentRpmOnHomeScreen);
static const char* const homeScreenDisplayModeLabels[] = {"Counter", "Fire Mode", "Both"};
static_assert(sizeof(homeScreenDisplayModeLabels) / sizeof(homeScreenDisplayModeLabels[0]) == kHomeScreenModeIdCount, "homeScreenDisplayModeLabels is out of step");
static EnumItem<homeScreenDisplayMode_t>
    homeScreenDisplayModeItem("Home Screen", "device:homeScreenDisplayMode",
                              &deviceSettings.homeScreenDisplayMode, homeScreenDisplayModeLabels,
                              kHomeScreenModeIds, kHomeScreenModeIdCount);
// Adds a 3rd line under the live-RPM column on the home screen: real/set DPS - independent of
// Show Current RPM (that toggle only gates the per-motor RPM rows above it in the same column).
static ToggleItem showDpsItem("Show DPS", "device:showDpsOnHomeScreen",
                              &deviceSettings.showDpsOnHomeScreen);

// No OLED row: turning this off from the menu blanks the panel and leaves serial as the only way
// back. onDevice, not setEditableWhen, which would reach the console as editable:false.
static ToggleItem hasDisplayItem("Display Attached", "device:hasDisplay",
                                 &deviceSettings.hasDisplay, /*needsReboot=*/true);

// Everything else in this submenu describes a panel that is not fitted. Stated as data too, so a
// console can re-evaluate it as the box is ticked rather than waiting for the next dump.
static bool displayFitted()
{
    return deviceSettings.hasDisplay;
}
static constexpr VisibilityTerm kDisplayFittedTerms[] = {{"device:hasDisplay", "true", false}};
static constexpr VisibilityCondition kDisplayFitted = {kDisplayFittedTerms, 1};

static MenuItem* displayMenuItems[] = {&homeScreenDisplayModeItem, &showCurrentRpmItem,
                                       &showDpsItem, &brightnessItem, &rotateDisplayItem,
                                       &hasDisplayItem};
static SubmenuItem displaySubmenu("Display", displayMenuItems, 6);
struct DisplayItemsInit
{
    DisplayItemsInit()
    {
        homeScreenDisplayModeItem.setVisibleWhen(displayFitted, &kDisplayFitted);
        showCurrentRpmItem.setVisibleWhen(displayFitted, &kDisplayFitted);
        showDpsItem.setVisibleWhen(displayFitted, &kDisplayFitted);
        brightnessItem.setVisibleWhen(displayFitted, &kDisplayFitted);
        rotateDisplayItem.setVisibleWhen(displayFitted, &kDisplayFitted);
    }
} displayItemsInit;

static const char* const ledWarningModeLabels[] = {"No Warning", "Low Batt", "Warning Batt"};
static_assert(sizeof(ledWarningModeLabels) / sizeof(ledWarningModeLabels[0]) == kLedWarningModeIdCount, "ledWarningModeLabels is out of step");
static EnumItem<ledWarningMode_t> ledWarningModeItem("LED Warning", "device:ledWarningMode",
                                                     &deviceSettings.ledWarningMode,
                                                     ledWarningModeLabels, kLedWarningModeIds,
                                                     kLedWarningModeIdCount);
// The stored pin. Spelled against PIN_NOT_USED rather than through pinDefined() so the rule beside
// it can say the same thing - a resolved pin is post-conflict and reboot-gated, a stored one is not.
static bool ledIsWired()
{
    return deviceSettings.ledDataPin != PIN_NOT_USED;
}
static constexpr VisibilityTerm kLedWiredTerms[] = {{"device:ledDataPin", "255", true}};
static constexpr VisibilityCondition kLedWired = {kLedWiredTerms, 1};

static NumericItem<uint16_t> debounceTimeItem("Switch Debounce (ms)", "device:debounceTime_ms",
                                              &deviceSettings.debounceTime_ms, 5, 50, 5);

static ToggleItem dualStageTriggerItem("Dual Stage Trigger", "device:dualStageTrigger",
                                       &deviceSettings.dualStageTrigger);
// Only meaningful when a rev pin is wired at all
static bool revPinWired()
{
    return pinDefined(revSwitchPin);
}
static SecondsDisplayItem menuHoldTimeItem("Menu Hold Time", "device:menuButtonHoldTime_ms",
                                           &deviceSettings.menuButtonHoldTime_ms, 1000, 5000, 500);
static NumericItem<int> voltageAvgWindowItem("Volt Avg Window", "device:voltageAveragingWindow",
                                             &deviceSettings.voltageAveragingWindow, 1, 20, 1);
static ToggleItem rpmShotCounterItem("RPM Shot Counter", "device:useRpmBaseShotCounter",
                                     &deviceSettings.useRpmBaseShotCounter);
static NumericItem<uint16_t> goodRpmReadsItem("Good RPM Reads", "device:goodRpmShotReads",
                                              &deviceSettings.goodRpmShotReads, 1, 30, 1);
static NumericItem<uint16_t> rpmDropThresholdItem("RPM Drop Thresh", "device:rpmDropThreshold",
                                                  &deviceSettings.rpmDropThreshold, 0, 2000, 100);
static bool usesRpmShotCounter()
{
    return deviceSettings.useRpmBaseShotCounter;
}
static constexpr VisibilityTerm kUsesRpmShotCounterTerms[] = {
    {"device:useRpmBaseShotCounter", "true", false}};
static constexpr VisibilityCondition kUsesRpmShotCounter = {kUsesRpmShotCounterTerms, 1};

// The RPM capture: a rev fills a fixed-length buffer, dumps it as CSV and then reboots (main.cpp).
// The toggle has an OLED row so that reboot-every-rev loop is escapable without a host.
// Non-static: menuMotors.cpp puts this row in the Motors & PID submenu.
ToggleItem rpmLoggingItem("RPM Logging", "device:useRpmLogging",
                                 &deviceSettings.useRpmLogging);
// Samples, not milliseconds: record() runs once per control-loop tick. The ceiling is the same
// constant startCapture() allocates against, so the schema publishes the real limit.
static NumericItem<uint32_t> rpmLogLengthItem("Capture Samples", "device:rpmLogLength",
                                              &deviceSettings.rpmLogLength, 100,
                                              MAX_RPM_LOG_LENGTH, 100);
static bool usesRpmLogging()
{
    return deviceSettings.useRpmLogging;
}
static constexpr VisibilityTerm kUsesRpmLoggingTerms[] = {{"device:useRpmLogging", "true", false}};
static constexpr VisibilityCondition kUsesRpmLogging = {kUsesRpmLoggingTerms, 1};

// The toggle lives in deviceItems[] instead, and must not also be here: DUMP_SCHEMA walks the tree,
// so an item in both arrays publishes its key twice.
static MenuItem* rpmLoggingItems[] = {&rpmLogLengthItem};
static SubmenuItem rpmLoggingSubmenu("RPM Logging", rpmLoggingItems, 1);
// The submenu too, or the OLED keeps a row that opens onto nothing - the same shape wiringSubmenu
// has. Its child stays in the schema: schemaDump.cpp emits onDevice:false rather than skipping.
struct RpmLoggingItemsInit
{
    RpmLoggingItemsInit()
    {
        rpmLogLengthItem.setOffDevice();
        rpmLoggingSubmenu.setOffDevice();
    }
} rpmLoggingItemsInit;

// What each switch does when held at power-on. Rows are indexed by bootButton_t and each is hidden
// unless its pin is wired, so a build with no menu button or no cycle switch doesn't show them.
static const char* const bootActionLabels[] = {"None",   "Bootloader", "ESC Passthrough", "Idle Hold",
                                               "Slot 1", "Slot 2",     "Slot 3"};
static_assert(sizeof(bootActionLabels) / sizeof(bootActionLabels[0]) == kBootActionIdCount, "bootActionLabels is out of step");
#define BOOT_ACTION_ITEM(name, label, key, index)                                                  \
    static EnumItem<bootAction_t> name(label, key, &deviceSettings.bootAction[index],              \
                                       bootActionLabels, kBootActionIds, kBootActionIdCount)
BOOT_ACTION_ITEM(bootActionMenuItem, "Menu Button", "device:bootAction[0]", BOOT_BTN_MENU);
BOOT_ACTION_ITEM(bootActionTriggerItem, "Trigger", "device:bootAction[1]", BOOT_BTN_TRIGGER);
BOOT_ACTION_ITEM(bootActionRevItem, "Rev Switch", "device:bootAction[2]", BOOT_BTN_REV);
BOOT_ACTION_ITEM(bootActionCycleItem, "Cycle Switch", "device:bootAction[3]", BOOT_BTN_CYCLE);
BOOT_ACTION_ITEM(bootActionIdleItem, "Idle Switch", "device:bootAction[4]", BOOT_BTN_IDLE);
BOOT_ACTION_ITEM(bootActionSelect0Item, "Select 0", "device:bootAction[5]", BOOT_BTN_SELECT0);
BOOT_ACTION_ITEM(bootActionSelect1Item, "Select 1", "device:bootAction[6]", BOOT_BTN_SELECT1);
BOOT_ACTION_ITEM(bootActionSelect2Item, "Select 2", "device:bootAction[7]", BOOT_BTN_SELECT2);
#undef BOOT_ACTION_ITEM

static bool menuPinWired()
{
    return pinDefined(menuButtonPin);
}
static bool triggerPinWired()
{
    return pinDefined(triggerSwitchPin);
}
// With a dual-stage trigger the rev line is the trigger's first stage, so evaluateBootAction()
// skips it and this row would be a lie.
static bool revBootPinWired()
{
    return pinDefined(revSwitchPin) && !deviceSettings.dualStageTrigger;
}
static bool cyclePinWired()
{
    return pinDefined(cycleSwitchPin);
}
static bool idlePinWired()
{
    return pinDefined(idleSwitchPin);
}
static bool select0PinWired()
{
    return pinDefined(selectPins[0]);
}
static bool select1PinWired()
{
    return pinDefined(selectPins[1]);
}
static bool select2PinWired()
{
    return pinDefined(selectPins[2]);
}

static MenuItem* bootActionItems[] = {
    &bootActionMenuItem,    &bootActionTriggerItem, &bootActionRevItem,     &bootActionCycleItem,
    &bootActionIdleItem,    &bootActionSelect0Item, &bootActionSelect1Item, &bootActionSelect2Item,
};
static SubmenuItem bootActionSubmenu("Boot Actions", bootActionItems, 8);

// How the pusher is driven, and the one field that says onto what. Off-device: they are wiring and
// travel with the pin they select, so the four move together or the state is incoherent.
static const char* const pusherDriveLabels[] = {"FET", "ESC"};
static_assert(sizeof(pusherDriveLabels) / sizeof(pusherDriveLabels[0]) == kPusherDriveIdCount, "pusherDriveLabels is out of step");
static EnumItem<pusherDrive_t> pusherDriveItem("Pusher Driver", "device:pusherDrive",
                                               &deviceSettings.pusherDrive, pusherDriveLabels,
                                               kPusherDriveIds, kPusherDriveIdCount,
                                               /*needsReboot=*/true);

static const char* const pusherEscChannelLabels[] = {"ESC 1", "ESC 2", "ESC 3", "ESC 4"};
static_assert(sizeof(pusherEscChannelLabels) / sizeof(pusherEscChannelLabels[0]) == kEscChannelIdCount, "pusherEscChannelLabels is out of step");
static EnumItem<escChannel_t> pusherEscChannelItem("Pusher ESC Ch", "device:pusherEscChannel",
                                                   &deviceSettings.pusherEscChannel,
                                                   pusherEscChannelLabels, kEscChannelIds,
                                                   kEscChannelIdCount,
                                                   /*needsReboot=*/true);
// Reads the stored driver, so the console can hide and show this row as the driver is picked.
static bool usesEscPusher()
{
    return deviceSettings.pusherDrive == PUSHER_DRIVE_ESC;
}
static constexpr VisibilityTerm kUsesEscPusherTerms[] = {{"device:pusherDrive", "esc", false}};
static constexpr VisibilityCondition kUsesEscPusher = {kUsesEscPusherTerms, 1};
static bool usesFetPusher()
{
    return deviceSettings.pusherDrive == PUSHER_DRIVE_FET;
}
static constexpr VisibilityTerm kUsesFetPusherTerms[] = {{"device:pusherDrive", "fet", false}};
static constexpr VisibilityCondition kUsesFetPusher = {kUsesFetPusherTerms, 1};

struct BootActionItemsInit
{
    BootActionItemsInit()
    {
        bootActionMenuItem.setVisibleWhen(menuPinWired);
        bootActionTriggerItem.setVisibleWhen(triggerPinWired);
        bootActionRevItem.setVisibleWhen(revBootPinWired);
        bootActionCycleItem.setVisibleWhen(cyclePinWired);
        bootActionIdleItem.setVisibleWhen(idlePinWired);
        bootActionSelect0Item.setVisibleWhen(select0PinWired);
        bootActionSelect1Item.setVisibleWhen(select1PinWired);
        bootActionSelect2Item.setVisibleWhen(select2PinWired);
        pusherEscChannelItem.setVisibleWhen(usesEscPusher, &kUsesEscPusher);
        pusherDriveItem.setOffDevice();
        pusherEscChannelItem.setOffDevice();
    }
} bootActionItemsInit;
struct DeviceItemsInit
{
    DeviceItemsInit()
    {
        hasDisplayItem.setOffDevice();
        ledWarningModeItem.setVisibleWhen(ledIsWired, &kLedWired);
        dualStageTriggerItem.setVisibleWhen(revPinWired);
        goodRpmReadsItem.setVisibleWhen(usesRpmShotCounter, &kUsesRpmShotCounter);
        rpmDropThresholdItem.setVisibleWhen(usesRpmShotCounter, &kUsesRpmShotCounter);
        rpmLogLengthItem.setVisibleWhen(usesRpmLogging, &kUsesRpmLogging);
    }
} deviceItemsInit;

// Shown on the home screen and the About screen. Uses the on-device text editor (TextEditItem).
static TextEditItem blasterNameItem("Blaster Name", "device:blasterName",
                                    &deviceSettings.blasterName);

static void resetDeviceConfirmed()
{
    DeviceStore::saveDeviceSettings(DeviceStore::factoryResetSettings());
    rebootReason = BootReason::MENU;
    delay(100);
    rp2040.reboot();
}
static ActionItem resetDeviceConfirmItem("Yes, Reset", resetDeviceConfirmed);
static MenuItem* resetDeviceItems[] = {&resetDeviceConfirmItem};
static SubmenuItem resetDeviceSubmenu("Factory Reset Device", resetDeviceItems, 1);

// Provenance: stored, echoed, never interpreted. Its own text limits rather than the OLED editor's
// 14 characters, which "trifolium_v1_2" already reaches.
class BoardIdItem : public MenuItem
{
  public:
    BoardIdItem(const char* label, const char* key, String* value)
        : MenuItem(label, key), value_(value)
    {
        setOffDevice();
    }

    String valueText() const override { return value_->length() ? *value_ : String("custom"); }
    // No editor: there is nothing to pick from on the device, and typing an id would not change a
    // single pin. Selecting the row does nothing rather than opening something misleading.
    MenuActivation activate() override { return MenuActivation::None; }

    ItemKind kind() const override { return ItemKind::Text; }
    uint16_t textMaxLen() const override { return kMaxLen; }
    const char* textCharset() const override { return kCharset; }
    void clampToBounds() override
    {
        String out;
        for (uint16_t i = 0; i < value_->length() && out.length() < kMaxLen; i++)
        {
            const char c = value_->charAt(i);
            if (strchr(kCharset, c) && c != '\0')
                out += c;
        }
        *value_ = out;
    }

  private:
    static const uint16_t kMaxLen = 32;
    static constexpr const char* kCharset =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-.";
    String* value_;
};
static BoardIdItem boardIdItem("Preset", "device:boardId", &deviceSettings.boardId);

// The boot gate: false means no pinMode() call is made anywhere, so this is the field that arms a
// blaster. Off-device - a device that turned it off from the panel would lose the panel. Nothing
// clears it except RESET_PINS; editing a pin deliberately does not.
static ToggleItem wiringConfiguredItem("Wiring Configured", "device:wiringConfigured",
                                       &deviceSettings.wiringConfigured, /*needsReboot=*/true);

// The four flywheel ESC channels. Any GPIO is legal - a pin muxes to a PIO block whatever its
// number - so there is no capability to narrow here, only the conflict engine's claim.
static PinItem esc1PinItem("ESC 1 Pin", "device:escPins[0]", &deviceSettings.escPins[0]);
static PinItem esc2PinItem("ESC 2 Pin", "device:escPins[1]", &deviceSettings.escPins[1]);
static PinItem esc3PinItem("ESC 3 Pin", "device:escPins[2]", &deviceSettings.escPins[2]);
static PinItem esc4PinItem("ESC 4 Pin", "device:escPins[3]", &deviceSettings.escPins[3]);

// The display bus. The pair is what has to be legal, not each pin: a GPIO's I2C role is fixed by
// pin % 4, so two individually legal pins can sit on different blocks and be servable by neither.
// selectDisplayBus() asks i2cPairUsable() before it touches setSDA.
static PinItem i2cSdaPinItem("I2C SDA Pin", "device:i2cSdaPin", &deviceSettings.i2cSdaPin);
static PinItem i2cSclPinItem("I2C SCL Pin", "device:i2cSclPin", &deviceSettings.i2cSclPin);

// The one pin a capability really does narrow - see AdcPinItem.
static AdcPinItem batteryAdcPinItem("Battery ADC Pin", "device:batteryAdcPin",
                                    &deviceSettings.batteryAdcPin);

// Driven LOW at boot and again by the low-voltage cutoff, to cut power to the ESCs and the pusher.
static PinItem escEnablePinItem("ESC Enable Pin", "device:escEnablePin",
                                &deviceSettings.escEnablePin);

// The nine switch/button pins, in the order the conflict engine resolves them (pinConflicts.cpp).
// Safety first, because a detached safety switch reads as disengaged.
static PinItem safetyPinItem("Safety Pin", "device:safetySwitchPin",
                             &deviceSettings.safetySwitchPin);
static PinItem triggerPinItem("Trigger Pin", "device:triggerSwitchPin",
                              &deviceSettings.triggerSwitchPin);
static PinItem revPinItem("Rev Pin", "device:revSwitchPin", &deviceSettings.revSwitchPin);
static PinItem menuButtonPinItem("Menu Button Pin", "device:menuButtonPin",
                                 &deviceSettings.menuButtonPin);
static PinItem cyclePinItem("Cycle Pin", "device:cycleSwitchPin", &deviceSettings.cycleSwitchPin);
static PinItem idlePinItem("Idle Pin", "device:idleSwitchPin", &deviceSettings.idleSwitchPin);
static PinItem select0PinItem("Select 0 Pin", "device:select0Pin", &deviceSettings.select0Pin);
static PinItem select1PinItem("Select 1 Pin", "device:select1Pin", &deviceSettings.select1Pin);
static PinItem select2PinItem("Select 2 Pin", "device:select2Pin", &deviceSettings.select2Pin);

// Two outputs rather than switch inputs, but the same engine resolves them. The gate pin's row
// follows the driver: on an ESC build the channel picks the pin.
static PinItem pusherFetPinItem("Pusher FET Pin", "device:pusherFetPin",
                                &deviceSettings.pusherFetPin);
static PinItem ledDataPinItem("LED Data Pin", "device:ledDataPin", &deviceSettings.ledDataPin);

// A switch's resting state, which is wiring rather than preference: a normally-closed switch reads
// inverted until this says so. Off-device, like its pin.
class PolarityItem : public ToggleItem
{
  public:
    PolarityItem(const char* label, const char* key, bool* value)
        : ToggleItem(label, key, value, /*needsReboot=*/true)
    {
        setOffDevice();
    }
};

// No select-line equivalents: those three encode a position, they are not pressed or released.
static PolarityItem triggerPolarityItem("Trigger Normally Closed",
                                        "device:triggerSwitchNormallyClosed",
                                        &deviceSettings.triggerSwitchNormallyClosed);
static PolarityItem revPolarityItem("Rev Normally Closed", "device:revSwitchNormallyClosed",
                                    &deviceSettings.revSwitchNormallyClosed);
static PolarityItem menuButtonPolarityItem("Menu Button Normally Closed",
                                           "device:menuButtonNormallyClosed",
                                           &deviceSettings.menuButtonNormallyClosed);
static PolarityItem cyclePolarityItem("Cycle Normally Closed", "device:cycleSwitchNormallyClosed",
                                      &deviceSettings.cycleSwitchNormallyClosed);
static PolarityItem idlePolarityItem("Idle Normally Closed", "device:idleSwitchNormallyClosed",
                                     &deviceSettings.idleSwitchNormallyClosed);
static PolarityItem safetyPolarityItem("Safety Normally Closed",
                                       "device:safetySwitchNormallyClosed",
                                       &deviceSettings.safetySwitchNormallyClosed);

// Outputs and buses first, then the inputs in conflict-resolution order, then the polarities.
static MenuItem* wiringItems[] = {&boardIdItem,            &wiringConfiguredItem,
                                  &esc1PinItem,            &esc2PinItem,
                                  &esc3PinItem,            &esc4PinItem,
                                  &i2cSdaPinItem,          &i2cSclPinItem,
                                  &batteryAdcPinItem,      &escEnablePinItem,
                                  &pusherFetPinItem,       &ledDataPinItem,
                                  &safetyPinItem,          &triggerPinItem,
                                  &revPinItem,             &menuButtonPinItem,
                                  &cyclePinItem,           &idlePinItem,
                                  &select0PinItem,         &select1PinItem,
                                  &select2PinItem,         &triggerPolarityItem,
                                  &revPolarityItem,        &menuButtonPolarityItem,
                                  &cyclePolarityItem,      &idlePolarityItem,
                                  &safetyPolarityItem};
static SubmenuItem wiringSubmenu("Wiring", wiringItems, 27);
struct WiringSubmenuInit
{
    WiringSubmenuInit()
    {
        wiringSubmenu.setOffDevice();
        wiringConfiguredItem.setOffDevice();
        i2cSdaPinItem.setVisibleWhen(displayFitted, &kDisplayFitted);
        i2cSclPinItem.setVisibleWhen(displayFitted, &kDisplayFitted);
        pusherFetPinItem.setVisibleWhen(usesFetPusher, &kUsesFetPusher);
    }
} wiringSubmenuInit;

static MenuItem* deviceItems[] = {
    &wiringSubmenu, &rebootSubmenu, &bootActionSubmenu, &displaySubmenu,
    &blasterNameItem, &ledWarningModeItem, &dualStageTriggerItem, &pusherDriveItem,
    &pusherEscChannelItem,
    &debounceTimeItem, &menuHoldTimeItem, &voltageAvgWindowItem, &rpmShotCounterItem,
    &goodRpmReadsItem, &rpmDropThresholdItem, &rpmLoggingSubmenu, &resetDeviceSubmenu,
    &aboutItem,
};
// Non-static: referenced by menu.cpp's Advanced submenu assembly.
SubmenuItem deviceSubmenu("Device", deviceItems, 18);
