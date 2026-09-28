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

// MUI picks an option when the press that opened a list is released over it, and the list opens
// touching the field, so a slow click that drifts a few pixels picks one by accident. MUI makes that
// pick by clicking the option during the release; a release with no press inside the list is the
// tell. A click in the list, or Enter on an option, has no such release and passes.
let pressedInList = false;
let releasedWithoutPress = false;
const noPickOnOpeningRelease = {
  onMouseDownCapture: () => {
    pressedInList = true;
  },
  onMouseLeave: () => {
    pressedInList = false;
  },
  onMouseUpCapture: () => {
    releasedWithoutPress = !pressedInList;
    pressedInList = false;
    setTimeout(() => {
      releasedWithoutPress = false; // for this release's click only
    });
  },
  onClickCapture: (event: React.MouseEvent) => {
    if (releasedWithoutPress) event.stopPropagation();
  },
};

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
      MuiSelect: {
        defaultProps: {
          size: "small",
          MenuProps: { slotProps: { list: noPickOnOpeningRelease } },
        },
      },
    },
  });
