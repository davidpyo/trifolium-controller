// BidirDShotX1 without the PIO. The frame encoding and the reply decoding are the library's own, so
// the firmware sees the same quantised eRPM a real ESC would give it.

#include "hal/detail.h"
#include "hal/hal.h"

#include <PIO_DShot.h>
#include <hardware/gpio.h>

#include <algorithm>

std::vector<BidirDShotX1*> BidirDShotX1::instances;
std::function<void(BidirDShotX1&)> BidirDShotX1::onCreate;

namespace
{
const BidirDshotTelemetryType telemetryTypeLut[16] = {
    BidirDshotTelemetryType::ERPM,          BidirDshotTelemetryType::ERPM,
    BidirDshotTelemetryType::TEMPERATURE,   BidirDshotTelemetryType::ERPM,
    BidirDshotTelemetryType::VOLTAGE,       BidirDshotTelemetryType::ERPM,
    BidirDshotTelemetryType::CURRENT,       BidirDshotTelemetryType::ERPM,
    BidirDshotTelemetryType::DEBUG_FRAME_1, BidirDshotTelemetryType::ERPM,
    BidirDshotTelemetryType::DEBUG_FRAME_2, BidirDshotTelemetryType::ERPM,
    BidirDshotTelemetryType::STRESS,        BidirDshotTelemetryType::ERPM,
    BidirDshotTelemetryType::STATUS,        BidirDshotTelemetryType::ERPM};

uint8_t edtNibble(BidirDshotTelemetryType type)
{
    switch (type)
    {
    case BidirDshotTelemetryType::TEMPERATURE: return 0x2;
    case BidirDshotTelemetryType::VOLTAGE: return 0x4;
    case BidirDshotTelemetryType::CURRENT: return 0x6;
    case BidirDshotTelemetryType::DEBUG_FRAME_1: return 0x8;
    case BidirDshotTelemetryType::DEBUG_FRAME_2: return 0xA;
    case BidirDshotTelemetryType::STRESS: return 0xC;
    case BidirDshotTelemetryType::STATUS: return 0xE;
    default: return 0x2;
    }
}
} // namespace

BidirDShotX1::BidirDShotX1(uint8_t pin, uint32_t speed) : pin_(pin), speed_(speed)
{
    if (pin >= NUM_BANK0_GPIOS || speed < 150 || speed > 4800)
    {
        iError_ = true;
        return;
    }
    hal::setPinFunction(pin, GPIO_FUNC_PIO0);
    instances.push_back(this);
    if (onCreate)
        onCreate(*this);
}

BidirDShotX1::~BidirDShotX1()
{
    if (iError_)
        return;
    hal::setPinFunction(pin_, GPIO_FUNC_NULL);
    instances.erase(std::remove(instances.begin(), instances.end(), this), instances.end());
}

BidirDShotX1* BidirDShotX1::on(uint8_t pin)
{
    for (BidirDShotX1* inst : instances)
    {
        if (inst->pin_ == pin)
            return inst;
    }
    return nullptr;
}

void BidirDShotX1::sendThrottle(uint16_t throttle)
{
    if (throttle > 2000)
        throttle = 2000;
    lastThrottle = throttle;
    throttleFrameCount++;

    if (throttle)
        throttle += 47;
    throttle <<= 1;
    sendRaw12Bit(throttle);
}

void BidirDShotX1::sendRaw11Bit(uint16_t data)
{
    {
        const hal::detail::FakesOwnHeap fakes;
        commands.push_back(data);
    }
    sendRaw12Bit((uint16_t)((data << 1) | 1));
}

void BidirDShotX1::sendRaw12Bit(uint16_t)
{
    const uint64_t now = hal::now_us();
    settle();
    if (inFlight_)
    {
        inFlight_ = false;
        if (now < landsAt_us_)
            repliesAborted++;
        else
            repliesFifoFull++;
    }
    if (now < frameEnds_us_)
        framesCut++;
    frameAt_us_ = now;
    frameEnds_us_ = now + frame_us();

    frameCount++;
    if (onFrame)
        onFrame(*this);
}

void BidirDShotX1::settle()
{
    if (inFlight_ && hal::now_us() >= landsAt_us_ && fifoCount_ < kFifoDepth)
    {
        fifo_[fifoCount_++] = flying_;
        inFlight_ = false;
    }
}

void BidirDShotX1::reply(Word w)
{
    flying_ = w;
    inFlight_ = true;
    landsAt_us_ = frameAt_us_ + replyLands_us();
}

bool BidirDShotX1::checkTelemetryAvailable()
{
    settle();
    return fifoCount_ != 0;
}

BidirDshotTelemetryType BidirDShotX1::getTelemetryErpm(uint32_t* value)
{
    uint32_t raw;
    BidirDshotTelemetryType ret = getTelemetryRaw(&raw);
    if (ret > BidirDshotTelemetryType::NO_PACKET)
        return BidirDshotTelemetryType::OTHER_VALUE;
    if (ret > BidirDshotTelemetryType::ERPM)
        return ret;
    *value = convertFromRaw(raw, BidirDshotTelemetryType::ERPM);
    return *value == 0xFFFFFFFF ? BidirDshotTelemetryType::CHECKSUM_ERROR
                                : BidirDshotTelemetryType::ERPM;
}

BidirDshotTelemetryType BidirDShotX1::getTelemetryPacket(uint32_t* value)
{
    uint32_t raw;
    BidirDshotTelemetryType ret = getTelemetryRaw(&raw);
    if (ret == BidirDshotTelemetryType::ERPM)
    {
        const uint32_t erpm = convertFromRaw(raw, ret);
        if (erpm == 0xFFFFFFFF)
            return BidirDshotTelemetryType::CHECKSUM_ERROR;
        *value = erpm;
    }
    else if (ret > BidirDshotTelemetryType::NO_PACKET)
    {
        *value = raw & 0xFF;
    }
    return ret;
}

BidirDshotTelemetryType BidirDShotX1::getTelemetryRaw(uint32_t* value)
{
    settle();
    if (!fifoCount_)
        return BidirDshotTelemetryType::NO_PACKET;
    Word newest = fifo_[fifoCount_ - 1];
    fifoCount_ = 0;
    // A reply waiting for room lands as the drain frees it, in time for the drain's last read.
    settle();
    if (fifoCount_)
    {
        newest = fifo_[fifoCount_ - 1];
        fifoCount_ = 0;
    }
    if (newest.corrupt)
        return BidirDshotTelemetryType::CHECKSUM_ERROR;
    *value = newest.raw;
    return telemetryTypeLut[newest.raw >> 8];
}

uint32_t BidirDShotX1::convertFromRaw(uint32_t raw, BidirDshotTelemetryType type)
{
    if (type == BidirDshotTelemetryType::ERPM)
    {
        if (raw == 0xFFF)
            return 0;
        raw = (raw & 0x1FF) << (raw >> 9);
        if (!raw)
            return 0xFFFFFFFF;
        return (60000000 + 50 * raw) / raw;
    }
    return raw & 0xFF;
}

void BidirDShotX1::replyErpm(uint32_t erpm)
{
    // The ESC reports its commutation period in microseconds as a 3-bit exponent and a 9-bit
    // mantissa, normalised so the mantissa's top bit is set whenever the exponent is not zero.
    uint32_t raw = 0xFFF;
    if (erpm > 0)
    {
        uint32_t period = 60000000 / erpm;
        uint32_t e = 0;
        while (period > 0x1FF && e < 7)
        {
            period >>= 1;
            e++;
        }
        if (period <= 0x1FF && period > 0)
            raw = (e << 9) | period;
    }
    reply({raw, false});
}

void BidirDShotX1::replyEdt(BidirDshotTelemetryType type, uint8_t value)
{
    reply({((uint32_t)edtNibble(type) << 8) | value, false});
}

void BidirDShotX1::replyCorrupt()
{
    reply({0, true});
}
