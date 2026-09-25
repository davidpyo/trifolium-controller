#pragma once
#include "types.h"

// What a GPIO can physically do. A separate question from whether something else already claims it
// (pinConflicts.h) and from whether the number is a GPIO at all (PinItem::bounds()).
//
// This layer exists because the wiring is user-entered now. Every board that ever shipped had its
// pinout checked against a schematic once; a number somebody types has not been.

// ADC is GPIO 26-29: the SDK's ADC_BASE_PIN plus its four external channels. Fixed in silicon.
constexpr uint8_t ADC_FIRST_PIN = 26;
constexpr uint8_t ADC_LAST_PIN = 29;

inline bool adcPinUsable(uint8_t pin)
{
    return pin >= ADC_FIRST_PIN && pin <= ADC_LAST_PIN;
}

// A GPIO's I2C role is fixed by pin % 4 - the RP2040 datasheet's function-select table gives each
// pin exactly one: 0 = i2c0 SDA, 1 = i2c0 SCL, 2 = i2c1 SDA, 3 = i2c1 SCL.
//
// The pair, not each pin: two individually legal pins on different blocks cannot be served by
// either. setSDA/setSCL panic() outside these sets - an unrecoverable boot loop rather than a
// blank screen - so this has to be answered before either is called.
inline bool i2cPairUsable(uint8_t sda, uint8_t scl)
{
    if (sda > MAX_GPIO_PIN || scl > MAX_GPIO_PIN)
        return false;
    return (sda % 4 == 0 && scl % 4 == 1) || (sda % 4 == 2 && scl % 4 == 3);
}

// Which hardware block serves a usable pair. Only meaningful once i2cPairUsable() says yes.
inline bool i2cUsesBlock0(uint8_t sda)
{
    return sda % 4 == 0;
}
