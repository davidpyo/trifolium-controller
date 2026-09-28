#pragma once
#include <Arduino.h>
#include "api/HardwareI2C.h"

#include <vector>

#define WIRE_HAS_END 1
#define WIRE_HAS_BUFFER_SIZE 1
#ifndef WIRE_BUFFER_SIZE
#define WIRE_BUFFER_SIZE 256
#endif

// arduino-pico's TwoWire, as far as the firmware and the Adafruit display stack reach into it. The
// bus itself is hal::setI2cDevice()/hal::i2cWrites().
class TwoWire : public HardwareI2C
{
  public:
    explicit TwoWire(uint8_t bus) : bus_(bus) {}

    void begin() override;
    void begin(uint8_t address) override;
    void end() override;

    bool setSDA(pin_size_t sda);
    bool setSCL(pin_size_t scl);

    void setClock(uint32_t freqHz) override;

    void beginTransmission(uint8_t address) override;
    uint8_t endTransmission(bool stopBit) override;
    uint8_t endTransmission(void) override;

    size_t requestFrom(uint8_t address, size_t quantity, bool stopBit) override;
    size_t requestFrom(uint8_t address, size_t quantity) override;

    size_t write(uint8_t data) override;
    size_t write(const uint8_t* data, size_t quantity) override;

    int available(void) override;
    int read(void) override;
    int peek(void) override;
    void flush(void) override;
    void onReceive(void (*)(int)) override;
    void onRequest(void (*)(void)) override;

    inline size_t write(unsigned long n) { return write((uint8_t)n); }
    inline size_t write(long n) { return write((uint8_t)n); }
    inline size_t write(unsigned int n) { return write((uint8_t)n); }
    inline size_t write(int n) { return write((uint8_t)n); }
    using Print::write;

    void setTimeout(uint32_t timeout = 25, bool reset_with_timeout = false);
    bool getTimeoutFlag(void) { return false; }
    void clearTimeoutFlag(void) {}
    size_t setBufferSize(size_t bSize) { return bSize; }

    // Host side: what setSDA/setSCL were given, and whether begin() ran.
    pin_size_t sda() const { return sda_; }
    pin_size_t scl() const { return scl_; }
    bool running() const { return running_; }
    void hostReset();

  private:
    uint8_t bus_;
    pin_size_t sda_ = 0xff;
    pin_size_t scl_ = 0xff;
    bool running_ = false;
    uint8_t address_ = 0;
    bool txBegun_ = false;
    std::vector<uint8_t> tx_;
};

extern TwoWire Wire;
extern TwoWire Wire1;
