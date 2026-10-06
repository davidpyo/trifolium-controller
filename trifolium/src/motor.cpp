#include "motor.h"

Motor::Motor(float pGain, float iGain, int32_t motorKv, int16_t motorPolesDiv2,
             int32_t maxSpinupVoltage_mv)
{
    // Initialize the motor with the given parameters
    m_pGain = pGain;
    m_iGain = iGain;
    m_motorKv = motorKv;
    m_motorPolesDiv2 = motorPolesDiv2;
    m_maxSpinupVoltage_mv = maxSpinupVoltage_mv;
}
