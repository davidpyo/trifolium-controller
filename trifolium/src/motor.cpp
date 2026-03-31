#include "motor.h"

Motor::Motor(float pGain,float iGain, float dGain, int32_t motorKv, int16_t motorPolesDiv2) {
    // Initialize the motor with the given parameters
    m_pGain = pGain;
    m_iGain = iGain;
    m_dGain = dGain;
    m_motorKv = motorKv;
    m_motorPolesDiv2 = motorPolesDiv2;
}
