// The Pico SDK's mutex against the fake's two cores.

#include "hal/detail.h"

#include <pico/mutex.h>

namespace
{
constexpr int kFree = -1;
constexpr int kTest = 2; // the test's side, which currentCore() calls -1

int caller()
{
    const int core = hal::detail::currentCore();
    return core < 0 ? kTest : core;
}
} // namespace

void mutex_init(mutex_t* mtx)
{
    mtx->owner = kFree;
}

bool mutex_try_enter(mutex_t* mtx, uint32_t* owner_out)
{
    if (mtx->owner == kFree)
    {
        mtx->owner = caller();
        return true;
    }
    if (owner_out)
        *owner_out = (uint32_t)mtx->owner;
    return false;
}

void mutex_enter_blocking(mutex_t* mtx)
{
    while (!mutex_try_enter(mtx, nullptr))
        hal::detail::sleep_us(1);
}

void mutex_exit(mutex_t* mtx)
{
    mtx->owner = kFree;
}

unsigned int get_core_num()
{
    const int core = hal::detail::currentCore();
    return core < 0 ? 0 : (unsigned int)core;
}
