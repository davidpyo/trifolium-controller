#include "menuCore.h"
#include "global.h" // BootReason/rebootReason - set before the reboot-warning's reboot
#include "profileStore.h"
#include "deviceStore.h"
#include "hwDiag.h"

extern boards_t board;

static const unsigned long HW_DIAG_HOLD_MS = 1500;

static void aboutFired()
{
    String message = deviceSettings.blasterName + "\n" +
                     "Profile Slot: " + String(activeProfileIndex + 1) + "\n" +
                     "RPM Profile: " + String(fpsMode + 1) + "\n" + "v" + String(MAJOR_VERSION) +
                     "." + String(MINOR_VERSION) + "." + String(PATCH_VERSION) + "\n" +
                     board.boardName + "\n" + "any press = back";
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
    ProfileStore::saveProfile(activeProfileIndex, ProfileStore::defaultProfile());
    DeviceStore::saveDeviceSettings(DeviceStore::defaultDeviceSettings());
    rebootReason = BootReason::MENU;
    delay(100);
    rp2040.reboot();
}
static ActionItem resetEverythingConfirmItem("Yes, Reset", resetEverythingConfirmed);
static MenuItem* resetEverythingItems[] = {&resetEverythingConfirmItem};
static SubmenuItem resetEverythingSubmenu("Factory Reset All", resetEverythingItems, 1);

static void escPassthroughFired()
{
    // Reuses the boot-time TO_ESC_PASSTHROUGH handling in main.cpp's setup().
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

extern TwoWire myI2C;
static const uint8_t SSD1306_I2C_ADDRESS = 0x3C;
static const uint8_t SSD1306_SETCONTRAST_CMD = 0x81;
static void setDisplayContrast(uint8_t value)
{
    myI2C.beginTransmission(SSD1306_I2C_ADDRESS);
    myI2C.write((uint8_t)0x00);
    myI2C.write(SSD1306_SETCONTRAST_CMD);
    myI2C.endTransmission();
    myI2C.beginTransmission(SSD1306_I2C_ADDRESS);
    myI2C.write((uint8_t)0x00);
    myI2C.write(value);
    myI2C.endTransmission();
}

class BrightnessItem : public MenuItem
{
  public:
    BrightnessItem(const char* label, uint8_t* value) : MenuItem(label), value_(value) {}

    String valueText() const override { return String(*value_); }
    MenuActivation activate() override { return MenuActivation::EnterEdit; }
    void beginEdit() override { entryValue_ = *value_; }
    void adjustValue(int8_t direction) override
    {
        int next = (int)*value_ + direction * 5;
        if (next > 255)
            next = 255;
        if (next < 5) // keep a floor so the screen never goes fully unreadable while adjusting
            next = 5;
        *value_ = (uint8_t)next;
        setDisplayContrast(*value_);
    }
    void adjustValueWrapping(int8_t direction) override
    {
        int next = (int)*value_ + direction * 5;
        if (next > 255)
            next = 5;
        if (next < 5)
            next = 255;
        *value_ = (uint8_t)next;
        setDisplayContrast(*value_);
    }
    void cancelEdit() override
    {
        *value_ = entryValue_;
        setDisplayContrast(*value_);
    }

  private:
    uint8_t* value_;
    uint8_t entryValue_ = 0;
};
static BrightnessItem brightnessItem("Brightness", &deviceSettings.displayBrightness);

class RotateDisplayItem : public MenuItem
{
  public:
    RotateDisplayItem(const char* label, bool* value) : MenuItem(label), value_(value) {}
    String valueText() const override { return *value_ ? "ON" : "OFF"; }
    MenuActivation activate() override
    {
        *value_ = !*value_;
        displayManager.setRotation(*value_);
        return MenuActivation::None;
    }

  private:
    bool* value_;
};
static RotateDisplayItem rotateDisplayItem("Rotate Display", &deviceSettings.rotateDisplay);
static ToggleItem showCurrentRpmItem("Show Current RPM",
                                     &deviceSettings.showCurrentRpmOnHomeScreen);
static const char* const homeScreenDisplayModeLabels[] = {"Counter", "Fire Mode", "Both"};
static EnumItem<homeScreenDisplayMode_t>
    homeScreenDisplayModeItem("Home Screen", &deviceSettings.homeScreenDisplayMode,
                              homeScreenDisplayModeLabels, 3);
// Adds a 3rd line under the live-RPM column on the home screen: real/set DPS - independent of
// Show Current RPM (that toggle only gates the per-motor RPM rows above it in the same column).
static ToggleItem showDpsItem("Show DPS", &deviceSettings.showDpsOnHomeScreen);

static MenuItem* displayMenuItems[] = {&brightnessItem, &rotateDisplayItem, &showCurrentRpmItem,
                                       &homeScreenDisplayModeItem, &showDpsItem};
static SubmenuItem displaySubmenu("Display", displayMenuItems, 5);

static const char* const ledWarningModeLabels[] = {"No Warning", "Low Batt", "Warning Batt"};
static EnumItem<ledWarningMode_t> ledWarningModeItem("LED Warning", &deviceSettings.ledWarningMode,
                                                     ledWarningModeLabels, 3);
static bool noLedWired()
{
    return !pinDefined(board.LED_DATA);
}
static const char* const NO_LED_LOCKED_MSG = "This board has no\nstatus LED wired.";
static ConditionalLockItem ledWarningModeLockItem(&ledWarningModeItem, noLedWired,
                                                  NO_LED_LOCKED_MSG);

static const char* const pusherTypeLabels[] = {"None", "Motor", "Solenoid"};
static EnumItem<pusherType_t> pusherTypeItem("Pusher Type", &deviceSettings.pusherType,
                                             pusherTypeLabels, 3, true /* needsReboot */);
static ToggleItem pusherReverseItem("Reverse Direction", &deviceSettings.pusherReverseDirection);
// cycleSwitch.interval(deviceSettings.pusherDebounceTime_ms) is only called once, at attach time
// in main.cpp's setup().
static NumericItem<uint16_t> pusherDebounceItem("Debounce (ms)",
                                                &deviceSettings.pusherDebounceTime_ms, 0, 200, 1,
                                                true /* needsReboot */);

static MenuItem* pusherMenuItems[] = {&pusherTypeItem, &pusherReverseItem, &pusherDebounceItem};
static SubmenuItem pusherSubmenu("Pusher", pusherMenuItems, 3);

static NumericItem<uint16_t> debounceTimeItem("Switch Debounce (ms)",
                                              &deviceSettings.debounceTime_ms, 1, 200, 1);

static ToggleItem dualStageTriggerItem("Dual Stage Trigger", &deviceSettings.dualStageTrigger);
static NumericItem<uint32_t>
    menuHoldTimeItem("Menu Hold Time (ms)", &deviceSettings.menuButtonHoldTime_ms, 200, 5000, 100);
static NumericItem<int> voltageAvgWindowItem("Volt Avg Window",
                                             &deviceSettings.voltageAveragingWindow, 1, 50, 1);
static ToggleItem rpmShotCounterItem("RPM Shot Counter", &deviceSettings.useRpmBaseShotCounter);
static NumericItem<uint16_t> goodRpmReadsItem("Good RPM Reads", &deviceSettings.goodRpmShotReads, 1,
                                              50, 1);
static NumericItem<uint16_t> rpmDropThresholdItem("RPM Drop Thresh",
                                                  &deviceSettings.rpmDropThreshold, 0, 2000, 10);
static NumericItem<uint32_t> maxRpmCapItem("Max RPM Cap", &deviceSettings.maxRpmCap, 5000, 100000,
                                           1000);

// Shown on the home screen and the About screen. Uses the on-device text editor (TextEditItem).
static TextEditItem blasterNameItem("Blaster Name", &deviceSettings.blasterName);

static void resetDeviceConfirmed()
{
    DeviceStore::saveDeviceSettings(DeviceStore::defaultDeviceSettings());
    rebootReason = BootReason::MENU;
    delay(100);
    rp2040.reboot();
}
static ActionItem resetDeviceConfirmItem("Yes, Reset", resetDeviceConfirmed);
static MenuItem* resetDeviceItems[] = {&resetDeviceConfirmItem};
static SubmenuItem resetDeviceSubmenu("Factory Reset Device", resetDeviceItems, 1);

static MenuItem* deviceItems[] = {
    &rebootSubmenu,          &displaySubmenu,       &pusherSubmenu,
    &blasterNameItem,        &debounceTimeItem,     &dualStageTriggerItem,
    &menuHoldTimeItem,       &voltageAvgWindowItem, &rpmShotCounterItem,
    &goodRpmReadsItem,       &rpmDropThresholdItem, &maxRpmCapItem,
    &ledWarningModeLockItem, &resetDeviceSubmenu,   &aboutItem,
};
// Non-static: referenced by menu.cpp's Advanced submenu assembly.
SubmenuItem deviceSubmenu("Device", deviceItems, 15);
