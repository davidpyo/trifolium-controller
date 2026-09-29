#pragma once
// The Pico SDK's mutex, as far as the firmware uses it, and get_core_num(). A core that finds the
// mutex taken waits by delaying, so the core holding it gets to run and let go.

#include <cstdint>

typedef struct
{
    volatile int owner; // the core holding it, -1 when free
} mutex_t;

void mutex_init(mutex_t* mtx);
bool mutex_try_enter(mutex_t* mtx, uint32_t* owner_out);
void mutex_enter_blocking(mutex_t* mtx);
void mutex_exit(mutex_t* mtx);

unsigned int get_core_num();
