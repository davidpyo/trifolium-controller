#include "sim_panel.h"

#include <Adafruit_GFX.h>

#include <algorithm>
#include <map>

namespace sim
{
namespace
{
// Each printable character as the five 8-pixel columns the GLCD font draws it with, keyed by those
// columns packed into one number.
const std::map<uint64_t, char>& glyphs()
{
    static std::map<uint64_t, char> table = []
    {
        std::map<uint64_t, char> out;
        for (int c = 33; c < 127; c++)
        {
            GFXcanvas1 canvas(6, 8);
            canvas.fillScreen(0);
            canvas.drawChar(0, 0, (unsigned char)c, 1, 0, 1);
            uint64_t key = 0;
            for (int x = 0; x < 5; x++)
            {
                uint8_t column = 0;
                for (int y = 0; y < 8; y++)
                {
                    if (canvas.getPixel(x, y))
                        column |= (uint8_t)(1u << y);
                }
                key = (key << 8) | column;
            }
            out.emplace(key, (char)c);
        }
        return out;
    }();
    return table;
}

// Argument bytes each multi-byte command takes; the rest take none.
uint8_t argumentsOf(uint8_t cmd)
{
    switch (cmd)
    {
    case 0x81: // contrast
    case 0x20: // memory mode
    case 0x8D: // charge pump
    case 0xA8: // multiplex
    case 0xD3: // display offset
    case 0xD5: // clock divide
    case 0xD9: // precharge
    case 0xDA: // COM pins
    case 0xDB: // VCOMH
        return 1;
    case 0x21: // column range
    case 0x22: // page range
    case 0xA3: // vertical scroll area
        return 2;
    case 0x29:
    case 0x2A:
        return 5;
    case 0x26:
    case 0x27:
        return 6;
    default:
        return 0;
    }
}
} // namespace

Panel::Panel() = default;

Panel::~Panel()
{
    hal::setI2cHook(nullptr);
}

void Panel::attach(uint8_t address)
{
    address_ = address;
    hal::setI2cHook([this](const hal::I2cWrite& w) { consume(w); });
}

void Panel::consume(const hal::I2cWrite& w)
{
    if (w.address != address_ || w.bytes.empty())
        return;
    // One control byte per transaction, as the Adafruit driver sends it: 0x00 commands, 0x40 data.
    const bool isData = (w.bytes[0] & 0x40) != 0;
    for (size_t i = 1; i < w.bytes.size(); i++)
    {
        if (isData)
            data(w.bytes[i]);
        else
            command(w.bytes[i]);
    }
}

void Panel::command(uint8_t b)
{
    if (argsWanted_)
    {
        args_[argCount_++] = b;
        if (argCount_ == argsWanted_)
            finish();
        return;
    }
    const uint8_t wanted = argumentsOf(b);
    if (wanted)
    {
        pending_ = b;
        argsWanted_ = wanted;
        argCount_ = 0;
        return;
    }
    switch (b)
    {
    case 0xAE: on_ = false; break;
    case 0xAF: on_ = true; break;
    case 0xA6: inverse_ = false; break;
    case 0xA7: inverse_ = true; break;
    case 0xA0: segRemap_ = false; break;
    case 0xA1: segRemap_ = true; break;
    case 0xC0: comRemap_ = false; break;
    case 0xC8: comRemap_ = true; break;
    default:
        // Page-mode addressing sets the page and column one nibble at a time.
        if (b >= 0xB0 && b <= 0xB7)
            page_ = b & 0x07;
        else if (b <= 0x0F)
            col_ = (uint8_t)((col_ & 0xF0) | b);
        else if (b >= 0x10 && b <= 0x1F)
            col_ = (uint8_t)((col_ & 0x0F) | ((b & 0x0F) << 4));
        break;
    }
}

void Panel::finish()
{
    switch (pending_)
    {
    case 0x81: contrast_ = args_[0]; break;
    case 0x20: mode_ = args_[0] & 0x03; break;
    case 0x21:
        colStart_ = args_[0] & 0x7F;
        colEnd_ = args_[1] & 0x7F;
        col_ = colStart_;
        break;
    case 0x22:
        pageStart_ = args_[0] & 0x07;
        pageEnd_ = args_[1] & 0x07;
        page_ = pageStart_;
        break;
    default: break;
    }
    argsWanted_ = 0;
    argCount_ = 0;
}

void Panel::data(uint8_t b)
{
    ram_[page_ & 7][col_ & 127] = b;
    dataBytes_++;
    if (mode_ == 0) // horizontal: across the column window, then down a page
    {
        if (col_ >= colEnd_)
        {
            col_ = colStart_;
            page_ = page_ >= pageEnd_ ? pageStart_ : (uint8_t)(page_ + 1);
        }
        else
        {
            col_++;
        }
    }
    else if (mode_ == 1) // vertical: down the page window, then across a column
    {
        if (page_ >= pageEnd_)
        {
            page_ = pageStart_;
            col_ = col_ >= colEnd_ ? colStart_ : (uint8_t)(col_ + 1);
        }
        else
        {
            page_++;
        }
    }
    else if (col_ < 127)
    {
        col_++;
    }
}

bool Panel::pixel(int x, int y) const
{
    if (x < 0 || y < 0 || x >= kWidth || y >= kHeight)
        return false;
    if (mountedUpsideDown)
    {
        x = kWidth - 1 - x;
        y = kHeight - 1 - y;
    }
    // The Adafruit driver's A1/C8 is the orientation it draws for, so that is the unflipped one.
    const int col = segRemap_ ? x : kWidth - 1 - x;
    const int row = comRemap_ ? y : kHeight - 1 - y;
    const bool lit = (ram_[row / 8][col] >> (row % 8)) & 1;
    return lit != inverse_;
}

int Panel::litPixels() const
{
    int n = 0;
    for (int y = 0; y < kHeight; y++)
    {
        for (int x = 0; x < kWidth; x++)
            n += pixel(x, y) ? 1 : 0;
    }
    return n;
}

std::string Panel::ascii() const
{
    std::string out;
    for (int y = 0; y < kHeight; y++)
    {
        for (int x = 0; x < kWidth; x++)
            out += pixel(x, y) ? '#' : '.';
        out += '\n';
    }
    return out;
}

std::vector<Panel::Line> Panel::lines() const
{
    // column(x, y): the 8 pixels from (x, y) down, as a byte.
    auto column = [this](int x, int y)
    {
        uint8_t v = 0;
        for (int i = 0; i < 8; i++)
        {
            if (pixel(x, y + i))
                v |= (uint8_t)(1u << i);
        }
        return v;
    };

    struct Hit
    {
        int x, y;
        char c;
        bool inverted;
    };
    std::vector<Hit> hits;
    const auto& table = glyphs();
    for (int y = 0; y + 8 <= kHeight; y++)
    {
        for (int x = 0; x + 5 <= kWidth; x++)
        {
            for (bool inv : {false, true})
            {
                const uint8_t blank = inv ? 0xFF : 0x00;
                // The gap either side of a glyph is background, which is what keeps a stroke of
                // some drawing from reading as a '-' or a '|'.
                if (x > 0 && column(x - 1, y) != blank)
                    continue;
                if (x + 5 < kWidth && column(x + 5, y) != blank)
                    continue;
                uint64_t key = 0;
                for (int i = 0; i < 5; i++)
                    key = (key << 8) | (uint8_t)(inv ? ~column(x + i, y) : column(x + i, y));
                auto it = table.find(key);
                if (it != table.end())
                    hits.push_back({x, y, it->second, inv});
            }
        }
    }

    std::sort(hits.begin(), hits.end(), [](const Hit& a, const Hit& b)
              { return a.y != b.y ? a.y < b.y : a.x < b.x; });

    std::vector<Line> found;
    for (size_t i = 0; i < hits.size();)
    {
        Line line{hits[i].x, hits[i].y, std::string(1, hits[i].c), hits[i].inverted};
        int lastX = hits[i].x;
        size_t j = i + 1;
        for (; j < hits.size() && hits[j].y == line.y && hits[j].inverted == line.highlighted; j++)
        {
            const int gap = hits[j].x - lastX;
            if (gap % 6 != 0)
                break; // not on this string's character grid
            line.text += std::string((size_t)(gap / 6 - 1), ' ') + hits[j].c;
            lastX = hits[j].x;
        }
        found.push_back(line);
        i = j;
    }

    // Rows of text 8 px apart leave descenders and ascenders that match a short glyph between them,
    // like the tail of a 'g' reading as a '\''. Longer lines claim their pixels first.
    std::stable_sort(found.begin(), found.end(), [](const Line& a, const Line& b)
                     { return a.text.size() > b.text.size(); });
    auto overlaps = [](const Line& a, const Line& b)
    {
        const int aRight = a.x + 6 * (int)a.text.size(), bRight = b.x + 6 * (int)b.text.size();
        return a.x < bRight && b.x < aRight && a.y < b.y + 8 && b.y < a.y + 8;
    };
    std::vector<Line> out;
    for (const Line& line : found)
    {
        if (std::none_of(out.begin(), out.end(), [&](const Line& kept) { return overlaps(line, kept); }))
            out.push_back(line);
    }
    std::sort(out.begin(), out.end(),
              [](const Line& a, const Line& b) { return a.y != b.y ? a.y < b.y : a.x < b.x; });
    return out;
}

std::string Panel::text() const
{
    std::string out;
    for (const Line& l : lines())
        out += (l.highlighted ? "> " : "  ") + l.text + "\n";
    return out;
}

bool Panel::shows(const std::string& s) const
{
    for (const Line& l : lines())
    {
        if (l.text.find(s) != std::string::npos)
            return true;
    }
    return false;
}

std::string Panel::highlighted() const
{
    for (const Line& l : lines())
    {
        if (l.highlighted)
            return l.text;
    }
    return "";
}
} // namespace sim
