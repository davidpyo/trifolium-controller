#include "driver.h"
#include <Arduino.h>
#include <PIO_DShot.h>

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
    uint16_t throttleValue;
    BidirDShotX1 * esc;
};