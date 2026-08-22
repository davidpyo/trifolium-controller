#include "menuCore.h"
#include <cstring> // strchr() - textEditCharIndex(), the on-device text editor's charset lookup

// Character set for the on-device text editor
static const char* const textEditCharset =
    " ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
static const uint8_t textEditCharsetLen = 66; // strlen(textEditCharset)

static int8_t textEditCharIndex(char c)
{
    const char* p = strchr(textEditCharset, c);
    return p ? (int8_t)(p - textEditCharset) : 0;
}

struct CharEditPressDetector
{
    enum class Press : uint8_t
    {
        None,
        Short,
        Long
    };

    bool longPressWasActive = menuButton.isPressed() &&
                              menuButton.currentDuration() >= deviceSettings.menuButtonHoldTime_ms;

    Press poll()
    {
        bool longPressNow = menuButton.isPressed() &&
                            menuButton.currentDuration() >= deviceSettings.menuButtonHoldTime_ms;
        bool longPress = longPressNow && !longPressWasActive;
        longPressWasActive = longPressNow;
        bool shortPress = menuButton.released() &&
                          menuButton.previousDuration() < deviceSettings.menuButtonHoldTime_ms;
        if (longPress)
            return Press::Long;
        if (shortPress)
            return Press::Short;
        return Press::None;
    }
};

static const uint8_t TEXT_EDIT_LENGTH = 14;

bool runTextEditor(const char* title, String& value)
{
    char buf[TEXT_EDIT_LENGTH + 1];
    for (uint8_t i = 0; i < TEXT_EDIT_LENGTH; i++)
        buf[i] = (i < value.length()) ? value[i] : ' ';
    buf[TEXT_EDIT_LENGTH] = '\0';

    uint8_t cursor = 0;
    bool inSaveCancel = false;
    uint8_t saveCancelSelection = 0; // 0 = Save, 1 = Cancel, 2 = Continue Editing
    HeldRepeat triggerRepeat;
    HeldRepeat revRepeat;
    CharEditPressDetector menuPress;

    while (true)
    {
        handleSerialCommands();
        menuButton.update();

        // Reading only .isPressed() avoids racing core 0's own .update() calls for the same edge.
        bool triggerIsPressed = pinDefined(triggerSwitchPin) && triggerSwitch.isPressed();
        bool revIsPressed = revNavPressed();
        bool triggerFire = triggerRepeat.poll(triggerIsPressed);
        bool revFire = revRepeat.poll(revIsPressed);

        if (!inSaveCancel)
        {
            int8_t idx = textEditCharIndex(buf[cursor]);
            if (triggerFire)
            {
                if (revUsableForNav())
                {
                    if (idx < (int8_t)(textEditCharsetLen - 1))
                        buf[cursor] = textEditCharset[idx + 1];
                }
                else
                {
                    buf[cursor] = textEditCharset[(idx + 1) % textEditCharsetLen];
                }
            }
            if (revFire && idx > 0)
                buf[cursor] = textEditCharset[idx - 1];
        }
        else
        {
            if (triggerFire)
            {
                uint8_t triggerStep = soloTriggerListDir() < 0 ? 2 : 1;
                saveCancelSelection = (saveCancelSelection + triggerStep) % 3;
            }
            if (revFire)
                saveCancelSelection = (saveCancelSelection + 1) % 3; // down
        }

        display.clearDisplay();
        display.setTextSize(1);
        display.setTextColor(SSD1306_WHITE);
        display.setTextWrap(false);
        display.setCursor(0, 0);
        display.println(title);
        display.drawFastHLine(0, 10, OLED_WIDTH, 1);

        if (!inSaveCancel)
        {
            int16_t x = (OLED_WIDTH - TEXT_EDIT_LENGTH * 8) / 2;
            for (uint8_t i = 0; i < TEXT_EDIT_LENGTH; i++)
            {
                bool sel = (i == cursor);
                if (sel)
                {
                    display.fillRect(x, 22, 8, 10, SSD1306_WHITE);
                    display.setTextColor(SSD1306_BLACK);
                }
                display.setCursor(x + 1, 23);
                display.print(buf[i]);
                if (sel)
                    display.setTextColor(SSD1306_WHITE);
                x += 8;
            }

            display.setCursor(0, 44);
            display.print("hold menu:save/cancel");
            display.drawFastHLine(0, 54, OLED_WIDTH, 1);
            display.setCursor(0, 56);
            display.print("trig/rev=char");
        }
        else
        {
            const char* labels[3] = {"Save", "Cancel", "Continue Editing"};
            for (uint8_t i = 0; i < 3; i++)
            {
                int16_t y = LIST_TOP_Y + i * ROW_HEIGHT;
                if (i == saveCancelSelection)
                    display.fillRect(0, y - 1, OLED_WIDTH, ROW_HEIGHT, SSD1306_WHITE);
                display.setCursor(2, y);
                display.setTextColor(i == saveCancelSelection ? SSD1306_BLACK : SSD1306_WHITE);
                display.print(labels[i]);
            }
            display.setTextColor(SSD1306_WHITE);
        }
        display.display();

        CharEditPressDetector::Press press = menuPress.poll();
        if (!inSaveCancel)
        {
            if (press == CharEditPressDetector::Press::Short)
            {
                cursor = (cursor + 1) % TEXT_EDIT_LENGTH;
            }
            else if (press == CharEditPressDetector::Press::Long)
            {
                inSaveCancel = true;
                saveCancelSelection = 0;
            }
        }
        else
        {
            if (press == CharEditPressDetector::Press::Short)
            {
                if (saveCancelSelection == 0)
                {
                    value = String(buf);
                    value.trim();
                    return true;
                }
                if (saveCancelSelection == 1)
                {
                    return false;
                }
                inSaveCancel = false; // Continue Editing - back to the character row, buf untouched
            }
            else if (press == CharEditPressDetector::Press::Long)
            {
                return false; // holding again from Save/Cancel/Continue = leave without saving
                              // either way
            }
        }

        delay(2);
    }
}
