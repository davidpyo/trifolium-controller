// The fake board's clock, and the scheduler that runs the firmware's two cores against it.

#include "hal/detail.h"
#include "hal/hal.h"
#include "hal/machine.h"

#include <condition_variable>
#include <limits>
#include <mutex>
#include <thread>

// Common.h declares setup() and loop(); arduino-pico's main.cpp declares these two itself.
void setup1();
void loop1();

namespace
{
constexpr uint64_t kNever = std::numeric_limits<uint64_t>::max();
constexpr int kCore0 = 0;
constexpr int kCore1 = 1;
constexpr int kHost = 2;

// Thrown into a parked core to unwind it when the machine is halted.
struct CoreStop
{
};

uint64_t clock_us = 0;
uint32_t tick_us = 1;
bool pendingPowerLoss = false;

struct Sched
{
    std::mutex m;
    std::condition_variable cv;
    bool active = false;
    int current = kHost;
    uint64_t wakeAt[3] = {kNever, kNever, kNever};
    bool live[2] = {false, false};
    bool unwinding = false;
    hal::Stop stop = hal::Stop::None;
    std::string detail;
    std::thread threads[2];
};

Sched s;
thread_local int self = kHost;

bool schedulable(int who)
{
    return who == kHost || (s.live[who] && s.stop == hal::Stop::None);
}

// Earliest wake time wins. On a tie, whoever comes after `self`, so a core that yields on a clock
// read lets an equally due peer go first.
int pickNext()
{
    int best = -1;
    for (int k = 1; k <= 3; k++)
    {
        const int who = (self + k) % 3;
        if (!schedulable(who))
            continue;
        if (best < 0 || s.wakeAt[who] < s.wakeAt[best])
            best = who;
    }
    return best;
}

void handTo(int next)
{
    std::unique_lock<std::mutex> lk(s.m);
    s.current = next;
    s.cv.notify_all();
    s.cv.wait(lk, [] { return s.current == self; });
    if (self != kHost && s.unwinding)
        throw CoreStop{};
}

void yieldNow()
{
    const int next = pickNext();
    if (s.wakeAt[next] != kNever && s.wakeAt[next] > clock_us)
        clock_us = s.wakeAt[next];
    if (next != self)
        handTo(next);
}

const char* coreName(int id)
{
    return id == kCore0 ? "core 0" : "core 1";
}

void coreBody(int id)
{
    self = id;
    hal::detail::heapCountThisThread(id);
    {
        std::unique_lock<std::mutex> lk(s.m);
        s.cv.wait(lk, [id] { return s.current == id; });
    }

    hal::Stop why = hal::Stop::None;
    std::string detail;
    try
    {
        if (s.unwinding)
            throw CoreStop{};
        // arduino-pico's main1() and main(), less the serialEvent hooks nothing here defines. The
        // tick after each pass stands in for the loop's own cost, so no pass is free.
        if (id == kCore0)
        {
            setup();
            for (;;)
            {
                loop();
                hal::detail::onClockRead();
            }
        }
        else
        {
            setup1();
            for (;;)
            {
                loop1();
                hal::detail::onClockRead();
            }
        }
    }
    catch (const CoreStop&)
    {
    }
    catch (const hal::Reboot& r)
    {
        why = r.toBootloader ? hal::Stop::RebootToBootloader : hal::Stop::Reboot;
    }
    catch (const hal::Panic& p)
    {
        why = hal::Stop::Panic;
        detail = p.message;
    }
    catch (const hal::PowerLoss&)
    {
        why = hal::Stop::PowerLoss;
    }
    catch (const std::exception& e)
    {
        why = hal::Stop::Exception;
        detail = e.what();
    }
    catch (...)
    {
        why = hal::Stop::Exception;
        detail = "unknown exception";
    }

    std::unique_lock<std::mutex> lk(s.m);
    s.live[id] = false;
    s.wakeAt[id] = kNever;
    // A reboot or a fault stops the chip, not one core: the other never runs again.
    if (why != hal::Stop::None && s.stop == hal::Stop::None)
    {
        s.stop = why;
        s.detail = std::string(coreName(id)) + (detail.empty() ? "" : ": " + detail);
    }
    s.current = kHost;
    s.cv.notify_all();
}
} // namespace

namespace hal::detail
{
uint64_t now_us()
{
    return clock_us;
}

void resetClock()
{
    clock_us = 0;
    tick_us = 1;
    pendingPowerLoss = false;
}

void setTickPerRead_us(uint32_t us)
{
    tick_us = us;
}

void advance_us(uint64_t us)
{
    clock_us += us;
}

void stall_us(uint64_t us)
{
    clock_us += us;
}

void powerLost()
{
    pendingPowerLoss = true;
}

void throwIfPowerLost()
{
    if (pendingPowerLoss && s.active && self != kHost)
    {
        pendingPowerLoss = false;
        throw hal::PowerLoss{};
    }
}

void spend_us(uint64_t us)
{
    throwIfPowerLost();
    clock_us += us;
    if (!s.active || self == kHost)
        return;
    for (int who = 0; who < 3; who++)
    {
        if (who != self && schedulable(who) && s.wakeAt[who] <= clock_us)
        {
            s.wakeAt[self] = clock_us;
            yieldNow();
            return;
        }
    }
}

int currentCore()
{
    return self == kHost ? -1 : self;
}

bool machineRunning()
{
    return s.active;
}

void sleep_us(uint64_t us)
{
    throwIfPowerLost();
    if (!s.active || self == kHost)
    {
        clock_us += us;
        return;
    }
    s.wakeAt[self] = clock_us + us;
    yieldNow();
}

void onClockRead()
{
    throwIfPowerLost();
    clock_us += tick_us;
    if (!s.active || self == kHost)
        return;
    for (int who = 0; who < 3; who++)
    {
        if (who != self && schedulable(who) && s.wakeAt[who] <= clock_us)
        {
            s.wakeAt[self] = clock_us;
            yieldNow();
            return;
        }
    }
}
} // namespace hal::detail

namespace hal
{
Stop lastStop()
{
    return s.stop;
}

Machine::~Machine()
{
    halt();
}

void Machine::start()
{
    halt();
    s.active = true;
    s.current = kHost;
    s.unwinding = false;
    s.stop = Stop::None;
    s.detail.clear();
    s.wakeAt[kCore0] = s.wakeAt[kCore1] = clock_us;
    s.wakeAt[kHost] = kNever;
    s.live[kCore0] = s.live[kCore1] = true;
    s.threads[kCore0] = std::thread(coreBody, kCore0);
    s.threads[kCore1] = std::thread(coreBody, kCore1);
}

bool Machine::run_us(uint64_t us)
{
    if (!s.active || s.stop != Stop::None)
        return false;
    s.wakeAt[kHost] = clock_us + us;
    yieldNow();
    s.wakeAt[kHost] = kNever;
    return s.stop == Stop::None;
}

bool Machine::stopped() const
{
    return s.stop != Stop::None;
}

Stop Machine::stop() const
{
    return s.stop;
}

const std::string& Machine::stopDetail() const
{
    return s.detail;
}

void Machine::halt()
{
    if (!s.active)
        return;
    s.unwinding = true;
    for (int id : {kCore0, kCore1})
    {
        if (s.live[id])
            handTo(id);
        if (s.threads[id].joinable())
            s.threads[id].join();
    }
    s.unwinding = false;
    s.active = false;
}
} // namespace hal
