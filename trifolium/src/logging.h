#pragma once
#include <Arduino.h>

#include "serialLock.h"

extern bool printTelemetry; // defined in CONFIGURATION.h

// logs "millis() [LEVEL] <args...>" as a single line, e.g. logger.info("shotsToFire ",
// shotsToFire);
//
// fatal/error print regardless of printTelemetry, which defaults to false: a device that resets its
// config, refuses a command, or disables a motor has to be able to say so on a stock unit.
//
// warn/info stay gated. Several of them sit in the 1 kHz control loop, where unconditional printing
// would flood the port.
//
// A line is built whole, then handed to SerialLock: printed now, or once the reply the other core is
// sending has gone out - never inside it, and never waiting for it.
class Logger
{
  public:
    template <typename... Args> void fatal(Args... args) { logLine(true, "FATAL", args...); }

    template <typename... Args> void error(Args... args) { logLine(true, "ERROR", args...); }

    template <typename... Args> void warn(Args... args)
    {
        logLine(printTelemetry, "WARN", args...);
    }

    template <typename... Args> void info(Args... args)
    {
        logLine(printTelemetry, "INFO", args...);
    }

  private:
    // One line, cut short past its buffer.
    class Line : public Print
    {
      public:
        size_t write(uint8_t c) override
        {
            if (len_ < sizeof(buf_) - 2)
                buf_[len_++] = (char)c;
            return 1;
        }
        void end()
        {
            buf_[len_++] = '\r';
            buf_[len_++] = '\n';
        }
        const char* data() const { return buf_; }
        size_t size() const { return len_; }

      private:
        char buf_[192];
        size_t len_ = 0;
    };

    // The gate is checked once here rather than per-part, so a level that is off costs nothing.
    template <typename... Args> void logLine(bool enabled, const char* level, Args... args)
    {
        if (!enabled)
            return;
        Line line;
        line.print(millis());
        line.print(" [");
        line.print(level);
        line.print("] ");
        logParts(line, args...);
        line.end();
        SerialLock::keep(line.data(), line.size());
        if (SerialLock::tryHold())
            SerialLock::release();
    }

    template <typename T> void logParts(Print& out, T value) { out.print(value); }

    template <typename T, typename... Rest> void logParts(Print& out, T first, Rest... rest)
    {
        out.print(first);
        logParts(out, rest...);
    }
};

inline Logger logger;
