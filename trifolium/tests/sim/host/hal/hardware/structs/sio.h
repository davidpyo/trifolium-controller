#pragma once
#include <stdint.h>

typedef struct
{
    volatile uint32_t cpuid;
    volatile uint32_t gpio_in;
    volatile uint32_t gpio_hi_in;
    uint32_t _pad0;
    volatile uint32_t gpio_out;
    volatile uint32_t gpio_out_set;
    volatile uint32_t gpio_out_clr;
    volatile uint32_t gpio_out_xor;
    volatile uint32_t gpio_oe;
    volatile uint32_t gpio_oe_set;
    volatile uint32_t gpio_oe_clr;
    volatile uint32_t gpio_oe_xor;
} sio_hw_t;

// Kept in step with the fake board's pin model; writes to it are not read back.
extern sio_hw_t hal_sio;
#define sio_hw (&hal_sio)
