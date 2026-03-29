#include "motor.h"

Motor::Motor(float pTerm,float iTerm, float dTerm) {
    // Initialize the motor with the given parameters
    m_pTerm = pTerm;
    m_iTerm = iTerm;
    m_dTerm = dTerm;
}
