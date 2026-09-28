#pragma once
#include <Arduino.h>
#include <api/HardwareSPI.h>

// Nothing in the firmware drives SPI; this exists because the Adafruit display stack compiles its
// SPI paths whether or not they are used.
class SPIClassRP2040 : public arduino::HardwareSPI
{
  public:
    uint8_t transfer(uint8_t data) override { return data; }
    uint16_t transfer16(uint16_t data) override { return data; }
    void transfer(void* buf, size_t count) override {}
    void transfer(const void* txbuf, void* rxbuf, size_t count) override {}
    void usingInterrupt(int interruptNumber) override {}
    void notUsingInterrupt(int interruptNumber) override {}
    void beginTransaction(SPISettings settings) override {}
    void endTransaction(void) override {}
    void attachInterrupt() override {}
    void detachInterrupt() override {}
    void begin() override {}
    void end() override {}
};

extern SPIClassRP2040 SPI;
extern SPIClassRP2040 SPI1;
