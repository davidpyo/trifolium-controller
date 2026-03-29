#include "Arduino.h"
#pragma once

class Motor {
public:
    Motor( float pTerm, float iTerm, float dTerm);
    float m_iTerm;
    float m_pTerm;
    float m_dTerm;
private:
};