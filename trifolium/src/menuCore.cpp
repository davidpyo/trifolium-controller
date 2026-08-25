#include "menuCore.h"
#include "logging.h"
#include "global.h" // BootReason/rebootReason - set before the reboot-warning's reboot
#include "profileStore.h"
#include "deviceStore.h"

// Reboot-elimination apply*() functions - defined in main.cpp, called from runMenu()'s
// post-save hook below so these settings apply immediately rather than requiring a reboot.
void applyMotorConfig();
void applyEmaFilterConstant();
void applySolenoidTimingCurve();
void applyMaxAchievableDps();
void applyDebounceInterval();
void applyPrintTelemetry();

Bounce2::Button menuButton = Bounce2::Button();

static const uint8_t MAX_MENU_DEPTH = 6;
static const uint8_t OLED_HEIGHT = 64;
static const uint8_t VISIBLE_ROWS = (OLED_HEIGHT - LIST_TOP_Y) / ROW_HEIGHT;

struct MenuLevel
{
    const char* title;
    MenuItem* const* items;
    uint8_t count; // real items only - the "< Back" row is implicit, at index count
    uint8_t selectedIndex;
    uint8_t scrollOffset;
};

static MenuLevel menuStack[MAX_MENU_DEPTH];
static uint8_t menuDepth;
static bool menuOpenFlag = false;

bool menuIsOpen()
{
    return menuOpenFlag;
}

static void pushLevel(const char* title, MenuItem* const* items, uint8_t count)
{
    if (menuDepth >= MAX_MENU_DEPTH)
        return;
    MenuLevel& level = menuStack[menuDepth++];
    level.title = title;
    level.items = items;
    level.count = count;
    level.selectedIndex = 0;
    level.scrollOffset = 0;
}

static uint8_t visibleCount(const MenuLevel& level)
{
    uint8_t n = 0;
    for (uint8_t i = 0; i < level.count; i++)
        if (level.items[i]->isVisible())
            n++;
    return n;
}

static MenuItem* visibleItemAt(const MenuLevel& level, uint8_t pos)
{
    for (uint8_t i = 0; i < level.count; i++)
    {
        if (!level.items[i]->isVisible())
            continue;
        if (pos == 0)
            return level.items[i];
        pos--;
    }
    return nullptr; // pos out of range - callers only call this for pos < visibleCount(level)
}

static void moveSelection(MenuLevel& level, int8_t delta)
{
    int16_t virtualCount = visibleCount(level) + 1; // + "< Back"
    int16_t next = (int16_t)level.selectedIndex + delta;
    if (next < 0)
        next = virtualCount - 1;
    if (next >= virtualCount)
        next = 0;
    level.selectedIndex = (uint8_t)next;
}

static void clampToVisible(MenuLevel& level)
{
    uint8_t virtualCount = visibleCount(level) + 1; // + "< Back"
    if (level.selectedIndex >= virtualCount)
        level.selectedIndex = virtualCount - 1;
    if (level.scrollOffset >= virtualCount)
        level.scrollOffset = 0;
}

static const uint8_t LIST_MAX_CHARS = (OLED_WIDTH - 2) / 6;

static String itemDisplayText(const MenuItem& item)
{
    String label = item.label();
    String value = item.valueText();
    String suffix = item.showsArrow() ? " >" : "";

    if (value.length() == 0)
        return label + suffix;

    int reserved = value.length() + 2 + suffix.length(); // ": " + value + optional " >"
    int labelBudget = (int)LIST_MAX_CHARS - reserved;
    if (labelBudget < 1)
        labelBudget = 1;
    if ((int)label.length() > labelBudget)
        label = label.substring(0, labelBudget);

    return label + ": " + value + suffix;
}

static void renderList(MenuLevel& level)
{
    clampToVisible(level);
    uint8_t count = visibleCount(level);
    uint8_t virtualCount = count + 1; // + "< Back"

    if (level.selectedIndex < level.scrollOffset)
        level.scrollOffset = level.selectedIndex;
    if (level.selectedIndex >= level.scrollOffset + VISIBLE_ROWS)
        level.scrollOffset = level.selectedIndex - VISIBLE_ROWS + 1;

    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setTextWrap(false); // clip rather than wrap into the next row
    display.setCursor(0, 0);
    display.println(level.title);
    display.drawFastHLine(0, 10, OLED_WIDTH, 1);

    for (uint8_t row = 0; row < VISIBLE_ROWS; row++)
    {
        uint8_t i = level.scrollOffset + row;
        if (i >= virtualCount)
            break;

        int16_t y = LIST_TOP_Y + row * ROW_HEIGHT;
        bool selected = (i == level.selectedIndex);
        String text = (i == count) ? "< Back" : itemDisplayText(*visibleItemAt(level, i));

        if (selected)
        {
            display.fillRect(0, y - 1, OLED_WIDTH, ROW_HEIGHT, SSD1306_WHITE);
            display.setTextColor(SSD1306_BLACK);
        }
        display.setCursor(2, y);
        display.print(text);
        if (selected)
        {
            display.setTextColor(SSD1306_WHITE);
        }
    }
    display.display();
}

static void renderEdit(const MenuItem& item, bool reversedDirection)
{
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setTextWrap(false); // same reasoning as renderList() - clip rather than wrap
    display.setCursor(0, 0);
    display.println(item.label());
    if (reversedDirection)
    {
        display.setCursor(107, 0);
        display.print("REV");
    }
    display.drawFastHLine(0, 10, OLED_WIDTH, 1);

    String valStr = item.valueText();
    uint8_t valSize = item.editValueTextSize();
    display.setTextSize(valSize);
    int16_t halfGlyphWidth = (int16_t)valSize * 3; // half of size*6px advance per character
    int16_t x = 64 - (int16_t)(valStr.length() * halfGlyphWidth);
    if (x < 0)
        x = 0;
    display.setCursor(x, 24);
    display.print(valStr);

    display.setTextSize(1);
    display.setCursor(0, 56);
    display.print("short=save long=cancel");
    display.display();
}

// One fewer row than VISIBLE_ROWS - keeps room for the save/cancel instruction line below.
static const uint8_t OPTIONS_VISIBLE_ROWS = (56 - LIST_TOP_Y) / ROW_HEIGHT;

// For items with a discrete option set (EnumItem) - a scrollable list of every option with the
// current one highlighted. Reached instead of renderEdit() whenever item.optionCount() > 0.
static void renderEditOptions(const MenuItem& item, uint8_t& scrollOffset)
{
    uint8_t count = item.optionCount();
    uint8_t current = item.currentOptionIndex();

    if (current < scrollOffset)
        scrollOffset = current;
    if (current >= scrollOffset + OPTIONS_VISIBLE_ROWS)
        scrollOffset = current - OPTIONS_VISIBLE_ROWS + 1;

    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setTextWrap(false);
    display.setCursor(0, 0);
    display.println(item.label());
    display.drawFastHLine(0, 10, OLED_WIDTH, 1);

    for (uint8_t row = 0; row < OPTIONS_VISIBLE_ROWS; row++)
    {
        uint8_t i = scrollOffset + row;
        if (i >= count)
            break;

        int16_t y = LIST_TOP_Y + row * ROW_HEIGHT;
        bool selected = (i == current);
        String text = item.optionLabel(i);

        if (selected)
        {
            display.fillRect(0, y - 1, OLED_WIDTH, ROW_HEIGHT, SSD1306_WHITE);
            display.setTextColor(SSD1306_BLACK);
        }
        display.setCursor(2, y);
        display.print(text);
        if (selected)
        {
            display.setTextColor(SSD1306_WHITE);
        }
    }

    display.setCursor(0, 56);
    display.print("short=save long=cancel");
    display.display();
}

// Shared by both trapdoor variants below - polls the menu button until a short or long press.
// Returns true for short-press, false for long-press.
bool waitForTrapdoorPress()
{
    bool longPressWasActive = menuButton.isPressed() &&
                              menuButton.currentDuration() >= deviceSettings.menuButtonHoldTime_ms;
    while (true)
    {
        handleSerialCommands();
        menuButton.update();

        bool longPressNow = menuButton.isPressed() &&
                            menuButton.currentDuration() >= deviceSettings.menuButtonHoldTime_ms;
        bool longPress = longPressNow && !longPressWasActive;
        longPressWasActive = longPressNow;

        bool shortPress = menuButton.released() &&
                          menuButton.previousDuration() < deviceSettings.menuButtonHoldTime_ms;

        if (longPress)
            return false;
        if (shortPress)
            return true;

        delay(10);
    }
}

// Blocking full-screen message-and-wait. Used by the
// reboot-required warning.
bool showTrapdoor(const String& message)
{
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.println(message);
    display.display();
    return waitForTrapdoorPress();
}

void setupMenuButton()
{
    if (pinDefined(menuButtonPin))
    {
        menuButton.attach(menuButtonPin, INPUT_PULLUP);
        menuButton.interval(debounceTime_ms);
        menuButton.setPressedState(menuButtonNormallyClosed);
    }
}

bool menuButtonHeld()
{
    menuButton.update();

    static bool wasActive = false;
    bool isActive = pinDefined(menuButtonPin) && menuButton.isPressed() &&
                    menuButton.currentDuration() >= deviceSettings.menuButtonHoldTime_ms;
    bool risingEdge = isActive && !wasActive;
    wasActive = isActive;
    return risingEdge;
}

void runMenu()
{
    menuOpenFlag = true;
    logger.info("Menu opened");

    menuDepth = 0;
    pushLevel("MENU", rootItems, rootItemsCount);

    bool editing = false;
    MenuItem* editingItem = nullptr;
    uint8_t optionsScrollOffset =
        0; // renderEditOptions()'s scroll position - reset per edit session below
    bool rebootPending = false;

    static const unsigned long DOUBLE_CLICK_WINDOW_MS = 350;
    bool reversedDirection = false;
    bool pendingSave = false;
    unsigned long pendingSaveStart_ms = 0;

    bool triggerWasPressed = triggerSwitch.isPressed();
    bool revWasPressed = revNavPressed();
    HeldRepeat triggerRepeat;
    HeldRepeat revRepeat;

    bool longPressWasActive = true;

    renderList(menuStack[menuDepth - 1]);

    while (true)
    {
        handleSerialCommands();

        menuButton.update();

        bool triggerIsPressed = pinDefined(triggerSwitchPin) && triggerSwitch.isPressed();
        bool revIsPressed = revNavPressed();
        bool triggerEdge = triggerIsPressed && !triggerWasPressed;
        bool revEdge = revIsPressed && !revWasPressed;
        triggerWasPressed = triggerIsPressed;
        revWasPressed = revIsPressed;

        // Long press fires once, the instant the hold duration is reached, not on release.
        bool longPressNow = menuButton.isPressed() &&
                            menuButton.currentDuration() >= deviceSettings.menuButtonHoldTime_ms;
        bool longPress = longPressNow && !longPressWasActive;
        longPressWasActive = longPressNow;

        bool shortPress = menuButton.released() &&
                          menuButton.previousDuration() < deviceSettings.menuButtonHoldTime_ms;

        if (editing)
        {
            bool isOptionsList = editingItem->optionCount() > 0;
            bool usesDoubleClickFlip = !isOptionsList && !revUsableForNav();
            int8_t triggerDir = isOptionsList ? -1 : +1;
            int8_t revDir = isOptionsList ? +1 : -1;
            if (triggerRepeat.poll(triggerIsPressed))
            {
                if (revUsableForNav())
                {
                    editingItem->adjust(triggerDir, false);
                }
                else
                {
                    int8_t soloDir = isOptionsList ? +1 : triggerDir;
                    if (usesDoubleClickFlip && reversedDirection)
                        soloDir = (int8_t)-soloDir;
                    editingItem->adjust(soloDir, true);
                }
            }
            if (revRepeat.poll(revIsPressed))
                editingItem->adjust(revDir, false);

            if (longPress)
            {
                editingItem->cancelEdit(); // revert to the value at edit-entry
                editing = false;
                pendingSave = false;
            }
            else if (shortPress)
            {
                if (usesDoubleClickFlip && pendingSave)
                {
                    reversedDirection = !reversedDirection;
                    pendingSave = false;
                }
                else if (usesDoubleClickFlip)
                {
                    pendingSave = true;
                    pendingSaveStart_ms = millis();
                }
                else
                {
                    if (editingItem->needsReboot())
                        rebootPending = true;
                    editing = false; // save: keep the live-adjusted value
                }
            }
            else if (pendingSave && millis() - pendingSaveStart_ms >= DOUBLE_CLICK_WINDOW_MS)
            {
                // No second click arrived in time - commit the save that's been on hold.
                pendingSave = false;
                if (editingItem->needsReboot())
                    rebootPending = true;
                editing = false;
            }
        }
        else
        {
            MenuLevel& level = menuStack[menuDepth - 1];
            clampToVisible(level);

            if (triggerEdge)
                moveSelection(level, soloTriggerListDir());
            if (revEdge)
                moveSelection(level, +1);

            if (longPress)
            {
                if (menuDepth > 1)
                    menuDepth--;
                else
                    menuDepth = 0; // exit the menu entirely from the top level
            }
            else if (shortPress)
            {
                if (level.selectedIndex == visibleCount(level))
                {
                    // synthetic "< Back" row - same as a long press at this level
                    if (menuDepth > 1)
                        menuDepth--;
                    else
                        menuDepth = 0;
                }
                else
                {
                    MenuItem* item = visibleItemAt(level, level.selectedIndex);
                    if (!item->isEditable())
                    {
                        // e.g. Ratio based FPS while the profile is in Custom mode
                        showTrapdoor(item->lockedMessage());
                        longPressWasActive = true; // don't also count as a long-press-to-exit
                    }
                    else
                        switch (item->activate())
                        {
                        case MenuActivation::EnterSubmenu:
                            pushLevel(item->label(), item->children(), item->childCount());
                            break;
                        case MenuActivation::EnterEdit:
                            item->beginEdit();
                            editing = true;
                            editingItem = item;
                            optionsScrollOffset = 0;
                            reversedDirection = false;
                            pendingSave = false;
                            break;
                        case MenuActivation::None:
                            if (item->needsReboot())
                                rebootPending = true;
                            longPressWasActive = true;
                            break;
                        case MenuActivation::PopBack:
                            if (menuDepth > 1)
                                menuDepth--;
                            else
                                menuDepth = 0;
                            longPressWasActive = true;
                            break;
                        }
                }
            }
        }

        if (menuDepth == 0)
            break;

        if (editing)
        {
            if (editingItem->optionCount() > 0)
                renderEditOptions(*editingItem, optionsScrollOffset);
            else
                renderEdit(*editingItem, reversedDirection);
        }
        else
            renderList(menuStack[menuDepth - 1]);

        delay(10);
    }

    // Simpler to save unconditionally on every menu close than track a dirty flag.
    ProfileStore::saveProfile(activeProfileIndex, activeProfile);
    DeviceStore::saveDeviceSettings(deviceSettings);

    // Re-apply every reboot-eliminated setting - cheap to recompute even if nothing changed.
    applyMotorConfig();
    applyEmaFilterConstant();
    applySolenoidTimingCurve();
    applyDebounceInterval();
    menuButton.interval(debounceTime_ms); // owned here, not main.cpp - applyDebounceInterval()
                                          // above keeps the shim itself in sync
    applyPrintTelemetry();
    batteryMonitor->updateCalibration(deviceSettings.voltageCalibrationFactor,
                                      deviceSettings.voltageAveragingWindow);
    applyMaxAchievableDps();
    displayManager.setRotation(deviceSettings.rotateDisplay);

    if (rebootPending)
    {
        bool rebootConfirmed = showTrapdoor("Reboot required\nshort=now long=later");
        if (rebootConfirmed)
        {
            logger.info("Menu: rebooting to apply changes");
            rebootReason = BootReason::MENU;
            delay(100);
            rp2040.reboot();
        }
    }

    menuOpenFlag = false;
    logger.info("Menu closed");
}
