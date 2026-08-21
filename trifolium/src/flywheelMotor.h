#pragma once
#include <Arduino.h>
#include "motor.h"
#include "types.h"

class BidirDShotX1; // forward decl, avoid pulling in PIO_DShot.h

class FlywheelMotor
{
  public:
    explicit FlywheelMotor(Motor* config);

    uint32_t revRPM = 0;         // target RPM to rev up to for the active firing mode
    uint32_t targetRPM = 0;      // current target RPM (ramps/dwells/idles toward this)
    uint32_t firingRPM = 0;      // RPM threshold considered "at speed" to allow firing
    uint32_t motorRPM = 0;       // filtered/last-known-good RPM reading
    uint32_t motorRPMRaw = 0;    // raw RPM reading before filtering (PID_CONTROL only)
    uint32_t motorRPMFilter = 0; // EMA filter accumulator (PID_CONTROL only)
    int32_t PIDError = 0;
    int32_t PIDErrorPrior = 1;
    int32_t PIDOutput = 0;
    float PIDIntegral = 0;
    float iTerm = 0;
    bool firstCrossing = false;
    uint16_t shotsUnderThreshold = 0;

    // Extended DShot Telemetry beyond eRPM - raw values, read by the menu's ESC dashboard. The
    // *Seen flags stay false until a frame of that type actually arrives.
    uint32_t telemetryVoltageRaw = 0;
    uint32_t telemetryCurrentRaw = 0;
    uint32_t telemetryTempRaw = 0;
    uint32_t telemetryStressRaw = 0;
    bool telemetryVoltageSeen = false;
    bool telemetryCurrentSeen = false;
    bool telemetryTempSeen = false;
    bool telemetryStressSeen = false;

    BidirDShotX1* esc = nullptr;
    Motor* m_config; // non-owning, points into CONFIGURATION.h's motorsObj[i]

    void attachEsc(BidirDShotX1* escPtr);
    void updatePID(int32_t batteryVoltage_mv, int32_t loopTime_us, int32_t maxThrottle,
                   uint8_t EMAFilter, uint32_t half, uint8_t iThreshold, int batteryType);
    void updateTBH(int32_t batteryVoltage_mv, flywheelState_t flywheelState, int32_t maxThrottle);
    void updateOpenLoop(int32_t batteryVoltage_mv, int32_t maxThrottle);
    void resetControl(flywheelControlType_t mode);
    void sendThrottle(int32_t value);

    // EMA-filters current RPM into motorRPM without touching PIDOutput/throttle - extracted from
    // updatePID() so other code can poll live RPM while driving throttle directly.
    void refreshFilteredRpm(uint8_t EMAFilter, uint32_t half, int batteryType);

  private:
    // ERPM overwrites rpmOut; any other recognized telemetry type updates the cache fields above.
    void readTelemetry(uint32_t& rpmOut);
};
