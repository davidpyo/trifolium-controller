#include "fetDriver.h"

Fet::Fet(uint8_t fetPin)
{
    m_pin = fetPin;
    pinMode(m_pin, OUTPUT);
    digitalWrite(m_pin, LOW); // gate off before anything can call drive()
}

// both parameters are ignored
void Fet::drive(float dutyCycle, bool reverseDirection)
{
    digitalWrite(m_pin, HIGH);
}

void Fet::coast()
{
    digitalWrite(m_pin, LOW);
}