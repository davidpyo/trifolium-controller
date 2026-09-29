#pragma once
// The host build's <Arduino.h>. String, Print, Stream and the Common.h declarations are
// arduino-pico's own (native_env.py); this adds what arduino-pico layers on top, backed by the fake
// board in hal.h.

#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

// api/ArduinoAPI.h less its networking headers, which want lwIP. Defining its guard keeps anything
// else from pulling them in.
#define ARDUINO_API_H
#define ARDUINO_API_VERSION 10501
#include "api/Binary.h"
#include "api/Interrupts.h"
#include "api/Print.h"
#include "api/Printable.h"
#include "api/String.h"
#include "api/Stream.h"
#include "api/WCharacter.h"
#include "api/Common.h"
#include "api/Compat.h"
#include "api/HardwareSerial.h"
#include "api/itoa.h"

// The real Arduino.h reaches both, through RP2040Support.h and directly.
#include <hardware/clocks.h>
#include <hardware/gpio.h>

#ifdef abs
#undef abs
#endif
#include <cmath>
#include <cstdlib>
using std::abs;
using std::round;

extern "C" {
void interrupts();
void noInterrupts();
void analogReadResolution(int bits);
char* dtostrf(double val, signed char width, unsigned char prec, char* s);
}

#define __uninitialized_ram(group) group

class SerialUSB : public arduino::HardwareSerial
{
  public:
    void begin(unsigned long baud = 115200) override;
    void begin(unsigned long baud, uint16_t config) override;
    void end() override;
    int available() override;
    int peek() override;
    int read() override;
    int availableForWrite() override;
    void flush() override;
    size_t write(uint8_t c) override;
    size_t write(const uint8_t* p, size_t len) override;
    using Print::write;
    operator bool() override;

    bool dtr();
    bool rts();
    void ignoreFlowControl(bool ignore = true);
};

extern SerialUSB Serial;

class RP2040
{
  public:
    // Both unwind to the test as hal::Reboot - see hal.h.
    [[noreturn]] void reboot();
    [[noreturn]] void rebootToBootloader();

    void idleOtherCore();
    void resumeOtherCore();
};

extern RP2040 rp2040;

using namespace arduino;
