#pragma once
// pico-bidir-dshot's BidirDShotX1 without the PIO. Frames go nowhere; telemetry comes from whatever
// the test queues, decoded exactly as the library decodes a received frame.
//
// The PIO program's timing is kept. A frame is 16 bits at the DShot rate. The ESC's 21-bit reply,
// at 5/4 of that rate, starts about 30 us after the frame and reaches the RX FIFO once all of it
// has been read: 140 us after the frame at DShot300, 85 at 600. A frame offered before then makes
// the library jump the state machine back to transmit, so that reply never arrives, and a frame
// offered while the last one is still going out cuts that one short, which the ESC discards.

#include <Arduino.h>

#include <cstdint>
#include <functional>
#include <vector>

enum class BidirDshotTelemetryType : uint8_t
{
    ERPM,
    OTHER_VALUE,
    CHECKSUM_ERROR,
    NO_PACKET,
    VOLTAGE,
    CURRENT,
    TEMPERATURE,
    STATUS,
    STRESS,
    DEBUG_FRAME_1,
    DEBUG_FRAME_2,
};

#define ESC_STATUS_MAX_STRESS_MASK 0b00001111
#define ESC_STATUS_ERROR_MASK 0b00100000
#define ESC_STATUS_WARNING_MASK 0b01000000
#define ESC_STATUS_ALERT_MASK 0b10000000

enum DShotCommand : uint16_t
{
    DSHOT_CMD_MOTOR_STOP = 0,
    DSHOT_CMD_BEACON1,
    DSHOT_CMD_BEACON2,
    DSHOT_CMD_BEACON3,
    DSHOT_CMD_BEACON4,
    DSHOT_CMD_BEACON5,
    DSHOT_CMD_ESC_INFO,
    DSHOT_CMD_SPIN_DIRECTION_1,
    DSHOT_CMD_SPIN_DIRECTION_2,
    DSHOT_CMD_3D_MODE_OFF,
    DSHOT_CMD_3D_MODE_ON,
    DSHOT_CMD_SETTINGS_REQUEST,
    DSHOT_CMD_SAVE_SETTINGS,
    DSHOT_CMD_EXTENDED_TELEMETRY_ENABLE,
    DSHOT_CMD_EXTENDED_TELEMETRY_DISABLE,
    DSHOT_CMD_SPIN_DIRECTION_NORMAL = 20,
    DSHOT_CMD_SPIN_DIRECTION_REVERSED = 21,
    DSHOT_CMD_LED0_ON,
    DSHOT_CMD_LED1_ON,
    DSHOT_CMD_LED2_ON,
    DSHOT_CMD_LED3_ON,
    DSHOT_CMD_LED0_OFF,
    DSHOT_CMD_LED1_OFF,
    DSHOT_CMD_LED2_OFF,
    DSHOT_CMD_LED3_OFF,
    DSHOT_CMD_AUDIO_STREAM_MODE_ON_OFF = 30,
    DSHOT_CMD_SILENT_MODE_ON_OFF = 31,
    DSHOT_CMD_MAX = 47
};

class BidirDShotX1
{
  public:
    static std::vector<BidirDShotX1*> instances;

    BidirDShotX1() = delete;
    BidirDShotX1(uint8_t pin, uint32_t speed = 600);
    ~BidirDShotX1();

    void sendThrottle(uint16_t throttle);
    void sendRaw11Bit(uint16_t data);
    void sendRaw12Bit(uint16_t data);

    bool checkTelemetryAvailable();
    BidirDshotTelemetryType getTelemetryErpm(uint32_t* erpm);
    BidirDshotTelemetryType getTelemetryPacket(uint32_t* value);
    BidirDshotTelemetryType getTelemetryRaw(uint32_t* value);
    static uint32_t convertFromRaw(uint32_t raw, BidirDshotTelemetryType type);

    bool initError() { return iError_; }

    // ---- host side -------------------------------------------------------------------------

    // The live instance on `pin`, or null.
    static BidirDShotX1* on(uint8_t pin);

    // Called for every instance as it is constructed - how a flywheel model gets attached to the
    // ESCs setup() creates.
    static std::function<void(BidirDShotX1&)> onCreate;

    // Called after every frame this instance sends.
    std::function<void(BidirDShotX1&)> onFrame;

    uint8_t escPin() const { return pin_; }
    uint32_t speed() const { return speed_; }

    // The last sendThrottle() value, clamped the way the library clamps it; frames of any kind.
    uint16_t lastThrottle = 0;
    uint64_t frameCount = 0;
    uint64_t throttleFrameCount = 0;

    // Every sendRaw11Bit() value, in order - the special commands, including any cut short.
    std::vector<uint16_t> commands;

    // Frames cut short by the next one, and replies lost: to a frame offered before they landed,
    // or because four unread ones already filled the FIFO.
    uint64_t framesCut = 0;
    uint64_t repliesAborted = 0;
    uint64_t repliesFifoFull = 0;

    uint32_t frame_us() const { return (16000 + speed_ - 1) / speed_; }
    uint32_t replyLands_us() const { return (32800 + speed_ - 1) / speed_ + 30; }

    // The ESC's answer to the frame just sent, landing replyLands_us() after it. A read drains the
    // FIFO and keeps the newest.
    void replyErpm(uint32_t erpm);
    void replyEdt(BidirDshotTelemetryType type, uint8_t value);
    void replyCorrupt();

  private:
    struct Word
    {
        uint32_t raw; // the 12-bit value a clean frame decodes to
        bool corrupt;
    };
    static constexpr size_t kFifoDepth = 4;

    uint8_t pin_;
    uint32_t speed_;
    bool iError_ = false;

    // The program's first instruction pushes its empty input register, which decodes as a
    // checksum error, so that is what a read before the first reply gets.
    Word fifo_[kFifoDepth] = {{0, true}};
    size_t fifoCount_ = 1;
    bool inFlight_ = false; // a reply on the wire, or read and waiting for room in the FIFO
    Word flying_{};
    uint64_t landsAt_us_ = 0;
    uint64_t frameAt_us_ = 0;
    uint64_t frameEnds_us_ = 0;

    void reply(Word w);
    void settle();
};
