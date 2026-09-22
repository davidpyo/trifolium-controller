import React from "react";
import { createRoot } from "react-dom/client";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import { App } from "./App";
import { buildTheme } from "./theme";

function Root() {
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
  const theme = React.useMemo(() => buildTheme(prefersDark ? "dark" : "light"), [prefersDark]);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  );
}

function mount() {
  const host = document.getElementById("root");
  if (!host) throw new Error("#root missing from index.html");
  createRoot(host).render(<Root />);
}

// The built page inlines this as a *classic* script, which executes at its position in the document -
// which can be before <div id="root"> has been parsed. `defer` is no help: it is ignored on inline
// scripts. So wait for the parse rather than assuming the script sits after the markup it needs.
//
// In dev the entry is a real ES module, which is deferred anyway, so readyState has already moved on
// and this mounts immediately.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
  mount();
}
