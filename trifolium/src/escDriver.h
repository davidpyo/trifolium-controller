#include "driver.h"
#include <Arduino.h>
#include <PIO_DShot.h>

class EscDriver : public Driver
{
  public:
    // Takes the DShot rate rather than assuming one: the pusher shares the bus discipline of the
    // flywheel ESCs, so it has to run at the rate deviceSettings.dshotMode selected for them.
    EscDriver(uint8_t escPin, uint16_t dshotRate);
    void drive(float dutyCycle, bool reverseDirection);
    void coast();
    void update() override;
    bool isForward; // this is used to track if we are forward or backwards (1000 backwards, 1500
                    // neutral, 2000 forwards)
  private:
    uint16_t throttleValue;
    BidirDShotX1* esc;
};