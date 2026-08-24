#include "firingModeBehavior.h"
#include <algorithm>
#include <cmath>

namespace
{
inline void accumulateShots(int16_t& shotsToFire, uint32_t burstLength)
{
    if (shotsToFire < (int16_t)burstLength || shotsToFire == 1)
        shotsToFire += burstLength;
}

class AutoMode : public FiringModeBehavior
{
  public:
    const char* defaultName() const override { return "AUTO"; }

    void update(FiringContext& ctx, TriggerEvent event) const override
    {
        switch (event)
        {
        case TriggerEvent::PRESSED:
            ctx.triggerTimeMs = ctx.time_ms;
            ctx.shotsToFire = ctx.configuredBurstLength;
            break;
        case TriggerEvent::RELEASED:
            if (ctx.shotsToFire > 1)
                ctx.shotsToFire = 1;
            break;
        default:
            break;
        }
    }

    void render(DisplayManager& display, int16_t x, int16_t y, int16_t w, int16_t h,
                const FiringContext& ctx) const override
    {
        display.drawDartBelt(x, y, w, h, ctx.configuredBurstLength);
    }
};

class BurstMode : public FiringModeBehavior
{
  public:
    const char* defaultName() const override { return "BURST"; }
    bool supportsReversible() const override { return true; }

    void update(FiringContext& ctx, TriggerEvent event) const override
    {
        if (ctx.reversible)
        {
            switch (event)
            {
            case TriggerEvent::PRESSED:
                ctx.triggerTimeMs = ctx.time_ms;
                ctx.requestRev = true;
                break;
            case TriggerEvent::HELD:
                ctx.requestRev = true;
                break;
            case TriggerEvent::RELEASED:
                ctx.requestRev = false;
                accumulateShots(ctx.shotsToFire, ctx.configuredBurstLength);
                break;
            default:
                break;
            }
            return;
        }

        if (event == TriggerEvent::PRESSED)
        {
            ctx.triggerTimeMs = ctx.time_ms;
            accumulateShots(ctx.shotsToFire, ctx.configuredBurstLength);
        }
    }

    void render(DisplayManager& display, int16_t x, int16_t y, int16_t w, int16_t h,
                const FiringContext& ctx) const override
    {
        display.drawDartBelt(x, y, w, h, ctx.configuredBurstLength);
    }
};

class BinaryMode : public FiringModeBehavior
{
  public:
    const char* defaultName() const override { return "BINARY"; }

    void update(FiringContext& ctx, TriggerEvent event) const override
    {
        if (event == TriggerEvent::PRESSED)
        {
            ctx.triggerTimeMs = ctx.time_ms;
            accumulateShots(ctx.shotsToFire, ctx.configuredBurstLength);
        }
        else if (event == TriggerEvent::RELEASED)
        {
            if (ctx.time_ms < ctx.triggerTimeMs + ctx.binaryTriggerTimeoutMs)
            {
                ctx.triggerTimeMs = ctx.time_ms;
                accumulateShots(ctx.shotsToFire, ctx.configuredBurstLength);
            }
        }
    }

    void render(DisplayManager& display, int16_t x, int16_t y, int16_t w, int16_t h,
                const FiringContext& ctx) const override
    {
        display.drawDartBelt(x, y, w, h, 2 * ctx.configuredBurstLength, ctx.configuredBurstLength);
    }
};

class SafeMode : public FiringModeBehavior
{
  public:
    const char* defaultName() const override { return "SAFE"; }
    bool supportsBurstLength() const override { return false; }
    bool supportsTargetDps() const override { return false; }

    void update(FiringContext& ctx, TriggerEvent) const override { ctx.shotsToFire = 0; }

    void render(DisplayManager& display, int16_t x, int16_t y, int16_t w, int16_t h,
                const FiringContext&) const override
    {
        display.drawDartBelt(x, y, w, h, 0);
    }
};

class SemiMode : public FiringModeBehavior
{
  public:
    const char* defaultName() const override { return "SEMI"; }
    bool supportsBurstLength() const override { return false; } // always exactly 1
    bool supportsReversible() const override { return true; }

    void update(FiringContext& ctx, TriggerEvent event) const override
    {
        if (ctx.reversible)
        {
            switch (event)
            {
            case TriggerEvent::PRESSED:
                ctx.triggerTimeMs = ctx.time_ms;
                ctx.requestRev = true;
                break;
            case TriggerEvent::HELD:
                ctx.requestRev = true;
                break;
            case TriggerEvent::RELEASED:
                ctx.requestRev = false;
                accumulateShots(ctx.shotsToFire, 1);
                break;
            default:
                break;
            }
            return;
        }

        if (event == TriggerEvent::PRESSED)
        {
            ctx.triggerTimeMs = ctx.time_ms;
            accumulateShots(ctx.shotsToFire, 1);
        }
    }

    void render(DisplayManager& display, int16_t x, int16_t y, int16_t w, int16_t h,
                const FiringContext&) const override
    {
        display.drawDartBelt(x, y, w, h, 1);
    }
};

// DPS ramps from a low starting point up to a cap the longer the trigger stays held. Fires
// continuously like AUTO while held; the rate is what changes, not the shot count.
class DevotionMode : public FiringModeBehavior
{
    static constexpr float kMinDPS = 3.0f;
    static constexpr float kMaxDPS = 20.0f;
    static constexpr uint32_t kRampDurationMs = 3000;
    static constexpr int16_t kContinuousFireSentinel = 999;

  public:
    const char* defaultName() const override { return "DEVOTION"; }
    bool supportsBurstLength() const override { return false; }
    bool supportsTargetDps() const override { return false; } // ramped internally, not configured

    void update(FiringContext& ctx, TriggerEvent event) const override
    {
        switch (event)
        {
        case TriggerEvent::PRESSED:
            ctx.triggerTimeMs = ctx.time_ms;
            ctx.targetDPS = kMinDPS;
            ctx.shotsToFire = kContinuousFireSentinel;
            break;
        case TriggerEvent::HELD:
        {
            float heldFraction =
                std::min(1.0f, (ctx.time_ms - ctx.triggerTimeMs) / (float)kRampDurationMs);
            ctx.targetDPS = kMinDPS + (kMaxDPS - kMinDPS) * heldFraction;
            break;
        }
        case TriggerEvent::RELEASED:
            if (ctx.shotsToFire > 1)
                ctx.shotsToFire = 1;
            break;
        case TriggerEvent::IDLE:
            if (ctx.shotsToFire == 0)
                ctx.targetDPS = kMinDPS;
            break;
        default:
            break;
        }
    }

    void render(DisplayManager& display, int16_t x, int16_t y, int16_t w, int16_t h,
                const FiringContext& ctx) const override
    {
        static constexpr float kMinStepPx = 8.0f;
        static constexpr float kMaxStepPx = 34.0f;
        float dpsFrac =
            std::min(1.0f, std::max(0.0f, (ctx.targetDPS - kMinDPS) / (kMaxDPS - kMinDPS)));
        int16_t dartStep = (int16_t)(kMaxStepPx - (kMaxStepPx - kMinStepPx) * dpsFrac);
        display.drawDartStream(x, y, w, h, dartStep);
    }
};

// Halo plasma-pistol charged shot. Hold to charge: releasing before the first slot arms fires
// nothing, releasing once armed fires that many darts. Holding through all three slots overheats,
// discarding pending shots and locking out re-charging.
class PlasmaMode : public FiringModeBehavior
{
    // Starting fraction is kept this high because the open-loop feedforward scales with targetRPM -
    // at 0.20 of a 30k revRPM the ESC sees ~11% throttle, and much below that the wheels can fail
    // to spin up from rest.
    static constexpr float kChargeStartFrac = 0.20f;
    static constexpr float kChargeReadyFrac = 0.93f;
    static constexpr uint32_t kChargeReadyMs = 1646;
    // Time constants spanned by the charge. baseChargeFrac() normalizes by this, so
    // baseChargeFrac(kChargeReadyMs) == kChargeReadyFrac holds for any value here.
    static constexpr float kChargeShape = 2.44f;
    static constexpr uint32_t kSlotIntervalMs = 700;
    static constexpr int16_t kMaxDarts = 3;
    static constexpr uint32_t kOverheatAfterMs = 1000;
    static constexpr uint32_t kOverheatLockoutMs = 2000;

    // Pluck-shaped modulation on the charge ramp. Asymmetric by necessity: spin-up measured
    // 2400-4400 Hz/s against ~1500 Hz/s free spindown, so a fast rise with a slow droop is the
    // only shape the flywheels can track.
    static constexpr float kOscillationDepth = 0.12f;
    static constexpr uint32_t kOscillationHz = 5;
    static constexpr float kPluckAttackFrac = 0.06f; // ~12ms at 5Hz; below ~10ms it only clips
    static constexpr float kPluckDecayRate = 7.0f;
    static constexpr float kPluckUndershoot = 1.0f; // depth fraction the tail settles below base

    static constexpr int16_t kOverheatPhase = kMaxDarts + 1;
    static constexpr int16_t kOverheatBuzzPulses = 10;
    static constexpr int16_t kSlotReadyBuzzPulses = 4;

    mutable uint32_t chargeStartMs_ = 0;
    mutable uint32_t lockoutUntilMs_ = 0;
    mutable int16_t lastPhase_ = 0;
    mutable bool holdActive_ = false;

    // cyclePos in [0,1) -> [-kPluckUndershoot, 1]. Decay asymptotes to -kPluckUndershoot so the
    // cycle end meets the next cycle's start without a discontinuity.
    static float pluckEnvelope(float cyclePos)
    {
        const float span = 1.0f + kPluckUndershoot;
        if (cyclePos < kPluckAttackFrac)
            return -kPluckUndershoot + span * (cyclePos / kPluckAttackFrac);
        float decayPos = (cyclePos - kPluckAttackFrac) / (1.0f - kPluckAttackFrac);
        return -kPluckUndershoot + span * std::exp(-kPluckDecayRate * decayPos);
    }

    static float baseChargeFrac(uint32_t heldMs)
    {
        float rise = 1.0f - std::exp(-kChargeShape * (float)heldMs / kChargeReadyMs);
        return kChargeStartFrac +
               (kChargeReadyFrac - kChargeStartFrac) * rise / (1.0f - std::exp(-kChargeShape));
    }

    // Base ramp plus the pluck - drives rpmScale. Floored at kChargeStartFrac so the undershoot
    // can't command a weaker launch than the charge started with, and can never go negative,
    // which fwControlLoop() would read as "no override" and snap motors to full revRPM.
    static float chargeFrac(uint32_t heldMs)
    {
        float cycles = (float)heldMs / 1000.0f * kOscillationHz;
        float frac =
            baseChargeFrac(heldMs) + kOscillationDepth * pluckEnvelope(cycles - std::floor(cycles));
        return std::min(1.0f, std::max(kChargeStartFrac, frac));
    }

    static int16_t readySlots(uint32_t heldMs)
    {
        if (heldMs < kChargeReadyMs)
            return 0;
        uint32_t sinceReadyMs = heldMs - kChargeReadyMs;
        int16_t slots = 1 + (int16_t)(sinceReadyMs / kSlotIntervalMs);
        return std::min(kMaxDarts, slots);
    }

    static bool isOverheating(uint32_t heldMs)
    {
        uint32_t allSlotsReadyMs = kChargeReadyMs + (uint32_t)(kMaxDarts - 1) * kSlotIntervalMs;
        return heldMs >= allSlotsReadyMs + kOverheatAfterMs;
    }

  public:
    const char* defaultName() const override { return "PLASMA"; }
    bool supportsBurstLength() const override { return false; }
    bool supportsTargetDps() const override { return false; }
    bool managesOwnRevLifecycle() const override { return true; }

    void update(FiringContext& ctx, TriggerEvent event) const override
    {
        switch (event)
        {
        case TriggerEvent::PRESSED:
            if (ctx.time_ms < lockoutUntilMs_)
                break; // still locked out from the last overheat
            chargeStartMs_ = ctx.time_ms;
            holdActive_ = true;
            lastPhase_ = 0;
            ctx.requestRev = true;
            ctx.shotsToFire = 0;
            ctx.rpmScale = chargeFrac(0);
            break;
        case TriggerEvent::HELD:
        {
            if (!holdActive_)
                break;
            uint32_t heldMs = ctx.time_ms - chargeStartMs_;
            bool overheating = isOverheating(heldMs);
            int16_t currentPhase = overheating ? kOverheatPhase : readySlots(heldMs);
            if (currentPhase > lastPhase_)
            {
                ctx.buzzPulsesRequested =
                    (currentPhase == kOverheatPhase) ? kOverheatBuzzPulses : kSlotReadyBuzzPulses;
                lastPhase_ = currentPhase;
            }
            if (overheating)
            {
                ctx.requestRev = false;
                ctx.shotsToFire = 0;
                ctx.rpmScale = -1.0f;
                break;
            }
            ctx.requestRev = true;
            ctx.rpmScale = (currentPhase > 0) ? 1.0f : chargeFrac(heldMs);
            break;
        }
        case TriggerEvent::RELEASED:
        {
            if (!holdActive_)
                break;
            ctx.requestRev = false;
            uint32_t heldMs = ctx.time_ms - chargeStartMs_;
            bool overheated = isOverheating(heldMs);
            ctx.shotsToFire = overheated ? 0 : readySlots(heldMs);
            if (overheated)
            {
                lockoutUntilMs_ = ctx.time_ms + kOverheatLockoutMs;
            }
            else
            {
                holdActive_ = false;
                ctx.rpmScale = -1.0f;
            }
            break;
        }
        case TriggerEvent::IDLE:
            if (holdActive_ && ctx.time_ms >= lockoutUntilMs_)
            {
                holdActive_ = false;
                ctx.rpmScale = -1.0f;
            }
            break;
        default:
            break;
        }
    }

    void render(DisplayManager& display, int16_t x, int16_t y, int16_t w, int16_t h,
                const FiringContext& ctx) const override
    {
        Adafruit_SSD1306& raw = display.raw();

        if (!holdActive_)
        {
            raw.drawRect(x, y, w, 5, 1);
            int16_t slotY = y + 6;
            for (int16_t i = 0; i < kMaxDarts; i++)
                raw.drawRect(x + 88 - i * 44, slotY, 40, 4, 1);
            return;
        }

        uint32_t heldMs = ctx.time_ms - chargeStartMs_;

        if (isOverheating(heldMs))
        {
            static const int16_t kBannerY = 38;
            static const int16_t kBannerH = 16;
            static const int16_t kBannerInkH = 14;
            static const int16_t kBannerTextW = 108;
            bool blinkOn = (ctx.time_ms / 200) % 2 == 0;
            if (blinkOn)
            {
                raw.fillRect(0, kBannerY, 128, kBannerH, 1);
                raw.setTextColor(SSD1306_BLACK);
            }
            else
            {
                raw.drawRect(0, kBannerY, 128, kBannerH, 1);
                raw.setTextColor(SSD1306_WHITE);
            }
            raw.setTextSize(2);
            raw.setCursor((128 - kBannerTextW) / 2, kBannerY + (kBannerH - kBannerInkH) / 2);
            raw.print("OVERHEAT!");
            raw.setTextColor(SSD1306_WHITE);
            raw.setTextSize(1);
            return;
        }

        int16_t slots = readySlots(heldMs);
        float barFrac = slots > 0 ? 1.0f : baseChargeFrac(heldMs) / kChargeReadyFrac;

        raw.drawRect(x, y, w, 5, 1);
        int16_t fillW = (int16_t)((w - 2) * barFrac);
        if (fillW > 0)
            raw.fillRect(x + w - 1 - fillW, y + 1, fillW, 3, 1);

        int16_t slotY = y + 6;
        for (int16_t i = 0; i < kMaxDarts; i++)
        {
            int16_t slotX = x + 88 - i * 44;
            raw.drawRect(slotX, slotY, 40, 4, 1);
            if (i < slots)
                raw.fillRect(slotX + 1, slotY + 1, 38, 2, 1);
        }
    }
};

const AutoMode kAuto;
const BurstMode kBurst;
const BinaryMode kBinary;
const SafeMode kSafe;
const SemiMode kSemi;
const DevotionMode kDevotion;
const PlasmaMode kPlasma;
} // namespace

const FiringModeBehavior& behaviorFor(burstFireType_t mode)
{
    switch (mode)
    {
    case BURST:
        return kBurst;
    case BINARY:
        return kBinary;
    case SAFE:
        return kSafe;
    case SEMI:
        return kSemi;
    case DEVOTION:
        return kDevotion;
    case PLASMA:
        return kPlasma;
    case AUTO:
    default:
        return kAuto;
    }
}
