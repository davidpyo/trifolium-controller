#pragma once
// The fake board's controls: what a test uses to stand in for the hardware around the firmware.

#include <Arduino.h>

#include <cstdint>
#include <functional>
#include <map>
#include <string>
#include <vector>

namespace hal
{
// What rp2040.reboot() and rebootToBootloader() throw, so the firmware code that asked for a reboot
// stops there the way it does on a real board.
struct Reboot
{
    bool toBootloader;
};

// What the core's panic() throws - the fakes raise it wherever arduino-pico would panic, such as
// Wire.setSDA() on a pin its block cannot use.
struct Panic
{
    std::string message;
};

// The power going away mid-run - see Flash::cutPowerBeforeWrite.
struct PowerLoss
{
};

// The chip back to its power-on state: clock, pin modes and outputs, serial buffers, I2C buses, ESC
// channels, sys clock. The world outside it survives, as it would a real power cycle - a switch
// held through a reboot is still held, and flash keeps its files.
void powerOn();

// The world outside the chip back to nothing: no switch held, no analog input, no I2C device, a
// host attached. Flash is separate - flash().clear().
void resetWorld();

// ---- time ------------------------------------------------------------------------------------

uint64_t now_us();
void advance_us(uint64_t us);

// How far each millis()/micros() read moves the clock, so a firmware loop that polls the clock for
// a timeout still reaches it. 0 stops time between delay() calls.
void setTickPerRead_us(uint32_t us);

// ---- GPIO --------------------------------------------------------------------------------------

constexpr uint8_t kPinCount = 30;

// Something outside the chip holding the pin at `level` - a switch to ground is drive(pin, LOW).
void drive(uint8_t pin, bool level);
void release(uint8_t pin);

// What digitalRead() would return right now.
bool level(uint8_t pin);

bool modeSet(uint8_t pin);
PinMode mode(uint8_t pin);
bool isOutput(uint8_t pin);
bool outputLevel(uint8_t pin);

// Every pinMode() call since powerOn(), on any pin, valid or not.
uint32_t pinModeCalls();

// The raw 10-bit reading analogRead() returns for the pin.
void setAnalog(uint8_t pin, int raw);

// Every analog reading climbing toward its setAnalog() value from power-on, first order with time
// constant `tau_us`, `charged_us` of it already done when this boot's clock started. 0 reads the
// value at once.
void setAnalogRise(uint64_t tau_us, uint64_t charged_us);

// Nesting depth of noInterrupts(); 0 when interrupts are on.
int interruptsDisabledDepth();

// For the fakes of peripherals that claim a pin - DShot, I2C - so gpio_get_function() reports
// what they did.
void setPinFunction(uint8_t pin, uint8_t gpioFunction);

// Called after every digitalWrite() takes effect - how a test watches an output such as the pusher
// gate. Survives powerOn(); pass nullptr to clear.
void setWriteHook(std::function<void(uint8_t pin, bool level)> hook);

// ---- USB serial --------------------------------------------------------------------------------

// Host to device: queued for Serial.read().
void serialWrite(const std::string& bytes);

// Device to host: everything written since the last call.
std::string serialRead();

// `if (Serial)` - true while a host holds the port open.
void setHostConnected(bool connected);

// ---- I2C ---------------------------------------------------------------------------------------

// A device at `address` ACKs; nothing else does.
void setI2cDevice(uint8_t address, bool present);
bool i2cDevicePresent(uint8_t address);

struct I2cWrite
{
    uint8_t bus; // 0 for Wire, 1 for Wire1
    uint8_t address;
    std::vector<uint8_t> bytes;
    bool acked;
};

// The most recent transactions, oldest first - the log keeps its last few thousand.
std::vector<I2cWrite>& i2cWrites();
uint64_t i2cWriteCount();
void recordI2cWrite(I2cWrite w); // for the Wire fake

// Called with every completed transaction to a present device - how a panel model listens to the
// bus. Survives powerOn(); pass nullptr to clear.
void setI2cHook(std::function<void(const I2cWrite&)> hook);

// ---- clocks ------------------------------------------------------------------------------------

void setSysClock_hz(uint32_t hz);

// ---- ESC passthrough ---------------------------------------------------------------------------

struct Passthrough
{
    bool active = false;
    std::vector<uint8_t> pins;
    // processPassthrough() returns nonzero this many more times, then 0 - the host closing the port.
    uint32_t ticksLeft = 0;
    uint32_t sessions = 0;
    // The library runs the session at 132 MHz and restores the clock it found, best effort.
    uint32_t clockBefore_hz = 0;
    uint32_t clockDuring_hz = 0;
    bool restoreFails = false;
};
Passthrough& passthrough();

// ---- heap --------------------------------------------------------------------------------------

// What the firmware's cores hold on the heap, in the blocks newlib would give the same requests.
// The PC is 64-bit, so anything holding a pointer asks for more here than on the RP2040. Past
// `limit` an allocation fails, as it does on the device.
struct Heap
{
    uint64_t live;
    uint64_t peak; // since the last resetHeapPeak()
    uint64_t allocations;
    uint64_t refused;
    uint64_t limit;
    bool untracked; // more live blocks than the count has room for; the numbers are low
};
Heap heap();
void resetHeapPeak();

// 0 puts back the RP2040's.
void setHeapLimit(uint64_t bytes);

// ---- flash -------------------------------------------------------------------------------------

struct Flash
{
    std::map<std::string, std::string> files;
    bool mounted = false;
    bool formatted = false; // set by LittleFS.format(), for a test asserting a fresh filesystem
    uint32_t writesCommitted = 0;

    // Every change to flash - a closed write, a remove, a rename, a format - is one write, atomic
    // as LittleFS makes each one. Writes are counted from 1; set this to N and the power goes as
    // write N is about to land, which never does.
    uint32_t writes = 0;
    uint32_t cutPowerBeforeWrite = 0;
    bool powerCut = false; // write N was cut; nothing lands until the next power on

    void clear()
    {
        files.clear();
        mounted = false;
        formatted = false;
        writesCommitted = 0;
        writes = 0;
        cutPowerBeforeWrite = 0;
        powerCut = false;
    }
};
Flash& flash();
} // namespace hal
