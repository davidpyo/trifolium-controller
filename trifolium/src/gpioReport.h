#pragma once
#include <Arduino.h>

// What every GPIO is actually doing right now: peripheral function, output enable, level, pulls.
// The blaster is closed and there is no scope on it, so "the unconfigured path drives nothing"
// has to be answerable from the wire - DUMP_GPIO is that answer.
namespace GpioReport
{
void writeJson(Print& out);
} // namespace GpioReport
