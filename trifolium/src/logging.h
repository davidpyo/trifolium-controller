#pragma once
#include <Arduino.h>

extern bool printTelemetry; // defined in CONFIGURATION.h

template <typename T>
void println(T value)
{
    if (printTelemetry)
        Serial.println(value);
}

template <typename T>
void print(T value)
{
    if (printTelemetry)
        Serial.print(value);
}

// logs "millis() [LEVEL] <args...>" as a single line, e.g. logger.info("shotsToFire ", shotsToFire);
class Logger
{
public:
    template <typename... Args>
    void info(Args... args)
    {
        logLine("INFO", args...);
    }

    template <typename... Args>
    void error(Args... args)
    {
        logLine("ERROR", args...);
    }

private:
    template <typename... Args>
    void logLine(const char *level, Args... args)
    {
        print(millis());
        print(" [");
        print(level);
        print("] ");
        logParts(args...);
        println("");
    }

    template <typename T>
    void logParts(T value)
    {
        print(value);
    }

    template <typename T, typename... Rest>
    void logParts(T first, Rest... rest)
    {
        print(first);
        logParts(rest...);
    }
};

inline Logger logger;
