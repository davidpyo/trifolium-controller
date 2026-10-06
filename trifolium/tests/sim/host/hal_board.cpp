// The fake board: time, pins, USB serial, reboot, and the register views gpioReport.cpp reads.

#include "hal/detail.h"
#include "hal/hal.h"

#include <PIO_DShot.h>
#include <Wire.h>
#include <hardware/clocks.h>
#include <hardware/gpio.h>
#include <hardware/structs/padsbank0.h>
#include <hardware/structs/sio.h>

#include <cmath>
#include <deque>

pads_bank0_hw_t hal_padsbank0;
sio_hw_t hal_sio;

SerialUSB Serial;
RP2040 rp2040;

namespace
{
constexpr uint32_t kDefaultSysClock_hz = 133000000;
constexpr uint64_t kUsbByte_us = 1; // full-speed USB CDC, about 1 MB/s with the host reading

struct Pin
{
    bool modeSet = false;
    PinMode mode = INPUT;
    bool out = false;
    uint8_t fn = GPIO_FUNC_NULL;
    bool pullUp = false;
    bool pullDown = true; // the RP2040's reset state
};

struct World
{
    int drive[hal::kPinCount];
    int analog[hal::kPinCount];
    bool analogRises[hal::kPinCount];
    uint64_t analogRiseTau_us = 0;
    uint64_t analogRiseCharged_us = 0;
    std::map<uint8_t, bool> i2cDevices;
    bool hostConnected = true;

    void reset()
    {
        for (uint8_t i = 0; i < hal::kPinCount; i++)
        {
            drive[i] = -1;
            analog[i] = 0;
            analogRises[i] = false;
        }
        analogRiseTau_us = analogRiseCharged_us = 0;
        i2cDevices.clear();
        hostConnected = true;
    }
};

struct Chip
{
    Pin pins[hal::kPinCount];
    uint32_t pinModeCalls = 0;
    int interruptsOff = 0;
    uint32_t sysClock_hz = kDefaultSysClock_hz;
    std::deque<uint8_t> rx;
    std::string tx;
    std::vector<hal::I2cWrite> i2cWrites;
    hal::Passthrough passthrough;
};

World world;
Chip chip;
hal::Flash flashStore;
std::function<void(uint8_t, bool)> writeHook;
std::function<int(uint8_t)> inputHook;
std::function<void(const hal::I2cWrite&)> i2cHook;
uint64_t i2cCount = 0;

bool validPin(uint8_t pin)
{
    return pin < hal::kPinCount;
}

bool readLevel(uint8_t pin)
{
    if (!validPin(pin))
        return false;
    if (world.drive[pin] >= 0)
        return world.drive[pin] != 0;
    if (inputHook)
    {
        const int level = inputHook(pin);
        if (level >= 0)
            return level != 0;
    }
    const Pin& p = chip.pins[pin];
    if (p.fn == GPIO_FUNC_SIO && p.modeSet && p.mode == OUTPUT)
        return p.out;
    if (p.pullUp)
        return true;
    return false;
}

void syncRegisters(uint8_t pin)
{
    const Pin& p = chip.pins[pin];
    uint32_t pad = PADS_BANK0_GPIO0_IE_BITS;
    if (p.pullUp)
        pad |= PADS_BANK0_GPIO0_PUE_BITS;
    if (p.pullDown)
        pad |= PADS_BANK0_GPIO0_PDE_BITS;
    hal_padsbank0.io[pin] = pad;

    const uint32_t bit = 1u << pin;
    const bool oe = p.fn == GPIO_FUNC_SIO && p.modeSet && p.mode == OUTPUT;
    hal_sio.gpio_oe = oe ? (hal_sio.gpio_oe | bit) : (hal_sio.gpio_oe & ~bit);
    hal_sio.gpio_out = p.out ? (hal_sio.gpio_out | bit) : (hal_sio.gpio_out & ~bit);
    hal_sio.gpio_in = readLevel(pin) ? (hal_sio.gpio_in | bit) : (hal_sio.gpio_in & ~bit);
}

void syncAllRegisters()
{
    for (uint8_t i = 0; i < hal::kPinCount; i++)
        syncRegisters(i);
}

// Not hal::powerOn(): Wire and the DShot instance list live in other translation units, which may
// not be constructed yet. A default Chip already is the power-on state.
struct Init
{
    Init()
    {
        world.reset();
        syncAllRegisters();
    }
} init;
} // namespace

namespace hal
{
void powerOn()
{
    chip = Chip{};
    detail::resetClock();
    flashStore.mounted = false;
    flashStore.powerCut = false;
    Wire.hostReset();
    Wire1.hostReset();
    BidirDShotX1::instances.clear();
    syncAllRegisters();
}

void resetWorld()
{
    world.reset();
    syncAllRegisters();
}

uint64_t now_us()
{
    return detail::now_us();
}

void advance_us(uint64_t us)
{
    detail::advance_us(us);
}

void setTickPerRead_us(uint32_t us)
{
    detail::setTickPerRead_us(us);
}

void drive(uint8_t pin, bool level)
{
    if (!validPin(pin))
        return;
    world.drive[pin] = level ? 1 : 0;
    syncRegisters(pin);
}

void release(uint8_t pin)
{
    if (!validPin(pin))
        return;
    world.drive[pin] = -1;
    syncRegisters(pin);
}

bool level(uint8_t pin)
{
    return readLevel(pin);
}

bool modeSet(uint8_t pin)
{
    return validPin(pin) && chip.pins[pin].modeSet;
}

PinMode mode(uint8_t pin)
{
    return validPin(pin) ? chip.pins[pin].mode : INPUT;
}

bool isOutput(uint8_t pin)
{
    return modeSet(pin) && chip.pins[pin].mode == OUTPUT && chip.pins[pin].fn == GPIO_FUNC_SIO;
}

bool outputLevel(uint8_t pin)
{
    return validPin(pin) && chip.pins[pin].out;
}

uint32_t pinModeCalls()
{
    return chip.pinModeCalls;
}

void setAnalog(uint8_t pin, int raw, bool rises)
{
    if (!validPin(pin))
        return;
    world.analog[pin] = raw;
    world.analogRises[pin] = rises;
}

bool analogRises(uint8_t pin)
{
    return validPin(pin) && world.analogRises[pin];
}

void setAnalogRise(uint64_t tau_us, uint64_t charged_us)
{
    world.analogRiseTau_us = tau_us;
    world.analogRiseCharged_us = charged_us;
}

int interruptsDisabledDepth()
{
    return chip.interruptsOff;
}

void setPinFunction(uint8_t pin, uint8_t gpioFunction)
{
    if (!validPin(pin))
        return;
    chip.pins[pin].fn = gpioFunction;
    syncRegisters(pin);
}

void setWriteHook(std::function<void(uint8_t pin, bool level)> hook)
{
    writeHook = std::move(hook);
}

void setInputHook(std::function<int(uint8_t pin)> hook)
{
    inputHook = std::move(hook);
}

void serialWrite(const std::string& bytes)
{
    for (char c : bytes)
        chip.rx.push_back((uint8_t)c);
}

std::string serialRead()
{
    std::string out;
    out.swap(chip.tx);
    return out;
}

void setHostConnected(bool connected)
{
    world.hostConnected = connected;
}

void setI2cDevice(uint8_t address, bool present)
{
    world.i2cDevices[address] = present;
}

bool i2cDevicePresent(uint8_t address)
{
    auto it = world.i2cDevices.find(address);
    return it != world.i2cDevices.end() && it->second;
}

std::vector<I2cWrite>& i2cWrites()
{
    return chip.i2cWrites;
}

uint64_t i2cWriteCount()
{
    return i2cCount;
}

void setI2cHook(std::function<void(const I2cWrite&)> hook)
{
    i2cHook = std::move(hook);
}

void recordI2cWrite(I2cWrite w)
{
    const hal::detail::FakesOwnHeap fakes;
    if (i2cHook && w.acked)
        i2cHook(w);
    constexpr size_t kKeep = 4096;
    if (chip.i2cWrites.size() >= kKeep)
        chip.i2cWrites.erase(chip.i2cWrites.begin(), chip.i2cWrites.begin() + kKeep / 2);
    chip.i2cWrites.push_back(std::move(w));
    i2cCount++;
}

void setSysClock_hz(uint32_t hz)
{
    chip.sysClock_hz = hz;
}

Passthrough& passthrough()
{
    return chip.passthrough;
}

Flash& flash()
{
    return flashStore;
}
} // namespace hal

// ---- Arduino core ------------------------------------------------------------------------------

extern "C" {
unsigned long millis(void)
{
    hal::detail::onClockRead();
    return (unsigned long)(hal::detail::now_us() / 1000);
}

unsigned long micros(void)
{
    hal::detail::onClockRead();
    return (unsigned long)hal::detail::now_us();
}

void delay(unsigned long ms)
{
    hal::detail::sleep_us((uint64_t)ms * 1000);
}

void delayMicroseconds(unsigned int us)
{
    hal::detail::sleep_us(us);
}

void yield(void) {}

void interrupts()
{
    if (chip.interruptsOff > 0)
        chip.interruptsOff--;
}

void noInterrupts()
{
    chip.interruptsOff++;
}

void pinMode(pin_size_t pin, PinMode mode)
{
    chip.pinModeCalls++;
    if (!validPin(pin))
        return;
    Pin& p = chip.pins[pin];
    p.modeSet = true;
    p.mode = mode;
    p.fn = GPIO_FUNC_SIO;
    p.pullUp = mode == INPUT_PULLUP;
    p.pullDown = mode == INPUT_PULLDOWN;
    syncRegisters(pin);
}

void digitalWrite(pin_size_t pin, PinStatus status)
{
    if (!validPin(pin))
        return;
    chip.pins[pin].out = status != LOW;
    syncRegisters(pin);
    if (writeHook)
    {
        const hal::detail::FakesOwnHeap fakes;
        writeHook(pin, status != LOW);
    }
}

PinStatus digitalRead(pin_size_t pin)
{
    return readLevel(pin) ? HIGH : LOW;
}

int analogRead(pin_size_t pin)
{
    if (pin < 26 || pin > 29)
        return 0;
    Pin& p = chip.pins[pin];
    p.fn = GPIO_FUNC_NULL;
    p.pullUp = p.pullDown = false;
    syncRegisters(pin);
    if (!world.analogRiseTau_us || !world.analogRises[pin])
        return world.analog[pin];
    const double t = (double)(world.analogRiseCharged_us + hal::now_us()) / world.analogRiseTau_us;
    return (int)(world.analog[pin] * (1.0 - std::exp(-t)));
}

void analogReadResolution(int bits) {}
void analogWrite(pin_size_t pin, int value) {}
void analogReference(uint8_t mode) {}
}

uint32_t clock_get_hz(enum clock_index clk_index)
{
    return clk_index == clk_sys ? chip.sysClock_hz : 0;
}

enum gpio_function gpio_get_function(uint gpio)
{
    return validPin(gpio) ? (enum gpio_function)chip.pins[gpio].fn : GPIO_FUNC_NULL;
}

bool gpio_get(uint gpio)
{
    return readLevel(gpio);
}

// ---- USB serial --------------------------------------------------------------------------------

void SerialUSB::begin(unsigned long) {}
void SerialUSB::begin(unsigned long, uint16_t) {}
void SerialUSB::end() {}

int SerialUSB::available()
{
    return (int)chip.rx.size();
}

int SerialUSB::peek()
{
    return chip.rx.empty() ? -1 : chip.rx.front();
}

int SerialUSB::read()
{
    if (chip.rx.empty())
        return -1;
    const uint8_t c = chip.rx.front();
    chip.rx.pop_front();
    return c;
}

int SerialUSB::availableForWrite()
{
    return 256;
}

void SerialUSB::flush() {}

// Output going out takes the writing core time, and the other core keeps running meanwhile - so,
// as on the chip, two cores printing at once interleave between their writes.
static void sendTime(size_t bytes)
{
    if (world.hostConnected)
        hal::detail::spend_us(bytes * kUsbByte_us);
}

size_t SerialUSB::write(uint8_t c)
{
    {
        const hal::detail::FakesOwnHeap fakes;
        chip.tx.push_back((char)c);
    }
    sendTime(1);
    return 1;
}

size_t SerialUSB::write(const uint8_t* p, size_t len)
{
    {
        const hal::detail::FakesOwnHeap fakes;
        chip.tx.append((const char*)p, len);
    }
    sendTime(len);
    return len;
}

SerialUSB::operator bool()
{
    return world.hostConnected;
}

bool SerialUSB::dtr()
{
    return world.hostConnected;
}

bool SerialUSB::rts()
{
    return world.hostConnected;
}

void SerialUSB::ignoreFlowControl(bool) {}

// ---- rp2040 ------------------------------------------------------------------------------------

void RP2040::reboot()
{
    throw hal::Reboot{false};
}

void RP2040::rebootToBootloader()
{
    throw hal::Reboot{true};
}

void RP2040::idleOtherCore() {}
void RP2040::resumeOtherCore() {}
