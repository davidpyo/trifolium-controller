#pragma once
#include <Arduino.h>
#include <new> // std::nothrow - startCapture() must not treat allocation failure as fatal
#include "flywheelMotor.h"
#include "logging.h"

class RpmLogger
{
  public:
    ~RpmLogger() { freeBuffers(); }

    // Returns false if the allocation failed - caller should just skip logging that rev cycle.
    bool startCapture(uint32_t length)
    {
        freeBuffers();
        targetRpmCache_ = new (std::nothrow) uint32_t[length][4];
        rpmCache_ = new (std::nothrow) uint32_t[length][4];
        throttleCache_ = new (std::nothrow) int16_t[length][4];
        valueCache_ = new (std::nothrow) float[length][4];
        voltageCache_ = new (std::nothrow) int32_t[length]; // per sample, not per motor
        if (!targetRpmCache_ || !rpmCache_ || !throttleCache_ || !valueCache_ || !voltageCache_)
        {
            freeBuffers();
            return false;
        }
        length_ = length;
        cacheIndex_ = 0;
        return true;
    }

    // Call once per control-loop tick to record the current sample, if a capture is active.
    void record(FlywheelMotor motorArr[4], const bool motors[4], int32_t batteryVoltage_mv)
    {
        if (!armed() || cacheIndex_ >= length_)
            return;
        voltageCache_[cacheIndex_] = batteryVoltage_mv;
        for (int i = 0; i < 4; i++)
        {
            if (motors[i])
            {
                rpmCache_[cacheIndex_][i] = motorArr[i].motorRPM;
                targetRpmCache_[cacheIndex_][i] = motorArr[i].targetRPM; // mostly for reference
                throttleCache_[cacheIndex_][i] = (int16_t)(motorArr[i].PIDOutput);
                valueCache_[cacheIndex_][i] = motorArr[i].PIDIntegral;
            }
        }
    }

    bool dumpIfReady(const bool motors[4])
    {
        if (!armed())
            return false;
        if (cacheIndex_ < length_)
        {
            cacheIndex_++;
            return false;
        }
        if (cacheIndex_ > length_)
            return false; // already dumped this capture

        char rowBuf[240];
        int len = snprintf(rowBuf, sizeof(rowBuf), "Voltage_mv,");
        for (int j = 0; j < 4; j++)
        {
            if (motors[j])
                len += snprintf(rowBuf + len, sizeof(rowBuf) - len,
                                "Motor %d,TargetRPM %d,Throttle %d,value %d,", j, j, j, j);
        }
        println(rowBuf);

        for (uint32_t i = 0; i < length_; i++)
        {
            len = snprintf(rowBuf, sizeof(rowBuf), "%ld,", (long)voltageCache_[i]);
            for (int j = 0; j < 4; j++)
            {
                if (motors[j])
                {
                    char valueStr[10];
                    dtostrf(valueCache_[i][j], 1, 2, valueStr);
                    len += snprintf(rowBuf + len, sizeof(rowBuf) - len, "%lu,%lu,%d,%s,",
                                    (unsigned long)rpmCache_[i][j],
                                    (unsigned long)targetRpmCache_[i][j], throttleCache_[i][j],
                                    valueStr);
                }
            }
            println(rowBuf);
        }
        cacheIndex_++; // prevent re-dumping
        freeBuffers(); // capture complete - release the buffer
        return true;
    }

  private:
    bool armed() const { return targetRpmCache_ != nullptr; }

    void freeBuffers()
    {
        delete[] targetRpmCache_;
        delete[] rpmCache_;
        delete[] throttleCache_;
        delete[] valueCache_;
        delete[] voltageCache_;
        targetRpmCache_ = nullptr;
        rpmCache_ = nullptr;
        throttleCache_ = nullptr;
        valueCache_ = nullptr;
        voltageCache_ = nullptr;
        length_ = 0;
        cacheIndex_ = 0;
    }

    uint32_t (*targetRpmCache_)[4] = nullptr;
    uint32_t (*rpmCache_)[4] = nullptr;
    int16_t (*throttleCache_)[4] = nullptr;
    float (*valueCache_)[4] = nullptr;
    int32_t* voltageCache_ = nullptr;
    uint32_t length_ = 0;
    uint32_t cacheIndex_ = 0;
};
