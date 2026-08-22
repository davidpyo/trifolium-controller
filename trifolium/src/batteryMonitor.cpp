#include "batteryMonitor.h"
#include "types.h" // PIN_NOT_USED
#include "logging.h"

BatteryMonitor::BatteryMonitor(uint8_t adcPin, float calibrationFactor, int averagingWindow,
                               uint8_t cellCount)
    : adcPin_(adcPin), calibrationFactor_(calibrationFactor),
      averagingWindow_(min(averagingWindow, MAX_AVERAGING_WINDOW)), cellCount_(cellCount)
{
}

void BatteryMonitor::begin()
{
    if (adcPin_ != PIN_NOT_USED)
    {
        pinMode(adcPin_, INPUT);
        adc_mv_ = (analogRead(adcPin_) * 3300UL) / 1023;
        voltage_mv_ = calibrationFactor_ * adc_mv_ * 11;
        logger.info("Battery voltage (before calibration): ", adc_mv_ * 11);
        if (calibrationFactor_ != 1.0)
        {
            logger.info("Battery voltage (after calibration): ", calibrationFactor_ * adc_mv_ * 11);
        }
        isDefined_ = true;
    }
    else
    {
        isDefined_ = false;
        voltage_mv_ = cellCount_ * 3500;
    }
}

void BatteryMonitor::updateCalibration(float calibrationFactor, int averagingWindow)
{
    calibrationFactor_ = calibrationFactor;
    averagingWindow_ = min(averagingWindow, MAX_AVERAGING_WINDOW);
    if (!isDefined_)
        return;

    // Seed the whole buffer with one fresh reading rather than zeroing it, so voltage_mv_ doesn't
    // drop to 0 and read as a real low-voltage cutoff for a few ticks.
    adc_mv_ = (analogRead(adcPin_) * 3300UL) / 1023;
    voltage_mv_ = calibrationFactor_ * adc_mv_ * 11;
    for (int i = 0; i < MAX_AVERAGING_WINDOW; i++)
    {
        voltageBuffer_[i] = voltage_mv_;
    }
    voltageBufferIndex_ = 0;
}

void BatteryMonitor::update()
{
    if (!isDefined_)
        return;

    adc_mv_ = (analogRead(adcPin_) * 3300UL) / 1023;
    if (averagingWindow_ == 1)
    {
        voltage_mv_ = calibrationFactor_ * adc_mv_ * 11;
    }
    else
    {
        voltageBuffer_[voltageBufferIndex_] = calibrationFactor_ * adc_mv_ * 11;
        voltageBufferIndex_ = (voltageBufferIndex_ + 1) % averagingWindow_;
        voltage_mv_ = 0;
        for (int i = 0; i < averagingWindow_; i++)
        {
            voltage_mv_ += voltageBuffer_[i];
        }
        voltage_mv_ /= averagingWindow_; // apply exponential moving average to smooth out noise.
                                         // Time constant ~= 1.44 ms
    }
}
