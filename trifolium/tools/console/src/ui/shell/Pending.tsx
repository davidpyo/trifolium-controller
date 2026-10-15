import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Drawer from "@mui/material/Drawer";
import { alpha, type Theme } from "@mui/material/styles";
import IconButton from "@mui/material/IconButton";
import { storeTitle, type Change } from "../changes";
import { Chip } from "../TopBar";

// Unsaved edits, always in view, and the one place they are written from: listed, with which writes
// restart the blaster, and each one revertible before anything is sent.

export interface WriteProgress {
  /** One line per load, in the order they are sent. */
  steps: string[];
  /** The step under way; steps before it are done. */
  at: number;
  /** What the current step is waiting on. */
  status: string;
}

/** A store's write restarts the blaster: always for the device, and for the slot it booted with. */
export const storeReboots = (slot: number | null, activeIndex: number): boolean =>
  slot === null || slot === activeIndex;

export function PendingBar({
  changes,
  profileName,
  activeIndex,
  live,
  busy,
  onReview,
  onWrite,
  onDiscard,
  onBackup,
}: {
  changes: Change[];
  profileName: (slot: number) => string;
  activeIndex: number;
  live: boolean;
  busy: boolean;
  onReview: () => void;
  /** Writes the one store every edit belongs to. */
  onWrite: (store: number | "device") => void;
  onDiscard: () => void;
  onBackup: () => void;
}) {
  const stores = [...new Set(changes.map((c) => c.slot))];
  const restarts = stores.some((s) => storeReboots(s, activeIndex));
  // Writing straight from the bar is for the plain case: one write, nothing the form has hidden.
  // Several writes, or an edit to a row out of sight, go through the review first.
  const direct = live && stores.length === 1 && !changes.some((c) => c.hidden);
  return (
    <Box
      role="region"
      aria-label="Unsaved changes"
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.25,
        px: { xs: 1.5, sm: 2 },
        flexWrap: "wrap",
        borderTop: 1,
        // Slim while there is nothing to write. With edits waiting it grows, takes the edit colour
        // and full-size buttons, so the write is hard to miss.
        ...(changes.length
          ? {
              py: 0.9,
              fontSize: 14,
              borderColor: "warning.main",
              bgcolor: (t: Theme) =>
                alpha(t.palette.warning.main, t.palette.mode === "dark" ? 0.16 : 0.1),
            }
          : {
              py: 0.4,
              fontSize: 13,
              borderColor: "divider",
              bgcolor: "background.paper",
              "& .MuiButton-root": {
                py: 0,
                px: 1.25,
                minHeight: 0,
                fontSize: 12.5,
                lineHeight: 1.7,
              },
            }),
      }}
    >
      {changes.length ? (
        <>
          <Box component="span" sx={{ fontWeight: 600 }}>
            <Box component="span" sx={{ color: "warning.main" }}>
              {changes.length}
            </Box>{" "}
            unsaved change{changes.length === 1 ? "" : "s"}
          </Box>
          <Box
            component="span"
            sx={{ color: "text.secondary", fontSize: 12.5, display: { xs: "none", sm: "inline" } }}
          >
            {stores.map((s) => storeTitle(s, profileName)).join(", ")}
            {restarts ? " · restarts the blaster" : ""}
          </Box>
          <Box sx={{ flex: 1 }} />
          <Button
            size="small"
            color="inherit"
            disabled={busy}
            onClick={onDiscard}
            sx={{ color: "text.secondary" }}
          >
            Discard
          </Button>
          {direct ? (
            <>
              <Button size="small" variant="outlined" disabled={busy} onClick={onReview}>
                Review
              </Button>
              <Button
                size="medium"
                variant="contained"
                color="warning"
                disabled={busy}
                onClick={() => onWrite(stores[0] ?? "device")}
              >
                Write to blaster
              </Button>
            </>
          ) : (
            <Button
              size="medium"
              variant="contained"
              color="warning"
              disabled={busy}
              onClick={onReview}
            >
              Review and write
            </Button>
          )}
        </>
      ) : (
        <>
          <Box component="span" sx={{ color: "text.secondary", fontSize: 12.5 }}>
            No unsaved changes
          </Box>
          <Box sx={{ flex: 1 }} />
          <Button size="small" variant="outlined" onClick={onBackup}>
            Back up
          </Button>
        </>
      )}
    </Box>
  );
}

export function ReviewSheet({
  open,
  changes,
  profileName,
  activeIndex,
  live,
  busy,
  progress,
  onClose,
  onRevert,
  onDiscard,
  onWrite,
  onShow,
}: {
  open: boolean;
  changes: Change[];
  profileName: (slot: number) => string;
  activeIndex: number;
  live: boolean;
  busy: boolean;
  progress: WriteProgress | null;
  onClose: () => void;
  onRevert: (mark: string) => void;
  onDiscard: () => void;
  /** null writes every store with changes; a slot or "device" writes that one alone. */
  onWrite: (store: number | "device" | null) => void;
  onShow: (change: Change) => void;
}) {
  const stores = [...new Set(changes.map((c) => c.slot))];
  const restarts = stores.filter((s) => storeReboots(s, activeIndex)).length;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={busy ? undefined : onClose}
      slotProps={{
        paper: { sx: { width: { xs: "100%", sm: 520 }, display: "flex", flexDirection: "column" } },
      }}
    >
      <Box
        role="dialog"
        aria-label="Review changes"
        sx={{ display: "flex", flexDirection: "column", height: "100%" }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "flex-start",
            gap: 1,
            px: 2.25,
            pt: 2,
            pb: 1.5,
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Box>
            <Box component="h3" sx={{ m: 0, fontSize: 16, fontWeight: 650 }}>
              {progress ? "Writing to the blaster" : "Review changes"}
            </Box>
            <Box component="p" sx={{ m: 0, mt: 0.5, color: "text.secondary", fontSize: 12.5 }}>
              {progress
                ? "Each write that restarts the blaster waits for it to come back before the next."
                : changes.length
                  ? `Blaster settings go first, because a profile's limits depend on them. ${
                      restarts
                        ? `The blaster restarts ${restarts === 1 ? "once" : `${restarts} times`}.`
                        : "Nothing here restarts the blaster."
                    }`
                  : "Nothing to write. Change a value anywhere and it is listed here."}
            </Box>
          </Box>
          <IconButton
            aria-label="Close"
            size="small"
            sx={{ ml: "auto" }}
            disabled={busy}
            onClick={onClose}
          >
            &#x2715;
          </IconButton>
        </Box>

        <Box sx={{ overflowY: "auto", flex: 1, py: 0.75 }}>
          {progress ? (
            <Box sx={{ px: 2.25, py: 1.5, display: "grid", gap: 1 }}>
              {progress.steps.map((s, i) => (
                <Box
                  key={s + i}
                  sx={{
                    display: "flex",
                    gap: 1.25,
                    alignItems: "center",
                    fontSize: 13,
                    color:
                      i < progress.at
                        ? "success.main"
                        : i === progress.at
                          ? "text.primary"
                          : "text.disabled",
                    fontWeight: i === progress.at ? 600 : 400,
                  }}
                >
                  {i < progress.at ? "✓" : i === progress.at ? <CircularProgress size={12} /> : "·"}
                  <span>{s}</span>
                </Box>
              ))}
              <Box sx={{ color: "text.secondary", fontSize: 12.5, mt: 0.5 }}>{progress.status}</Box>
            </Box>
          ) : (
            stores.map((slot) => {
              const title = storeTitle(slot, profileName);
              const reboots = storeReboots(slot, activeIndex);
              return (
                <Box
                  key={String(slot)}
                  role="group"
                  aria-label={title}
                  sx={{ px: 2.25, pt: 1.25, pb: 0.5 }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      flexWrap: "wrap",
                      fontSize: 13,
                      fontWeight: 650,
                    }}
                  >
                    {title}
                    {slot === activeIndex && <Chip tone="accent">Active</Chip>}
                    <Box
                      component="span"
                      sx={{
                        fontFamily: "ui-monospace, Consolas, monospace",
                        fontSize: 11.5,
                        color: "text.disabled",
                        fontWeight: 400,
                      }}
                    >
                      {slot === null ? "LOAD_DEVICE" : `LOAD_PROFILE ${slot}`}
                    </Box>
                    <Chip>{reboots ? "restarts" : "no restart"}</Chip>
                    <Box sx={{ ml: "auto" }}>
                      <Button
                        size="small"
                        color="inherit"
                        disabled={!live || busy}
                        aria-label={`Write only ${title}`}
                        onClick={() => onWrite(slot ?? "device")}
                      >
                        Write only this
                      </Button>
                    </Box>
                  </Box>
                  {changes
                    .filter((c) => c.slot === slot)
                    .map((c) => (
                      <Box
                        key={c.mark}
                        sx={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr) auto auto",
                          gap: "4px 12px",
                          alignItems: "center",
                          py: 0.85,
                          borderBottom: 1,
                          borderColor: "divider",
                          fontSize: 13,
                          "&:last-of-type": { borderBottom: 0 },
                        }}
                      >
                        <Box sx={{ minWidth: 0 }}>
                          <Box
                            component="button"
                            type="button"
                            onClick={() => onShow(c)}
                            title="Show this setting"
                            sx={{
                              border: 0,
                              bgcolor: "transparent",
                              p: 0,
                              font: "inherit",
                              color: "text.primary",
                              cursor: "pointer",
                              textAlign: "left",
                            }}
                          >
                            {c.label}
                          </Box>
                          <Box sx={{ color: "text.disabled", fontSize: 11.5 }}>
                            {c.where}
                            {c.hidden
                              ? " · not shown with the current settings, still written"
                              : ""}
                          </Box>
                        </Box>
                        <Box
                          sx={{
                            fontFamily: "ui-monospace, Consolas, monospace",
                            fontSize: 12.5,
                            whiteSpace: "nowrap",
                          }}
                        >
                          <Box component="s" sx={{ color: "text.disabled" }}>
                            {c.from}
                          </Box>
                          {" → "}
                          <Box component="b" sx={{ color: "warning.main", fontWeight: 650 }}>
                            {c.to}
                          </Box>
                        </Box>
                        <Button
                          size="small"
                          disabled={busy}
                          onClick={() => onRevert(c.mark)}
                          aria-label={`Revert ${c.label}`}
                        >
                          Revert
                        </Button>
                      </Box>
                    ))}
                </Box>
              );
            })
          )}
        </Box>

        <Box
          sx={{
            borderTop: 1,
            borderColor: "divider",
            px: 2.25,
            py: 1.5,
            display: "flex",
            gap: 1,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          {progress ? (
            <Box component="span" sx={{ color: "text.secondary", fontSize: 12.5 }}>
              Keep the blaster plugged in.
            </Box>
          ) : changes.length ? (
            <>
              <Button
                color="inherit"
                disabled={busy}
                onClick={onDiscard}
                sx={{ color: "text.secondary" }}
              >
                Discard all
              </Button>
              <Box sx={{ flex: 1 }} />
              {!live && (
                <Box component="span" sx={{ fontSize: 12.5, color: "text.secondary" }}>
                  Connect a blaster to write
                </Box>
              )}
              <Button
                variant="contained"
                color="warning"
                disabled={!live || busy}
                onClick={() => onWrite(null)}
              >
                Write {changes.length} change{changes.length === 1 ? "" : "s"}
              </Button>
            </>
          ) : (
            <>
              <Box sx={{ flex: 1 }} />
              <Button onClick={onClose}>Close</Button>
            </>
          )}
        </Box>
      </Box>
    </Drawer>
  );
}
