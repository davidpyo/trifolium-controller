// Smoke-tests the built single-file page: loads it in jsdom, runs its script, and checks React
// actually mounted something.
//
// Exists because "the bundle parses" and "the page renders" are different claims, and a runtime
// error in a UI library leaves exactly the same blank page as a syntax error. Catches the class of
// mistake that only shows up when the code runs.
//
//   node scripts/smoke.mjs dist/index.html
//
// Not a substitute for opening it in a real browser: jsdom has no Web Serial, so this checks the
// initial offline render only, which is precisely the part that was blank.

import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";

const target = process.argv[2] ?? "dist/index.html";
const html = readFileSync(target, "utf8");

const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (e) => errors.push(`jsdomError: ${e.message}`));
virtualConsole.on("error", (...args) => errors.push(`console.error: ${args.join(" ")}`));

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  virtualConsole,
  beforeParse(window) {
    // jsdom implements no scrolling at all, and MUI's Tabs and Select both call scrollIntoView.
    // Without this an unimplemented method throws mid-render and the page looks blank.
    window.Element.prototype.scrollIntoView ??= function scrollIntoView() { };
    // jsdom ships no matchMedia, and the theme picks light/dark from it.
    window.matchMedia ??= (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() { },
      removeListener() { },
      addEventListener() { },
      removeEventListener() { },
      dispatchEvent: () => false,
    });
  },
});

// React 19 mounts synchronously enough for a macrotask to be sufficient.
await new Promise((r) => setTimeout(r, 500));

const root = dom.window.document.getElementById("root");
const text = root?.textContent ?? "";
const nodes = root?.querySelectorAll("*").length ?? 0;

console.log(`${target}`);
console.log(`  #root children : ${nodes} elements`);
console.log(`  text length    : ${text.length}`);
console.log(`  looks mounted  : ${nodes > 20 ? "yes" : "NO"}`);

for (const e of errors) console.log(`  ERROR ${e}`);

// Things that must appear on the first page, the Overview, and in the frame around every page.
const expectedAlways = [
  "TRIFOLIUM",
  "Connect",
  // The navigation: every page is reachable from the rail.
  "Overview",
  "Profiles",
  "Blaster settings",
  "Wiring",
  "RPM capture",
  "Splash screen",
  "Firmware",
  "Maintenance",
  "Raw JSON",
  // The unsaved-changes bar and the log at the foot of the page.
  "No unsaved changes",
  "Log",
  // Overview's own panels.
  "Health",
  "Backups and firmware",
];
const expectedProfiles = [
  "Name", // profile:name, beside the slot tabs
  "Fire Modes",
];
const expectedBlaster = [
  "Shot Counter", // curated grouping applied
  "Switch Settings",
  "Motors & PID",
  // The ESC-side help under the motor matrix. Its summary renders folded, so the string being
  // present is the whole assertion - what is under it is the component's own test.
  "Setting up the ESCs in AM32",
  "Display",
];
// Checked by the wiring table's second column: "Normally Closed" proves the table shape, where a pin
// label alone would only prove a field list. The rules block under it is prose about firmware
// behaviour, so its heading is checked too.
const expectedWiring = ["Trigger", "Normally Closed", "How these pins are read"];

const missing = expectedAlways.filter((s) => !text.includes(s));
if (missing.length) console.log(`  MISSING TEXT: ${missing.join(", ")}`);

// Only one page is mounted at a time, so each is visited through the navigation and checked there.
const navButton = (label) =>
  [...dom.window.document.querySelectorAll('nav[aria-label="Sections"] button')].find(
    (b) => b.textContent?.trim() === label,
  );
const visit = async (label, wanted) => {
  const button = navButton(label);
  if (!button) {
    console.log(`  ${label.padEnd(15)}: NOT FOUND`);
    return { text: "", missing: wanted };
  }
  button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  const pageText = root?.textContent ?? "";
  const absent = wanted.filter((t) => !pageText.includes(t));
  console.log(`  ${label.padEnd(15)}: ${absent.length ? "INCOMPLETE" : "renders"}`);
  if (absent.length) console.log(`  MISSING ON ${label.toUpperCase()}: ${absent.join(", ")}`);
  return { text: pageText, missing: absent };
};

const profilesPage = await visit("Profiles", expectedProfiles);
const blasterPage = await visit("Blaster settings", expectedBlaster);
const hasMatrix = /Motor 1[\s\S]*Motor 4/.test(blasterPage.text);
console.log(`  motor matrix   : ${hasMatrix ? "present" : "MISSING"}`);
const wiringPage = await visit("Wiring", expectedWiring);

if (process.argv.includes("--dump")) {
  console.log("\n--- visible text ---");
  console.log(text.replace(/\s+/g, " ").slice(0, 1200));
  console.log("\n--- blaster settings ---");
  console.log(blasterPage.text.replace(/\s+/g, " ").slice(0, 900));
}

const ok =
  nodes > 20 &&
  errors.length === 0 &&
  missing.length === 0 &&
  hasMatrix &&
  profilesPage.missing.length === 0 &&
  blasterPage.missing.length === 0 &&
  wiringPage.missing.length === 0;
console.log(`\nVERDICT: ${ok ? "renders" : "BLANK OR BROKEN"}`);
process.exit(ok ? 0 : 1);
