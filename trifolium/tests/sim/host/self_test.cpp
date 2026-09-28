// trifolium-sim --self-test: the fake board, checked against the behaviour of the parts it stands in
// for. Every verdict the Python suite reaches rests on these.

#include <doctest.h>

#include "hal/detail.h"
#include "hal/hal.h"
#include "hal/machine.h"
#include "sim_panel.h"

#include <Adafruit_GFX.h>
#include <LittleFS.h>
#include <PIO_DShot.h>
#include <Wire.h>
#include <hardware/structs/padsbank0.h>
#include <hardware/structs/sio.h>

namespace
{
struct FreshBoard
{
    FreshBoard()
    {
        hal::resetWorld();
        hal::powerOn();
        hal::flash().clear();
    }
};
} // namespace

TEST_CASE("String and Print format numbers the way the core does")
{
    CHECK(String(0.2f, 2) == "0.20");
    CHECK(String(1.999f, 2) == "2.00");
    CHECK(String(-3) == "-3");
    CHECK(String(255u, HEX) == "ff");

    hal::serialRead();
    Serial.print(0.5f);
    Serial.print(' ');
    Serial.println(42);
    CHECK(hal::serialRead() == "0.50 42\r\n");
}

TEST_CASE_FIXTURE(FreshBoard, "a pin reads its pull until something outside drives it")
{
    pinMode(5, INPUT_PULLUP);
    CHECK(digitalRead(5) == HIGH);
    hal::drive(5, LOW);
    CHECK(digitalRead(5) == LOW);
    hal::release(5);
    CHECK(digitalRead(5) == HIGH);

    pinMode(6, INPUT_PULLDOWN);
    CHECK(digitalRead(6) == LOW);

    CHECK(hal::pinModeCalls() == 2);
    CHECK((padsbank0_hw->io[5] & PADS_BANK0_GPIO0_PUE_BITS) != 0);
    CHECK((padsbank0_hw->io[6] & PADS_BANK0_GPIO0_PDE_BITS) != 0);
    CHECK(gpio_get_function(5) == GPIO_FUNC_SIO);
    CHECK(gpio_get_function(7) == GPIO_FUNC_NULL);
}

TEST_CASE_FIXTURE(FreshBoard, "an output reads back what it was driven to")
{
    pinMode(9, OUTPUT);
    digitalWrite(9, HIGH);
    CHECK(hal::isOutput(9));
    CHECK(hal::outputLevel(9));
    CHECK(digitalRead(9) == HIGH);
    CHECK((sio_hw->gpio_oe & (1u << 9)) != 0);
    digitalWrite(9, LOW);
    CHECK_FALSE(hal::outputLevel(9));
}

TEST_CASE_FIXTURE(FreshBoard, "pinMode on a pin the chip does not have is counted and ignored")
{
    pinMode(200, INPUT_PULLUP);
    CHECK(hal::pinModeCalls() == 1);
    CHECK_FALSE(hal::modeSet(200));
}

TEST_CASE_FIXTURE(FreshBoard, "the clock moves on delay() and a little on every read")
{
    const unsigned long before = millis();
    delay(250);
    CHECK(millis() - before == 250);

    hal::setTickPerRead_us(0);
    const unsigned long us = micros();
    CHECK(micros() == us);
    delayMicroseconds(7);
    CHECK(micros() == us + 7);
    hal::setTickPerRead_us(1);
}

TEST_CASE_FIXTURE(FreshBoard, "a reboot unwinds to the caller as hal::Reboot")
{
    bool bootloader = false;
    try
    {
        rp2040.rebootToBootloader();
    }
    catch (const hal::Reboot& r)
    {
        bootloader = r.toBootloader;
    }
    CHECK(bootloader);
    CHECK_THROWS_AS(rp2040.reboot(), hal::Reboot);
}

TEST_CASE_FIXTURE(FreshBoard, "LittleFS: nothing opens unmounted, and a write lands on close")
{
    CHECK_FALSE(LittleFS.open("/a.cfg", "w"));
    REQUIRE(LittleFS.begin());

    File w = LittleFS.open("/a.cfg", "w");
    REQUIRE(w);
    w.print("hello");
    CHECK_FALSE(LittleFS.exists("/a.cfg"));
    w.close();
    CHECK(hal::flash().files["/a.cfg"] == "hello");

    File r = LittleFS.open("/a.cfg", "r");
    REQUIRE(r);
    CHECK(r.size() == 5);
    CHECK(r.readString() == "hello");

    CHECK_FALSE(LittleFS.open("/missing", "r"));
    CHECK(LittleFS.rename("/a.cfg", "/b.cfg"));
    CHECK_FALSE(LittleFS.exists("/a.cfg"));
    CHECK(LittleFS.remove("/b.cfg"));
    CHECK_FALSE(LittleFS.remove("/b.cfg"));
}

TEST_CASE_FIXTURE(FreshBoard, "LittleFS: a power cut stops the write it lands on and every one after")
{
    REQUIRE(LittleFS.begin());
    hal::flash().files["/keep"] = "old";
    hal::flash().cutPowerBeforeWrite = hal::flash().writes + 2;

    File w = LittleFS.open("/new", "w");
    w.print("x");
    w.close(); // write 1 lands
    CHECK(hal::flash().files.count("/new") == 1);
    CHECK_THROWS_AS(LittleFS.remove("/keep"), hal::PowerLoss); // write 2 is cut
    CHECK(hal::flash().files["/keep"] == "old");
    CHECK_THROWS_AS(LittleFS.rename("/new", "/keep"), hal::PowerLoss);
}

namespace
{
// One frame, answered by `reply`, and the time for that answer to land.
template <typename Reply> void exchange(BidirDShotX1& esc, Reply reply)
{
    esc.sendThrottle(0);
    reply();
    hal::advance_us(esc.replyLands_us());
}
} // namespace

TEST_CASE_FIXTURE(FreshBoard, "DShot: a reply decodes the way the library decodes a received frame")
{
    BidirDShotX1 esc(4, 300);
    REQUIRE(BidirDShotX1::on(4) == &esc);
    CHECK(gpio_get_function(4) == GPIO_FUNC_PIO0);

    uint32_t value = 12345;
    CHECK(esc.getTelemetryPacket(&value) == BidirDshotTelemetryType::CHECKSUM_ERROR); // the opening push
    CHECK(esc.getTelemetryPacket(&value) == BidirDshotTelemetryType::NO_PACKET);
    CHECK(value == 12345);

    // Close rather than exact: the period keeps 9 bits of mantissa, and the library's decode adds
    // 50 eRPM, which is 0.7% of the slowest reading here.
    for (uint32_t erpm : {7000u, 70000u, 210000u, 350000u})
    {
        exchange(esc, [&] { esc.replyErpm(erpm); });
        REQUIRE(esc.getTelemetryPacket(&value) == BidirDshotTelemetryType::ERPM);
        CHECK(value == doctest::Approx(erpm).epsilon(0.015));
    }

    exchange(esc, [&] { esc.replyErpm(0); });
    REQUIRE(esc.getTelemetryPacket(&value) == BidirDshotTelemetryType::ERPM);
    CHECK(value == 0);

    exchange(esc, [&] { esc.replyEdt(BidirDshotTelemetryType::TEMPERATURE, 41); });
    CHECK(esc.getTelemetryPacket(&value) == BidirDshotTelemetryType::TEMPERATURE);
    CHECK(value == 41);

    exchange(esc, [&] { esc.replyErpm(70000); });
    exchange(esc, [&] { esc.replyEdt(BidirDshotTelemetryType::VOLTAGE, 67); });
    CHECK(esc.getTelemetryPacket(&value) == BidirDshotTelemetryType::VOLTAGE);
    CHECK(esc.getTelemetryPacket(&value) == BidirDshotTelemetryType::NO_PACKET);

    exchange(esc, [&] { esc.replyCorrupt(); });
    CHECK(esc.getTelemetryPacket(&value) == BidirDshotTelemetryType::CHECKSUM_ERROR);

    const uint64_t frames = esc.frameCount;
    esc.sendThrottle(2500);
    CHECK(esc.lastThrottle == 2000);
    esc.sendRaw11Bit(DSHOT_CMD_EXTENDED_TELEMETRY_ENABLE);
    CHECK(esc.commands.back() == DSHOT_CMD_EXTENDED_TELEMETRY_ENABLE);
    CHECK(esc.frameCount == frames + 2);
}

TEST_CASE_FIXTURE(FreshBoard, "DShot: a reply lands once the frame, the turnaround and the reply are over")
{
    BidirDShotX1 dshot300(4, 300);
    BidirDShotX1 dshot600(5, 600);
    CHECK(dshot300.frame_us() == 54);
    CHECK(dshot300.replyLands_us() == 140);
    CHECK(dshot600.frame_us() == 27);
    CHECK(dshot600.replyLands_us() == 85);

    uint32_t value;
    dshot300.getTelemetryPacket(&value);
    dshot300.sendThrottle(0);
    dshot300.replyErpm(70000);
    hal::advance_us(dshot300.replyLands_us() - 1);
    CHECK_FALSE(dshot300.checkTelemetryAvailable());
    CHECK(dshot300.getTelemetryPacket(&value) == BidirDshotTelemetryType::NO_PACKET);
    hal::advance_us(1);
    CHECK(dshot300.checkTelemetryAvailable());
    CHECK(dshot300.getTelemetryPacket(&value) == BidirDshotTelemetryType::ERPM);
}

TEST_CASE_FIXTURE(FreshBoard, "DShot: a frame offered before the reply has landed aborts it")
{
    BidirDShotX1 esc(4, 300);
    uint32_t value;
    esc.getTelemetryPacket(&value);

    esc.sendThrottle(100);
    esc.replyErpm(70000);
    hal::advance_us(esc.replyLands_us() - 1);
    esc.sendThrottle(100);
    CHECK(esc.repliesAborted == 1);
    CHECK(esc.framesCut == 0);
    hal::advance_us(1000);
    CHECK(esc.getTelemetryPacket(&value) == BidirDshotTelemetryType::NO_PACKET);

    // Still going out: the frame is cut as well, so the ESC never had it to answer.
    esc.sendThrottle(100);
    esc.replyErpm(70000);
    hal::advance_us(esc.frame_us() - 1);
    esc.sendThrottle(200);
    CHECK(esc.framesCut == 1);
    CHECK(esc.repliesAborted == 2);

    // An ESC that does not answer leaves nothing to abort.
    hal::advance_us(1000);
    esc.sendThrottle(0);
    hal::advance_us(100);
    esc.sendThrottle(0);
    CHECK(esc.repliesAborted == 2);

    // One frame a millisecond, read before the next, as the control loop runs: nothing is lost.
    hal::advance_us(1000);
    for (int i = 0; i < 10; i++)
    {
        exchange(esc, [&] { esc.replyErpm(70000); });
        hal::advance_us(1000 - esc.replyLands_us());
        CHECK(esc.getTelemetryPacket(&value) == BidirDshotTelemetryType::ERPM);
    }
    CHECK(esc.repliesAborted == 2);
    CHECK(esc.framesCut == 1);
}

TEST_CASE_FIXTURE(FreshBoard, "DShot: the FIFO holds four unread replies, and a fifth waits for a read")
{
    BidirDShotX1 esc(4, 300);
    uint32_t value;
    esc.getTelemetryPacket(&value);

    for (uint32_t i = 1; i <= 5; i++)
        exchange(esc, [&] { esc.replyErpm(i * 10000); });
    CHECK(esc.repliesFifoFull == 0);
    exchange(esc, [&] { esc.replyErpm(60000); }); // the waiting fifth is dropped, the sixth waits
    CHECK(esc.repliesFifoFull == 1);
    REQUIRE(esc.getTelemetryPacket(&value) == BidirDshotTelemetryType::ERPM);
    CHECK(value == doctest::Approx(60000).epsilon(0.015));

    // Read before the newest has landed, the newest the FIFO has is the fourth.
    for (uint32_t i = 1; i <= 4; i++)
        exchange(esc, [&] { esc.replyErpm(i * 10000); });
    esc.sendThrottle(0);
    esc.replyErpm(90000);
    REQUIRE(esc.getTelemetryPacket(&value) == BidirDshotTelemetryType::ERPM);
    CHECK(value == doctest::Approx(40000).epsilon(0.015));
}

TEST_CASE("the heap counts a core's allocations as newlib would hold them, and refuses past the limit")
{
    hal::detail::heapCountThisThread(0);
    const hal::Heap start = hal::heap();

    void* small = malloc(1);
    void* block = malloc(100);
    CHECK(hal::heap().live - start.live == 16 + 104);
    block = realloc(block, 200);
    CHECK(hal::heap().live - start.live == 16 + 208);
    {
        const hal::detail::FakesOwnHeap fakes;
        void* theirs = malloc(1000);
        CHECK(hal::heap().live - start.live == 16 + 208);
        free(theirs);
    }

    hal::setHeapLimit(start.live + 1024);
    void* tooBig = malloc(1024);
    CHECK(tooBig == nullptr);
    CHECK(realloc(block, 2000) == nullptr); // the old block stands
    CHECK(hal::heap().refused - start.refused == 2);
    CHECK(hal::heap().live - start.live == 16 + 208);
    hal::setHeapLimit(0);

    free(small);
    free(block);
    CHECK(hal::heap().live == start.live);
    hal::detail::heapCountThisThread(0, false);
    void* host = malloc(64);
    CHECK(hal::heap().live == start.live);
    free(host);
}

TEST_CASE_FIXTURE(FreshBoard, "Wire panics on a pin its block cannot use, as the core does")
{
    CHECK_THROWS_AS(Wire.setSDA(1), hal::Panic);
    CHECK_THROWS_AS(Wire1.setSDA(4), hal::Panic);
    CHECK(Wire.setSDA(4));
    CHECK(Wire.setSCL(5));
    CHECK(Wire1.setSDA(26));
    CHECK(Wire1.setSCL(27));
    Wire.begin();
    CHECK_THROWS_AS(Wire.setSDA(8), hal::Panic);
}

TEST_CASE_FIXTURE(FreshBoard, "Wire: only a present device acknowledges a probe")
{
    Wire.setSDA(4);
    Wire.setSCL(5);
    Wire.begin();
    Wire.beginTransmission(0x3C);
    CHECK(Wire.endTransmission() == 2);
    hal::setI2cDevice(0x3C, true);
    Wire.beginTransmission(0x3C);
    CHECK(Wire.endTransmission() == 0);
    CHECK(Wire.endTransmission() == 4); // no transmission begun
}

TEST_CASE_FIXTURE(FreshBoard, "outside a running machine a delay is plain time")
{
    const uint64_t t0 = hal::now_us();
    delay(3);
    CHECK(hal::now_us() - t0 >= 3000);
}

TEST_CASE_FIXTURE(FreshBoard,
                  "the panel reads text drawn in the GLCD font, highlighted or not, row on row")
{
    sim::Panel panel;
    panel.mountedUpsideDown = false;
    panel.attach(0x3C);
    hal::setI2cDevice(0x3C, true);
    Wire.setSDA(4);
    Wire.setSCL(5);
    Wire.begin();

    // One SSD1306 frame by hand: horizontal addressing over the whole panel, then 1 KB of data
    // with "HI" in the top-left page, drawn by the real GFX code into a canvas first.
    GFXcanvas1 canvas(128, 64);
    canvas.fillScreen(0);
    canvas.setCursor(0, 0);
    canvas.print("HI");
    canvas.fillRect(0, 16, 128, 8, 1);
    canvas.setTextColor(0);
    canvas.setCursor(6, 16);
    canvas.print("SEL");
    canvas.setTextColor(1);
    canvas.setCursor(0, 32);
    canvas.print("ESC Passthrough, disc");
    canvas.setCursor(0, 40);
    canvas.print("onnect to exit");

    auto send = [](std::initializer_list<uint8_t> bytes)
    {
        Wire.beginTransmission(0x3C);
        for (uint8_t b : bytes)
            Wire.write(b);
        Wire.endTransmission();
    };
    send({0x00, 0xAF, 0xA1, 0xC8, 0x20, 0x00, 0x21, 0, 127, 0x22, 0, 7});
    for (int page = 0; page < 8; page++)
    {
        for (int col = 0; col < 128; col += 16)
        {
            Wire.beginTransmission(0x3C);
            Wire.write((uint8_t)0x40);
            for (int c = col; c < col + 16; c++)
            {
                uint8_t v = 0;
                for (int bit = 0; bit < 8; bit++)
                    v |= canvas.getPixel(c, page * 8 + bit) ? (1 << bit) : 0;
                Wire.write(v);
            }
            Wire.endTransmission();
        }
    }
    CHECK(panel.on());
    CHECK(panel.shows("HI"));
    CHECK(panel.highlighted() == "SEL");
    CHECK(panel.text() == "  HI\n> SEL\n  ESC Passthrough, disc\n  onnect to exit\n");
}
