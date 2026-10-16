import React from "react";
import Box from "@mui/material/Box";

// The page frame: the top bar, a band for whatever the whole page should know (offline, a boot
// fault), the navigation beside the page, the unsaved-changes bar under it, and the log at the foot.
// Only the page scrolls; the frame stays put, so the bar that writes is always one reach away.
//
// Under 600 px the navigation becomes tabs along the bottom, which is where a thumb is.

export interface ShellProps {
  top: React.ReactNode;
  band?: React.ReactNode;
  nav: React.ReactNode;
  pending?: React.ReactNode;
  log: React.ReactNode;
  /** A folded log takes no row on a phone, where it opens from More instead. */
  logFolded?: boolean;
  tabs?: React.ReactNode;
  children: React.ReactNode;
}

export function Shell({ top, band, nav, pending, log, logFolded, tabs, children }: ShellProps) {
  return (
    <Box
      sx={{
        height: "100dvh",
        display: "grid",
        gridTemplateRows: "auto auto minmax(0, 1fr) auto auto auto",
        gridTemplateColumns: {
          xs: "minmax(0, 1fr)",
          sm: "56px minmax(0, 1fr)",
          md: "208px minmax(0, 1fr)",
        },
        gridTemplateAreas: {
          xs: `"top" "band" "main" "log" "pend" "tabs"`,
          // The log sits under the page, beside the rail; the unsaved-changes bar runs along the
          // foot of the window, as an editor's status bar does.
          sm: `"top top" "band band" "nav main" "nav log" "pend pend" "tabs tabs"`,
        },
        bgcolor: "background.default",
      }}
    >
      <Box sx={{ gridArea: "top", minWidth: 0 }}>{top}</Box>
      <Box sx={{ gridArea: "band", minWidth: 0 }}>{band}</Box>
      <Box sx={{ gridArea: "nav", display: { xs: "none", sm: "flex" }, minHeight: 0 }}>{nav}</Box>
      <Box
        component="main"
        id="main"
        sx={{ gridArea: "main", overflowY: "auto", minWidth: 0, minHeight: 0 }}
      >
        {children}
      </Box>
      <Box sx={{ gridArea: "pend", minWidth: 0 }}>{pending}</Box>
      <Box
        sx={{
          gridArea: "log",
          minWidth: 0,
          display: { xs: logFolded ? "none" : "block", sm: "block" },
        }}
      >
        {log}
      </Box>
      <Box sx={{ gridArea: "tabs", display: { xs: "block", sm: "none" } }}>{tabs}</Box>
    </Box>
  );
}

/** A page's heading row: what this page is for, and the actions that belong to all of it. */
export function PageHead({
  title,
  lede,
  actions,
}: {
  title: string;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <Box sx={{ display: "flex", alignItems: "flex-end", gap: 1.5, flexWrap: "wrap", mb: 1.5 }}>
      <Box sx={{ minWidth: 0 }}>
        <Box component="h2" sx={{ m: 0, fontSize: 20, fontWeight: 650, letterSpacing: "-0.005em" }}>
          {title}
        </Box>
        {lede && (
          <Box
            component="p"
            sx={{ m: 0, mt: 0.25, color: "text.secondary", fontSize: 13.5, maxWidth: "70ch" }}
          >
            {lede}
          </Box>
        )}
      </Box>
      {actions && (
        <Box sx={{ ml: "auto", display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
          {actions}
        </Box>
      )}
    </Box>
  );
}

/**
 * A page's content column. One width for every page, so moving between them never shifts the
 * content sideways; text inside keeps its own measure.
 */
export function Page({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ px: { xs: 1.5, sm: 3 }, pt: 2.25, pb: 4, maxWidth: 1640, mx: "auto" }}>
      {children}
    </Box>
  );
}

/**
 * A titled panel. `role="group"` named by its title, so a page's parts are findable by name.
 * `folded` shows the title row and `summary` alone.
 */
export function Panel({
  title,
  lede,
  actions,
  summary,
  folded,
  onFold,
  badge,
  tone,
  id,
  children,
}: {
  title?: string;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
  summary?: React.ReactNode;
  folded?: boolean;
  onFold?: () => void;
  badge?: React.ReactNode;
  tone?: "danger";
  id?: string;
  children?: React.ReactNode;
}) {
  const titleId = React.useId();
  const heading = title && (
    <Box
      component="h3"
      id={titleId}
      sx={{
        m: 0,
        fontSize: 14,
        fontWeight: 650,
        color: tone === "danger" ? "error.main" : undefined,
      }}
    >
      {title}
    </Box>
  );
  return (
    <Box
      component="section"
      id={id}
      role={title ? "group" : undefined}
      aria-labelledby={title ? titleId : undefined}
      sx={{
        bgcolor: "background.paper",
        border: 1,
        borderColor: tone === "danger" ? "error.main" : "divider",
        borderRadius: 2,
        mb: 1.5,
        scrollMarginTop: 10,
        minWidth: 0,
      }}
    >
      {title && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: "4px 10px",
            px: 1.75,
            py: 1,
            minHeight: 40,
            flexWrap: "wrap",
            borderBottom: folded ? 0 : 1,
            borderColor: "divider",
          }}
        >
          {onFold ? (
            <Box
              component="button"
              type="button"
              onClick={onFold}
              aria-expanded={!folded}
              sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: 0.75,
                border: 0,
                bgcolor: "transparent",
                p: 0,
                color: "inherit",
                cursor: "pointer",
                font: "inherit",
              }}
            >
              <Box
                component="span"
                aria-hidden
                sx={{
                  color: "text.disabled",
                  fontSize: 11,
                  transform: folded ? "none" : "rotate(90deg)",
                  transition: "transform .15s",
                }}
              >
                &#x25B6;
              </Box>
              {heading}
            </Box>
          ) : (
            heading
          )}
          {folded && summary ? (
            <Box
              component="span"
              sx={{
                fontFamily: "ui-monospace, Consolas, monospace",
                fontSize: 11.5,
                color: "text.secondary",
                minWidth: 0,
              }}
            >
              {summary}
            </Box>
          ) : (
            lede && (
              <Box component="p" sx={{ m: 0, color: "text.secondary", fontSize: 12.5 }}>
                {lede}
              </Box>
            )
          )}
          {(badge || actions) && (
            <Box sx={{ ml: "auto", display: "flex", gap: 0.75, alignItems: "center" }}>
              {badge}
              {!folded && actions}
            </Box>
          )}
        </Box>
      )}
      {!folded && children}
    </Box>
  );
}
