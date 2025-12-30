#include "escDriver.h"

EscDriver::EscDriver(uint8_t escPin)
{
    m_pin = escPin;
    isForward = true; 
    pinMode(m_pin, OUTPUT);
    escSolenoidDriver = new RP2040_PWM(m_pin, 490, 73.5);
    escSolenoidDriver->setPWM(m_pin, 490, 73.5);
}

// both parameters are ignored
void EscDriver::drive(float dutyCycle, bool reverseDirection)
{
    if(isForward == true){
        escSolenoidDriver->setPWM(m_pin, 490, 97.5);
        isForward = false;
    } else {
        escSolenoidDriver->setPWM(m_pin, 490, 49.5);
        isForward = true;
    }
}

void EscDriver::coast()
{
    escSolenoidDriver->setPWM(m_pin, 490, 73.5);
}

// cannot actually brake with only 1 FET, coast instead
void EscDriver::brake()
{
    escSolenoidDriver->setPWM(m_pin, 490, 73.5);
}
