#include "driver.h"
#include <Arduino.h>
#include <SPI.h>


class Drv : public Driver  {
        public:
        Drv(uint8_t in1, uint8_t in2, uint8_t nsleep_pin, uint8_t mosi_pin, uint8_t miso_pin, uint8_t nscs_pin, uint8_t sclk_pin);
        void init();
        bool wake();
        void sleep();
        void drive();
        void drive(float dutyCycle, bool reverseDirection);
        void brake();
        void coast();    
    protected:
        uint8_t ph;
        uint8_t en;
        uint8_t nsleep;
        uint8_t mosi;
        uint8_t miso;
        uint8_t nscs;
        uint8_t sclk;
        int writeWord(uint8_t address, uint8_t data);
        uint16_t readWord(uint8_t address);

    
};
