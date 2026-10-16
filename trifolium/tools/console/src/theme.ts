import { alpha, createTheme } from "@mui/material/styles";

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

/**
 * A slim pill on a clear track that takes the accent colour under the pointer. Chromium and Safari
 * draw it from the ::-webkit-scrollbar rules. Chromium ignores those rules wherever the standard
 * scrollbar-width or scrollbar-color is set, so the standard pair is given only to browsers
 * without the WebKit ones, which is Firefox.
 */
function scrollbars(mode: "light" | "dark", accent: string) {
  const ink = mode === "dark" ? "#c9d4e3" : "#3a4658";
  const thumb = alpha(ink, mode === "dark" ? 0.28 : 0.32);
  return {
    "*::-webkit-scrollbar": { width: 10, height: 10 },
    "*::-webkit-scrollbar-track, *::-webkit-scrollbar-corner": {
      background: "transparent",
    },
    "*::-webkit-scrollbar-thumb": {
      backgroundColor: thumb,
      borderRadius: 999,
      // The clear border insets the pill from the edge.
      border: "2px solid transparent",
      backgroundClip: "padding-box",
      minHeight: 36,
    },
    "*::-webkit-scrollbar-thumb:hover": { backgroundColor: alpha(accent, 0.7) },
    "*::-webkit-scrollbar-thumb:active": { backgroundColor: accent },
    "@supports not selector(::-webkit-scrollbar)": {
      "*": { scrollbarWidth: "thin", scrollbarColor: `${thumb} transparent` },
    },
  };
}

export const buildTheme = (mode: "light" | "dark") => {
  const accent = mode === "dark" ? "#7cc4ff" : "#0a58a8";
  return createTheme({
    palette: {
      mode,
      primary: { main: accent },
      // The page ground sits a step below the panels on it, so a section reads as a surface.
      background:
        mode === "dark"
          ? { default: "#0c1118", paper: "#131a24" }
          : { default: "#f4f6fa", paper: "#ffffff" },
      divider: mode === "dark" ? "#253041" : "#dbe2ec",
      warning: { main: mode === "dark" ? "#f2b257" : "#a85d00" },
    },
    shape: { borderRadius: 6 },
    typography: {
      fontFamily: fontStack,
      // Numeric fields read better aligned; tabular figures stop values jittering as they change.
      fontSize: 14,
      button: { textTransform: "none", fontWeight: 550 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { fontVariantNumeric: "tabular-nums" },
          ...scrollbars(mode, accent),
        },
      },
      MuiButton: { defaultProps: { disableElevation: true } },
      MuiPaper: { defaultProps: { elevation: 0 } },
      MuiTextField: { defaultProps: { size: "small" } },
      MuiSelect: {
        defaultProps: {
          size: "small",
          MenuProps: { slotProps: { list: noPickOnOpeningRelease } },
        },
      },
    },
  });
};
