#pragma once
// Between the fake board's files; tests use hal.h and machine.h.

#include <cstdint>

namespace hal::detail
{
uint64_t now_us();
void resetClock();
void setTickPerRead_us(uint32_t us);

// delay() and delayMicroseconds(): parks a running core until then, or just moves the clock.
void sleep_us(uint64_t us);

// millis() and micros(): the read itself takes a tick, which may make another participant due.
void onClockRead();

// Time that passes with both cores stopped - a flash write, which parks the other core and masks
// interrupts. The caller keeps running afterwards; nobody else ran meanwhile.
void stall_us(uint64_t us);

// Time the calling core spends while the other keeps running - USB output going out - so a core
// that is due meanwhile gets to run before the caller carries on.
void spend_us(uint64_t us);

// 0 or 1 for the core calling, -1 from the test's side.
int currentCore();

// A power cut noticed where hal::PowerLoss cannot be thrown - a destructor. The running core
// throws it at its next clock read or delay instead.
void powerLost();

// Advances the clock from the test's side, outside any core.
void advance_us(uint64_t us);

bool machineRunning();

// Counts what the calling thread allocates as the firmware's - called by each core as it starts.
void heapCountThisThread(int core, bool counting = true);

// Held by a fake while it allocates for itself on the calling core, so its bookkeeping is not
// counted as the firmware's heap.
struct FakesOwnHeap
{
    FakesOwnHeap();
    ~FakesOwnHeap();
    FakesOwnHeap(const FakesOwnHeap&) = delete;
    FakesOwnHeap& operator=(const FakesOwnHeap&) = delete;
};
} // namespace hal::detail
