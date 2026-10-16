import React from "react";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";

// Where each part of the console lives, grouped by how often it is used, each page saying how
// many unsaved edits it holds.

export type ViewId =
  "overview" | "profiles" | "blaster" | "wiring" | "rpm" | "splash" | "firmware" | "maint" | "raw";

const ICON: Record<ViewId | "more", string> = {
  overview: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  profiles: "M4 6h16M4 12h16M4 18h10",
  blaster:
    "M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1",
  wiring: "M6 4h12v16H6zM2 8h4M2 12h4M2 16h4M18 8h4M18 12h4M18 16h4",
  rpm: "M3 20h18M4 17c3-9 6-11 9-11s4 3 7 3",
  splash: "M3 6h18v12H3zM7 14l3-3 3 3 2-2 2 2",
  firmware: "M12 3v12M7 10l5 5 5-5M4 21h16",
  maint: "M21 12a9 9 0 1 1-3-6.7M21 4v5h-5",
  raw: "M8 4c-2 0-2 2-2 4s-2 4-2 4 2 2 2 4 0 4 2 4M16 4c2 0 2 2 2 4s2 4 2 4-2 2-2 4 0 4-2 4",
  more: "M5 12h.01M12 12h.01M19 12h.01",
};

export function Icon({ name, size = 16 }: { name: keyof typeof ICON; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "more" ? 3.5 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={ICON[name]} />
    </svg>
  );
}

export const NAV_GROUPS: { title: string; items: { id: ViewId; label: string }[] }[] = [
  {
    title: "Configure",
    items: [
      { id: "overview", label: "Overview" },
      { id: "profiles", label: "Profiles" },
      { id: "blaster", label: "Blaster settings" },
      { id: "wiring", label: "Wiring" },
    ],
  },
  {
    title: "Tools",
    items: [
      { id: "rpm", label: "RPM capture" },
      { id: "splash", label: "Splash screen" },
      { id: "firmware", label: "Firmware" },
    ],
  },
  {
    title: "Advanced",
    items: [
      { id: "maint", label: "Maintenance" },
      { id: "raw", label: "Raw JSON" },
    ],
  },
];

const PRIMARY: { id: ViewId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "profiles", label: "Profiles" },
  { id: "blaster", label: "Blaster" },
  { id: "wiring", label: "Wiring" },
];

const countSx = {
  ml: "auto",
  fontSize: 11,
  fontWeight: 700,
  color: "warning.main",
  bgcolor: (t: { palette: { mode: string } }) =>
    t.palette.mode === "dark" ? "#3a2a12" : "#fff1dc",
  borderRadius: 999,
  px: 0.85,
  lineHeight: 1.6,
} as const;

function NavButton({
  id,
  label,
  current,
  count,
  compact,
  onGo,
}: {
  id: ViewId;
  label: string;
  current: boolean;
  count?: number;
  compact?: boolean;
  onGo: (id: ViewId) => void;
}) {
  return (
    <Box
      component="button"
      type="button"
      aria-current={current ? "page" : undefined}
      aria-label={count ? `${label}, ${count} unsaved` : label}
      title={label}
      onClick={() => onGo(id)}
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: compact ? { sm: "center", md: "flex-start" } : "flex-start",
        gap: 1.25,
        width: "100%",
        border: 0,
        bgcolor: current ? "action.selected" : "transparent",
        color: current ? "primary.main" : "text.secondary",
        fontWeight: current ? 600 : 400,
        textAlign: "left",
        px: 1.25,
        py: 0.9,
        borderRadius: 1,
        font: "inherit",
        fontSize: 13.5,
        cursor: "pointer",
        position: "relative",
        "&:hover": { bgcolor: "action.hover", color: "text.primary" },
      }}
    >
      <Icon name={id} />
      <Box component="span" sx={{ display: compact ? { sm: "none", md: "inline" } : "inline" }}>
        {label}
      </Box>
      {count ? (
        <Box
          component="span"
          aria-hidden
          sx={{
            ...countSx,
            ...(compact && { position: { sm: "absolute", md: "static" }, top: 2, right: 4 }),
          }}
        >
          {count}
        </Box>
      ) : null}
    </Box>
  );
}

export interface NavProps {
  view: ViewId;
  counts: Partial<Record<ViewId, number>>;
  onGo: (id: ViewId) => void;
  /** Pages with nothing to show yet - only the setup flow, on a device with no wiring. */
  only?: ViewId[];
  /** The phone's More sheet opens the log, which has no row of its own there while folded. */
  onOpenLog?: () => void;
  /** Under the sections: which build this is, and where to get it and the firmware. */
  footer?: React.ReactNode;
}

function NavList({ view, counts, onGo, only, compact }: NavProps & { compact?: boolean }) {
  return (
    <>
      {NAV_GROUPS.map((g) => {
        const items = g.items.filter((i) => !only || only.includes(i.id));
        if (!items.length) return null;
        return (
          <React.Fragment key={g.title}>
            <Box
              component="h4"
              sx={{
                fontSize: 11,
                letterSpacing: ".07em",
                textTransform: "uppercase",
                color: "text.disabled",
                m: 0,
                mt: 1.5,
                mb: 0.5,
                mx: 1.25,
                fontWeight: 650,
                display: compact ? { sm: "none", md: "block" } : "block",
                "&:first-of-type": { mt: 0.25 },
              }}
            >
              {g.title}
            </Box>
            {items.map((i) => (
              <NavButton
                key={i.id}
                id={i.id}
                label={i.label}
                current={view === i.id}
                count={counts[i.id]}
                compact={compact}
                onGo={onGo}
              />
            ))}
          </React.Fragment>
        );
      })}
    </>
  );
}

/** The rail beside the page: icons alone between 600 and 900 px, labelled above that. */
export function NavRail({ footer, ...props }: NavProps) {
  return (
    <Box
      component="nav"
      aria-label="Sections"
      sx={{
        width: "100%",
        borderRight: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        px: { sm: 0.75, md: 1 },
        py: 1.25,
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 0.25,
      }}
    >
      <NavList {...props} compact />
      {footer && (
        <Box sx={{ mt: "auto", pt: 2, px: 1.25, pb: 0.5, borderTop: 1, borderColor: "divider" }}>
          {footer}
        </Box>
      )}
    </Box>
  );
}

/** The phone's tabs: the four pages used most, and More for the rest. */
export function BottomTabs({ view, counts, onGo, only, onOpenLog, footer }: NavProps) {
  const [more, setMore] = React.useState(false);
  const primary = PRIMARY.filter((p) => !only || only.includes(p.id));
  const inMore = !primary.some((p) => p.id === view);
  const go = (id: ViewId) => {
    setMore(false);
    onGo(id);
  };
  return (
    <>
      <Box
        component="nav"
        aria-label="Sections"
        sx={{
          display: "grid",
          gridTemplateColumns: `repeat(${primary.length + 1}, minmax(0, 1fr))`,
          borderTop: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        {[...primary, { id: "more" as const, label: "More" }].map((t) => {
          const current = t.id === "more" ? inMore || more : view === t.id && !more;
          const count = t.id === "more" ? undefined : counts[t.id];
          return (
            <Box
              key={t.id}
              component="button"
              type="button"
              aria-current={current ? "page" : undefined}
              onClick={() => (t.id === "more" ? setMore(true) : go(t.id))}
              sx={{
                border: 0,
                bgcolor: "transparent",
                display: "grid",
                justifyItems: "center",
                gap: 0.25,
                py: 0.9,
                fontSize: 10.5,
                font: "inherit",
                color: current ? "primary.main" : "text.secondary",
                fontWeight: current ? 650 : 400,
                position: "relative",
                cursor: "pointer",
              }}
            >
              <Icon name={t.id} />
              <span>{t.label}</span>
              {count ? (
                <Box
                  component="span"
                  sx={{ ...countSx, position: "absolute", top: 3, left: "calc(50% + 6px)", ml: 0 }}
                >
                  {count}
                </Box>
              ) : null}
            </Box>
          );
        })}
      </Box>
      <Drawer anchor="bottom" open={more} onClose={() => setMore(false)}>
        <Box component="nav" aria-label="More sections" sx={{ p: 1, pb: 2 }}>
          <NavList view={view} counts={counts} onGo={go} only={only} />
          {onOpenLog && (
            <Box
              component="button"
              type="button"
              onClick={() => {
                setMore(false);
                onOpenLog();
              }}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.25,
                width: "100%",
                border: 0,
                bgcolor: "transparent",
                color: "text.secondary",
                px: 1.25,
                py: 0.9,
                mt: 1,
                font: "inherit",
                fontSize: 13.5,
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden
              >
                <path d="M4 17l6-5-6-5M12 19h8" />
              </svg>
              Log
            </Box>
          )}
          {footer && (
            <Box sx={{ mt: 1.5, pt: 1.5, px: 1.25, borderTop: 1, borderColor: "divider" }}>
              {footer}
            </Box>
          )}
        </Box>
      </Drawer>
    </>
  );
}
