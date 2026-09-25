import React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { DropLabel, dropOutlineSx, useFileDrop } from "./FileDrop";

// Custom boot splash: a 128x64 1bpp bitmap stored in flash (src/splashStore.h).
//
// Ported from tools/serial-config.html. The firmware is strict by design - it blocks on a fixed
// 1024-byte read and rejects anything else - so the size check happens here rather than sending a
// wrong-sized image and having it refused.
//
// Packing is MSB-first within each byte, 16 bytes per row, matching SplashStore's layout. A *dark*
// source pixel becomes a *lit* pixel on the OLED, which is what makes black-on-white artwork look
// right without inverting.

/** Shared by the picker and the drop zone. */
const IMAGE_ACCEPT = ["image/*"] as const;

export const SPLASH_WIDTH = 128;
export const SPLASH_HEIGHT = 64;
export const SPLASH_BYTES = (SPLASH_WIDTH * SPLASH_HEIGHT) / 8;

/** Thresholds to 1bpp and returns both the packed bytes and a preview bitmap. */
function pack(image: ImageData, invert: boolean): { bytes: Uint8Array; preview: ImageData } {
  const bytes = new Uint8Array(SPLASH_BYTES);
  const preview = new ImageData(SPLASH_WIDTH, SPLASH_HEIGHT);

  for (let y = 0; y < SPLASH_HEIGHT; y++) {
    for (let byteX = 0; byteX < SPLASH_WIDTH / 8; byteX++) {
      let packed = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = byteX * 8 + bit;
        const idx = (y * SPLASH_WIDTH + x) * 4;
        const lum =
          0.299 * image.data[idx] + 0.587 * image.data[idx + 1] + 0.114 * image.data[idx + 2];
        let on = lum < 128 ? 1 : 0; // dark source pixel -> lit pixel on the OLED
        if (invert) on = on ? 0 : 1;
        packed = (packed << 1) | on;
        const v = on ? 255 : 0;
        preview.data[idx] = v;
        preview.data[idx + 1] = v;
        preview.data[idx + 2] = v;
        preview.data[idx + 3] = 255;
      }
      bytes[y * (SPLASH_WIDTH / 8) + byteX] = packed;
    }
  }
  return { bytes, preview };
}

export interface SplashProps {
  live: boolean;
  onUpload: (bytes: Uint8Array) => void;
  onClear: () => void;
}

export function Splash({ live, onUpload, onClear }: SplashProps) {
  const [source, setSource] = React.useState<ImageData | null>(null);
  const [invert, setInvert] = React.useState(false);
  const [bytes, setBytes] = React.useState<Uint8Array | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);
  const [rejected, setRejected] = React.useState<string | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  // Re-thresholds whenever the source or the invert toggle changes, so flipping invert is instant
  // rather than needing the file picked again.
  React.useEffect(() => {
    if (!source) {
      setBytes(null);
      return;
    }
    const { bytes: packed, preview } = pack(source, invert);
    setBytes(packed);
    const ctx = canvasRef.current?.getContext("2d");
    ctx?.putImageData(preview, 0, 0);
    setStatus("Converted. Check the preview, then upload.");
  }, [source, invert]);

  const pick = async (file: File) => {
    setRejected(null);
    setStatus(null);
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) {
      setSource(null);
      setRejected("Could not decode that file as an image.");
      return;
    }
    if (bitmap.width !== SPLASH_WIDTH || bitmap.height !== SPLASH_HEIGHT) {
      setSource(null);
      setRejected(
        `Image is ${bitmap.width}x${bitmap.height}. It must be exactly ${SPLASH_WIDTH}x${SPLASH_HEIGHT} — the firmware rejects any other size. Resize it and try again.`,
      );
      return;
    }

    const work = document.createElement("canvas");
    work.width = SPLASH_WIDTH;
    work.height = SPLASH_HEIGHT;
    const ctx = work.getContext("2d")!;
    ctx.fillStyle = "#fff"; // flatten transparency onto white before thresholding
    ctx.fillRect(0, 0, SPLASH_WIDTH, SPLASH_HEIGHT);
    ctx.drawImage(bitmap, 0, 0);
    setSource(ctx.getImageData(0, 0, SPLASH_WIDTH, SPLASH_HEIGHT));
  };

  const { over, dropProps } = useFileDrop({
    accept: IMAGE_ACCEPT,
    what: "an image",
    onFile: (file) => void pick(file),
    onReject: setRejected,
  });

  return (
    <Stack spacing={1} {...dropProps} sx={dropOutlineSx(over)}>
      <DropLabel over={over} label="Drop a 128x64 image here" />
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Button size="small" variant="outlined" onClick={() => fileRef.current?.click()}>
          Choose image
        </Button>
        <Typography variant="caption" color="text.disabled">
          or drop one here
        </Typography>
        <input
          ref={fileRef}
          type="file"
          accept={IMAGE_ACCEPT.join(",")}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void pick(file);
          }}
        />
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={invert}
              disabled={!source}
              onChange={(e) => setInvert(e.target.checked)}
            />
          }
          disableTypography
          label={<Typography variant="caption">Invert</Typography>}
          sx={{ m: 0, gap: 0.5 }}
        />
        <Button
          size="small"
          variant="contained"
          disabled={!live || !bytes}
          onClick={() => bytes && onUpload(bytes)}
        >
          Upload to device
        </Button>
        <Button size="small" color="error" disabled={!live} onClick={onClear}>
          Clear custom splash
        </Button>
      </Stack>

      {rejected && (
        <Alert severity="error" sx={{ py: 0 }}>
          {rejected}
        </Alert>
      )}

      <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start", flexWrap: "wrap" }}>
        <Box>
          <Typography variant="caption" color="text.secondary" component="div">
            Preview (what the OLED will show)
          </Typography>
          <Box
            sx={{
              display: "inline-block",
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              p: 0.5,
              bgcolor: "#000",
            }}
          >
            <canvas
              ref={canvasRef}
              width={SPLASH_WIDTH}
              height={SPLASH_HEIGHT}
              style={{ width: 256, height: 128, imageRendering: "pixelated", display: "block" }}
            />
          </Box>
        </Box>
        <Stack spacing={0.5} sx={{ maxWidth: 380 }}>
          <Typography variant="caption" color="text.secondary">
            Must be exactly {SPLASH_WIDTH}×{SPLASH_HEIGHT}. Dark pixels light up. Takes effect on the
            next boot.
          </Typography>
          {status && (
            <Typography variant="caption" color="success.main">
              {status}
            </Typography>
          )}
          <Typography variant="caption" color="text.disabled">
            The console does not read a splash back from the device, so the check is rebooting and
            looking at it.
          </Typography>
        </Stack>
      </Stack>
    </Stack>
  );
}
