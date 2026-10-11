#pragma once
// A flywheel on the end of a bidirectional DShot ESC: first-order toward the speed the throttle
// asks for, answering each frame with its eRPM the way the ESC does - read by the firmware on its
// next tick. From rest it waits out the ESC's sensorless start; spinning up it gains no faster
// than the ESC's current limit allows, so the rise is a ramp; spinning down it follows the throttle
// quickly, because the ESC brakes as the throttle falls.
//
// The defaults are fitted to a v1.2 blaster's RPM captures - two 3200 kV motors on 4S under PID
// control, tests/bench/capture_rpm.py - with the start delay the middle of the 40-150 ms seen.

#include "hal/hal.h"

#include <PIO_DShot.h>

#include <algorithm>
#include <cmath>

struct SimFlywheel
{
    float kv = 3200.0f;
    float packVoltage = 16.8f;
    float loadedFraction = 0.975f; // of Kv * V * duty the wheel actually reaches under drag
    float startDelay_s = 0.08f;
    float maxAccel_rpmPerS = 325000.0f;
    float tauUp_s = 0.04f;
    float tauDown_s = 0.07f;
    uint8_t polePairs = 7;

    // Answer every n-th frame only, to stand in for telemetry lost on the wire.
    uint32_t replyEvery = 1;
    bool replies = true;

    // With no pack behind it an ESC neither answers nor drives its wheel.
    bool powered = true;

    // When modelled, an ESC ignores the signal until startup_ms after it first arrives, and
    // restart_ms longer when the RP2040 rebooted under a powered ESC, which restarts on losing the
    // signal. Unmodelled, it answers from its first frame.
    bool startupModelled = false;
    uint32_t startup_ms = 0;
    uint32_t restart_ms = 0;
    bool restarted = false;

    float rpm = 0.0f;
    uint16_t throttle = 0;
    float peakRpm = 0.0f;
    float lastDartRpm = 0.0f; // the speed the last dart met the wheel at, 0 before any
    bool attached = false;

    void setPowered(bool on)
    {
        if (on != powered)
        {
            signalSeen_ = false;
            restarted = false;
        }
        powered = on;
    }

    bool started(uint64_t now) const
    {
        if (!powered)
            return false;
        if (!startupModelled)
            return true;
        const uint64_t wait_us = (uint64_t)(startup_ms + (restarted ? restart_ms : 0)) * 1000;
        return signalSeen_ && now >= signalAt_us_ + wait_us;
    }

    void attach(BidirDShotX1& esc)
    {
        attached = true;
        lastUs_ = hal::now_us();
        esc.onFrame = [this](BidirDShotX1& e) { onFrame(e); };
    }

    // A dart through the wheels at `at_us`, taking `lossRpm` with it.
    void hitAt(uint64_t at_us, float lossRpm)
    {
        hitAt_us_ = at_us;
        hitLoss_ = lossRpm;
    }

    // The ESC's next reply, in place of the wheel's own: a bad eRPM, an extended-telemetry frame or
    // a corrupt one. Once, then the wheel answers again.
    enum class Override : uint8_t
    {
        None,
        Erpm,
        Edt,
        Corrupt
    };
    void overrideNext(Override kind, uint32_t value = 0,
                      BidirDshotTelemetryType type = BidirDshotTelemetryType::TEMPERATURE)
    {
        override_ = kind;
        overrideValue_ = value;
        overrideType_ = type;
    }

    float steadyRpm(uint16_t t) const { return kv * packVoltage * (t / 2000.0f) * loadedFraction; }

  private:
    static constexpr float kAtRestRpm = 100.0f;

    uint64_t lastUs_ = 0;
    uint64_t startAt_us_ = 0; // when a start from rest gets the wheel turning; 0 when not starting
    uint64_t frames_ = 0;
    bool signalSeen_ = false;
    uint64_t signalAt_us_ = 0;
    uint64_t hitAt_us_ = 0;
    float hitLoss_ = 0.0f;
    Override override_ = Override::None;
    uint32_t overrideValue_ = 0;
    BidirDshotTelemetryType overrideType_ = BidirDshotTelemetryType::TEMPERATURE;

    void onFrame(BidirDShotX1& esc)
    {
        const uint64_t now = hal::now_us();
        const float dt = (now - lastUs_) / 1e6f;
        lastUs_ = now;

        if (rpm < kAtRestRpm)
        {
            if (throttle == 0)
                startAt_us_ = 0;
            else if (startAt_us_ == 0)
                startAt_us_ = now + (uint64_t)(startDelay_s * 1e6f);
        }
        const float target = steadyRpm(throttle);
        if (dt > 0 && now >= startAt_us_)
        {
            const float tau = target > rpm ? tauUp_s : tauDown_s;
            float step = (target - rpm) * (1.0f - std::exp(-dt / tau));
            if (step > 0)
                step = std::min(step, maxAccel_rpmPerS * dt);
            rpm += step;
        }
        if (hitLoss_ > 0 && now >= hitAt_us_)
        {
            lastDartRpm = rpm;
            rpm = std::max(0.0f, rpm - hitLoss_);
            hitLoss_ = 0;
        }
        if (rpm > peakRpm)
            peakRpm = rpm;

        if (powered && !signalSeen_)
        {
            signalSeen_ = true;
            signalAt_us_ = now;
        }
        const bool up = started(now);
        throttle = up ? esc.lastThrottle : 0;
        if (!up)
            return;
        if (override_ != Override::None)
        {
            if (override_ == Override::Erpm)
                esc.replyErpm(overrideValue_);
            else if (override_ == Override::Edt)
                esc.replyEdt(overrideType_, (uint8_t)overrideValue_);
            else
                esc.replyCorrupt();
            override_ = Override::None;
            return;
        }
        if (replies && (frames_++ % replyEvery) == 0)
            esc.replyErpm((uint32_t)(rpm * polePairs));
    }
};
