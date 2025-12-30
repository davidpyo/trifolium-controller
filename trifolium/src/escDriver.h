#include "driver.h"
#include <Arduino.h>
#include <PIO_DShot.h>
#include <RP2040_PWM.h>

class EscDriver : public Driver {
public:
    uint8_t m_pin;
    EscDriver(uint8_t escPin);
    void drive(float dutyCycle, bool reverseDirection);
    void brake();
    void coast();
    void update() override;
    bool isForward; //this is used to track if we are forward or backwards (1000 backwards, 1500 neutral, 2000 forwards)
private:
    RP2040_PWM* escSolenoidDriver;
};