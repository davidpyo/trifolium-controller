// arduino-pico's own String/Print/Stream and number formatting, compiled for the host, plus the
// passthrough entry points.

#include "hal/hal.h"

#include <esc_passthrough.h>
#include <hardware/clocks.h>

#include "api/Common.cpp"
#include "api/Print.cpp"
#include "api/Stream.cpp"
#include "api/String.cpp"

// The Windows CRT has its own three-argument lltoa/ulltoa. Nothing here calls the core's.
#define lltoa noniso_lltoa
#define ulltoa noniso_ulltoa
#include HAL_STDLIB_NONISO_CPP
#undef lltoa
#undef ulltoa

// newlib has utoa and the Windows CRT does not; stdlib_noniso.cpp's ultoa() calls it.
extern "C" char* utoa(unsigned value, char* string, int radix)
{
    char digits[33];
    int n = 0;
    do
    {
        const unsigned d = value % radix;
        digits[n++] = (char)(d < 10 ? '0' + d : 'a' + d - 10);
        value /= radix;
    } while (value);
    int i = 0;
    while (n)
        string[i++] = digits[--n];
    string[i] = 0;
    return string;
}

#ifndef _WIN32
// newlib and the Windows CRT have itoa and Apple's libc does not; String's constructors call it.
extern "C" char* itoa(int value, char* string, int radix)
{
    if (value < 0 && radix == 10)
    {
        string[0] = '-';
        utoa(0u - (unsigned)value, string + 1, radix);
        return string;
    }
    return utoa((unsigned)value, string, radix);
}
#endif

// cores/rp2040/WMath.cpp, whose uint32_t seed only matches Common.h's unsigned long on the RP2040.
void randomSeed(unsigned long seed)
{
    if (seed != 0)
        srand((unsigned)seed);
}

long random(long howbig)
{
    if (howbig == 0)
        return 0;
    return rand() % howbig;
}

long random(long howsmall, long howbig)
{
    if (howsmall >= howbig)
        return howsmall;
    return random(howbig - howsmall) + howsmall;
}

uint8_t passthroughPins[8];
uint8_t escCount = 0;

void beginPassthrough(uint8_t* pins, uint8_t pinCount)
{
    hal::Passthrough& pt = hal::passthrough();
    pt.active = true;
    pt.sessions++;
    pt.clockBefore_hz = clock_get_hz(clk_sys);
    hal::setSysClock_hz(132000000);
    pt.clockDuring_hz = clock_get_hz(clk_sys);
    pt.pins.assign(pins, pins + pinCount);
    escCount = pinCount;
    for (uint8_t i = 0; i < pinCount && i < 8; i++)
        passthroughPins[i] = pins[i];
}

void beginPassthrough(uint8_t pin)
{
    beginPassthrough(&pin, 1);
}

uint8_t processPassthrough(void)
{
    hal::Passthrough& pt = hal::passthrough();
    if (pt.ticksLeft == 0)
        return 0;
    pt.ticksLeft--;
    delay(1);
    return 1;
}

void endPassthrough()
{
    hal::Passthrough& pt = hal::passthrough();
    pt.active = false;
    if (!pt.restoreFails)
        hal::setSysClock_hz(pt.clockBefore_hz);
}
