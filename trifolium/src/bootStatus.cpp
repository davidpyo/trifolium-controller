#include "bootStatus.h"
#include <cstring> // strncpy() - recordConfigFault() copies its detail
#include "hardware/clocks.h" // clock_get_hz() - the clock a passthrough session leaves behind

namespace
{
bool displayProbed_ = false;
bool displayOk_ = false;
const char* displayErr_ = "";

char boardId_[24] = "";
bool wiringConfigured_ = false;
bool idleHoldEngaged_ = false;
bool passthroughExited_ = false;

int32_t escAnsweredAt_ms_[4] = {-1, -1, -1, -1};
uint32_t escArmDuration_ms_ = 0;
bool escArmTimedOut_ = false;
bool escArmRecorded_ = false;

// Three profile slots plus the device file plus the board is the worst case, and a repeat of the
// same fault says nothing new, so this cannot overflow in practice; the cap is here so it cannot
// overflow in principle either.
const uint8_t kMaxFaults = 5;
struct FaultEntry
{
    BootStatus::ConfigFault fault;
    char detail[24];
};
FaultEntry faults_[kMaxFaults];
uint8_t faultCount_ = 0;

const char* faultName(BootStatus::ConfigFault fault)
{
    switch (fault)
    {
    case BootStatus::ConfigFault::DeviceVersionRefused: return "deviceVersionRefused";
    case BootStatus::ConfigFault::ProfileVersionRefused: return "profileVersionRefused";
    case BootStatus::ConfigFault::WiringUnavailable:
    default: return "wiringUnavailable";
    }
}
} // namespace

namespace BootStatus
{
// Written once on core 1 during setup1(), read on whichever core serves the command afterwards.
// Only literals are stored, so the pointer stays valid.
void recordDisplay(bool probed, bool ok, const char* err)
{
    displayProbed_ = probed;
    displayOk_ = ok;
    displayErr_ = err ? err : "";
}

// Written on core 0 during setup(), before bootSettingsLoaded releases core 1. The id is copied
// rather than held: it comes off a String inside deviceSettings, which the console can rewrite.
void recordWiring(const char* id, bool configured)
{
    boardId_[0] = '\0';
    if (id)
        strncpy(boardId_, id, sizeof(boardId_) - 1);
    boardId_[sizeof(boardId_) - 1] = '\0';
    wiringConfigured_ = configured;
}

// Written from setup()'s boot-action dispatch (POR only) and, live, from the root menu's "Idle
// Mode" toggle - whichever changed it last wins, since this tracks current state, not a one-shot.
void recordIdleHold(bool engaged)
{
    idleHoldEngaged_ = engaged;
}

// Written on core 0, after bootSettingsLoaded has released core 1 - unavoidably, since the session
// it reports ends long after that. A single bool store, and absent means "no session this boot".
void recordPassthroughExit()
{
    passthroughExited_ = true;
}

// Written on core 0 during setup(), from the same load that sets the board, so it lands before
// bootSettingsLoaded releases core 1 and is only read afterwards.
void recordConfigFault(ConfigFault fault, const char* detail)
{
    if (faultCount_ >= kMaxFaults)
        return;
    FaultEntry& entry = faults_[faultCount_++];
    entry.fault = fault;
    entry.detail[0] = '\0';
    if (detail)
        strncpy(entry.detail, detail, sizeof(entry.detail) - 1);
    entry.detail[sizeof(entry.detail) - 1] = '\0';
}

void recordEscArming(const int32_t answeredAt_ms[4], uint32_t duration_ms, bool timedOut)
{
    for (int i = 0; i < 4; i++)
        escAnsweredAt_ms_[i] = answeredAt_ms[i];
    escArmDuration_ms_ = duration_ms;
    escArmTimedOut_ = timedOut;
    escArmRecorded_ = true;
}

void writeJson(Print& out)
{
    out.print("{\"cmd\":\"DUMP_BOOT\",\"ok\":true,\"display\":{\"probed\":");
    out.print(displayProbed_ ? "true" : "false");
    out.print(",\"ok\":");
    out.print(displayOk_ ? "true" : "false");
    out.print(",\"err\":\"");
    out.print(displayErr_);
    out.print("\"},\"wiring\":{\"boardId\":\"");
    out.print(boardId_);
    out.print("\",\"configured\":");
    out.print(wiringConfigured_ ? "true" : "false");
    out.print("},\"idleHold\":");
    out.print(idleHoldEngaged_ ? "true" : "false");
    out.print(",\"passthroughExited\":");
    out.print(passthroughExited_ ? "true" : "false");
    out.print(",\"escArming\":{\"ran\":");
    out.print(escArmRecorded_ ? "true" : "false");
    out.print(",\"duration_ms\":");
    out.print(escArmDuration_ms_);
    out.print(",\"timedOut\":");
    out.print(escArmTimedOut_ ? "true" : "false");
    out.print(",\"answeredAt_ms\":[");
    for (int i = 0; i < 4; i++)
    {
        if (i)
            out.print(',');
        out.print(escAnsweredAt_ms_[i]);
    }
    out.print("]}");
    out.print(",\"sysClockHz\":");
    out.print(clock_get_hz(clk_sys));
    out.print(",\"configFaults\":[");
    for (uint8_t i = 0; i < faultCount_; i++)
    {
        if (i)
            out.print(',');
        out.print("{\"fault\":\"");
        out.print(faultName(faults_[i].fault));
        out.print("\",\"detail\":\"");
        out.print(faults_[i].detail);
        out.print("\"}");
    }
    out.println("]}");
}
} // namespace BootStatus
