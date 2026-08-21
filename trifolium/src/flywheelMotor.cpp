#include "flywheelMotor.h"
#include <PIO_DShot.h>

FlywheelMotor::FlywheelMotor(Motor* config) : m_config(config) {}

void FlywheelMotor::attachEsc(BidirDShotX1* escPtr)
{
    esc = escPtr;
}

void FlywheelMotor::sendThrottle(int32_t value)
{
    esc->sendThrottle(value);
}

void FlywheelMotor::resetControl(flywheelControlType_t mode)
{
    switch (mode)
    {
    case PID_CONTROL:
        PIDOutput = 0;
        PIDIntegral = 0; // stop reset PID
        firstCrossing = false;
        break;
    case TBH_CONTROL:
        PIDIntegral = 0; // reset TBH to target RPM value
        break;
    }
}

void FlywheelMotor::readTelemetry(uint32_t& rpmOut)
{
    uint32_t value;
    switch (esc->getTelemetryPacket(&value))
    {
    case BidirDshotTelemetryType::ERPM:
        rpmOut = value;
        break;
    case BidirDshotTelemetryType::VOLTAGE:
        telemetryVoltageRaw = value;
        telemetryVoltageSeen = true;
        break;
    case BidirDshotTelemetryType::CURRENT:
        telemetryCurrentRaw = value;
        telemetryCurrentSeen = true;
        break;
    case BidirDshotTelemetryType::TEMPERATURE:
        telemetryTempRaw = value;
        telemetryTempSeen = true;
        break;
    case BidirDshotTelemetryType::STRESS:
        telemetryStressRaw = value;
        telemetryStressSeen = true;
        break;
    default:
        break; // NO_PACKET/CHECKSUM_ERROR/STATUS/DEBUG_FRAME_* - rpmOut left as-is
    }
}

void FlywheelMotor::refreshFilteredRpm(uint8_t EMAFilter, uint32_t half, int batteryType)
{
    readTelemetry(motorRPMRaw);
    motorRPMRaw /= m_config->m_motorPolesDiv2; // convert eRPM to RPM

    // reject impossible rpm readings - high-pass plus cell-count-scaled tolerance
    if (motorRPMRaw * 1000 > m_config->m_motorKv * batteryVoltageMax_mv[batteryType] +
                                 (cellCount((batteryType_t)batteryType) * 500))
    {
        // assign to last valid filtered rpm reading
        motorRPMRaw = motorRPM;
    }
    // do some filtering
    motorRPMFilter += motorRPMRaw;
    motorRPM = (motorRPMFilter + half) >> EMAFilter; // 1st-order exponential moving average
    motorRPMFilter -= motorRPM;
}

void FlywheelMotor::updatePID(int32_t batteryVoltage_mv, int32_t loopTime_us, int32_t maxThrottle,
                              uint8_t EMAFilter, uint32_t half, uint8_t iThreshold, int batteryType)
{
    refreshFilteredRpm(EMAFilter, half, batteryType);

    PIDError = targetRPM - motorRPM;
    if ((signbit(PIDError) ||
         ((abs(PIDErrorPrior - PIDError) < iThreshold) && motorRPM > (targetRPM / 2))) &&
        !firstCrossing)
    {
        firstCrossing = true;
    }
    int16_t openLoopThrottle = max(
        min(maxThrottle, maxThrottle * targetRPM / batteryVoltage_mv * 1000 / m_config->m_motorKv),
        0);
    if (!firstCrossing)
    {
        PIDIntegral = 0;
        iTerm = 0;
    }
    else
    {
        PIDIntegral += PIDError * loopTime_us / 1000000.0;

        // use iTerm to save some memory for the next
        iTerm = (openLoopThrottle) / (m_config->m_iGain * 2);
        PIDIntegral = constrain(PIDIntegral, -iTerm, iTerm);

        // overwrite iTerm with real value
        iTerm = PIDIntegral * m_config->m_iGain;
    }

    if (targetRPM == 0)
    {
        PIDOutput = 0;
    }
    else
    {
        PIDOutput = (openLoopThrottle) + m_config->m_pGain * PIDError + iTerm;
    }

    PIDErrorPrior = PIDError;
    esc->sendThrottle(max(0, min(maxThrottle, static_cast<int32_t>(PIDOutput))));
}

void FlywheelMotor::updateTBH(int32_t batteryVoltage_mv, flywheelState_t flywheelState,
                              int32_t maxThrottle)
{
    /*
    so slightly confusing, but we use PIDIntegral for TBH variable, and KI for gain, and PIDOutput
    for our error accumulator, which we cap at 1999. Just trying to reuse variables to save runtime
    memory
    */
    readTelemetry(motorRPM);
    motorRPM /= m_config->m_motorPolesDiv2; // convert eRPM to RPM

    // reject impossible rpm readings
    if (motorRPM * 1000 > m_config->m_motorKv * batteryVoltage_mv)
    {
        // assign to last valid filtered rpm reading
        motorRPM = motorRPMFilter;
    }
    motorRPMFilter = motorRPM;

    PIDError = targetRPM - motorRPM;

    if (signbit(PIDError) && !firstCrossing)
    {
        firstCrossing = true;
    }
    if (firstCrossing)
    {
        PIDOutput += m_config->m_iGain * PIDError; // reset PID output
    }

    if (signbit(PIDError) != signbit(PIDErrorPrior))
    {
        PIDOutput = PIDIntegral = .5 * (PIDOutput + PIDIntegral);
        PIDErrorPrior = PIDError;
    }

    if (PIDOutput > 1999)
    {
        PIDOutput = 1999; // prevent negative output and cap output
    }
    else if (PIDOutput < 0)
    {
        PIDOutput = 0;
    }
    // prevent output from being zero if non zero targetRPM since we don't want to hard brake if we
    // overshoot for heat optimization
    if ((flywheelState == STATE_ACCELERATING || flywheelState == STATE_FULLSPEED) &&
        targetRPM != 0 && PIDOutput < 1)
    {
        PIDOutput = 1;
    }
    esc->sendThrottle(max(0, min(maxThrottle, static_cast<int32_t>(PIDOutput))));
}

void FlywheelMotor::updateOpenLoop(int32_t batteryVoltage_mv, int32_t maxThrottle)
{
    readTelemetry(motorRPM);
    motorRPM /= m_config->m_motorPolesDiv2; // convert eRPM to RPM
    int32_t openLoopTarget =
        maxThrottle * targetRPM / batteryVoltage_mv * 1000 / m_config->m_motorKv;
    if (openLoopTarget < PIDOutput)
    {
        PIDOutput = openLoopTarget;
    }
    PIDOutput = constrain(PIDOutput, 0, maxThrottle);
    esc->sendThrottle(PIDOutput);
}
