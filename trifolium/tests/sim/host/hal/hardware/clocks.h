#pragma once
#include <stdint.h>

enum clock_index
{
    clk_gpout0 = 0,
    clk_gpout1,
    clk_gpout2,
    clk_gpout3,
    clk_ref,
    clk_sys,
    clk_peri,
    clk_usb,
    clk_adc,
    clk_rtc,
    CLK_COUNT
};

// clk_sys is hal::setSysClock_hz(); the rest report 0.
uint32_t clock_get_hz(enum clock_index clk_index);
