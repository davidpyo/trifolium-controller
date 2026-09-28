#pragma once
#include <stdint.h>
#include "hardware/gpio.h"

#define PADS_BANK0_GPIO0_OD_BITS 0x00000080u
#define PADS_BANK0_GPIO0_IE_BITS 0x00000040u
#define PADS_BANK0_GPIO0_PUE_BITS 0x00000008u
#define PADS_BANK0_GPIO0_PDE_BITS 0x00000004u

typedef struct
{
    volatile uint32_t voltage_select;
    volatile uint32_t io[NUM_BANK0_GPIOS];
} pads_bank0_hw_t;

// Kept in step with the fake board's pin model.
extern pads_bank0_hw_t hal_padsbank0;
#define padsbank0_hw (&hal_padsbank0)
