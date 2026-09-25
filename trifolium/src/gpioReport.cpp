#include "gpioReport.h"

#include <hardware/gpio.h>
#include <hardware/structs/padsbank0.h>
#include <hardware/structs/sio.h>

#include "CONFIGURATION.h"
#include "deviceSettings.h"

extern DeviceSettings deviceSettings;
extern uint8_t pusherPin();
extern bool wiringLive;

// The nine pins as the conflict engine left them. deviceSettings still carries what the
// user asked for, so reporting from it names the role that *lost* a contested pin.
#include "menuCore.h"

namespace
{
const char* functionName(int fn)
{
    switch (fn)
    {
    case GPIO_FUNC_XIP:
        return "xip";
    case GPIO_FUNC_SPI:
        return "spi";
    case GPIO_FUNC_UART:
        return "uart";
    case GPIO_FUNC_I2C:
        return "i2c";
    case GPIO_FUNC_PWM:
        return "pwm";
    case GPIO_FUNC_SIO:
        return "sio";
    case GPIO_FUNC_PIO0:
        return "pio0";
    case GPIO_FUNC_PIO1:
        return "pio1";
    case GPIO_FUNC_GPCK:
        return "gpck";
    case GPIO_FUNC_USB:
        return "usb";
    default:
        return "null"; // GPIO_FUNC_NULL - the reset state, pin connected to nothing
    }
}

// What the stored wiring says this pin is for - intent, not state; `driven` says whether it is
// claimed. deviceSettings, not the resolved pins: a pin detached this boot still names itself here.
const char* roleOf(uint8_t pin)
{
    struct Role
    {
        uint8_t pin;
        const char* name;
    };
    const Role roles[] = {
        {deviceSettings.escPins[0], "esc1"},
        {deviceSettings.escPins[1], "esc2"},
        {deviceSettings.escPins[2], "esc3"},
        {deviceSettings.escPins[3], "esc4"},
        {deviceSettings.i2cSclPin, "i2cScl"},
        {deviceSettings.i2cSdaPin, "i2cSda"},
        {deviceSettings.batteryAdcPin, "batteryADC"},
        // The role keeps the name "drvEN" even though the field behind it is pusherFetPin: it
        // names the physical function, it is what every board file called that pin, and two bench
        // walks match on the string.
        {pusherPin(), "drvEN"},
        {deviceSettings.ledDataPin, "ledData"},
        {deviceSettings.escEnablePin, "escEnable"},
        {menuButtonPin, "menuButton"},
        {triggerSwitchPin, "trigger"},
        {revSwitchPin, "rev"},
        {cycleSwitchPin, "cycle"},
        {idleSwitchPin, "idle"},
        {safetySwitchPin, "safety"},
        {selectPins[0], "select0"},
        {selectPins[1], "select1"},
        {selectPins[2], "select2"},
    };
    for (const Role& r : roles)
    {
        if (r.pin == pin)
            return r.name;
    }
    return "";
}
} // namespace

namespace GpioReport
{
void writeJson(Print& out)
{
    out.print("{\"cmd\":\"DUMP_GPIO\",\"ok\":true,\"boardId\":\"");
    out.print(deviceSettings.boardId);
    out.print("\",\"configured\":");
    out.print(wiringLive ? "true" : "false");
    out.print(",\"gpio\":[");

    uint8_t drivenCount = 0;
    uint8_t claimedCount = 0;
    for (uint8_t pin = 0; pin < NUM_BANK0_GPIOS; pin++)
    {
        const int fn = (int)gpio_get_function(pin);
        const uint32_t pad = padsbank0_hw->io[pin];
        const bool sio = (fn == GPIO_FUNC_SIO);
        // The pad's output disable, not just the SIO direction register: a pin handed to PWM or
        // PIO is driven by that peripheral whatever SIO thinks its direction is.
        const bool oe = !(pad & PADS_BANK0_GPIO0_OD_BITS) &&
                        (!sio || (sio_hw->gpio_oe & (1u << pin)) != 0);
        // A pin at GPIO_FUNC_NULL is connected to nothing inside the chip whatever the pad says,
        // so it cannot be driving anything.
        const bool driven = (fn != GPIO_FUNC_NULL) && oe;
        if (fn != GPIO_FUNC_NULL)
            claimedCount++;
        if (driven)
            drivenCount++;

        if (pin)
            out.print(',');
        out.print("{\"n\":");
        out.print(pin);
        out.print(",\"fn\":\"");
        out.print(functionName(fn));
        out.print("\",\"oe\":");
        out.print(oe ? "true" : "false");
        out.print(",\"driven\":");
        out.print(driven ? "true" : "false");
        out.print(",\"level\":");
        out.print(gpio_get(pin) ? 1 : 0);
        out.print(",\"pu\":");
        out.print((pad & PADS_BANK0_GPIO0_PUE_BITS) ? "true" : "false");
        out.print(",\"pd\":");
        out.print((pad & PADS_BANK0_GPIO0_PDE_BITS) ? "true" : "false");
        out.print(",\"role\":\"");
        out.print(roleOf(pin));
        out.print("\"}");
    }

    out.print("],\"drivenCount\":");
    out.print(drivenCount);
    out.print(",\"claimedCount\":");
    out.print(claimedCount);
    out.println("}");
}

} // namespace GpioReport
