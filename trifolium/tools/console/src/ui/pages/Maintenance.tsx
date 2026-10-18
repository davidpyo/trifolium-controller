import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import type { ResetKind } from "../ResetDialog";
import { Page, PageHead, Panel } from "../shell/Shell";

// The resets. Restarts, a re-read, the verbose log and the flasher are in the top bar, one reach
// from any page; these are not, because each one loses something and none is needed for tuning.

export interface MaintenanceProps {
  live: boolean;
  busy: boolean;
  profileName: string;
  onReset: (kind: ResetKind) => void;
}

export function Maintenance({ live, busy, profileName, onReset }: MaintenanceProps) {
  const off = !live || busy;
  // Least destructive first, so the pointer travels further the more it costs.
  const resets: { kind: ResetKind; title: string; about: string }[] = [
    {
      kind: "profile",
      title: `Reset profile ${profileName}`,
      about: "Just this slot, back to defaults. The other two are untouched.",
    },
    {
      kind: "device",
      title: "Reset blaster settings",
      about:
        "Factory defaults for everything the OLED menu can set. Wiring and all three profiles are kept.",
    },
    {
      kind: "wiring",
      title: "Clear wiring",
      about:
        "Every pin back to unused, and the blaster drives none until a board preset is loaded again.",
    },
    {
      kind: "everything",
      title: "Reset everything",
      about: "All three profiles and all blaster settings.",
    },
  ];

  return (
    <Page>
      <PageHead
        title="Maintenance"
        lede="Putting things back to defaults. Restarts, Read from Device, verbose logging and the flasher are in the top bar."
      />
      <Panel
        title="Danger zone"
        lede="Least destructive first. Each asks you to type a word first."
        tone="danger"
      >
        {resets.map((r, i) => (
          <Box
            key={r.kind}
            sx={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              gap: "8px 16px",
              alignItems: "center",
              px: 2,
              py: 1.35,
              borderTop: i ? 1 : 0,
              borderColor: "divider",
            }}
          >
            <Box>
              <Box sx={{ fontWeight: 600 }}>{r.title}</Box>
              <Box sx={{ color: "text.secondary", fontSize: 12.5 }}>{r.about}</Box>
            </Box>
            <Button
              size="small"
              variant="outlined"
              color="error"
              disabled={off}
              onClick={() => onReset(r.kind)}
            >
              {r.title}…
            </Button>
          </Box>
        ))}
      </Panel>
    </Page>
  );
}
