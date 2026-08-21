#include "Arduino.h"
#pragma once

class Motor
{
  public:
    Motor(float pGain, float iGain, int32_t motorKv, int16_t motorPolesDiv2);
    float m_iGain;
    float m_pGain;
    int32_t m_motorKv;
    int16_t m_motorPolesDiv2;

  private:
};