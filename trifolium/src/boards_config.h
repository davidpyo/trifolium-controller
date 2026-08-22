#pragma once
#include "types.h"
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// when creating a new board config, set unused pins to PIN_NOT_USED
//  for FET_DRIVER, set drvEN to the fet pin
//  for ESC_DRIVER, set drvEN to the esc pin
//  depending on I2C pins

// Copies `base` and applies `modify` to the copy.
template <typename F> constexpr boards_t derive(boards_t base, F modify)
{
    modify(base);
    return base;
}

const boards_t trifolium_v1_2_fet_driver = {
    .boardName = "Trifolium v1.2 FET",
    .pusherDriverType = FET_DRIVER,
    .esc1 = 0,
    .esc2 = 1,
    .esc3 = 2,
    .esc4 = 3,
    .telem = 4,
    .I2C_SCL = 15,
    .I2C_SDA = 14,
    .I2C_HW_BLK = i2c1,
    .IO2 = 18,
    .IO5 = 19,
    .IO6 = 20,
    .IO1 = 21,
    .IO3 = 9,
    .IO4 = 10,
    .batteryADC = 28,
    .escADC = 26,
    .drvADC = PIN_NOT_USED,
    .drvNSLEEP = PIN_NOT_USED,
    .drvEN = 24,
    .drvPH = PIN_NOT_USED,
    .drvMOSI = PIN_NOT_USED,
    .drvMISO = PIN_NOT_USED,
    .drvNSCS = PIN_NOT_USED,
    .drvSCLK = PIN_NOT_USED,
    .LED_DATA = PIN_NOT_USED,
    .ESC_ENABLE = PIN_NOT_USED,
};

// v1.3/v1.4 are pin-identical to v1.2 - same pin values, distinct boardName only.
const boards_t trifolium_v1_4_fet_driver =
    derive(trifolium_v1_2_fet_driver, [](boards_t& b) { b.boardName = "Trifolium v1.4 FET"; });
const boards_t trifolium_v1_3_fet_driver =
    derive(trifolium_v1_2_fet_driver, [](boards_t& b) { b.boardName = "Trifolium v1.3 FET"; });

// v1.1 moved drvEN off pin 24, onto 27.
const boards_t trifolium_v1_1_fet_driver = derive(trifolium_v1_2_fet_driver,
                                                  [](boards_t& b)
                                                  {
                                                      b.boardName = "Trifolium v1.1 FET";
                                                      b.drvEN = 27;
                                                  });

// v1.0 had no telem line, battery ADC, or ESC current-sense ADC wired.
const boards_t trifolium_v1_0_fet_driver = derive(trifolium_v1_1_fet_driver,
                                                  [](boards_t& b)
                                                  {
                                                      b.boardName = "Trifolium v1.0 FET";
                                                      b.telem = PIN_NOT_USED;
                                                      b.batteryADC = PIN_NOT_USED;
                                                      b.escADC = PIN_NOT_USED;
                                                  });

// Same PCB as v1.2 FET - wired for an ESC-based pusher driver instead of a FET one, on drvEN=2
// rather than 24.
const boards_t trifolium_v1_2_esc_driver = derive(trifolium_v1_2_fet_driver,
                                                  [](boards_t& b)
                                                  {
                                                      b.boardName = "Trifolium v1.2 ESC";
                                                      b.pusherDriverType = ESC_DRIVER;
                                                      b.drvEN = 2;
                                                  });

// Pin-identical to v1.2 ESC - boardName only.
const boards_t trifolium_v1_1_esc_driver =
    derive(trifolium_v1_2_esc_driver, [](boards_t& b) { b.boardName = "Trifolium v1.1 ESC"; });

// Same v1.0 change as the FET variant above: no telem line, battery ADC, or ESC current-sense ADC.
const boards_t trifolium_v1_0_esc_driver = derive(trifolium_v1_1_esc_driver,
                                                  [](boards_t& b)
                                                  {
                                                      b.boardName = "Trifolium v1.0 ESC";
                                                      b.telem = PIN_NOT_USED;
                                                      b.batteryADC = PIN_NOT_USED;
                                                      b.escADC = PIN_NOT_USED;
                                                  });

const boards_t pico_zero_diana = {
    .boardName = "Pico Zero Diana",
    .pusherDriverType = FET_DRIVER,
    .esc1 = 0,
    .esc2 = 1,
    .esc3 = 2,
    .esc4 = 3,
    .telem = PIN_NOT_USED,
    .I2C_SCL = 5,
    .I2C_SDA = 4,
    .I2C_HW_BLK = i2c0,
    .IO2 = 4,
    .IO5 = 8,
    .IO6 = 6,
    .IO1 = 3,
    .IO3 = 5,
    .IO4 = 12,
    .batteryADC = PIN_NOT_USED,
    .escADC = PIN_NOT_USED,
    .drvADC = PIN_NOT_USED,
    .drvNSLEEP = PIN_NOT_USED,
    .drvEN = 11,
    .drvPH = PIN_NOT_USED,
    .drvMOSI = PIN_NOT_USED,
    .drvMISO = PIN_NOT_USED,
    .drvNSCS = PIN_NOT_USED,
    .drvSCLK = PIN_NOT_USED,
    .LED_DATA = 24,
    .ESC_ENABLE = PIN_NOT_USED,
};

const boards_t pico_zero = {
    .boardName = "Pico Zero",
    .pusherDriverType = FET_DRIVER,
    .esc1 = 0,
    .esc2 = 1,
    .esc3 = 2,
    .esc4 = 3,
    .telem = PIN_NOT_USED,
    .I2C_SCL = 5,
    .I2C_SDA = 4,
    .I2C_HW_BLK = i2c0,
    .IO2 = 7,
    .IO5 = 8,
    .IO6 = 9,
    .IO1 = 10,
    .IO3 = 11,
    .IO4 = 12,
    .batteryADC = 26,
    .escADC = 27,
    .drvADC = 28,
    .drvNSLEEP = 16,
    .drvEN = 17,
    .drvPH = 18,
    .drvMOSI = 19,
    .drvMISO = 20,
    .drvNSCS = 21,
    .drvSCLK = 22,
    .LED_DATA = 24,
    .ESC_ENABLE = 25,
};

// Diana build - 2 motors only, no display/I2C/telem line, status LED on LED_DATA.
const boards_t diana_v1_0 = {
    .boardName = "Diana v1.0",
    .pusherDriverType = FET_DRIVER,
    .esc1 = 1,
    .esc2 = 2,
    .esc3 = PIN_NOT_USED,
    .esc4 = PIN_NOT_USED,
    .telem = PIN_NOT_USED,
    .I2C_SCL = PIN_NOT_USED,
    .I2C_SDA = PIN_NOT_USED,
    .I2C_HW_BLK = i2c0,
    .IO2 = 7,
    .IO5 = 5,
    .IO6 = PIN_NOT_USED,
    .IO1 = 6,
    .IO3 = 3,
    .IO4 = 4,
    .batteryADC = 28,
    .escADC = PIN_NOT_USED,
    .drvADC = PIN_NOT_USED,
    .drvNSLEEP = PIN_NOT_USED,
    .drvEN = 0,
    .drvPH = PIN_NOT_USED,
    .drvMOSI = PIN_NOT_USED,
    .drvMISO = PIN_NOT_USED,
    .drvNSCS = PIN_NOT_USED,
    .drvSCLK = PIN_NOT_USED,
    .LED_DATA = 27,
    .ESC_ENABLE = PIN_NOT_USED,
};

const boards_t rune_0_2 = {
    .boardName = "Rune 0.2",
    .pusherDriverType = DRV_DRIVER,
    .esc1 = 0,
    .esc2 = 1,
    .esc3 = 2,
    .esc4 = 3,
    .telem = 4,
    .I2C_SCL = 5,
    .I2C_SDA = 6,
    .I2C_HW_BLK = i2c0, // rune i2c messed up
    .IO2 = 7,
    .IO5 = 8,
    .IO6 = 9,
    .IO1 = 10,
    .IO3 = 11,
    .IO4 = 12,
    .batteryADC = 26,
    .escADC = 27,
    .drvADC = 28,
    .drvNSLEEP = 16,
    .drvEN = 17,
    .drvPH = 18,
    .drvMOSI = 19,
    .drvMISO = 20,
    .drvNSCS = 21,
    .drvSCLK = 22,
    .LED_DATA = 24,
    .ESC_ENABLE = 25,
};
