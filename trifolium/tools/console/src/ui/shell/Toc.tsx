import React from "react";
import Box from "@mui/material/Box";

// A long page's contents, beside it on a wide screen: where each section is, which one is in view,
// and which hold unsaved edits.

export interface TocEntry {
  id: string;
  label: string;
  dirty?: boolean;
}

export const sectionId = (page: string, label: string) =>
  `sec-${page}-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

export function Toc({ entries }: { entries: TocEntry[] }) {
  const [current, setCurrent] = React.useState<string | null>(entries[0]?.id ?? null);

  // The section in view is the last one whose top has passed the top of the page area.
  React.useEffect(() => {
    const main = document.getElementById("main");
    if (!main) return;
    const onScroll = () => {
      const top = main.getBoundingClientRect().top + 24;
      let at: string | null = entries[0]?.id ?? null;
      for (const e of entries) {
        const el = document.getElementById(e.id);
        if (el && el.getBoundingClientRect().top <= top) at = e.id;
      }
      setCurrent(at);
    };
    onScroll();
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => main.removeEventListener("scroll", onScroll);
  }, [entries]);

  return (
    <Box
      component="nav"
      aria-label="On this page"
      sx={{
        position: "sticky",
        top: 8,
        display: { xs: "none", xl: "grid" },
        gap: 0.25,
        fontSize: 12.5,
        alignSelf: "start",
      }}
    >
      <Box
        sx={{
          fontSize: 11,
          letterSpacing: ".07em",
          textTransform: "uppercase",
          color: "text.disabled",
          fontWeight: 650,
          mb: 0.5,
        }}
      >
        On this page
      </Box>
      {entries.map((e) => (
        <Box
          key={e.id}
          component="button"
          type="button"
          onClick={() =>
            document.getElementById(e.id)?.scrollIntoView({ block: "start", behavior: "smooth" })
          }
          sx={{
            textAlign: "left",
            border: 0,
            borderLeft: 2,
            borderColor: current === e.id ? "primary.main" : "divider",
            bgcolor: "transparent",
            color: current === e.id ? "primary.main" : "text.secondary",
            font: "inherit",
            py: 0.4,
            pl: 1.25,
            cursor: "pointer",
            "&:hover": { color: "text.primary" },
          }}
        >
          {e.label}
          {e.dirty && (
            <Box
              component="span"
              aria-label="unsaved"
              sx={{ color: "warning.main", fontWeight: 700, ml: 0.5 }}
            >
              •
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}
