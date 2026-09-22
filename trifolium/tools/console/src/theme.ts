import { createTheme } from "@mui/material/styles";

// No webfont. MUI defaults to Roboto pulled from Google Fonts, which cannot load from a file://
// origin (opaque origin, CORS blocks the stylesheet) and would leave the page rendering in a
// fallback anyway. A system stack costs nothing and looks native on every platform.
const fontStack = [
  "system-ui",
  "-apple-system",
  "Segoe UI",
  "Roboto",
  "Helvetica Neue",
  "Arial",
  "sans-serif",
].join(",");

export const buildTheme = (mode: "light" | "dark") =>
  createTheme({
    palette: {
      mode,
      primary: { main: mode === "dark" ? "#7cc4ff" : "#0a58a8" },
    },
    typography: {
      fontFamily: fontStack,
      // Numeric fields read better aligned; tabular figures stop values jittering as they change.
      fontSize: 14,
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { fontVariantNumeric: "tabular-nums" },
        },
      },
      MuiTextField: { defaultProps: { size: "small" } },
      MuiSelect: { defaultProps: { size: "small" } },
    },
  });
