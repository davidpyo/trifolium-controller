#include "pinConflicts.h"

#include "CONFIGURATION.h"
#include "pinCapabilities.h"
#include "deviceSettings.h"
#include "logging.h"
#include "types.h"

extern DeviceSettings deviceSettings;
extern bool motorsEnabled[4];
extern bool pusherValid;
extern bool pinDefined(uint8_t pin);
extern uint8_t escPin(uint8_t motorIndex);
extern uint8_t pusherPin();

// The runtime pin set this owns. Defined in main.cpp, written only from resolve().
extern uint8_t menuButtonPin;
extern uint8_t triggerSwitchPin;
extern uint8_t revSwitchPin;
extern uint8_t cycleSwitchPin;
extern uint8_t idleSwitchPin;
extern uint8_t safetySwitchPin;
extern uint8_t selectPins[3];
extern uint8_t ledDataPin;
extern uint8_t batteryAdcPin;
extern uint8_t escEnablePin;
extern bool displayAllowed;
extern bool wiringLive;

namespace
{
// 9 switch pins + 4 motors + the pusher + 2 I2C + the ADC + the LED + ESC enable is 19, and every
// one of those can also carry a warning; nothing reaches the cap in practice.
const uint8_t kMaxEntries = 40;
PinConflicts::Entry entries_[kMaxEntries];
uint8_t count_ = 0;
uint8_t losses_ = 0;
bool menuButtonLost_ = false;

// The deviceSettings input pins, highest priority first. When two collide the later one loses, so
// this list is the contract - moving an entry changes which switch a user loses. Safety is first
// because losing it fails open: a detached safety switch reads as disengaged and the blaster fires.
struct PinSlot
{
    uint8_t* live;         // the runtime global this slot resolves into
    const uint8_t* stored; // what the user asked for; never written
    const char* field;
};

const uint8_t kSlotCount = 9;

// Seeds the runtime pins from the stored ones and returns the slot table. Splitting live from
// stored here is the whole safety property: everything below writes only through `live`.
void seedSlots(PinSlot* out)
{
    uint8_t n = 0;
    out[n++] = {&safetySwitchPin, &deviceSettings.safetySwitchPin, "safetySwitchPin"};
    out[n++] = {&triggerSwitchPin, &deviceSettings.triggerSwitchPin, "triggerSwitchPin"};
    out[n++] = {&revSwitchPin, &deviceSettings.revSwitchPin, "revSwitchPin"};
    out[n++] = {&menuButtonPin, &deviceSettings.menuButtonPin, "menuButtonPin"};
    out[n++] = {&cycleSwitchPin, &deviceSettings.cycleSwitchPin, "cycleSwitchPin"};
    out[n++] = {&idleSwitchPin, &deviceSettings.idleSwitchPin, "idleSwitchPin"};
    out[n++] = {&selectPins[0], &deviceSettings.select0Pin, "select0Pin"};
    out[n++] = {&selectPins[1], &deviceSettings.select1Pin, "select1Pin"};
    out[n++] = {&selectPins[2], &deviceSettings.select2Pin, "select2Pin"};
    for (uint8_t i = 0; i < kSlotCount; i++)
        *out[i].live = *out[i].stored;
}

struct Claim
{
    uint8_t pin;
    const char* name;
};

// 4 ESC channels + the pusher + ESC enable + the ADC + 2 I2C + the LED is 10.
const uint8_t kMaxClaims = 20;

const char* const kEscNames[4] = {"esc1", "esc2", "esc3", "esc4"};
const char* const kMotorFields[4] = {"motor1", "motor2", "motor3", "motor4"};

const Claim* heldBy(const Claim* claims, uint8_t n, uint8_t pin)
{
    for (uint8_t i = 0; i < n; i++)
    {
        if (claims[i].pin == pin)
            return &claims[i];
    }
    return nullptr;
}

// What this configuration asks the chip to do that the chip cannot. Runs before anything is
// claimed, because two of the three answers change what there is to claim. TwoWire::setSDA/setSCL
// panic() on an illegal pin, so the I2C pair is settled here rather than at the point of use.
void resolveCapabilities()
{
    if (pinDefined(batteryAdcPin) && !adcPinUsable(batteryAdcPin))
    {
        const uint8_t pin = batteryAdcPin;
        batteryAdcPin = PIN_NOT_USED;
        PinConflicts::record("batteryAdcPin", pin, "notAnAdcPin", PinConflicts::Action::PinCleared);
        logger.error("GPIO ", (int)pin, " has no ADC channel - only ", (int)ADC_FIRST_PIN, "-",
                     (int)ADC_LAST_PIN, " do. Battery monitoring is off; a reading from any other "
                     "pin would be noise the low-voltage cutoff acted on.");
    }

    const bool anyI2cPin =
        pinDefined(deviceSettings.i2cSdaPin) || pinDefined(deviceSettings.i2cSclPin);
    if (displayAllowed && !i2cPairUsable(deviceSettings.i2cSdaPin, deviceSettings.i2cSclPin))
    {
        displayAllowed = false;
        // Both pins unset is "no panel wired", which is an answer rather than a fault.
        if (anyI2cPin)
        {
            PinConflicts::record("i2cSdaPin", deviceSettings.i2cSdaPin, "i2cPair",
                                 PinConflicts::Action::DisplayOff);
            logger.error("SDA ", (int)deviceSettings.i2cSdaPin, " and SCL ",
                         (int)deviceSettings.i2cSclPin,
                         " are not a pair any I2C block can serve - a GPIO's I2C role is fixed by "
                         "pin % 4. Display off for this boot; the bus was never started, which is "
                         "what keeps setSDA from panicking.");
        }
    }
}

// Everything this configuration will actually drive, claimed in priority order. The order encodes
// how much each loss costs: a blaster down one flywheel still fires, one whose pusher is throttling
// a flywheel ESC does not. Every claim that loses is recorded with the name of what beat it.
void resolveDrivenOutputs(Claim* claims, uint8_t& n)
{
    for (uint8_t i = 0; i < 4; i++)
    {
        // motorsEnabled[], not the stored config: validatePusherAndMotors() has already cleared
        // the channels with no pin and the one the pusher occupies, so an ESC-driven pusher does
        // not collide with the motor it replaced.
        if (!motorsEnabled[i] || !pinDefined(escPin(i)))
            continue;
        if (const Claim* held = heldBy(claims, n, escPin(i)))
        {
            motorsEnabled[i] = false;
            PinConflicts::record(kMotorFields[i], escPin(i), held->name,
                                 PinConflicts::Action::MotorDisabled);
            logger.error("Pin conflict: motor ", i + 1, " is GPIO ", (int)escPin(i), ", which ",
                         held->name, " already drives - motor disabled for this boot. Stored "
                         "config is unchanged.");
            continue;
        }
        claims[n++] = {escPin(i), kEscNames[i]};
    }

    if (pusherValid && pinDefined(pusherPin()))
    {
        if (const Claim* held = heldBy(claims, n, pusherPin()))
        {
            const uint8_t pin = pusherPin();
            pusherValid = false;
            PinConflicts::record("pusher", pin, held->name, PinConflicts::Action::PusherDisabled);
            logger.error("Pin conflict: the pusher is GPIO ", (int)pin, ", which ", held->name,
                         " already drives - pusher disabled for this boot. Stored config is "
                         "unchanged.");
        }
        else
        {
            claims[n++] = {pusherPin(), "pusher"};
        }
    }

    // Two outputs and a bus, each of which simply detaches: losing the ESC power gate, the battery
    // reading or the panel costs a capability rather than the blaster.
    struct Output
    {
        uint8_t* live;
        const char* field;
    };
    const Output outputs[] = {{&escEnablePin, "escEnablePin"}, {&batteryAdcPin, "batteryAdcPin"}};
    for (const Output& out : outputs)
    {
        if (!pinDefined(*out.live))
            continue;
        if (const Claim* held = heldBy(claims, n, *out.live))
        {
            const uint8_t pin = *out.live;
            *out.live = PIN_NOT_USED;
            PinConflicts::record(out.field, pin, held->name, PinConflicts::Action::PinCleared);
            logger.error("Pin conflict: ", out.field, " is GPIO ", (int)pin, ", which ",
                         held->name, " already drives - detached for this boot. Stored config is "
                         "unchanged.");
            continue;
        }
        claims[n++] = {*out.live, out.field};
    }

    if (displayAllowed)
    {
        // The pair moves together: half a bus is not a bus, so either collision costs the display.
        const Claim* held = heldBy(claims, n, deviceSettings.i2cSdaPin);
        const uint8_t which = held ? deviceSettings.i2cSdaPin : deviceSettings.i2cSclPin;
        if (!held)
            held = heldBy(claims, n, deviceSettings.i2cSclPin);
        if (held)
        {
            displayAllowed = false;
            PinConflicts::record("i2cSdaPin", which, held->name, PinConflicts::Action::DisplayOff);
            logger.error("Pin conflict: the I2C bus needs GPIO ", (int)which, ", which ",
                         held->name, " already drives - display off for this boot. Stored config "
                         "is unchanged.");
        }
        else
        {
            claims[n++] = {deviceSettings.i2cSdaPin, "i2cSda"};
            claims[n++] = {deviceSettings.i2cSclPin, "i2cScl"};
        }
    }

    if (pinDefined(ledDataPin))
    {
        if (const Claim* held = heldBy(claims, n, ledDataPin))
        {
            const uint8_t pin = ledDataPin;
            ledDataPin = PIN_NOT_USED;
            PinConflicts::record("ledDataPin", pin, held->name, PinConflicts::Action::PinCleared);
            logger.error("Pin conflict: ledDataPin is GPIO ", (int)pin, ", which ", held->name,
                         " already drives - LED detached for this boot. Stored config is "
                         "unchanged.");
        }
        else
        {
            claims[n++] = {ledDataPin, "ledData"};
        }
    }
}

// select0 sharing the menu button's pin is a supported wiring, not a collision: with
// BUTTON_SELECT_FIRE the one button both opens the menu and cycles the mode, and setup() skips
// attaching select0 for exactly that case (setupMenuButton(), menuCore.cpp).
bool sharesMenuButtonByDesign(const char* a, const char* b)
{
    const bool pair = (strcmp(a, "menuButtonPin") == 0 && strcmp(b, "select0Pin") == 0) ||
                      (strcmp(a, "select0Pin") == 0 && strcmp(b, "menuButtonPin") == 0);
    return pair && deviceSettings.selectFireType == BUTTON_SELECT_FIRE;
}

// A select line means nothing without select-fire hardware, so it claims no pin then.
bool slotActive(const char* field)
{
    if (strncmp(field, "select", 6) != 0)
        return true;
    return deviceSettings.selectFireType != NO_SELECT_FIRE;
}

const char* actionName(PinConflicts::Action a)
{
    switch (a)
    {
    case PinConflicts::Action::PinCleared:
        return "pinCleared";
    case PinConflicts::Action::MotorDisabled:
        return "motorDisabled";
    case PinConflicts::Action::PusherDisabled:
        return "pusherDisabled";
    case PinConflicts::Action::DisplayOff:
        return "displayOff";
    case PinConflicts::Action::PinWarning:
    default:
        return "pinWarning";
    }
}
} // namespace

namespace PinConflicts
{

void record(const char* field, uint8_t pin, const char* against, Action action)
{
    if (count_ >= kMaxEntries)
        return;
    entries_[count_++] = {field, pin, against, action};
    if (action != Action::PinWarning)
        losses_++;
}

void resolve()
{
    PinSlot slot[kSlotCount];
    seedSlots(slot);
    ledDataPin = deviceSettings.ledDataPin;
    batteryAdcPin = deviceSettings.batteryAdcPin;
    escEnablePin = deviceSettings.escEnablePin;
    displayAllowed = deviceSettings.hasDisplay;

    if (!wiringLive)
        return; // nothing is driven, so nothing can be contested

    // Before the claims, because two of its three answers change what there is to claim.
    resolveCapabilities();

    Claim claims[kMaxClaims];
    uint8_t claimCount = 0;
    resolveDrivenOutputs(claims, claimCount);

    // 1. An input never takes a pin from something that drives one: an INPUT_PULLUP attached over
    // a DShot line or the I2C bus breaks the thing it lands on and reads nothing useful itself.
    for (uint8_t i = 0; i < kSlotCount; i++)
    {
        if (!pinDefined(*slot[i].live) || !slotActive(slot[i].field))
            continue;
        if (const Claim* held = heldBy(claims, claimCount, *slot[i].live))
        {
            const uint8_t pin = *slot[i].live;
            *slot[i].live = PIN_NOT_USED;
            record(slot[i].field, pin, held->name, Action::PinCleared);
            logger.error("Pin conflict: ", slot[i].field, " is GPIO ", (int)pin, ", which ",
                         held->name, " already drives - input detached for this boot. Stored "
                         "config is unchanged.");
            if (strcmp(slot[i].field, "menuButtonPin") == 0)
                menuButtonLost_ = true;
        }
    }

    // 2. Two input pins on the same GPIO: the later one in the priority order above loses.
    for (uint8_t i = 0; i < kSlotCount; i++)
    {
        if (!pinDefined(*slot[i].live) || !slotActive(slot[i].field))
            continue;
        for (uint8_t j = 0; j < i; j++)
        {
            if (!pinDefined(*slot[j].live) || !slotActive(slot[j].field))
                continue;
            if (*slot[j].live != *slot[i].live)
                continue;
            if (sharesMenuButtonByDesign(slot[j].field, slot[i].field))
                break;
            const uint8_t pin = *slot[i].live;
            *slot[i].live = PIN_NOT_USED;
            record(slot[i].field, pin, slot[j].field, Action::PinCleared);
            logger.error("Pin conflict: ", slot[i].field, " and ", slot[j].field,
                         " are both GPIO ", (int)pin, " - ", slot[i].field,
                         " detached for this boot. Stored config is unchanged.");
            if (strcmp(slot[i].field, "menuButtonPin") == 0)
                menuButtonLost_ = true;
            break;
        }
    }

    // 3. Losing the menu button is the one resolution that removes the way back, so it gets said
    // separately rather than being one line among several.
    if (menuButtonLost_)
        logger.error("The menu button is now unassigned: the on-device menu cannot be opened. "
                     "Fix menuButtonPin over serial or in the web console.");
}

uint8_t count()
{
    return count_;
}

uint8_t losses()
{
    return losses_;
}

const Entry* entries()
{
    return entries_;
}

bool menuButtonLost()
{
    return menuButtonLost_;
}

void writeJson(Print& out)
{
    out.print('[');
    for (uint8_t i = 0; i < count_; i++)
    {
        if (i)
            out.print(',');
        out.print("{\"field\":\"");
        out.print(entries_[i].field);
        out.print("\",\"pin\":");
        out.print(entries_[i].pin);
        out.print(",\"against\":\"");
        out.print(entries_[i].against);
        out.print("\",\"action\":\"");
        out.print(actionName(entries_[i].action));
        out.print("\"}");
    }
    out.print(']');
}

} // namespace PinConflicts
