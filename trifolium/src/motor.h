#include "Arduino.h"
#pragma once

class Motor {
public:
    Motor( float pTerm, float iTerm, float dTerm, int32_t motorKv, int16_t motorPolesDiv2);
    float m_iTerm;
    float m_pTerm;
    float m_dTerm;
    int32_t m_motorKv;
    int16_t m_motorPolesDiv2;
private:
};