import React from "react";
import Box from "@mui/material/Box";
import Dialog from "@mui/material/Dialog";

// Ctrl+K: find a setting by name or by what it does, or run a command, without knowing which page
// holds it. Settings outnumber pages ten to one, so this is the quickest way to most of them.

export interface PaletteItem {
  group: "Commands" | "Settings";
  label: string;
  /** What it does, searched as well as shown. */
  sub?: string;
  /** Where it lives, or its shortcut. */
  where: string;
  run: () => void;
}

/** Every word typed appears somewhere in the item; a hit on the label itself ranks first. */
export function search(items: PaletteItem[], query: string): PaletteItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items.filter((i) => i.group === "Commands").slice(0, 6);
  const words = q.split(/\s+/);
  const hay = (i: PaletteItem) => `${i.label} ${i.sub ?? ""} ${i.where}`.toLowerCase();
  const found = items.filter((i) => words.every((w) => hay(i).includes(w)));
  const rank = (i: PaletteItem) => (i.label.toLowerCase().includes(q) ? 0 : 1);
  const commands = found.filter((i) => i.group === "Commands").slice(0, 4);
  const settings = found
    .filter((i) => i.group === "Settings")
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 8);
  return [...commands, ...settings];
}

export function Palette({
  open,
  items,
  onClose,
}: {
  open: boolean;
  items: PaletteItem[];
  onClose: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [at, setAt] = React.useState(0);
  const results = React.useMemo(() => search(items, query), [items, query]);

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setAt(0);
    }
  }, [open]);

  const run = (i: number) => {
    const item = results[i];
    if (!item) return;
    onClose();
    item.run();
  };

  let index = 0;
  const group = (name: PaletteItem["group"]) => {
    const inGroup = results.filter((r) => r.group === name);
    if (!inGroup.length) return null;
    return (
      <React.Fragment key={name}>
        <Box
          sx={{
            fontSize: 11,
            letterSpacing: ".07em",
            textTransform: "uppercase",
            color: "text.disabled",
            px: 1,
            pt: 1,
            pb: 0.5,
            fontWeight: 650,
          }}
        >
          {name}
        </Box>
        {inGroup.map((item) => {
          const i = index++;
          return (
            <Box
              key={`${name}-${item.label}-${item.where}`}
              role="option"
              aria-selected={i === at}
              onMouseEnter={() => setAt(i)}
              onClick={() => run(i)}
              sx={{
                display: "flex",
                gap: 1.25,
                alignItems: "baseline",
                px: 1,
                py: 0.85,
                borderRadius: 1,
                cursor: "pointer",
                bgcolor: i === at ? "action.selected" : "transparent",
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                {item.label}
                {item.sub && (
                  <Box
                    sx={{
                      color: "text.secondary",
                      fontSize: 12,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.sub}
                  </Box>
                )}
              </Box>
              <Box
                sx={{
                  ml: "auto",
                  fontSize: 12,
                  color: "text.disabled",
                  whiteSpace: "nowrap",
                  flex: "none",
                }}
              >
                {item.where}
              </Box>
            </Box>
          );
        })}
      </React.Fragment>
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      slotProps={{ paper: { sx: { alignSelf: "flex-start", mt: 8 } } }}
    >
      <Box
        component="input"
        autoFocus
        value={query}
        placeholder="Search settings and commands…"
        aria-label="Search settings and commands"
        role="combobox"
        aria-expanded
        aria-controls="palette-results"
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          setQuery(e.target.value);
          setAt(0);
        }}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setAt((v) => Math.min(results.length - 1, v + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setAt((v) => Math.max(0, v - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            run(at);
          }
        }}
        sx={{
          width: "100%",
          border: 0,
          borderBottom: 1,
          borderColor: "divider",
          px: 1.75,
          py: 1.5,
          fontSize: 15,
          outline: "none",
          bgcolor: "background.paper",
          color: "text.primary",
          font: "inherit",
        }}
      />
      <Box id="palette-results" role="listbox" sx={{ maxHeight: 360, overflowY: "auto", p: 0.75 }}>
        {results.length ? (
          [group("Commands"), group("Settings")]
        ) : (
          <Box sx={{ p: 2, color: "text.secondary", fontSize: 13 }}>
            No setting or command matches.
          </Box>
        )}
      </Box>
    </Dialog>
  );
}
