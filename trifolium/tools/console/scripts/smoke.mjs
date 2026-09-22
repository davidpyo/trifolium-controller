// Smoke-tests the built single-file page: loads it in jsdom, runs its script, and checks React
// actually mounted something.
//
// Exists because "the bundle parses" and "the page renders" are different claims, and a runtime
// error in a UI library leaves exactly the same blank page as a syntax error. Catches the class of
// mistake that only shows up when the code runs.
//
//   node scripts/smoke.mjs ../serial-config.html
//
// Not a substitute for opening it in a real browser: jsdom has no Web Serial, so this checks the
// initial offline render only, which is precisely the part that was blank.

import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";

const target = process.argv[2] ?? "../serial-config.html";
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

// Things that must appear if the schema actually rendered into the tabbed layout.
//
// Deliberately not "Advanced": that group is a container the layout unwraps, so its name is absent
// by design and asserting on it would lock in the old nested-accordion shape.
//
// Nor "Per Motor RPM", which this used to require on the profile tab even in Stage mode. The
// console now drops the inactive half of a view toggle instead of showing it greyed out, so on a
// stage-mode fixture its absence is the correct render.
// Split by tab: only one tab's content is mounted at a time, so a device-tab string is genuinely
// absent from the profile-tab render and asserting it there would be wrong.
const expectedAlways = [
  "TRIFOLIUM",
  "Config Console",
  "Connect",
  "Read from Device",
  // Backup, Load Backup and Write are menus now - the button is on the page, the three choices
  // inside it are not, so assert the trigger rather than its contents.
  "Backup",
  "Load Backup",
  "Write to Device",
  "Splash",
  "RPM Log",
  "Raw JSON",
];
const expectedProfileTab = [
  "Profile slot",
  "Name", // profile:name, moved out of the form and onto the slot row
  "Fire Modes",
];
const expectedDeviceTab = [
  "Shot Counter", // curated grouping applied
  "Switch Settings",
  "Motors & PID",
  // The ESC-side help under the motor matrix. Its summary renders folded, so the string being
  // present is the whole assertion - what is under it is the component's own test.
  "Setting up the ESCs in AM32",
  "Display", // moved above where Wiring used to sit
];
// The wiring table has its own tab now. Checked there rather than on Device, and by its third
// column: "Held At Boot" proves the table shape, where a pin label alone would only prove a field
// list. The rules block under it is prose about firmware behaviour, so its heading is checked too -
// it renders unconditionally, unlike the per-row tooltips, which only exist on hover.
const expectedWiringTab = [
  "Trigger",
  "Normally Closed",
  "Held At Boot",
  "How these pins are read",
];
const expected = [...expectedAlways, ...expectedProfileTab];
const missing = expected.filter((s) => !text.includes(s));
if (missing.length) console.log(`  MISSING TEXT: ${missing.join(", ")}`);

// Click through to the Fire Modes tab and check it renders too. That editor resolves the `[*]`
// placeholder in the shared mode rows to a concrete index, which nothing else exercises.
const tabs = [...dom.window.document.querySelectorAll('[role="tab"]')];
const fireTab = tabs.find((t) => t.textContent?.trim() === "Device");
let fireModesText = "";
if (fireTab) {
  fireTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  fireModesText = root?.textContent ?? "";
}
console.log(`  tabs found     : ${tabs.length}`);
console.log(`  device tab     : ${fireTab ? "clicked" : "NOT FOUND"}`);
let deviceMissing = [];
if (fireTab) {
  const hasMatrix = /Motor 1[\s\S]*Motor 4/.test(fireModesText);
  console.log(`  motor matrix   : ${hasMatrix ? "present" : "MISSING"}`);
  if (!hasMatrix) console.log("  ERROR device tab has no motor matrix");
  deviceMissing = expectedDeviceTab.filter((t) => !fireModesText.includes(t));
  if (deviceMissing.length) console.log(`  MISSING ON DEVICE TAB: ${deviceMissing.join(", ")}`);
}

const wiringTab = tabs.find((t) => t.textContent?.trim() === "Wiring");
let wiringMissing = [];
if (wiringTab) {
  wiringTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  const wiringText = root?.textContent ?? "";
  wiringMissing = expectedWiringTab.filter((t) => !wiringText.includes(t));
  console.log(`  wiring tab     : ${wiringMissing.length ? "INCOMPLETE" : "renders"}`);
  if (wiringMissing.length) console.log(`  MISSING ON WIRING TAB: ${wiringMissing.join(", ")}`);
} else {
  console.log("  wiring tab     : NOT FOUND");
  wiringMissing = expectedWiringTab;
}

if (process.argv.includes("--dump")) {
  console.log("\n--- visible text ---");
  console.log(text.replace(/\s+/g, " ").slice(0, 1200));
  if (fireModesText) {
    console.log("\n--- fire modes tab ---");
    console.log(fireModesText.replace(/\s+/g, " ").slice(0, 900));
  }
}

const ok =
  nodes > 20 &&
  errors.length === 0 &&
  missing.length === 0 &&
  deviceMissing.length === 0 &&
  wiringMissing.length === 0;
console.log(`\nVERDICT: ${ok ? "renders" : "BLANK OR BROKEN"}`);
process.exit(ok ? 0 : 1);
