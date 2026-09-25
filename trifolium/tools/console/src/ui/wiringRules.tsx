import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

// What the firmware will do with the pins in the table above, stated where somebody is typing them.
//
// These are documentation of rules that live in the firmware, so each one names where, and the two
// that are silicon rather than policy say so: a reader who does not believe the pin % 4 rule should
// be able to go and check it rather than take this file's word.
//
// Deliberately not derived from the schema. The schema publishes bounds, not consequences - there
// is no field on `device:batteryAdcPin` that says "anything outside 26-29 folds to unused", and a
// range narrowed to 26-29 would be the wrong fix (see AdcPinItem in menu.h for why). So this is
// prose, and it is short enough to keep true.

export interface WiringRule {
  /** Which row it is about, or null for a rule about the table as a whole. */
  field?: string;
  text: string;
}

export const WIRING_RULES: WiringRule[] = [
  {
    text:
      "Unused is 255. Every pin here accepts a GPIO 0-29 or 255 for nothing wired; a number in " +
      "between is folded to 255 on load, because pinMode() ignores it silently.",
  },
  {
    field: "device:select0Pin",
    text:
      "Select 0 is also the mode button. With Select-Fire set to Button, pressing it cycles to " +
      "the next fire mode - Select 1 and 2 are unused in that mode, since they only encode " +
      "positions for a switch. Setting it to the same GPIO as the Menu Button is supported and " +
      "not a conflict: one button then does both, short press to cycle and long press for the menu.",
  },
  {
    field: "device:batteryAdcPin",
    text:
      "The battery divider must be GPIO 26-29. That is the chip's ADC range, not a board's, so " +
      "anything else is folded to unused rather than kept - a voltage read off a pin with no ADC " +
      "channel is noise, and the low-voltage cutoff would act on it.",
  },
  {
    field: "device:i2cSdaPin",
    text:
      "SDA and SCL have to be a servable pair. A GPIO's I2C role is fixed in silicon by pin % 4: " +
      "0 = i2c0 SDA, 1 = i2c0 SCL, 2 = i2c1 SDA, 3 = i2c1 SCL. Two individually legal pins on " +
      "different blocks are served by neither, so the display stays off and the bus is never " +
      "started - which is what keeps an illegal pin out of setSDA(), where it would panic.",
  },
  {
    text:
      "The ESC channels take any GPIO. Every pin can be muxed to a PIO block, so there is no " +
      "DShot restriction to work around.",
  },
  {
    text:
      "When two things want one pin, the one that costs less is dropped for that boot and reported " +
      "above. Your setting stays on disk exactly as you typed it, so the report comes back every " +
      "boot until you change it.",
  },
];

/** The rules as a block, for under the wiring table. */
export function WiringRules() {
  return (
    <Box sx={{ mt: 1.5 }}>
      <Typography variant="caption" sx={{ fontWeight: 600, display: "block", mb: 0.5 }}>
        How these pins are read
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {WIRING_RULES.map((rule) => (
          <Typography
            key={rule.text}
            component="li"
            variant="caption"
            color="text.secondary"
            sx={{ display: "list-item", mb: 0.35 }}
          >
            {rule.text}
          </Typography>
        ))}
      </Box>
    </Box>
  );
}

/** The rule for one row, if it has one - used as the row's tooltip. */
export function ruleFor(key: string | undefined): string | undefined {
  if (!key) return undefined;
  return WIRING_RULES.find((r) => r.field === key)?.text;
}
