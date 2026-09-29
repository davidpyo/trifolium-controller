#pragma once
#include <stdint.h>

typedef unsigned int uint;

#define NUM_BANK0_GPIOS 30

enum gpio_function
{
    GPIO_FUNC_XIP = 0,
    GPIO_FUNC_SPI = 1,
    GPIO_FUNC_UART = 2,
    GPIO_FUNC_I2C = 3,
    GPIO_FUNC_PWM = 4,
    GPIO_FUNC_SIO = 5,
    GPIO_FUNC_PIO0 = 6,
    GPIO_FUNC_PIO1 = 7,
    GPIO_FUNC_GPCK = 8,
    GPIO_FUNC_USB = 9,
    GPIO_FUNC_NULL = 0x1f,
};

// Read back from the fake board's pin model, the same one pinMode()/digitalRead() use.
enum gpio_function gpio_get_function(uint gpio);
bool gpio_get(uint gpio);
