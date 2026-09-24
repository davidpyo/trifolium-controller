#pragma once
#include <Arduino.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Wire.h>
#include "flywheelMotor.h"

struct FiringContext;
class FiringModeBehavior;

// Rebinds Adafruit_SSD1306's protected `wire` after the board is known, so `display` can stay a
// plain global and every display.foo() call site stays as it is.
class BoardDisplay : public Adafruit_SSD1306
{
  public:
    BoardDisplay(uint8_t w, uint8_t h) : Adafruit_SSD1306(w, h, nullptr, -1) {}

    // Before begin(), never after. Null keeps the base default (&Wire, never begun), which leaves
    // the menu's unguarded display.foo() calls inert instead of faulting.
    void bindWire(TwoWire* bus)
    {
        if (bus)
            wire = bus;
    }
};

class DisplayManager
{
  public:
    explicit DisplayManager(Adafruit_SSD1306& display);

    void setHasDisplay(bool hasDisplay);

    // Whether a panel is actually usable. Starts as the stored hasDisplay setting and is cleared by
    // begin() if the panel doesn't come up, so callers driving frames should gate on this rather
    // than on deviceSettings.hasDisplay.
    bool hasDisplay() const { return hasDisplay_; }

    // Caller (setup1()) must wait on main.cpp's bootSettingsLoaded first: it orders core 0's
    // deviceSettings load and selectDisplayBus() ahead of the bus->begin() here. Null bus = run
    // headless. Returns whether a panel came up.
    bool begin(bool rotateDisplay, uint8_t brightness, TwoWire* bus);

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
                         bool idleHoldActive, bool batteryWarningActive,
                         homeScreenDisplayMode_t homeScreenDisplayMode,
                         const FiringModeBehavior& modeBehavior, const FiringContext& fireCtx,
                         bool showDps, float achievedDPS, float targetDPS);

    Adafruit_SSD1306& raw() { return display_; }

    bool drawDartBelt(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t dartCount,
                      uint16_t groupBreakAt = 0);

    void drawDartStream(int16_t x, int16_t y, int16_t w, int16_t h, int16_t dartStep);

  private:
    static const int SCREEN_WIDTH = 128;
    static const int SCREEN_HEIGHT = 64;
    static const uint8_t SCREEN_ADDRESS = 0x3C;

    static const int16_t BODY_WIDTH = 6;
    static const int16_t BODY_HEIGHT = 4;
    static const int16_t HEAD_HEIGHT = 2;
    void drawDart(int16_t dartX, int16_t midY);

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
};
