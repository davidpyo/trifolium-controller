import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { SxProps, Theme } from "@mui/material/styles";

// Drag-and-drop for the console's file pickers.
//
// Every picker here takes exactly one file, so a multi-file drop is refused rather than quietly
// reduced to its first entry. A dropped file is checked against the same accept list its hidden
// <input> carries, and a mismatch is reported through whichever channel that picker already uses
// for a bad pick - the device log, an inline Alert - rather than being parsed and failing deeper in.

/** One accept entry: ".json" against the name, "image/*" or "text/plain" against the type. */
function matches(file: File, entry: string): boolean {
  const rule = entry.trim().toLowerCase();
  if (!rule) return false;
  if (rule.startsWith(".")) return file.name.toLowerCase().endsWith(rule);
  if (rule.endsWith("/*")) return file.type.toLowerCase().startsWith(rule.slice(0, -1));
  return file.type.toLowerCase() === rule;
}

export function acceptsFile(file: File, accept: readonly string[]): boolean {
  return accept.some((entry) => matches(file, entry));
}

export interface FileDropOptions {
  /** Same entries as the picker's `accept`, so the two cannot disagree about what is allowed. */
  accept: readonly string[];
  /** Names the wanted file in a refusal: "not <what>". */
  what: string;
  onFile: (file: File) => void;
  onReject: (message: string) => void;
  disabled?: boolean;
}

/** Drop handlers plus whether a file is currently over the element they are spread onto. */
export function useFileDrop({ accept, what, onFile, onReject, disabled }: FileDropOptions) {
  // dragenter and dragleave fire again for every child the pointer crosses, so this counts depth
  // instead of toggling a flag - a boolean clears on the first inner element and the zone goes dark
  // while the file is still over it.
  const depth = React.useRef(0);
  const [over, setOver] = React.useState(false);

  const clear = () => {
    depth.current = 0;
    setOver(false);
  };

  // Dragged text or a link is left alone, so selecting across a panel doesn't light up a drop zone.
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  const dropProps = disabled
    ? {}
    : {
        onDragEnter: (e: React.DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          depth.current += 1;
          setOver(true);
        },
        onDragOver: (e: React.DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault(); // without this the browser navigates to the file instead
          e.dataTransfer.dropEffect = "copy";
        },
        onDragLeave: (e: React.DragEvent) => {
          if (!hasFiles(e)) return;
          depth.current -= 1;
          if (depth.current <= 0) clear();
        },
        onDrop: (e: React.DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          clear();
          const files = Array.from(e.dataTransfer.files);
          if (files.length === 0) return;
          if (files.length > 1) {
            onReject(`Drop one file at a time - ${files.length} were dropped.`);
            return;
          }
          if (!acceptsFile(files[0], accept)) {
            onReject(`${files[0].name} is not ${what}.`);
            return;
          }
          onFile(files[0]);
        },
      };

  return { over, dropProps };
}


/**
 * Outline for an element that is already on screen, shown only while a file is over it.
 *
 * An outline rather than a border: it is drawn outside the box, so nothing on the panel moves when
 * a drag starts.
 */
export function dropOutlineSx(over: boolean): SxProps<Theme> {
  return {
    position: "relative",
    outline: over ? "2px dashed" : "none",
    outlineColor: "primary.main",
    outlineOffset: 4,
    borderRadius: 1,
  };
}

/** Says what the outlined element wants, as a child of it. Renders nothing until a file is over. */
export function DropLabel({ over, label }: { over: boolean; label: string }) {
  if (!over) return null;
  return (
    <Box
      sx={{
        position: "absolute",
        top: 4,
        right: 4,
        px: 0.75,
        py: 0.25,
        borderRadius: 1,
        bgcolor: "background.paper",
        border: 1,
        borderColor: "primary.main",
        pointerEvents: "none",
        zIndex: 1,
      }}
    >
      <Typography variant="caption" color="primary.main" noWrap>
        {label}
      </Typography>
    </Box>
  );
}
