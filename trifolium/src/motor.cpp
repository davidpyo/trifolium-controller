#include "motor.h"

Motor::Motor(float pTerm,float iTerm, float dTerm, int32_t motorKv, int16_t motorPolesDiv2) {
    // Initialize the motor with the given parameters
    m_pTerm = pTerm;
    m_iTerm = iTerm;
    m_dTerm = dTerm;
    m_motorKv = motorKv;
    m_motorPolesDiv2 = motorPolesDiv2;
}
