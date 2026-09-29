#pragma once
// The firmware's two cores on the fake board: setup()/loop() on core 0 and setup1()/loop1() on
// core 1, launched together as arduino-pico's main() launches them. Exactly one runs at a time.
// The running core keeps the baton until it delays, or reads the clock past another participant's
// wake time - the other core, or the test waiting in run_us(). So both cores see one clock, a
// core spinning on millis() still lets the other run, and every run is deterministic.

#include <cstdint>
#include <string>

namespace hal
{
enum class Stop : uint8_t
{
    None,
    Reboot,
    RebootToBootloader,
    Panic,
    PowerLoss,
    Exception, // anything else a core threw - a bug in the firmware or a fake
};

// How the most recent machine stopped, after it is gone - what decides whether the RAM a reboot
// keeps is handed to the next boot.
Stop lastStop();

class Machine
{
  public:
    Machine() = default;
    ~Machine();
    Machine(const Machine&) = delete;
    Machine& operator=(const Machine&) = delete;

    // Launches both cores at the current time. They run only inside run_us().
    void start();

    // Lets the cores run for `us` of simulated time. False once they have stopped - a reboot, a
    // panic, an exception - and stop() says why; a stopped machine stays stopped.
    bool run_us(uint64_t us);
    bool run_ms(uint64_t ms) { return run_us(ms * 1000); }

    // Runs until `done()` holds, checking every `step_us`, or `limit_us` has passed. True if it held.
    template <typename Pred> bool runUntil(Pred done, uint64_t limit_us, uint64_t step_us = 1000)
    {
        for (uint64_t t = 0; t < limit_us; t += step_us)
        {
            if (done())
                return true;
            if (!run_us(step_us))
                return done();
        }
        return done();
    }

    bool stopped() const;
    Stop stop() const;
    const std::string& stopDetail() const;

    // Unwinds both cores. The destructor does this too.
    void halt();
};
} // namespace hal
