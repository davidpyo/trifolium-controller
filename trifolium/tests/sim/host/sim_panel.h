#pragma once
// An SSD1306 on the I2C bus, rebuilt from the bytes the firmware actually sends - so what a test
// reads is what the panel would show, not the driver's RAM copy, which is only half the path.
//
// lines() reads the screen the way a person does: every size-1 string in the GLCD font, found by
// matching glyphs the real Adafruit GFX code draws, with the highlighted (inverted) row marked.

#include "hal/hal.h"

#include <string>
#include <vector>

namespace sim
{
class Panel
{
  public:
    static constexpr int kWidth = 128;
    static constexpr int kHeight = 64;

    Panel();
    ~Panel();

    // Listens to every transaction to `address` on the bus from now on.
    void attach(uint8_t address = 0x3C);
    void consume(const hal::I2cWrite& w);

    // How the panel sits in the blaster - a fact about the build, which rotateDisplay is the
    // firmware's answer to. Upside down is how the shipped setting expects it.
    bool mountedUpsideDown = true;

    bool on() const { return on_; }
    uint8_t contrast() const { return contrast_; }
    bool inverted() const { return inverse_; }
    uint64_t dataBytes() const { return dataBytes_; }

    // As the panel shows it: RAM through the segment and COM remap, and inverse.
    bool pixel(int x, int y) const;
    int litPixels() const;

    // '#' and '.', one row per line - for a failure message or a golden image.
    std::string ascii() const;

    struct Line
    {
        int x, y;
        std::string text;
        bool highlighted;
    };
    std::vector<Line> lines() const;
    std::string text() const; // every line, top to bottom, one per row
    bool shows(const std::string& s) const;
    std::string highlighted() const; // the highlighted line's text, or ""

  private:
    uint8_t address_ = 0x3C;
    uint8_t ram_[8][128] = {};
    bool on_ = false;
    bool inverse_ = false;
    uint8_t contrast_ = 0x7F;
    bool segRemap_ = false;
    bool comRemap_ = false;
    uint8_t mode_ = 2; // page addressing, the power-on default
    uint8_t colStart_ = 0, colEnd_ = 127, pageStart_ = 0, pageEnd_ = 7;
    uint8_t col_ = 0, page_ = 0;
    uint64_t dataBytes_ = 0;

    uint8_t pending_ = 0;     // a command still waiting for its arguments
    uint8_t argsWanted_ = 0;
    uint8_t args_[6] = {};
    uint8_t argCount_ = 0;

    void command(uint8_t b);
    void finish();
    void data(uint8_t b);
};
} // namespace sim
