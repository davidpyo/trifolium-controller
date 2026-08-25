#include "displayManager.h"
#include "bitmaps.h"
#include "splashStore.h"
#include "global.h" // MAJOR_VERSION/MINOR_VERSION/PATCH_VERSION macros
#include "firingModeBehavior.h"

DisplayManager::DisplayManager(Adafruit_SSD1306& display) : display_(display) {}

void DisplayManager::setHasDisplay(bool hasDisplay)
{
    hasDisplay_ = hasDisplay;
}

void DisplayManager::begin(bool rotateDisplay)
{
    if (!hasDisplay_)
        return;

    while (!display_.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS))
    {
        delay(100);
    }
    display_.clearDisplay();
    display_.setTextSize(1);
    display_.setTextColor(SSD1306_WHITE);
    setRotation(rotateDisplay);
}

void DisplayManager::setRotation(bool rotateDisplay)
{
    if (!hasDisplay_)
        return;
    display_.setRotation(rotateDisplay ? 2 : 0);
}

void DisplayManager::showText(String str, int curX, int curY, bool clearScreen)
{
    if (!hasDisplay_)
        return;
    mailboxText_ = str;
    mailboxCursorX_ = curX;
    mailboxCursorY_ = curY;
    mailboxClear_ = clearScreen;
    mailboxPending_ = true;
}

void DisplayManager::requestBootupSplash()
{
    bootupPending_ = true;
}

void DisplayManager::flushMailbox()
{
    if (!hasDisplay_)
        return;

    if (mailboxPending_)
    {
        if (mailboxClear_)
        {
            display_.clearDisplay();
        }
        display_.setCursor(mailboxCursorX_, mailboxCursorY_);
        display_.println(mailboxText_);
        display_.display();
        mailboxPending_ = false;
    }

    if (bootupPending_)
    {
        display_.clearDisplay();
        static uint8_t customSplash[SplashStore::SPLASH_BYTES];
        if (SplashStore::loadCustomSplash(customSplash))
            display_.drawBitmap(0, 0, customSplash, SCREEN_WIDTH, SCREEN_HEIGHT, 1);
        else
            display_.drawBitmap(0, 0, splash, SCREEN_WIDTH, SCREEN_HEIGHT, 1);
        display_.display();
        bootupPending_ = false;
        display_.setCursor(0, 56);
        display_.setTextSize(1);
        display_.print("Trifolium v" + String(MAJOR_VERSION) + "." + String(MINOR_VERSION) + "." +
                       String(PATCH_VERSION));
        display_.display();
    }
}

void DisplayManager::drawDart(int16_t dartX, int16_t midY)
{
    display_.fillRect(dartX + 1, midY - BODY_HEIGHT / 2, BODY_WIDTH, BODY_HEIGHT, SSD1306_WHITE);
    display_.fillRect(dartX, midY - HEAD_HEIGHT / 2, 1, HEAD_HEIGHT, SSD1306_WHITE);
}

bool DisplayManager::drawDartBelt(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t dartCount,
                                  uint16_t groupBreakAt)
{
    unsigned long now = millis();
    if (now - lastFrameTime_ >= FIRING_ANIM_FRAME_MS)
    {
        lastFrameTime_ = now;
        beltPos_ += FIRING_ANIM_PIXELS_PER_TICK;
    }

    if (dartCount == 0)
        return false;

    static const int16_t DART_GAP = 1;  // gap between consecutive darts within one sub-burst
    static const int16_t GROUP_GAP = 4; // gap between Binary's press-group and release-group
    static const int32_t BURST_GAP =
        60; // gap between the end of one burst and the start of the next
    int16_t glyphWidth = BODY_WIDTH + 1; // +1 for the point
    int16_t dartStep = glyphWidth + DART_GAP;
    int16_t extraGroupGap = GROUP_GAP - DART_GAP;

    bool hasGroupBreak = groupBreakAt > 0 && groupBreakAt < dartCount;
    int32_t clusterWidth = (int32_t)dartCount * dartStep - DART_GAP + // no trailing gap after
                           (hasGroupBreak ? extraGroupGap : 0);       // the last dart
    int32_t cycleLength = clusterWidth + BURST_GAP;
    beltPos_ = (uint16_t)((uint32_t)beltPos_ % (uint32_t)cycleLength);

    int16_t midY = y + h / 2;
    int32_t maxRepeats = min((int32_t)8, w / max((int32_t)1, cycleLength) + 2);

    for (int32_t r = -1; r <= maxRepeats; r++)
    {
        int32_t leadX = x + w - beltPos_ + r * cycleLength;
        if (leadX > x + w || leadX + clusterWidth < x - glyphWidth)
            continue; // this whole repeat is off-screen, skip it entirely

        int32_t iMin =
            max((int32_t)0, (int32_t)((x - glyphWidth - leadX + dartStep - 1) / dartStep));
        int32_t iMax = min((int32_t)dartCount - 1, (int32_t)((x + w - leadX) / dartStep));
        for (int32_t i = iMin; i <= iMax; i++)
        {
            int32_t groupOffset = (hasGroupBreak && i >= (int32_t)groupBreakAt) ? extraGroupGap : 0;
            int16_t dartX = (int16_t)(leadX + i * dartStep + groupOffset);
            drawDart(dartX, midY);
        }
    }

    bool tooWideForCluster = clusterWidth > w;
    if (tooWideForCluster)
    {
        String countString = "x" + String(dartCount);
        int16_t countW = (int16_t)countString.length() * 6;
        display_.setCursor(max((int16_t)0, (int16_t)(128 - countW - 1)), 36);
        display_.print(countString);
    }
    return tooWideForCluster;
}

void DisplayManager::drawDartStream(int16_t x, int16_t y, int16_t w, int16_t h, int16_t dartStep)
{
    unsigned long now = millis();
    if (now - lastFrameTime_ >= FIRING_ANIM_FRAME_MS)
    {
        lastFrameTime_ = now;
        beltPos_ += FIRING_ANIM_PIXELS_PER_TICK;
    }

    dartStep = max((int16_t)(BODY_WIDTH + 2), dartStep);
    int16_t pos = beltPos_ % dartStep;

    int16_t midY = y + h / 2;
    for (int16_t lead = x + w - pos; lead > x - (BODY_WIDTH + 1); lead -= dartStep)
        drawDart(lead, midY);
}

void DisplayManager::renderTelemetry(
    const char* fireModeString, const char* profileName, const char* blasterName,
    FlywheelMotor motorArr[4], const bool motors[4], const motorStage_t motorStage[4],
    uint32_t displayShotCounter, bool isBatteryAdcDefined, int32_t batteryVoltage_mv,
    bool showCurrentRpm, bool batteryWarningActive, homeScreenDisplayMode_t homeScreenDisplayMode,
    const FiringModeBehavior& modeBehavior, const FiringContext& fireCtx, bool showDps,
    float achievedDPS, float targetDPS)
{
    if (!hasDisplay_)
        return;

    display_.clearDisplay();
    display_.setTextSize(1);

    // display blaster name / profile slot - top-left, every mode
    display_.setCursor(0, 5);
    display_.print(blasterName);
    display_.print("|");
    display_.print(profileName);

    // show battery voltage - blinks "LOW BATT" in the same spot instead when the non-cutoff
    // warning threshold has tripped
    if (isBatteryAdcDefined)
    {
        bool showWarning = batteryWarningActive && (millis() / 500) % 2 == 0;
        String batteryVoltageString =
            showWarning ? "LOW BATT" : String(batteryVoltage_mv / 1000.0, 1) + "V";
        display_.setCursor(128 - (batteryVoltageString.length() * 6), 5);
        display_.print(batteryVoltageString);
    }
    display_.drawFastHLine(0, 15, 128, 1);

    // Target RPM, bottom-right of the y=56 row
    int32_t stage1Rpm = -1, stage2Rpm = -1;
    for (int i = 0; i < 4; i++)
    {
        if (!motors[i])
            continue;
        if (motorStage[i] == STAGE_1 && stage1Rpm < 0)
            stage1Rpm = motorArr[i].revRPM;
        else if (motorStage[i] == STAGE_2 && stage2Rpm < 0)
            stage2Rpm = motorArr[i].revRPM;
    }
    String motorRpmString;
    if (stage1Rpm >= 0 && stage2Rpm >= 0)
    {
        motorRpmString = (stage1Rpm == stage2Rpm)
                             ? String(stage1Rpm / 1000) + "K"
                             : String(stage1Rpm / 1000) + "K|" + String(stage2Rpm / 1000) + "K";
    }
    else if (stage1Rpm >= 0)
    {
        motorRpmString = String(stage1Rpm / 1000) + "K";
    }
    else if (stage2Rpm >= 0)
    {
        motorRpmString = String(stage2Rpm / 1000) + "K";
    }
    if (motorRpmString.length() > 0)
    {
        display_.setCursor(128 - motorRpmString.length() * 6 - 1, 56);
        display_.print(motorRpmString);
    }

    if (homeScreenDisplayMode == HOME_COUNTER)
    {
        display_.setCursor(0, 56);
        display_.print(fireModeString);

        display_.drawFastHLine(0, 54, 128, 1);

        int totalRows = (showCurrentRpm ? 2 : 0) + (showDps ? 1 : 0);
        int16_t rowY[3];
        if (totalRows > 0)
        {
            int16_t gap = (int16_t)(39 / (totalRows + 1));
            for (int i = 0; i < totalRows; i++)
                rowY[i] = 15 + gap * (i + 1);
        }
        int nextRow = 0;
        if (showCurrentRpm)
        {
            int16_t nextX[2] = {0, 0};
            for (int i = 0; i < 4; i++)
            {
                if (!motors[i])
                    continue;
                int row = (motorStage[i] == STAGE_2) ? 0 : 1;
                if (nextX[row] > 100)
                    continue;
                String cell = String(motorArr[i].motorRPM / 1000) + "K";
                display_.setCursor(nextX[row], rowY[row]);
                display_.print(cell);
                nextX[row] += cell.length() * 6 + 6;
            }
            nextRow = 2;
        }

        if (showDps)
        {
            display_.setCursor(0, rowY[nextRow]);
            display_.print(String(achievedDPS, 0) + "/" + String(targetDPS, 0));
        }

        display_.setTextSize(4);
        String displayShotCounterString(displayShotCounter);
        display_.setCursor(128 - (displayShotCounterString.length() * 24), 20);
        display_.print(displayShotCounterString);
    }
    else
    {
        bool effectiveShowDps = showDps && modeBehavior.supportsTargetDps();
        bool tightenForAnim = (homeScreenDisplayMode == HOME_FIRE_MODE) && effectiveShowDps;
        int16_t rpmRow0Y = tightenForAnim ? 17 : 20;
        int16_t rpmRow1Y = tightenForAnim ? 26 : 30;
        int16_t dpsRowY = tightenForAnim ? 35 : 40;
        if (showCurrentRpm)
        {
            int16_t nextX[2] = {0, 0};
            for (int i = 0; i < 4; i++)
            {
                if (!motors[i])
                    continue;
                int row = (motorStage[i] == STAGE_2) ? 0 : 1;
                if (nextX[row] > 60)
                    continue;
                String cell = String(motorArr[i].motorRPM / 1000) + "K";
                display_.setCursor(nextX[row], row == 0 ? rpmRow0Y : rpmRow1Y);
                display_.print(cell);
                nextX[row] += cell.length() * 6 + 4;
            }
        }
        if (effectiveShowDps)
        {
            display_.setCursor(0, dpsRowY);
            display_.print(String(achievedDPS, 0) + "/" + String(targetDPS, 0));
        }

        int16_t nameY = (homeScreenDisplayMode == HOME_BOTH) ? 17 : 20;
        display_.setTextSize(2);
        display_.setCursor(128 - (int16_t)strlen(fireModeString) * 12 - 1, nameY);
        display_.print(fireModeString);
        display_.setTextSize(1); // reset - the branches below print their own text explicitly

        display_.drawFastHLine(0, 54, 128, 1);

        if (homeScreenDisplayMode == HOME_BOTH)
        {
            String displayShotCounterString(displayShotCounter);
            display_.setTextSize(2);
            int16_t counterW = displayShotCounterString.length() * 12;
            display_.setCursor(128 - counterW - 1, 36);
            display_.print(displayShotCounterString);
            display_.setTextSize(1);
        }
        else // HOME_FIRE_MODE
        {
            String displayShotCounterString(displayShotCounter);
            display_.setCursor(0, 56);
            display_.print(displayShotCounterString);

            int16_t animY = effectiveShowDps ? 44 : 42;
            int16_t animH = effectiveShowDps ? 8 : 12;
            modeBehavior.render(*this, 0, animY, 128, animH, fireCtx);
        }
    }

    display_.display();
}
