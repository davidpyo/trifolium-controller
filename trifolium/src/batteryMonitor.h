#pragma once
#include <Arduino.h>

// Core 0 owns it (begin()/update() only ever called from core 0); core 1 only calls the
// read-only getters below
class BatteryMonitor
{
  public:
    BatteryMonitor(uint8_t adcPin, float calibrationFactor, int averagingWindow, uint8_t cellCount);

    void begin();  // one-shot boot-time read - call once from setup()
    void update(); // smoothed per-tick read - call every ~1ms from mainFiringLogic()

    // Re-applies a new calibration factor/averaging window live, resetting the smoothing buffer.
    void updateCalibration(float calibrationFactor, int averagingWindow);

    bool isDefined() const { return isDefined_; }
    int32_t getVoltage_mv() const { return voltage_mv_; }

  private:
    static const int MAX_AVERAGING_WINDOW = 16;

    uint8_t adcPin_;
    float calibrationFactor_;
    int averagingWindow_;
    uint8_t cellCount_;
    bool isDefined_ = false;
    uint32_t adc_mv_ = 0;
    int32_t voltage_mv_ = 0;
    int32_t voltageBuffer_[MAX_AVERAGING_WINDOW] = {0};
    int voltageBufferIndex_ = 0;
};
