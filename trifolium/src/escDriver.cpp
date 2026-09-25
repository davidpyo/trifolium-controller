#include "escDriver.h"

EscDriver::EscDriver(uint8_t escPin, uint16_t dshotRate)
{
    isForward = true;
    esc = new BidirDShotX1(escPin, dshotRate);
    throttleValue = DSHOT_CMD_MOTOR_STOP;
}

// both parameters are ignored
void EscDriver::drive(float dutyCycle, bool reverseDirection)
{
    if (isForward == true)
    {
        throttleValue = 2000;
        isForward = false;
    }
    else
    {
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

void EscDriver::update()
{
    esc->sendThrottle(throttleValue);
}