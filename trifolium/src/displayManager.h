#pragma once
#include <Arduino.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "flywheelMotor.h"

class DisplayManager
{
  public:
    explicit DisplayManager(Adafruit_SSD1306& display);

    void setHasDisplay(bool hasDisplay);

    // Caller (setup1()) must wait for core 0 to finish loading deviceSettings first - see
    // main.cpp's bootSettingsLoaded flag.
    void begin(bool rotateDisplay);

    void setRotation(bool rotateDisplay);

    // Mailbox setter - core 0 only. Consumed by flushMailbox() on core 1.
    void showText(String str, int curX = 0, int curY = 0, bool clearScreen = false);
    void requestBootupSplash(); // core 0 only, same mailbox contract as showText()

    // Call every loop1() tick (core 1): flushes a pending showText()/requestBootupSplash().
    void flushMailbox();

    // Runtime telemetry screen - core 1 only.
    void renderTelemetry(const char* fireModeString, const char* profileName,
                         const char* blasterName, FlywheelMotor motorArr[4], const bool motors[4],
                         const motorStage_t motorStage[4], uint32_t displayShotCounter,
                         bool isBatteryAdcDefined, int32_t batteryVoltage_mv, bool showCurrentRpm,
                         bool batteryWarningActive, homeScreenDisplayMode_t homeScreenDisplayMode,
                         uint16_t animDartCount, uint16_t animGroupBreakAt, bool showDps,
                         float achievedDPS, float targetDPS);

    Adafruit_SSD1306& raw() { return display_; }

  private:
    static const int SCREEN_WIDTH = 128;
    static const int SCREEN_HEIGHT = 64;
    static const uint8_t SCREEN_ADDRESS = 0x3C;

    Adafruit_SSD1306& display_;
    bool hasDisplay_ = false;

    String mailboxText_ = "";
    int mailboxCursorX_ = 0;
    int mailboxCursorY_ = 0;
    bool mailboxClear_ = false;
    bool mailboxPending_ = false;
    bool bootupPending_ = false;

    // Home screen firing-animation belt position (HOME_FIRE_MODE placeholder).
    static const unsigned long FIRING_ANIM_FRAME_MS = 50;
    static const uint8_t FIRING_ANIM_PIXELS_PER_TICK = 6;
    unsigned long lastFrameTime_ = 0;
    uint16_t beltPos_ = 0;

    bool drawFiringAnimation(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t dartCount,
                             uint16_t groupBreakAt = 0);
};
