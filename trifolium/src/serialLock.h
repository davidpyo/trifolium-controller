#pragma once

#include <Arduino.h>

// Both cores print on the one USB serial port. Output that has to arrive in one piece - a command's
// reply, an event line, a log line - is printed holding this lock, or the other core's output lands
// in the middle of it, and arduino-pico's SerialUSB drops bytes when both cores write at once.
//
// A log line never waits for the lock. It is kept, timestamped when logged, and printed by whoever
// releases the lock next, so nothing is lost unless the buffer fills while one reply goes out - and
// then the number lost is printed in its place.
namespace SerialLock
{
void begin();

// Blocks until this core holds the lock. A core that already holds it nests.
void hold();

// Takes the lock only if nobody holds it, this core included.
bool tryHold();

// The outermost release prints the lines kept meanwhile, then lets go.
void release();

// Prints the lines kept so far. For the holder, before a reboot that would lose them.
void printKept();

// Keeps a whole line to print at the next release.
void keep(const char* text, size_t len);
} // namespace SerialLock

struct SerialHold
{
    SerialHold() { SerialLock::hold(); }
    ~SerialHold() { SerialLock::release(); }
    SerialHold(const SerialHold&) = delete;
    SerialHold& operator=(const SerialHold&) = delete;
};
