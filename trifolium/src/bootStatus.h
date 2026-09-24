#pragma once
#include <Arduino.h>

// Boot faults print before the host has re-enumerated the USB CDC port, so nothing catches them
// live. Recorded here as well, and read back with DUMP_BOOT.
namespace BootStatus
{
// probed stays false when hasDisplay is off, which keeps "no panel wired" and "panel wired but
// silent" apart.
void recordDisplay(bool probed, bool ok, const char* err);

void recordWiring(const char* id, bool configured);

// Live rather than a boot-time fact: the root menu's Idle Mode toggle flips it mid-session.
void recordIdleHold(bool engaged);
void recordBootProfile(int8_t slot); // -1: no boot action chose one

// A plain global, so a reboot clears it and a true here means the fall-through really happened.
void recordPassthroughExit();

// answeredAt_ms[i] is the uptime motor i's first eRPM frame decoded at, or -1 if none did. Written
// from the control loop after core 1 is released, so `ran` false means "not finished yet" rather
// than "never happened"; it is set last, so a true there means the rest is readable.
void recordEscArming(const int32_t answeredAt_ms[4], uint32_t duration_ms, bool timedOut);

// Only a file read off flash: a bad upload fails in front of the host that sent it.
enum class ConfigFault : uint8_t
{
    DeviceVersionRefused,  // device.cfg was outside the migratable range, so settings were reset
    ProfileVersionRefused, // a profile file was, so that slot kept its defaults
    WiringUnavailable,     // the config predates stored wiring; there is no table to rebuild it
};

// `detail` is copied, not held.
void recordConfigFault(ConfigFault fault, const char* detail);

void writeJson(Print& out);
} // namespace BootStatus
