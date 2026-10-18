// The heap the firmware's cores use, counted at the allocator: hal/heap_count.h points every
// source's malloc, calloc, realloc and free here, and operator new is replaced below.
// An allocation that would take the count past the RP2040's heap fails, as newlib's does.
// A thread is told apart by its id rather than a thread_local, whose first touch can allocate.

#include "hal/detail.h"
#include "hal/hal.h"

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <new>

// The C library's own, which the counted versions below hand on to.
#undef malloc
#undef calloc
#undef realloc
#undef free

#ifdef _WIN32
// Not <windows.h>, whose INPUT collides with Arduino's.
extern "C" __declspec(dllimport) unsigned long __stdcall GetCurrentThreadId(void);
#else
#include <pthread.h>
#endif

namespace
{
uint64_t threadId()
{
#ifdef _WIN32
    return GetCurrentThreadId();
#else
    return (uint64_t)pthread_self();
#endif
}

// newlib on the RP2040: a 4-byte header, rounded up to 8, and never under 16.
uint32_t chunk(size_t n)
{
    const size_t c = (n + 4 + 7) & ~(size_t)7;
    return (uint32_t)(c < 16 ? 16 : c);
}

std::atomic<uint64_t> cores[2];
int fakesHolding[2]; // each written only by its own core

int coreIndex()
{
    const uint64_t id = threadId();
    for (int core = 0; core < 2; core++)
    {
        if (id == cores[core].load(std::memory_order_relaxed))
            return core;
    }
    return -1;
}

bool onCore()
{
    const int core = coreIndex();
    return core >= 0 && fakesHolding[core] == 0;
}

// Open addressing in static storage, so keeping count never allocates.
constexpr size_t kSlots = 1 << 16;
void* const kTombstone = (void*)1;
struct Slot
{
    void* p;
    uint32_t bytes;
};
Slot table[kSlots];
std::atomic_flag lock = ATOMIC_FLAG_INIT;
// What the pico build leaves for the heap: 256 KB of SRAM less .data and .bss, 23 KB at 2.1.
constexpr uint64_t kRp2040Heap = 232 * 1024;

uint64_t live = 0, peak = 0, allocations = 0, refused = 0;
uint64_t limit = kRp2040Heap;
bool overflowed = false;

// Takes the count past the limit; counted as refused.
bool refuse(size_t n)
{
    if (live + chunk(n) <= limit)
        return false;
    refused++;
    return true;
}

struct Guard
{
    Guard()
    {
        while (lock.test_and_set(std::memory_order_acquire))
        {
        }
    }
    ~Guard() { lock.clear(std::memory_order_release); }
};

size_t home(void* p)
{
    return ((uintptr_t)p >> 4) * 0x9E3779B97F4A7C15ull >> 48;
}

void track(void* p, size_t n)
{
    const uint32_t bytes = chunk(n);
    size_t i = home(p);
    for (size_t probes = 0; probes < kSlots; probes++, i = (i + 1) & (kSlots - 1))
    {
        if (table[i].p == nullptr || table[i].p == kTombstone)
        {
            table[i] = {p, bytes};
            live += bytes;
            allocations++;
            if (live > peak)
                peak = live;
            return;
        }
    }
    overflowed = true;
}

// Its count, or 0 if it was never tracked.
uint32_t untrack(void* p)
{
    size_t i = home(p);
    for (size_t probes = 0; probes < kSlots && table[i].p; probes++, i = (i + 1) & (kSlots - 1))
    {
        if (table[i].p == p)
        {
            const uint32_t bytes = table[i].bytes;
            table[i].p = kTombstone;
            live -= bytes;
            return bytes;
        }
    }
    return 0;
}
} // namespace

extern "C"
{
void* hal_malloc(size_t n)
{
    if (!onCore())
        return malloc(n);
    Guard g;
    if (refuse(n))
        return nullptr;
    void* p = malloc(n);
    if (p)
        track(p, n);
    return p;
}

void* hal_calloc(size_t count, size_t n)
{
    if (!onCore())
        return calloc(count, n);
    Guard g;
    if (refuse(count * n))
        return nullptr;
    void* p = calloc(count, n);
    if (p)
        track(p, count * n);
    return p;
}

void* hal_realloc(void* old, size_t n)
{
    const bool counted = onCore();
    Guard g;
    const uint32_t before = old ? untrack(old) : 0;
    if (counted && n && refuse(n))
    {
        if (before)
            track(old, before - 4); // back as it was; the old block stands
        return nullptr;
    }
    void* p = realloc(old, n);
    if (!p && n)
    {
        if (before)
            track(old, before - 4);
        return p;
    }
    if (p && (before || counted))
        track(p, n);
    return p;
}

void hal_free(void* p)
{
    if (p)
    {
        Guard g;
        untrack(p);
    }
    free(p);
}
}

// Plain new and delete only: the C++ library routes its array, nothrow and sized variants through
// these two. Nothing here is over-aligned, so the align_val_t ones are left alone.
void* operator new(size_t n)
{
    void* p = hal_malloc(n ? n : 1);
    if (!p)
        throw std::bad_alloc();
    return p;
}
void operator delete(void* p) noexcept
{
    hal_free(p);
}

namespace hal
{
Heap heap()
{
    Guard g;
    return {live, peak, allocations, refused, limit, overflowed};
}

void setHeapLimit(uint64_t bytes)
{
    Guard g;
    limit = bytes ? bytes : kRp2040Heap;
}

void resetHeapPeak()
{
    Guard g;
    peak = live;
}
} // namespace hal

namespace hal::detail
{
void heapCountThisThread(int core, bool counting)
{
    cores[core].store(counting ? threadId() : 0);
}

FakesOwnHeap::FakesOwnHeap()
{
    const int core = coreIndex();
    if (core >= 0)
        fakesHolding[core]++;
}

FakesOwnHeap::~FakesOwnHeap()
{
    const int core = coreIndex();
    if (core >= 0)
        fakesHolding[core]--;
}
} // namespace hal::detail
