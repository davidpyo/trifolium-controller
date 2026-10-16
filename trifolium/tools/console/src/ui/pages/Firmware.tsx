import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import { Page, PageHead, Panel } from "../shell/Shell";

// Updating the firmware over PICOBOOT. The flasher itself is a dialog, because it runs a sequence -
// back up, restart into the bootloader, write, reconnect - that should hold the screen while it runs.

const STEPS = [
  "Back up",
  "Restart into bootloader",
  "Write the .uf2",
  "Reconnect and check settings",
];

export function Firmware({ busy, onFlash }: { busy: boolean; onFlash: () => void }) {
  return (
    <Page>
      <PageHead
        title="Firmware"
        lede="Flash over USB with PICOBOOT. Works with no RPI-RP2 drive, so a removable-drive policy does not block it."
      />
      <Panel title="Before you flash">
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: "8px 0", px: 2, py: 1.5 }}>
          {STEPS.map((s, i) => (
            <Box
              key={s}
              component="span"
              sx={{
                display: "flex",
                alignItems: "center",
                fontSize: 12.5,
                color: "text.secondary",
              }}
            >
              {i > 0 && (
                <Box
                  component="span"
                  sx={{ width: 22, height: "1px", bgcolor: "divider", mx: 1 }}
                />
              )}
              <Box component="b" sx={{ color: "text.primary", mr: 0.75 }}>
                {i + 1}
              </Box>
              {s}
            </Box>
          ))}
        </Box>
        <Box
          sx={{
            px: 2,
            py: 1.25,
            borderTop: 1,
            borderColor: "divider",
            color: "text.secondary",
            fontSize: 12.5,
          }}
        >
          <Box component="p" sx={{ m: 0, maxWidth: "75ch" }}>
            The flasher offers a backup first, and the published releases or a .uf2 of your own.
            Your settings live in their own flash area and survive an update. A factory image is the
            exception: it carries a config, and flashing it replaces yours.
          </Box>
        </Box>
        <Box sx={{ px: 2, pb: 1.75 }}>
          <Button variant="contained" disabled={busy} onClick={onFlash}>
            Flash Firmware
          </Button>
        </Box>
      </Panel>
    </Page>
  );
}
