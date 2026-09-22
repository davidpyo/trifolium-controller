#pragma once
#include <Arduino.h>

// Runtime pin resolution: what this configuration would drive, what collides, and what it asks the
// chip to do that the chip cannot. Policy is resolution, never refusal - a device that refuses to
// boot cannot be repaired from the console. Resolution happens in RAM only: the stored config is
// left as the user wrote it, so the conflict re-reports on the next boot rather than being erased
// from disk. The one exception is batteryAdcPin, which folds to unused in
// AdcPinItem::clampToBounds() and persists like any other clamp.
namespace PinConflicts
{

enum class Action : uint8_t
{
    PinCleared,     // a deviceSettings pin was detached for this boot
    MotorDisabled,  // a motor's ESC channel has no pin
    PusherDisabled, // the configured pusher channel has no pin
    DisplayOff,     // the I2C pair is not one any hardware block can serve
    // Nothing was taken away; the pin works and is simply worth a look. Nothing records one
    // today - it is the category an advisory goes in, and the one losses() excludes.
    PinWarning,
};

struct Entry
{
    const char* field;   // "triggerSwitchPin", "motor3", "pusher"
    uint8_t pin;         // the contested GPIO, or PIN_NOT_USED when there was none
    const char* against; // what it lost to: "esc1", "i2cScl", "menuButtonPin", "notAnAdcPin"
    Action action;
};

// Resolves capability first, then collisions. Runs on core 0 before bootSettingsLoaded releases
// core 1, and nothing writes the results afterwards, so they are lock-free to read from either
// core.
//
// Must run before evaluateBootAction(), which reaches pinMode() through heldAtBoot() and would
// otherwise attach an input on a pin something else drives.
void resolve();

// Recorded by validatePusherAndMotors() rather than duplicated here: it already implements the
// motor-loses-to-pusher rule, and having two copies of it invites them to disagree.
void record(const char* field, uint8_t pin, const char* against, Action action);

uint8_t count();

// Entries that actually took something away, i.e. everything but Action::PinWarning. The OLED
// banner and the boot log count these rather than count(), so an advisory can never raise an
// alarm: a banner that comes up every boot on a correctly wired blaster means nothing within a
// week. Equal to count() while nothing records a PinWarning.
uint8_t losses();

const Entry* entries();

// Its own question, because losing this pin is the one resolution that takes away the route used
// to fix it: the OLED menu becomes unreachable and serial is all that is left.
bool menuButtonLost();

// The array for the DUMP_SCHEMA header, so the console can explain why an input does nothing.
void writeJson(Print& out);

} // namespace PinConflicts
