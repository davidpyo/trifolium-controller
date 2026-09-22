import React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import Typography from "@mui/material/Typography";

// Prose a panel has to carry but must not lead with: a disclosure triangle over body text, and the
// paragraph and step styles the text inside one is written in.
//
// Shared rather than per-panel because the shape is the promise - anything folded away behind a
// triangle is optional reading, and two panels that fold differently stop reading as the same
// offer.

/** A summary line that opens into whatever is passed as children. Closed to begin with. */
export function HelpSection({ summary, children }: { summary: string; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);

  return (
    <Box>
      <Button
        size="small"
        onClick={() => setOpen((v) => !v)}
        sx={{ textTransform: "none", px: 0.5, justifyContent: "flex-start" }}
      >
        {open ? "▾" : "▸"}&nbsp;{summary}
      </Button>
      <Collapse in={open}>
        <Box sx={{ pl: 1.5, pr: 1, pb: 1 }}>{children}</Box>
      </Collapse>
    </Box>
  );
}

export function Para({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
      {children}
    </Typography>
  );
}

export function Steps({ children }: { children: React.ReactNode }) {
  return (
    <Box component="ol" sx={{ m: 0, mb: 0.75, pl: 2.5 }}>
      {children}
    </Box>
  );
}

export function Step({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      component="li"
      variant="body2"
      color="text.secondary"
      sx={{ display: "list-item", mb: 0.35 }}
    >
      {children}
    </Typography>
  );
}
