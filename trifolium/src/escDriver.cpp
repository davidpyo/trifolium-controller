#include "escDriver.h"

EscDriver::EscDriver(uint8_t escPin)
{
    m_pin = escPin;
    isForward = true; 
    esc = new BidirDShotX1(escPin, 300);
    throttleValue = DSHOT_CMD_MOTOR_STOP;
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
    throttleValue = DSHOT_CMD_MOTOR_STOP;
    update();
}

// cannot actually brake with only 1 FET, coast instead
void EscDriver::brake()
{
    throttleValue = DSHOT_CMD_MOTOR_STOP;
    update();
}

void EscDriver::update()
{
    esc->sendThrottle(throttleValue);
}