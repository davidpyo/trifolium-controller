#pragma once
#include "types.h"
#include "displayManager.h"

enum class TriggerEvent
{
    PRESSED,
    HELD,
    RELEASED,
    IDLE,
};

struct FiringContext
{
    int16_t& shotsToFire;
    float& targetDPS;
    uint32_t time_ms;
    uint32_t& triggerTimeMs;
    uint32_t binaryTriggerTimeoutMs;
    uint32_t configuredBurstLength;
    bool reversible; // FireModeConfig::reversible - only consulted by BURST/SEMI

    bool& requestRev;

    float& rpmScale;              // < 0 = motors use their own revRPM; 0..1 = scale each motor's
    int16_t& buzzPulsesRequested; // consumed and cleared by handlePlasmaBuzzPulse()
};

class FiringModeBehavior
{
  public:
    virtual const char* defaultName() const = 0;
    virtual void update(FiringContext& ctx, TriggerEvent event) const = 0;

    // Confined to the given rect - x/y/w/h are DisplayManager's to decide, not the mode's.
    virtual void render(DisplayManager& display, int16_t x, int16_t y, int16_t w, int16_t h,
                        const FiringContext& ctx) const = 0;

    virtual bool supportsBurstLength() const { return true; }
    virtual bool supportsTargetDps() const { return true; }
    virtual bool supportsReversible() const { return false; } // true only for BURST, SEMI
    virtual bool managesOwnRevLifecycle() const { return false; }

    virtual ~FiringModeBehavior() = default;
};

const FiringModeBehavior& behaviorFor(burstFireType_t mode);
