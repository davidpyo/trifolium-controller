#pragma once
// rp2040-passthrough's entry points over hal::passthrough().
#include <Arduino.h>

uint8_t processPassthrough(void);
void beginPassthrough(uint8_t* pins, uint8_t pinCount);
void beginPassthrough(uint8_t pin);
void endPassthrough();

extern uint8_t passthroughPins[8];
extern uint8_t escCount;
