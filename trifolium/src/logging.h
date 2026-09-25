#pragma once
#include <Arduino.h>

extern bool printTelemetry; // defined in CONFIGURATION.h

// logs "millis() [LEVEL] <args...>" as a single line, e.g. logger.info("shotsToFire ",
// shotsToFire);
//
// fatal/error print regardless of printTelemetry, which defaults to false: a device that resets its
// config, refuses a command, or disables a motor has to be able to say so on a stock unit.
//
// warn/info stay gated. Several of them sit in the 1 kHz control loop, where unconditional printing
// would flood the port and interleave into DUMP_SCHEMA's single-line output.
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
    // The gate is checked once here rather than per-part, so a level that is off costs nothing and
    // a line can never be emitted half-written.
    template <typename... Args> void logLine(bool enabled, const char* level, Args... args)
    {
        if (!enabled)
            return;
        Serial.print(millis());
        Serial.print(" [");
        Serial.print(level);
        Serial.print("] ");
        logParts(args...);
        Serial.println();
    }

    template <typename T> void logParts(T value) { Serial.print(value); }

    template <typename T, typename... Rest> void logParts(T first, Rest... rest)
    {
        Serial.print(first);
        logParts(rest...);
    }
};

inline Logger logger;
