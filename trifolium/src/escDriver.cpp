#include "escDriver.h"

EscDriver::EscDriver(uint8_t escPin)
{
    m_pin = escPin;
    isForward = true; 
    esc = new BidirDShotX1(escPin, 300);
    esc->sendRaw11Bit(0); //set to neutral on startup
}

// both parameters are ignored
void EscDriver::drive(float dutyCycle, bool reverseDirection)
{
    if(isForward == true){
        throttleValue = 2000;
        isForward = false;
    } else {
        throttleValue = 1000;
        isForward = true;
    }
    update();
}

void EscDriver::coast()
{
    throttleValue = 0;
    update();
}

// cannot actually brake with only 1 FET, coast instead
void EscDriver::brake()
{
    throttleValue = 0;
    update();
}

void EscDriver::update()
{
    if (throttleValue == 0){
        esc->sendRaw11Bit(0); // if throttle is 0, send 0 to stop esc signal
    } else {
        esc->sendThrottle(throttleValue);
    }
}