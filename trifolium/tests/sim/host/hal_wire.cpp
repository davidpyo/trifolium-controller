// arduino-pico's Wire over hal::setI2cDevice(), with its pin rules and return codes.

#include "hal/detail.h"
#include "hal/hal.h"

#include <SPI.h>
#include <Wire.h>
#include <hardware/gpio.h>

TwoWire Wire(0);
TwoWire Wire1(1);
SPIClassRP2040 SPI;
SPIClassRP2040 SPI1;

namespace
{
// A GPIO's I2C role is fixed by pin % 4: 0/1 are i2c0 SDA/SCL, 2/3 are i2c1 SDA/SCL.
bool legal(uint8_t bus, pin_size_t pin, bool sda)
{
    if (pin >= hal::kPinCount)
        return false;
    return pin % 4 == (uint8_t)(bus * 2 + (sda ? 0 : 1));
}
} // namespace

void TwoWire::hostReset()
{
    sda_ = 0xff;
    scl_ = 0xff;
    running_ = false;
    address_ = 0;
    txBegun_ = false;
    tx_.clear();
}

void TwoWire::begin()
{
    running_ = true;
    if (sda_ < hal::kPinCount)
        hal::setPinFunction(sda_, GPIO_FUNC_I2C);
    if (scl_ < hal::kPinCount)
        hal::setPinFunction(scl_, GPIO_FUNC_I2C);
}

void TwoWire::begin(uint8_t) { begin(); }

void TwoWire::end()
{
    running_ = false;
}

bool TwoWire::setSDA(pin_size_t sda)
{
    if (running_)
        throw hal::Panic{"FATAL: Attempting to set Wire" + std::string(bus_ ? "1" : "") +
                         ".SDA while running"};
    if (!legal(bus_, sda, true))
        throw hal::Panic{"FATAL: Attempting to set Wire" + std::string(bus_ ? "1" : "") +
                         ".SDA to illegal pin " + std::to_string(sda)};
    sda_ = sda;
    return true;
}

bool TwoWire::setSCL(pin_size_t scl)
{
    if (running_)
        throw hal::Panic{"FATAL: Attempting to set Wire" + std::string(bus_ ? "1" : "") +
                         ".SCL while running"};
    if (!legal(bus_, scl, false))
        throw hal::Panic{"FATAL: Attempting to set Wire" + std::string(bus_ ? "1" : "") +
                         ".SCL to illegal pin " + std::to_string(scl)};
    scl_ = scl;
    return true;
}

void TwoWire::setClock(uint32_t) {}

void TwoWire::setTimeout(uint32_t, bool) {}

void TwoWire::beginTransmission(uint8_t address)
{
    address_ = address;
    txBegun_ = true;
    tx_.clear();
}

uint8_t TwoWire::endTransmission(bool)
{
    if (!running_ || !txBegun_)
        return 4;
    txBegun_ = false;
    const bool present = hal::i2cDevicePresent(address_);
    {
        const hal::detail::FakesOwnHeap fakes;
        hal::recordI2cWrite({bus_, address_, tx_, present});
    }
    const bool probe = tx_.empty();
    tx_.clear();
    if (probe)
        return present ? 0 : 2;
    return present ? 0 : 4;
}

uint8_t TwoWire::endTransmission(void)
{
    return endTransmission(true);
}

size_t TwoWire::requestFrom(uint8_t, size_t, bool)
{
    return 0;
}

size_t TwoWire::requestFrom(uint8_t address, size_t quantity)
{
    return requestFrom(address, quantity, true);
}

size_t TwoWire::write(uint8_t data)
{
    if (!running_ || !txBegun_ || tx_.size() >= WIRE_BUFFER_SIZE)
        return 0;
    const hal::detail::FakesOwnHeap fakes;
    tx_.push_back(data);
    return 1;
}

size_t TwoWire::write(const uint8_t* data, size_t quantity)
{
    for (size_t i = 0; i < quantity; ++i)
    {
        if (!write(data[i]))
            return i;
    }
    return quantity;
}

int TwoWire::available(void)
{
    return 0;
}

int TwoWire::read(void)
{
    return -1;
}

int TwoWire::peek(void)
{
    return -1;
}

void TwoWire::flush(void) {}
void TwoWire::onReceive(void (*)(int)) {}
void TwoWire::onRequest(void (*)(void)) {}
