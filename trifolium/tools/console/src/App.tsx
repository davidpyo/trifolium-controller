import React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import {
  BOARD_ID_KEY,
  WIRING_CONFIGURED_KEY,
  presetDrift,
  presetEntries,
  presetForBoardId,
  wiringLabel,
  type Preset,
} from "./schema/presets";
import { needsPresetPicker } from "./schema/wiring";
import { diagramForBoardId } from "./schema/wiringDiagrams";
import { buildPatch, getByKey, setByKey } from "./schema/keyPath";
import { walk, type BootStatus, type Schema, type SchemaNode } from "./schema/types";
import { resolveVisibility } from "./schema/visibility";
import { configFrom, SerialTransport, TIMEOUT_SCHEMA_MS, type LogLine } from "./serial/transport";
import { bundleFilename, buildBundle, checkBundle, diffKeys, downloadJson } from "./config/bundle";
import { blasterLoads, schemaMismatch, type Blaster } from "./config/blasters";
import { LOG_LINE_CAP, extractRpmCsv } from "./rpm/parse";
import { compareVersions } from "./firmware/releases";
import { applyLayout } from "./ui/applyLayout";
import { listChanges, marksToRevert, sectionSummary, splitMark, type Change } from "./ui/changes";
import { DirtyKeys, StagingContext, type Staging } from "./ui/dirty";
import { SetupWizard } from "./ui/SetupWizard";
import { BootFaults } from "./ui/BootFaults";
import { BootRules } from "./ui/BootRules";
import { EscSetup } from "./ui/EscSetup";
import { FireModes } from "./ui/FireModes";
import { FlashDialog } from "./ui/FlashDialog";
import { DEVICE_LAYOUT, PROFILE_LAYOUT } from "./ui/layout";
import { LoadKindDialog } from "./ui/LoadKindDialog";
import { logToText } from "./ui/LogView";
import { PinConflicts } from "./ui/PinConflicts";
import { ProfileBar } from "./ui/ProfileBar";
import { ProfileCopyDialog } from "./ui/ProfileCopyDialog";
import { RawJson } from "./ui/RawJson";
import { ResetDialog, type ResetKind, type ResetPlan } from "./ui/ResetDialog";
import { RpmLog } from "./ui/RpmLog";
import { FW_CONSOLE_CONTROLS, RevHold, type MotorsStatus, type RevHoldApi } from "./ui/RevHold";
import { motorActionRows, useMotorActions, type Ack } from "./ui/MotorActions";
import { RpmStages } from "./ui/RpmStages";
import { EncoderSelector, SelectorSwitch } from "./ui/SelectorSwitch";
import { WiringWarnings } from "./ui/WiringWarnings";
import { WiringDiagram } from "./ui/WiringDiagram";
import { WiringRules } from "./ui/wiringRules";
import { WiringTable } from "./ui/WiringTable";
import { ConsoleFooter } from "./ui/ConsoleFooter";
import { Section, type Payloads } from "./ui/Section";
import { countFields, deriveSections, pruneToStore, type Store } from "./ui/sections";
import { Splash, type DeviceSplash } from "./ui/Splash";
import {
  CONFIG_ACCEPT,
  Chip,
  TopBar,
  garblingFirmware,
  FW_LOGS_WAIT_FOR_REPLIES,
  type LoadIntent,
} from "./ui/TopBar";
import { BottomTabs, NavRail, type ViewId } from "./ui/shell/Nav";
import { LOG_DEFAULT_PX, LogDrawer, clampLogHeight } from "./ui/shell/LogDrawer";
import { PendingBar, ReviewSheet, type WriteProgress } from "./ui/shell/Pending";
import { Page, PageHead, Panel, Shell } from "./ui/shell/Shell";
import { Toc, sectionId } from "./ui/shell/Toc";
import { Palette, type PaletteItem } from "./ui/shell/Palette";
import { splitUnit } from "./ui/changes";
import { helpFor } from "./help/settings";
import Switch from "@mui/material/Switch";
import { Firmware } from "./ui/pages/Firmware";
import { Maintenance } from "./ui/pages/Maintenance";
import { Overview } from "./ui/pages/Overview";

// Real replies captured from a device, checked in so the whole form can be built and reviewed with
// nothing plugged in. Replaced by live data on connect.
import fixtureSchema from "./fixtures/schema.json";
import fixtureDevice from "./fixtures/device.json";
import { presetById } from "./schema/presets";
import fixtureProfile0 from "./fixtures/profile0.json";
import fixtureProfile1 from "./fixtures/profile1.json";
import fixtureProfile2 from "./fixtures/profile2.json";

const FIXTURE_PROFILES: unknown[] = [fixtureProfile0, fixtureProfile1, fixtureProfile2];

/** The schema node for a key, so a field rendered outside the form still honours its own limits. */
/** Motors the config enables on a wired ESC pin. The firmware has the last word, at boot. */
function enabledMotors(device: unknown): number[] {
  const config = (getByKey(device as never, "device:motorConfig") as { enabled?: boolean }[]) ?? [];
  const pins = (getByKey(device as never, "device:escPins") as number[]) ?? [];
  return config.flatMap((m, i) => (m?.enabled && pins[i] !== undefined && pins[i] !== 255 ? [i] : []));
}

function nodeFor(schema: Schema, key: string): SchemaNode | undefined {
  let found: SchemaNode | undefined;
  walk(schema.tree, (node) => {
    if (node.key === key && !found) found = node;
  });
  return found;
}

const BLASTER_NAME_KEY = "device:blasterName";
const PROFILE_NAME_KEY = "profile:name";
/** Select-fire modes are only meaningful on a switch, which is what the firmware's own rule says. */
const SELECT_FIRE_KEY = "device:selectFireType";

/**
 * Which board the offline view pretends to be.
 *
 * `?board=diana_v1_0` picks one, which is how a board's drawings get looked at without a device -
 * the thing anyone adding a board under trifolium/boards/ needs to do, and otherwise needs an edit
 * and a rebuild for. An id naming no board falls back rather than blanking the page.
 */
const OFFLINE_BOARD = "trifolium_v1_4";

const offlineBoard = (): string => {
  if (typeof location === "undefined") return OFFLINE_BOARD;
  const asked = new URLSearchParams(location.search).get("board");
  return asked && presetById(asked) ? asked : OFFLINE_BOARD;
};

/**
 * What the offline view shows before a device is connected: the sample config, on that board with
 * its own wiring.
 *
 * Built from the preset rather than a second copy of it, so a board edited later is what this
 * shows - the point when the board is one you are in the middle of drawing.
 */
const OFFLINE_PRESET = presetById(offlineBoard());

const OFFLINE_SCHEMA = {
  ...(fixtureSchema as unknown as Schema),
  // The diagram is chosen by the schema's board id, not the device's: it is the device saying what
  // it is, and offline the fixture is doing the saying.
  boardId: OFFLINE_PRESET?.id ?? (fixtureSchema as unknown as Schema).boardId,
};

const OFFLINE_DEVICE = {
  ...fixtureDevice,
  ...(OFFLINE_PRESET?.wiring ?? {}),
};

/** Device keys edited on the Wiring page, whose edits count there rather than under Blaster. */
const WIRING_KEYS = new Set([
  ...(DEVICE_LAYOUT.find((s) => s.label === "Wiring")?.keys ?? []),
  BOARD_ID_KEY,
  WIRING_CONFIGURED_KEY,
]);

/** An edit not yet written: its mark as `dirty` holds it, and the value it stages. */
interface Staged {
  mark: string;
  value: unknown;
}

/** "1:profile:name" -> ["1", "profile:name"]. */
const splitSlotMark = (mark: string): [string, string] => {
  const at = mark.indexOf(":");
  return [mark.slice(0, at), mark.slice(at + 1)];
};

/** Values read from the device, with staged edits laid back over them. */
function restage(device: unknown, profiles: unknown[], keep: Staged[]) {
  let nextDevice = device;
  const nextProfiles = [...profiles];
  for (const { mark, value } of keep) {
    if (mark.startsWith("device:")) {
      nextDevice = setByKey(nextDevice, mark, value);
      continue;
    }
    const [slotText, key] = splitSlotMark(mark);
    const slot = Number(slotText);
    nextProfiles[slot] = setByKey(nextProfiles[slot], key, value);
  }
  return { device: nextDevice, profiles: nextProfiles };
}

/** One store's staged edits as the command that writes them. */
interface Load {
  command: string;
  payload: Record<string, unknown>;
  marks: string[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** This browser's page and log choices, which the console reopens with. */
const VIEW_KEY = "trifolium.view";
const LOG_KEY = "trifolium.log";
const LOG_HEIGHT_KEY = "trifolium.logHeight";

const remembered = (key: string, fallback: string): string => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback; // storage blocked: the default stands
  }
};

const onPhone = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(max-width: 599.95px)").matches;

const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // nothing to do: it is a convenience
  }
};

export function App() {
  const [schema, setSchema] = React.useState<Schema>(OFFLINE_SCHEMA);
  const [live, setLive] = React.useState(false);
  const [slot, setSlot] = React.useState(0);
  const [device, setDevice] = React.useState<unknown>(OFFLINE_DEVICE);
  const [profiles, setProfiles] = React.useState<unknown[]>(FIXTURE_PROFILES);
  /** The values as the device last reported them: what each staged edit is shown against. */
  const [baseline, setBaseline] = React.useState<{ device: unknown; profiles: unknown[] }>({
    device: OFFLINE_DEVICE,
    profiles: FIXTURE_PROFILES,
  });
  const [dirty, setDirty] = React.useState<Set<string>>(new Set());
  const [log, setLog] = React.useState<LogLine[]>([]);
  // Read when a capture's restart is over, which is several renders after its lines arrived.
  const logRef = React.useRef(log);
  logRef.current = log;
  /** The RPM capture page's box: held here so a finished capture lands in it from any page. */
  const [rpmText, setRpmText] = React.useState("");
  // Open by default where there is room for five lines; folded on a phone.
  const [logOpen, setLogOpen] = React.useState<boolean>(
    () => remembered(LOG_KEY, onPhone() ? "folded" : "open") === "open",
  );
  const [logHeight, setLogHeight] = React.useState<number>(() =>
    clampLogHeight(
      Number(remembered(LOG_HEIGHT_KEY, String(LOG_DEFAULT_PX))) || LOG_DEFAULT_PX,
      typeof window === "undefined" ? 900 : window.innerHeight,
    ),
  );
  const [view, setView] = React.useState<ViewId>(
    () => (remembered(VIEW_KEY, "overview") as ViewId) || "overview",
  );
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  /** A GPIO the wiring table and the board drawing both light, from whichever is under the pointer. */
  const [hoverPin, setHoverPin] = React.useState<number | null>(null);
  const [progress, setProgress] = React.useState<WriteProgress | null>(null);
  /** Sections folded to their title, by page and section. */
  const [folded, setFolded] = React.useState<Set<string>>(new Set());
  /** Every row's help line shown in full, for a screen with no hover to show it on. */
  const [describe, setDescribe] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  /** A preset the user picked on an already-wired device, held until they confirm. */
  /** The picker, opened deliberately on a device that already has a wiring. */
  const [presetsOpen, setPresetsOpen] = React.useState(false);
  /**
   * The blaster config a device is being set up with. Keeps the picker up across the restarts that
   * takes, during which the device reports no wiring and then, briefly, no connection at all.
   */
  const [settingUp, setSettingUp] = React.useState<Blaster | null>(null);
  /** The connected device's DUMP_BOOT, for the faults it recorded. Null while offline. */
  const [boot, setBoot] = React.useState<BootStatus | null>(null);
  /** A reset the user picked, held until they type its word. Null when no dialog is open. */
  const [pendingReset, setPendingReset] = React.useState<ResetPlan | null>(null);
  /** The PICOBOOT flasher. Openable offline, for a board already sitting in its bootloader. */
  const [flashOpen, setFlashOpen] = React.useState(false);
  // null closed; {to: null} open with nothing picked yet.
  const [copyTo, setCopyTo] = React.useState<{ to: number | null } | null>(null);

  /** The last read found boot faults or a resolved pin conflict, which Overview explains. */
  const bootProblem = React.useRef(false);

  // The transport is built once, so it reaches afterReboot() - rebuilt every render - through this.
  const onRebooting = React.useRef<(reason: string) => void>(() => {});
  const transport = React.useMemo(
    () =>
      new SerialTransport({
        onLog: (line) => setLog((prev) => [...prev.slice(-(LOG_LINE_CAP - 1)), line]),
        onDisconnect: () => {
          setLive(false);
          setWiringByHand(false); // a different device may need the picker
          // Faults describe the boot of a device that is no longer attached.
          setBoot(null);
        },
        onRebooting: (reason) => onRebooting.current(reason),
      }),
    [],
  );

  const note = (kind: LogLine["kind"], text: string) =>
    setLog((prev) => [...prev, { kind, text, at: Date.now() }]);

  // Only the device's own lines. Our "> COMMAND" echoes would break the contiguous-numeric-rows scan
  // that finds a CSV capture.
  const deviceLogText = React.useMemo(
    () =>
      log
        .filter((l) => l.kind === "in")
        .map((l) => l.text)
        .join("\n"),
    [log],
  );

  /**
   * The schema as it applies to the values in the form right now.
   *
   * `schema.visible` is the device's answer as of the last dump, which goes stale the moment
   * anything is edited - and the rows that move are exactly the ones a user is watching for when
   * they flip Control Type or Select-Fire. Only rows carrying a `visibleWhen` are re-evaluated;
   * everything else keeps the device's word, because the rules it does not publish read
   * post-conflict pins and board properties that no amount of form state can settle.
   */
  const resolved = React.useMemo(
    () => resolveVisibility(schema, { device, profile: profiles[slot] ?? {} }),
    [schema, device, profiles, slot],
  );

  const sectionsFor = React.useCallback(
    (which: Store): SchemaNode[] => {
      const pruned = deriveSections(resolved.tree)
        .map((s) => pruneToStore(s, which))
        .filter((s): s is SchemaNode => s !== null && countFields(s) > 0);
      return applyLayout(pruned, which === "device" ? DEVICE_LAYOUT : PROFILE_LAYOUT);
    },
    [resolved],
  );

  const profileSections = React.useMemo(() => sectionsFor("profile"), [sectionsFor]);
  const deviceSections = React.useMemo(() => sectionsFor("device"), [sectionsFor]);

  const payloads: Payloads = { device, profile: profiles[slot] ?? {} };

  const profileName = (i: number) => {
    const p = profiles[i] as { name?: string } | undefined;
    return p?.name?.trim() || `Slot ${i + 1}`;
  };

  /** Dirty keys for one store. Profile keys are recorded as "slot:key" so slots stay independent. */
  const dirtyFor = (which: Store, forSlot = slot): string[] =>
    [...dirty]
      .filter((d) => (which === "device" ? d.startsWith("device:") : d.startsWith(`${forSlot}:`)))
      .map((d) => (which === "device" ? d : d.slice(String(forSlot).length + 1)));

  /**
   * Values only - deliberately not the schema. Only for a write that did not reboot.
   *
   * The schema header carries state no DUMP_DEVICE or DUMP_PROFILE will ever return -
   * `activeProfileIndex`, `activeModeCount`, `wiringConfigured`, `pinConflicts`, `boardId` - so
   * anywhere those can have moved this leaves the console describing the device it met rather than
   * the one it is talking to, with nothing on screen saying so. The first two are the worst of it:
   * the slot picker keeps pointing at the old profile and the fire-mode list is clamped by the
   * wrong count, which reads as a device that lost its modes. A write the device applied without
   * rebooting cannot move any of the five, which is the whole of why this is safe there. Everywhere
   * else, and always after a reboot, use readSchemaAndValues().
   */
  const readAll = async (keep: Staged[] = []) => {
    const dev = await transport.request<unknown>("DUMP_DEVICE");
    const loaded: unknown[] = [];
    for (let i = 0; i < schema.profileCount; i++) {
      loaded.push(configFrom((await transport.request<unknown>(`DUMP_PROFILE ${i}`)) ?? {}));
    }
    const readDevice = dev ? configFrom(dev) : baseline.device;
    const read = restage(readDevice, loaded, keep);
    setBaseline({ device: readDevice, profiles: loaded });
    setDevice(read.device);
    setProfiles(read.profiles);
    setDirty(new Set(keep.map((s) => s.mark)));
  };

  /** Staged edits outside `written`, with their values, for a re-read to put back. */
  const stagedExcept = (written: Set<string>): Staged[] =>
    [...dirty]
      .filter((mark) => !written.has(mark))
      .map((mark) => {
        if (mark.startsWith("device:")) return { mark, value: getByKey(device, mark) };
        const [slotText, key] = splitSlotMark(mark);
        return { mark, value: getByKey(profiles[Number(slotText)], key) };
      });

  /**
   * Re-reads the schema and every stored value from a connected device.
   *
   * The schema comes first and is re-read, not cached: which rows exist and what bounds they carry
   * both depend on the board, so anything that can change the board has to refetch it rather than
   * only refreshing values.
   */
  const readSchemaAndValues = async (keep: Staged[] = []): Promise<boolean> => {
    const next = await transport.requestWhole<Schema>("DUMP_SCHEMA", TIMEOUT_SCHEMA_MS);
    if (!next || next.cmd !== "DUMP_SCHEMA") {
      note(
        "err",
        "No usable schema from the device - the log says why. Reconnect to try again. Firmware " +
          "that predates DUMP_SCHEMA never answers it: use the Raw JSON page there, since the form " +
          "would show limits that may not match the device.",
      );
      return false;
    }

    const dev = await transport.requestWhole<unknown>("DUMP_DEVICE");
    const loaded: unknown[] = [];
    for (let i = 0; i < next.profileCount; i++) {
      loaded.push(configFrom((await transport.requestWhole<unknown>(`DUMP_PROFILE ${i}`)) ?? {}));
    }

    // Cheap, and the only way to learn what this boot discarded: the faults print before a host
    // can attach. A device too old to answer leaves it null, which reads as "nothing recorded".
    const bootStatus = await transport.request<BootStatus>("DUMP_BOOT");
    setBoot(bootStatus);
    bootProblem.current =
      (bootStatus?.configFaults?.length ?? 0) > 0 || (next.pinConflicts?.length ?? 0) > 0;

    const readDevice = configFrom(dev ?? {});
    const read = restage(readDevice, loaded, keep);
    setSchema(next);
    setBaseline({ device: readDevice, profiles: loaded });
    setDevice(read.device);
    setProfiles(read.profiles);
    setSlot(next.activeProfileIndex);
    setDirty(new Set(keep.map((s) => s.mark)));
    setLive(true);
    return true;
  };

  /**
   * waitReady() before the first read, for the reason every reboot path already calls it: opening
   * the port is not the same as the device being ready. USB CDC enumerates early in setup(), but
   * nothing answers until loop1() runs - past the splash delay, the conflict panel and the ESC arm
   * loop - and a command sent into that gap is swallowed rather than queued.
   *
   * It only shows up on a board powered by USB alone, because plugging in *is* the power-on there.
   * A board already running on its battery has long since passed that gap, which is why the first
   * connect looked fine for so long and then reported "No reply to DUMP_SCHEMA within 15000 ms" on
   * the bench. Ten cheap DUMP_BOOT retries cost nothing against a device that is already up.
   */
  const connect = async (choose: boolean) => {
    // The flow the reboot paused reads the device itself once it is back.
    if (transport.awaitingReconnect) {
      await transport.connect(choose);
      return;
    }
    if (!(await transport.connect(choose))) return;
    if (!(await transport.waitReady())) return;
    if ((await readSchemaAndValues()) && bootProblem.current) setView("overview");
  };

  /**
   * Loads a wiring preset. An ordinary partial LOAD_DEVICE: the firmware has no board table, so a
   * preset is simply a config that says nothing about anything except the pins. The firmware leaves
   * every key a payload does not mention exactly as it was, so tuning and profiles are untouched by
   * construction rather than by anything arranged here.
   *
   * The device version is stamped from the live schema, but the preset's own is checked first:
   * loading a preset written for a different schema through a patch stamped with this one would
   * apply keys that may since have changed meaning. Refusing is the honest failure.
   */
  const applyPreset = async (preset: Preset) => {
    if (preset.schemaVersion !== schema.deviceSchemaVersion) {
      note(
        "err",
        `The ${preset.name} preset was written for device schema v${preset.schemaVersion}, ` +
          `and this firmware speaks v${schema.deviceSchemaVersion}. Not loading it - use a console ` +
          "built with this firmware's release.",
      );
      return;
    }
    setBusy(true);
    try {
      if (await applyDeviceValues(presetEntries(preset))) {
        setWiringByHand(false);
        setPresetsOpen(false);
        note("ok", `Loaded the ${preset.name} wiring.`);
      }
    } finally {
      setBusy(false);
    }
  };

  /**
   * Sets a device with no wiring up as a board with a blaster's config: its device settings, then
   * every profile slot, each sent whole as a Full Backup's would be.
   *
   * Refused outright for a config or a board written for another schema. A load the device refuses
   * stops the rest, and the re-read then shows what the device holds.
   */
  const applyBlaster = async (board: Preset, blaster: Blaster) => {
    const configMismatch = schemaMismatch(blaster.bundle, schema);
    const mismatch = configMismatch
      ? `The ${blaster.name} config ${configMismatch}.`
      : board.schemaVersion !== schema.deviceSchemaVersion
        ? `The ${board.name} preset was written for device schema v${board.schemaVersion}, and ` +
          `this firmware speaks v${schema.deviceSchemaVersion}.`
        : null;
    if (mismatch) {
      note("err", `${mismatch} Not loading it - use a console built with this firmware's release.`);
      return;
    }
    const label = `${blaster.name} on ${board.name}`;
    setSettingUp(blaster);
    setBusy(true);
    try {
      for (const { command, payload } of blasterLoads(blaster.bundle, board, schema)) {
        const step =
          command === "LOAD_DEVICE"
            ? "the device settings"
            : `profile slot ${Number(command.split(" ")[1]) + 1}`;
        const ack = await transport.load(command, payload);
        if (!ack?.ok) {
          note("err", `Setting up as ${label} stopped at ${step}; the log says why.`);
          await readSchemaAndValues();
          return;
        }
        if (
          ack.rebooting &&
          !((await transport.reopenAfterReboot()) && (await transport.waitReady()))
        ) {
          note(
            "err",
            `The device restarted after ${step} and did not come back. Reconnect when it has ` +
              "restarted, then check its settings.",
          );
          return;
        }
      }
      if (await readSchemaAndValues()) note("ok", `Set up as ${label}.`);
    } finally {
      setBusy(false);
      setSettingUp(null);
    }
  };

  /**
   * The custom path: every pin unused, the provenance cleared, and the boot gate off.
   *
   * No "generic board" preset: a template for a bare Pico would be backed by no schematic, so an
   * LED warning output could be seeded onto a pin carrying a solenoid. The wiring table is answered
   * a pin at a time instead.
   */
  const startCustomWiring = async () => {
    const pinKeys = new Set<string>();
    walk(schema.tree, (node) => {
      if (node.display === "pin" && node.key?.startsWith("device:")) pinKeys.add(node.key);
    });
    const entries = [...pinKeys].map((key) => ({ key, value: 255 }));
    entries.push({ key: BOARD_ID_KEY, value: "" as unknown as number });
    entries.push({ key: WIRING_CONFIGURED_KEY, value: false as unknown as number });

    setBusy(true);
    try {
      if (await applyDeviceValues(entries)) {
        // Before the re-read: the device now reports no wiring, which is what the picker gates on.
        setWiringByHand(true);
        setPresetsOpen(false);
        setView("wiring");
        note(
          "ok",
          "Wiring cleared. Set each pin in the Wiring table, then tick Wiring Configured and " +
            "write - the blaster drives nothing until you do.",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  /**
   * Commands that end in a reboot, and what the console owes the user afterwards.
   *
   * Everything here reboots, so every one of them has to come back through
   * reopenAfterReboot()/waitReady() before reading again - the same sequence writeStores() uses and
   * for the same reason. Bootloader is the exception and deliberately does not: the device comes
   * back as a USB mass-storage drive with no serial port at all, so there is nothing to reconnect
   * to and pretending otherwise would just time out.
   */
  const afterReboot = async (label: string, capture = false) => {
    if ((await transport.reopenAfterReboot()) && (await transport.waitReady())) {
      setLive(true);
      if (await readSchemaAndValues()) note("ok", `${label} - device is back.`);
      if (capture) loadCapture();
      return;
    }
    note("err", `${label}, but the device did not come back. Reconnect when it has restarted.`);
  };
  onRebooting.current = (reason) =>
    void afterReboot(
      reason === "rpmLog" ? "RPM capture finished" : "The device restarted",
      reason === "rpmLog",
    );

  /** The newest capture in the device log, into the RPM capture page. */
  const loadCapture = () => {
    const csv = extractRpmCsv(
      logRef.current
        .filter((l) => l.kind === "in")
        .map((l) => l.text)
        .join("\n"),
    );
    if (!csv) return;
    setRpmText(csv);
    note("ok", "The capture is on the RPM capture page.");
  };

  // Connected to firmware that has the motor and rev commands.
  const consoleControls = live && compareVersions(schema.fw ?? "0", FW_CONSOLE_CONTROLS) >= 0;
  const runCommand = (command: string) => transport.request<NonNullable<Ack>>(command);
  const motorActions = useMotorActions(runCommand, (ok, text) => note(ok ? "ok" : "err", text));
  // Older firmware answers DUMP_SPLASH with raw bytes rather than a line, so it is not asked.
  const readSplash = React.useCallback(async (): Promise<DeviceSplash | null> => {
    if (!consoleControls) return null;
    const reply = await transport.request<{ custom: boolean; b64: string }>("DUMP_SPLASH");
    if (!reply?.b64) return null;
    return { custom: reply.custom, bytes: Uint8Array.from(atob(reply.b64), (c) => c.charCodeAt(0)) };
  }, [consoleControls, transport]);
  const revHoldApi: RevHoldApi = React.useMemo(
    () => ({
      hold: (mask) => void transport.sendQuiet(`REV_HOLD ${mask}`),
      release: () => void transport.sendQuiet("REV_RELEASE"),
      status: () =>
        transport.request<MotorsStatus>("DUMP_MOTORS", undefined, { quiet: true }),
    }),
    [transport],
  );

  /**
   * Only a plain reboot comes back to us. The other two hand the device to something else, and the
   * console's job in both cases is to get out of the way.
   *
   * Bootloader is obvious - the port disappears as the device re-enumerates as a drive. ESC
   * passthrough is the one that looks like a reboot and is not: the blaster comes back on the same
   * COM port, but it comes back to be driven by an ESC configurator (am32.ca and friends), and Web
   * Serial hands a port to exactly one page. A console still holding it is why that configurator
   * cannot connect. Worse, passthrough runs its own closed loop and never answers DUMP_BOOT, so
   * waitReady() would spend fifteen seconds failing and still be holding the port at the end of it.
   *
   * Closing the port is also how the session ends - the firmware watches for the host going away -
   * so the console leaving is both what lets the configurator in and what gets the blaster back.
   */
  const reboot = async (mode: "normal" | "bootloader" | "passthrough") => {
    setBusy(true);
    try {
      if (mode === "bootloader") {
        // Fire and forget: REBOOT_BOOTLOADER's ack races the re-enumeration, and dropping the port
        // deliberately beats letting readLoop() discover it as a failure.
        await transport.sendLine("REBOOT_BOOTLOADER");
        note("ok", "Bootloader requested. The blaster should appear as a USB drive.");
        // The port is kept for reopenAfterReboot(): flashing over PICOBOOT comes back this way,
        // and a plain Reboot > Bootloader simply never asks for it.
        await transport.disconnect("Disconnected - the blaster is in its bootloader.", true);
        return;
      }
      if (mode === "passthrough") {
        // The ack is worth waiting for - it arrives before the reboot and says the command was
        // accepted - but nothing after it is ours to wait for.
        const ack = await transport.command("ESC_PASSTHROUGH");
        if (!ack?.ok) return; // the log carries the refusal
        note(
          "ok",
          "ESC passthrough requested. Releasing the port for an ESC configurator - closing it " +
            "there ends passthrough, then Connect again.",
        );
        await transport.disconnect();
        return;
      }
      const ack = await transport.command("REBOOT");
      if (!ack?.ok) return;
      await afterReboot("Rebooted");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Runs the reset the dialog confirmed.
   *
   * The device decides what each one means, not this function - FACTORY_RESET_DEVICE preserves the
   * fields with no OLED row by the firmware's own mechanical rule, and RESET_PINS clears the wiring.
   * Composing either payload here would be a second copy of that rule, free to drift from it.
   */
  const runReset = async (plan: ResetPlan) => {
    const COMMANDS: Record<ResetKind, string> = {
      profile: `FACTORY_RESET_PROFILE ${plan.slot ?? slot}`,
      device: "FACTORY_RESET_DEVICE",
      wiring: "RESET_PINS",
      everything: "FACTORY_RESET_ALL",
    };
    const LABELS: Record<ResetKind, string> = {
      profile: `${plan.profileName ?? "Profile"} reset`,
      device: "Device settings reset",
      wiring: "Wiring cleared",
      everything: "Everything reset",
    };
    const command = COMMANDS[plan.kind];
    const label = LABELS[plan.kind];

    setBusy(true);
    try {
      const ack = await transport.command(command);
      if (!ack?.ok) return;
      // The reset is on disk and the form still holds what was there before it, so every pending
      // edit now describes a device that no longer exists. readSchemaAndValues() replaces the lot.
      setDirty(new Set());
      await afterReboot(label);
    } finally {
      setBusy(false);
      setPendingReset(null);
    }
  };

  const askReset = (kind: ResetKind) =>
    setPendingReset(kind === "profile" ? { kind, slot, profileName: profileName(slot) } : { kind });

  /**
   * Writes device fields straight to the device, outside the dirty set.
   *
   * For a setting the console arms and then clears on the user's behalf, which must not sit in a
   * batch the user might never send or might send half of. The device reboots on any LOAD_DEVICE,
   * so this carries the same reconnect as writeStores().
   */
  const applyDeviceValues = async (entries: { key: string; value: unknown }[]) => {
    setBusy(true);
    try {
      const ack = await transport.load(
        "LOAD_DEVICE",
        buildPatch(schema.deviceSchemaVersion, entries),
      );
      if (!ack?.ok) return false; // the log already says why; the device is untouched on a refusal
      if (ack.rebooting) {
        if (!(await transport.reopenAfterReboot())) return false;
        if (!(await transport.waitReady())) return false;
        setLive(true);
        // The schema, not just the values. Applying a wiring preset flips `wiringConfigured` in
        // the schema header, and reading values alone left that stale - so the device came back
        // armed while the console went on showing the preset picker, and only a manual reconnect
        // cleared it. `pinConflicts` and `boardId` are stale by the same mechanism.
        return await readSchemaAndValues();
      }
      await readAll();
      return true;
    } finally {
      setBusy(false);
    }
  };

  /** Marks `mark` as edited, or clears it when the value is back where the device has it. */
  const mark = (prev: Set<string>, m: string, value: unknown): Set<string> => {
    const [markSlot, key] = splitMark(m);
    const base = markSlot === null ? baseline.device : baseline.profiles[markSlot];
    const next = new Set(prev);
    if (same(getByKey(base as never, key), value)) next.delete(m);
    else next.add(m);
    return next;
  };

  const onEdit = (key: string, value: unknown) => {
    if (key.startsWith("device:")) {
      setDevice((prev: unknown) => setByKey((prev ?? {}) as object, key, value));
      setDirty((prev) => mark(prev, key, value));
    } else {
      setProfiles((prev) =>
        prev.map((p, i) => (i === slot ? setByKey((p ?? {}) as object, key, value) : p)),
      );
      setDirty((prev) => mark(prev, `${slot}:${key}`, value));
    }
  };

  /**
   * Replaces the fire-mode array and activeModeCount together.
   *
   * They have to move as one: ProfileStore::toJson writes only activeModeCount entries and fromJson
   * reads min(activeModeCount, array length), so a list that grew without the count following it
   * would be silently truncated on the device.
   */
  const replaceModes = (modes: unknown[]) => {
    setProfiles((prev) =>
      prev.map((p, i) =>
        i === slot
          ? { ...((p ?? {}) as object), fireModes: modes, activeModeCount: modes.length }
          : p,
      ),
    );
    setDirty((prev) =>
      mark(
        mark(prev, `${slot}:profile:fireModes`, modes),
        `${slot}:profile:activeModeCount`,
        modes.length,
      ),
    );
  };

  /** Puts one staged edit back to what the device holds. */
  const revert = (m: string) => {
    const marks = marksToRevert(m, dirty);
    let nextDevice = device;
    const nextProfiles = [...profiles];
    for (const each of marks) {
      const [markSlot, key] = splitMark(each);
      if (markSlot === null) {
        nextDevice = setByKey(nextDevice as object, key, getByKey(baseline.device as never, key));
      } else {
        nextProfiles[markSlot] = setByKey(
          nextProfiles[markSlot] as object,
          key,
          getByKey(baseline.profiles[markSlot] as never, key),
        );
      }
    }
    setDevice(nextDevice);
    setProfiles(nextProfiles);
    setDirty((prev) => new Set([...prev].filter((d) => !marks.includes(d))));
  };

  /** Every staged edit put back, without a read: the baseline is what the device holds. */
  const discardAll = () => {
    setDevice(baseline.device);
    setProfiles(baseline.profiles);
    setDirty(new Set());
    setReviewOpen(false);
  };

  /** A store's staged edits as the load that writes them, or null when it has none. */
  const loadFor = (which: Store, target: number): Load | null => {
    const keys = dirtyFor(which, target);
    if (!keys.length) return null;

    const source = which === "device" ? device : profiles[target];
    const version = which === "device" ? schema.deviceSchemaVersion : schema.profileSchemaVersion;
    const command = which === "device" ? "LOAD_DEVICE" : `LOAD_PROFILE ${target}`;

    // fireModes moves as a whole array, so send the array and its count rather than trying to patch
    // individual elements of a list whose length changed.
    const wholeArray = keys.some((k) => k === "profile:fireModes");
    const entries = wholeArray
      ? [
          { key: "profile:fireModes", value: getByKey(source, "profile:fireModes") },
          { key: "profile:activeModeCount", value: getByKey(source, "profile:activeModeCount") },
          ...keys
            .filter((k) => k !== "profile:fireModes" && k !== "profile:activeModeCount")
            .filter((k) => !k.startsWith("profile:fireModes["))
            .map((key) => ({ key, value: getByKey(source, key) })),
        ]
      : keys.map((key) => ({ key, value: getByKey(source, key) }));

    return {
      command,
      payload: buildPatch(version, entries),
      marks: keys.map((key) => (which === "device" ? key : `${target}:${key}`)),
    };
  };

  /**
   * Writes these stores in order, then reads the device back once. Edits staged anywhere else are
   * laid back over what is read, so writing one part of a loaded backup keeps the rest. A load the
   * device refuses stops the ones after it, which stay staged.
   */
  const writeStores = async (targets: [Store, number][]) => {
    const loads = targets
      .map(([which, target]) => loadFor(which, target))
      .filter((load): load is Load => load !== null);
    if (!loads.length) return;

    const steps = [
      ...loads.map(
        (l) => `${l.command}: ${l.marks.length} value${l.marks.length === 1 ? "" : "s"}`,
      ),
      "Reading back schema and values",
    ];
    const show = (at: number, status: string) => setProgress({ steps, at, status });

    setBusy(true);
    let ok = false;
    try {
      const written = new Set<string>();
      let rebooted = false;
      for (const [i, load] of loads.entries()) {
        show(i, "Sending…");
        const ack = await transport.load(load.command, load.payload);
        if (!ack || !ack.ok) break; // the log already says why; the device is untouched on a refusal

        for (const m of load.marks) written.add(m);
        setDirty((prev) => new Set([...prev].filter((d) => !written.has(d))));

        if (ack.rebooting) {
          show(i, "The blaster is restarting. Waiting for it to answer…");
          // The device dropped the port to apply the change. Reconnect and re-read the schema as
          // well as the values: clamping may have altered what got stored, and the reboot may have
          // changed what the header says about the device - a pin that now collides shows up in
          // `pinConflicts`, and a write that armed or disarmed it moves `wiringConfigured`. Reading
          // values alone left both stale.
          //
          // waitReady() is not optional and its absence is what made a write look like a failed
          // reconnect: USB CDC enumerates seconds before loop1() starts servicing commands, so the
          // port reopens and then the first read lands in that gap and is swallowed. The console
          // came back connected to a device that answered nothing.
          if (!((await transport.reopenAfterReboot()) && (await transport.waitReady()))) return;
          setLive(true);
          rebooted = true;
        }
      }
      if (!written.size) return;

      show(loads.length, "Reading back…");
      const keep = stagedExcept(written);
      if (rebooted) await readSchemaAndValues(keep);
      else await readAll(keep);
      ok = true;
    } finally {
      setBusy(false);
      setProgress(null);
      if (ok) setReviewOpen(false);
    }
  };

  const writeEverything = () =>
    writeStores([["device", 0], ...profiles.map((_, i): [Store, number] => ["profile", i])]);

  /**
   * Copies one profile slot onto another, entirely host-side.
   *
   * There is no COPY_PROFILE command and none is needed: the payload DUMP_PROFILE returned is
   * already the shape LOAD_PROFILE reads, so the copy is that payload sent at a different index.
   * Sending it whole rather than rebuilding it from schema keys also carries any field this build
   * of the console does not know about, which a key-by-key copy would quietly drop.
   *
   * `name` is held back so the destination keeps its own, matching ProfileStore::copyProfile - three
   * slots called Medium is worse than a name that has to be retyped. The version is stamped from
   * the live schema rather than trusted from the dump, so a stale capture is refused rather than
   * half-applied.
   */
  const copyProfile = async (from: number, to: number) => {
    const source = profiles[from];
    if (!source || from === to) return;
    const { name: _keepDestinationName, ...rest } = source as Record<string, unknown>;
    const payload = { ...rest, schemaVersion: schema.profileSchemaVersion };

    setBusy(true);
    try {
      const ack = await transport.load(`LOAD_PROFILE ${to}`, payload);
      if (!ack || !ack.ok) return; // the log says why, and the device is untouched on a refusal
      note("ok", `Copied ${profileName(from)} onto ${profileName(to)}.`);
      setCopyTo(null);

      if (ack.rebooting) {
        if ((await transport.reopenAfterReboot()) && (await transport.waitReady())) {
          setLive(true);
          await readSchemaAndValues();
        }
      } else {
        await readAll();
      }
    } finally {
      setBusy(false);
    }
  };

  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");

  const saveDeviceFile = () => {
    const name = `device-${stamp()}.json`;
    downloadJson(name, device);
    note("ok", `Saved ${name}`);
  };

  const saveProfileFile = () => {
    const name = `profile${slot}-${stamp()}.json`;
    downloadJson(name, profiles[slot] ?? {});
    note("ok", `Saved ${name} (${profileName(slot)})`);
  };

  const saveBundleFile = () => {
    const now = new Date();
    const name = bundleFilename(device, now);
    downloadJson(name, buildBundle(schema, device, profiles, now.toISOString()));
    note("ok", `Saved ${name} (device + ${profiles.length} profiles)`);
  };

  const saveLogFile = () => {
    const name = `trifolium-log-${stamp()}.txt`;
    const blob = new Blob([logToText(log)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const fileInput = React.useRef<HTMLInputElement>(null);

  /** What the user said they were loading, so a mismatched file is refused rather than guessed at. */
  const [loadIntent, setLoadIntent] = React.useState<LoadIntent>("bundle");
  /** A file dropped on the page, held until the dialog says which store it is for. */
  const [droppedFile, setDroppedFile] = React.useState<File | null>(null);
  /** The user declined the picker and is wiring this device by hand. Cleared on disconnect. */
  const [wiringByHand, setWiringByHand] = React.useState(false);

  /**
   * Loads a file the user has already told us the kind of.
   *
   * The kind is asked for up front rather than sniffed. Sniffing worked, but it meant the same
   * button could do three different things depending on a file's contents, and the one it chose was
   * only visible afterwards in the log. Declaring it first turns a wrong file into a refusal.
   */
  const loadFromFile = async (file: File, intent: LoadIntent) => {
    const text = await file.text();
    const check = checkBundle(text, schema);

    if (intent !== "bundle" && check.bundle) {
      note(
        "err",
        `${file.name} is a full backup, not a ${intent === "device" ? "device config" : "profile"}. Use Restore > Full Backup.`,
      );
      return;
    }

    if (intent === "bundle" && !check.bundle) {
      note("err", `${file.name} is not a full backup: ${check.error ?? "unrecognised file"}`);
      return;
    }

    if (check.bundle) {
      for (const w of check.warnings) note("err", `${file.name}: ${w}`);
      const changed = diffKeys(schema, baseline, {
        device: check.bundle.device,
        profiles: check.bundle.profiles,
      });
      setDevice(check.bundle.device);
      setProfiles(check.bundle.profiles);
      setDirty(changed);
      note("ok", `Loaded ${file.name} — ${changed.size} value(s) differ from the device.`);
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch (e) {
      note("err", `${file.name}: ${(e as Error).message}`);
      return;
    }

    const looksLikeProfile = "fireModes" in parsed || "revRPM" in parsed;
    const looksLikeDevice = "motorConfig" in parsed || "blasterName" in parsed;

    // Declared kind and actual contents have to agree. Loading a device dump into a profile slot
    // silently produced a slot full of nothing, which only showed up as a diff count of zero.
    if (intent === "profile" && !looksLikeProfile) {
      note("err", `${file.name} does not look like a profile - no fireModes or revRPM in it.`);
      return;
    }
    if (intent === "device" && !looksLikeDevice) {
      note(
        "err",
        `${file.name} does not look like a device config - no motorConfig or blasterName.`,
      );
      return;
    }

    if (looksLikeProfile) {
      const nextProfiles = profiles.map((p, i) => (i === slot ? parsed : p));
      const changed = diffKeys(schema, { device, profiles }, { device, profiles: nextProfiles });
      setProfiles(nextProfiles);
      setDirty((prev) => new Set([...prev, ...changed]));
      note("ok", `Loaded ${file.name} into ${profileName(slot)} — ${changed.size} change(s).`);
    } else if (looksLikeDevice) {
      const changed = diffKeys(schema, { device, profiles }, { device: parsed, profiles });
      setDevice(parsed);
      setDirty((prev) => new Set([...prev, ...changed]));
      note("ok", `Loaded ${file.name} into device settings — ${changed.size} change(s).`);
    } else {
      note("err", `${file.name}: ${check.error ?? "unrecognised file"}`);
    }
  };

  const openLoad = (intent: LoadIntent) => {
    setLoadIntent(intent);
    fileInput.current?.click();
  };

  // `wiringByHand` is the console's own answer to "does this device still need a board chosen".
  // The device says no wiring either way; this says the user has already declined the picker.
  const showPicker = needsPresetPicker(schema, live) && !wiringByHand;
  const setupMode = showPicker || settingUp !== null;

  /**
   * What the header calls this device's wiring, and whether it still matches the preset it names.
   *
   * The device cannot answer the second half - `boardId` is provenance it never interprets, and
   * there is no table left to compare against - so the modified flag is computed here, on the side
   * that holds the presets.
   */
  const wiringName = React.useMemo(() => {
    const label = wiringLabel(schema.boardId);
    const drift = presetDrift(device, schema.boardId);
    return drift && drift.changed.length ? `${label} (modified)` : label;
  }, [schema.boardId, device]);

  /**
   * The preset a device with no wiring was probably running, from the id its config still carries.
   *
   * The firmware cannot do this: `boardId` is provenance it never interprets. Following the alias
   * table here is the concrete payoff of the console holding the presets - an upgraded device is
   * offered the right wiring rather than an empty dropdown. The boot fault carries the same id, for
   * a device whose config was replaced.
   */
  const suggestedPreset = React.useMemo(() => {
    const fromSchema = presetForBoardId(schema.boardId);
    if (fromSchema) return fromSchema;
    const fault = boot?.configFaults?.find((f) => f.fault === "wiringUnavailable");
    return presetForBoardId(fault?.detail);
  }, [schema.boardId, boot]);

  // A board with no authored SVG is not an error - the page just stays table-only, the same way a
  // board with no preset falls back to custom wiring.
  const wiringDiagram = React.useMemo(() => diagramForBoardId(schema.boardId), [schema.boardId]);

  const blasterNameNode = nodeFor(schema, BLASTER_NAME_KEY);
  const profileNameNode = nodeFor(schema, PROFILE_NAME_KEY);

  /**
   * Whether the selector-switch editor applies at all.
   *
   * Three switch positions only pick a fire mode when the blaster reads a switch; on screen or
   * button select-fire they are wired to nothing. The firmware says so itself - its own "Set
   * Selector Switch Modes" row carries `selectFireType eq "switch"` - so this reads the same
   * stored value rather than inventing a second rule.
   */
  const usesSelectorSwitch = getByKey(device, SELECT_FIRE_KEY) === "switch";
  const usesEncoder = getByKey(device, SELECT_FIRE_KEY) === "encoder";

  /**
   * Edits to rows the form is no longer showing.
   *
   * Re-evaluating visibility live means a row can disappear *after* it was edited - untick Display
   * Attached having already changed Brightness, and the brightness edit is still queued, still
   * counted, and no longer anywhere on screen to see or undo. The edit is not lost and writing it
   * is correct, since the value stays stored either way; what would be wrong is not saying so. The
   * review sheet says so, row by row.
   */
  const hiddenKeys = React.useMemo(() => {
    const out = new Set<string>();
    walk(resolved.tree, (node) => {
      if (node.key && node.visible === false) out.add(node.key);
    });
    return out;
  }, [resolved]);

  /**
   * Dirty keys as a field sees them: device keys plus this slot's profile keys, with the "slot:"
   * prefix stripped. Switching slots changes what is marked, which is the point - an edit to slot 2
   * is not an edit to the slot you are looking at.
   */
  const dirtyKeys = React.useMemo(() => {
    const out = new Set<string>();
    for (const entry of dirty) {
      if (entry.startsWith("device:")) out.add(entry);
      else if (entry.startsWith(`${slot}:`)) out.add(entry.slice(String(slot).length + 1));
    }
    return out;
  }, [dirty, slot]);

  /** The section each key is laid out under, so a change in the review says where it lives. */
  const sectionOfKey = React.useMemo(() => {
    const out = new Map<string, string>();
    for (const section of [...deviceSections, ...profileSections]) {
      walk([section], (node) => {
        if (node.key && !out.has(node.key)) out.set(node.key, section.label);
      });
    }
    return out;
  }, [deviceSections, profileSections]);

  const changes: Change[] = React.useMemo(
    () =>
      listChanges({
        schema: resolved,
        dirty,
        baseline,
        current: { device, profiles },
        hiddenKeys,
        wiringKeys: WIRING_KEYS,
        sectionOf: (key) => sectionOfKey.get(key),
      }),
    [resolved, dirty, baseline, device, profiles, hiddenKeys, sectionOfKey],
  );

  const counts = React.useMemo(() => {
    const out: Partial<Record<ViewId, number>> = {};
    for (const c of changes) out[c.view as ViewId] = (out[c.view as ViewId] ?? 0) + 1;
    return out;
  }, [changes]);

  const dirtySlots = React.useMemo(
    () => new Set(changes.filter((c) => c.slot !== null).map((c) => c.slot as number)),
    [changes],
  );

  React.useEffect(() => remember(VIEW_KEY, view), [view]);
  React.useEffect(() => remember(LOG_KEY, logOpen ? "open" : "folded"), [logOpen]);
  React.useEffect(() => remember(LOG_HEIGHT_KEY, String(logHeight)), [logHeight]);
  // A smaller window takes a tall log down with it, so the page always keeps most of the screen.
  React.useEffect(() => {
    const fit = () => setLogHeight((h) => clampLogHeight(h, window.innerHeight));
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const go = (next: ViewId, toSlot?: number) => {
    if (toSlot !== undefined) setSlot(toSlot);
    setView(next);
    document.getElementById("main")?.scrollTo?.({ top: 0 });
  };

  // Ctrl+S reviews what is staged, from anywhere: the keystroke a person reaches for to save.
  // Ctrl+K searches.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        setReviewOpen(true);
      } else if (k === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const isFolded = (key: string) => folded.has(key);
  const toggleFold = (key: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const foldAll = (keys: string[]) =>
    setFolded((prev) => {
      const all = keys.every((k) => prev.has(k));
      const next = new Set(prev);
      for (const k of keys) {
        if (all) next.delete(k);
        else next.add(k);
      }
      return next;
    });

  /** Rows show an edit against the device and put it back through this. */
  const staging: Staging = {
    was: (key) =>
      changes.find(
        (c) => c.key === key && (key.startsWith("device:") ? c.slot === null : c.slot === slot),
      )?.from,
    revert: (key) => revert(key.startsWith("device:") ? key : `${slot}:${key}`),
    describe,
  };

  /** Unsaved edits in one section of a page: the device's for Blaster, the shown slot's for Profiles. */
  const unsavedIn = (label: string, store: "device" | "profile") =>
    changes.filter(
      (c) => c.where === label && (store === "device" ? c.slot === null : c.slot === slot),
    ).length;

  const badge = (n: number) => (n ? <Chip tone="warn">{n} unsaved</Chip> : undefined);

  /** The page-head controls a long page of sections shares: fold them all, and show every help line. */
  const pageTools = (keys: string[]) => (
    <>
      <Button
        size="small"
        color="inherit"
        sx={{ color: "text.secondary" }}
        onClick={() => foldAll(keys)}
      >
        {keys.every((k) => folded.has(k)) ? "Expand all" : "Collapse all"}
      </Button>
      <Box
        component="label"
        sx={{
          display: "flex",
          alignItems: "center",
          fontSize: 12.5,
          color: "text.secondary",
          cursor: "pointer",
        }}
      >
        Descriptions
        <Switch size="small" checked={describe} onChange={(e) => setDescribe(e.target.checked)} />
      </Box>
    </>
  );

  const verbose = getByKey(device, "device:printTelemetry") === true;
  const toggleVerbose = () =>
    void applyDeviceValues([{ key: "device:printTelemetry", value: !verbose }]);

  /** Opens a setting's page and section, scrolls it into view, and marks where it is. */
  const showSetting = (target: ViewId, section: string | undefined, key: string) => {
    go(target);
    if (section) {
      setFolded((prev) => {
        const next = new Set(prev);
        next.delete(`${target}:${section}`);
        return next;
      });
    }
    window.setTimeout(() => {
      const row = document.querySelector<HTMLElement>(`[data-key="${key}"]`);
      const el = row ?? (section ? document.getElementById(sectionId(target, section)) : null);
      if (!el) return;
      el.scrollIntoView({ block: "center" });
      el.animate?.(
        [{ boxShadow: "inset 0 0 0 2px #7cc4ff" }, { boxShadow: "inset 0 0 0 2px transparent" }],
        { duration: 1600 },
      );
      el.querySelector<HTMLElement>("input:not([type=hidden]), [role=combobox], button")?.focus({
        preventScroll: true,
      });
    }, 80);
  };

  /** Which page a setting is edited on. */
  const pageOf = (key: string): ViewId => {
    if (WIRING_KEYS.has(key)) return "wiring";
    if (key === "device:useRpmLogging" || key === "device:rpmLogLength") return "rpm";
    if (key === "device:defaultProfileIndex" || key.startsWith("device:switchPositionProfile"))
      return "profiles";
    return key.startsWith("device:") ? "blaster" : "profiles";
  };

  const PAGE_TITLE: Partial<Record<ViewId, string>> = {
    blaster: "Blaster settings",
    profiles: "Profiles",
    wiring: "Wiring",
    rpm: "RPM capture",
  };

  const paletteItems: PaletteItem[] = (() => {
    const items: PaletteItem[] = [
      {
        group: "Commands",
        label: "Review and write changes",
        where: "Ctrl S",
        run: () => setReviewOpen(true),
      },
      { group: "Commands", label: "Back up everything", where: "Overview", run: saveBundleFile },
      {
        group: "Commands",
        label: "Restore a full backup",
        where: "Overview",
        run: () => openLoad("bundle"),
      },
      { group: "Commands", label: "Open the log", where: "Log", run: () => setLogOpen(true) },
      {
        group: "Commands",
        label: "Flash firmware",
        where: "Firmware",
        run: () => {
          go("firmware");
          setFlashOpen(true);
        },
      },
      { group: "Commands", label: "Capture RPM", where: "RPM capture", run: () => go("rpm") },
      {
        group: "Commands",
        label: "Reset to defaults",
        sub: "A profile, the blaster settings, the wiring or everything",
        where: "Maintenance",
        run: () => go("maint"),
      },
    ];
    if (live) {
      items.push(
        {
          group: "Commands",
          label: "Read from Device",
          sub: "Discards unsaved edits",
          where: "Top bar",
          run: () => void readSchemaAndValues(),
        },
        {
          group: "Commands",
          label: "Restart the blaster",
          where: "Top bar",
          run: () => void reboot("normal"),
        },
        {
          group: "Commands",
          label: "Restart into bootloader",
          where: "Top bar",
          run: () => void reboot("bootloader"),
        },
        {
          group: "Commands",
          label: "Start ESC passthrough",
          where: "Top bar",
          run: () => void reboot("passthrough"),
        },
        {
          group: "Commands",
          label: verbose ? "Turn verbose logging off" : "Turn verbose logging on",
          sub: "Switch presses, state changes and shots in the log",
          where: "Top bar",
          run: toggleVerbose,
        },
        {
          group: "Commands",
          label: "Change board preset",
          where: "Wiring",
          run: () => {
            go("wiring");
            setPresetsOpen(true);
          },
        },
      );
    }
    const seen = new Set<string>();
    walk(resolved.tree, (node) => {
      if (!node.key || node.kind === "group" || node.storage || node.visible === false) return;
      if (node.key === BLASTER_NAME_KEY || node.key === PROFILE_NAME_KEY) return;
      // One entry per fire-mode field, not one per mode: the editor holds them all in one table.
      const modeLeaf = /^profile:fireModes\[\d+\]\.(\w+)$/.exec(node.key)?.[1];
      const id = modeLeaf ? `mode:${modeLeaf}` : node.key;
      if (seen.has(id)) return;
      seen.add(id);
      const page = modeLeaf ? "profiles" : pageOf(node.key);
      const section = modeLeaf ? "Fire Modes" : sectionOfKey.get(node.key);
      const key = node.key;
      items.push({
        group: "Settings",
        label: splitUnit(node.label).name,
        sub: helpFor(key),
        where: [PAGE_TITLE[page], section].filter(Boolean).join(" · "),
        run: () => showSetting(page, section, key),
      });
    });
    return items;
  })();

  const modeSummary = (profile: unknown) => {
    const count = Number(getByKey(profile, "profile:activeModeCount") ?? 0);
    const modes = (
      (getByKey(profile, "profile:fireModes") as
        { name?: string; burstMode?: string }[] | undefined) ?? []
    ).slice(0, count || undefined);
    return modes.map((m) => m.name?.trim() || String(m.burstMode ?? "").toUpperCase()).join(" · ");
  };

  const garbling = garblingFirmware(verbose, live ? schema.fw : null);
  const conflicts = schema.pinConflicts ?? [];
  const faults = boot?.configFaults ?? [];

  const band = (
    <>
      {!live && (
        <Band>
          <b>Sample config.</b> Nothing is connected, so this is the console&rsquo;s own sample:
          browse it, edit it and{" "}
          <Box
            component="button"
            type="button"
            onClick={saveBundleFile}
            sx={{
              background: "none",
              border: 0,
              p: 0,
              color: "inherit",
              textDecoration: "underline",
              cursor: "pointer",
              font: "inherit",
            }}
          >
            save a full backup
          </Box>{" "}
          of it. Writing needs a blaster.
        </Band>
      )}
      {live && !setupMode && view !== "overview" && (faults.length > 0 || conflicts.length > 0) && (
        <Band
          tone="error"
          action={
            <Button size="small" color="inherit" onClick={() => go("overview")}>
              Show
            </Button>
          }
        >
          <b>This boot dropped part of the config.</b>{" "}
          {[
            faults.length && "stored settings were discarded",
            conflicts.length && "a pin conflict was resolved",
          ]
            .filter(Boolean)
            .join(", and ")}
          .
        </Band>
      )}
      {garbling && (
        <Band tone="warning">
          With verbose logging on, firmware {garbling} can garble its replies, so a read or write
          may fail or show stale values. Update to {FW_LOGS_WAIT_FOR_REPLIES} or later to fix it for
          good, or switch Verbose off on the log bar first.
        </Band>
      )}
    </>
  );

  const profileNames = profiles.map((_, i) => profileName(i));

  const page = (() => {
    if (setupMode && (view === "overview" || view === "wiring")) {
      return (
        <Page>
          <PageHead
            title="Set up this blaster"
            lede="This device has no wiring yet. Pick its board, and a known blaster's config if it is one."
          />
          <Stack spacing={1.25} sx={{ mb: 1.5 }}>
            {/* Both render above the picker as well as on Overview. A device whose stored config
                predates stored wiring is exactly the case where the picker alone misleads: it looks
                like a device nobody has configured, when in fact its wiring is the one thing this
                build could not carry across. */}
            <BootFaults boot={boot} />
            <PinConflicts schema={schema} />
          </Stack>
          <Panel>
            <Box sx={{ p: 2 }}>
              <SetupWizard
                busy={busy}
                schema={schema}
                storedBoardId={schema.boardId || undefined}
                suggested={suggestedPreset}
                onApply={(preset) => void applyPreset(preset)}
                onApplyBlaster={(board, blaster) => void applyBlaster(board, blaster)}
                onCustom={() => void startCustomWiring()}
              />
            </Box>
          </Panel>
        </Page>
      );
    }

    switch (view) {
      case "overview":
        return (
          <Overview
            live={live}
            schema={schema}
            boot={boot}
            device={device}
            profiles={profiles}
            profileName={profileName}
            wiringLabel={wiringName}
            slot={slot}
            onGo={go}
            onSaveBundle={saveBundleFile}
            onSaveDevice={saveDeviceFile}
            onSaveProfile={saveProfileFile}
            onLoad={openLoad}
            onDropFile={setDroppedFile}
            onDropReject={(text) => note("err", text)}
          />
        );

      case "profiles": {
        const sections = profileSections.filter((s) => s.label !== "Selector Switch");
        const selector = usesSelectorSwitch
          ? "Selector Switch"
          : usesEncoder
            ? "Selector Encoder"
            : null;
        const labels = [
          ...sections.map((s) => s.label),
          "Fire Modes",
          ...(selector ? [selector] : []),
        ];
        const keys = labels.map((l) => `profiles:${l}`);
        const valueOf = (key: string) => getByKey(payloads.profile, key);
        return (
          <Page>
            <PageHead
              title="Profiles"
              lede={`${profiles.length} slots. Each holds its own RPM, timing and fire modes.`}
              actions={pageTools(keys)}
            />
            <ProfileBar
              slot={slot}
              names={profileNames}
              activeIndex={schema.activeProfileIndex}
              dirtySlots={dirtySlots}
              onCopy={live ? () => setCopyTo({ to: null }) : undefined}
              copyDisabled={busy}
              name={String(getByKey(payloads.profile, PROFILE_NAME_KEY) ?? "")}
              nameMaxLen={profileNameNode?.maxLen}
              nameCharset={profileNameNode?.charset}
              onName={(v) => onEdit(PROFILE_NAME_KEY, v)}
              onSlotChange={setSlot}
            />
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "minmax(0, 1fr)", xl: "minmax(0, 1fr) 150px" },
                gap: 3,
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                {sections.map((section) => {
                  const key = `profiles:${section.label}`;
                  return (
                    <Panel
                      key={`${section.label}-${slot}`}
                      id={sectionId("profiles", section.label)}
                      title={section.label}
                      folded={isFolded(key)}
                      onFold={() => toggleFold(key)}
                      summary={sectionSummary(section, valueOf)}
                      badge={badge(unsavedIn(section.label, "profile"))}
                    >
                      <Box sx={{ p: 1.5 }}>
                        {section.label === "RPM & Timing" ? (
                          // The settings that hold across both RPM modes come first; the per-motor or
                          // per-stage targets follow, since which of those you are looking at is
                          // decided by RPM Mode in the block above.
                          <Stack spacing={1.25}>
                            <Section node={section} payloads={payloads} onEdit={onEdit} />
                            <RpmStages
                              schema={resolved}
                              device={device}
                              profile={payloads.profile}
                              onEdit={onEdit}
                            />
                          </Stack>
                        ) : (
                          <Section node={section} payloads={payloads} onEdit={onEdit} />
                        )}
                      </Box>
                    </Panel>
                  );
                })}

                <Panel
                  id={sectionId("profiles", "Fire Modes")}
                  title="Fire Modes"
                  folded={isFolded("profiles:Fire Modes")}
                  onFold={() => toggleFold("profiles:Fire Modes")}
                  summary={modeSummary(payloads.profile)}
                  badge={badge(unsavedIn("Fire Modes", "profile"))}
                >
                  <Box sx={{ p: 1.5 }}>
                    <FireModes
                      key={`firemodes-${slot}`}
                      schema={resolved}
                      profile={payloads.profile}
                      onEdit={onEdit}
                      onReplaceModes={replaceModes}
                    />
                  </Box>
                </Panel>

                {selector && (
                  <Panel
                    id={sectionId("profiles", selector)}
                    title={selector}
                    folded={isFolded(`profiles:${selector}`)}
                    onFold={() => toggleFold(`profiles:${selector}`)}
                  >
                    <Box sx={{ p: 1.5 }}>
                      {usesSelectorSwitch ? (
                        <SelectorSwitch
                          key={`selector-${slot}`}
                          schema={resolved}
                          device={device}
                          profile={payloads.profile}
                          profileNames={profileNames}
                          onEdit={onEdit}
                        />
                      ) : (
                        <EncoderSelector
                          key={`encoder-${slot}`}
                          schema={resolved}
                          device={device}
                          profile={payloads.profile}
                          profileNames={profileNames}
                          onEdit={onEdit}
                        />
                      )}
                    </Box>
                  </Panel>
                )}
              </Box>
              <Toc
                entries={labels.map((l) => ({
                  id: sectionId("profiles", l),
                  label: l,
                  dirty: unsavedIn(l, "profile") > 0,
                }))}
              />
            </Box>
          </Page>
        );
      }

      case "blaster": {
        // Wiring has its own page: it is the longest section and the one you touch least once a
        // board is set up. It stays claimed by DEVICE_LAYOUT even so, because unclaiming it would
        // scatter the pins into "Other settings" rather than move them.
        const sections = deviceSections.filter((s) => s.label !== "Wiring");
        const keys = sections.map((s) => `blaster:${s.label}`);
        const valueOf = (key: string) => getByKey(device, key);
        return (
          <Page>
            <PageHead
              title="Blaster settings"
              lede="Shared by every profile. Written with one LOAD_DEVICE, which restarts the blaster."
              actions={pageTools(keys)}
            />
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "minmax(0, 1fr)", xl: "minmax(0, 1fr) 150px" },
                gap: 3,
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                {sections.map((section) => {
                  const key = `blaster:${section.label}`;
                  return (
                    <Panel
                      key={section.label}
                      id={sectionId("blaster", section.label)}
                      title={section.label}
                      folded={isFolded(key)}
                      onFold={() => toggleFold(key)}
                      summary={sectionSummary(section, valueOf)}
                      badge={badge(unsavedIn(section.label, "device"))}
                    >
                      <Box sx={{ p: 1.5 }}>
                        {section.label === "Motors & PID" ? (
                          // The ESC's own settings are half of what these fields describe, and there
                          // is nowhere else on the page they would be read next to.
                          <Stack spacing={1.25}>
                            <Section
                              node={section}
                              payloads={payloads}
                              onEdit={onEdit}
                              matrixExtras={motorActionRows({
                                motors: enabledMotors(device),
                                available: consoleControls,
                                ...motorActions,
                              })}
                            />
                            <EscSetup device={device} />
                          </Stack>
                        ) : section.label === "Boot Actions" ? (
                          <BootRules
                            schema={resolved}
                            device={device}
                            profileNames={profiles.map(
                              (p) => (p as { name?: string } | undefined)?.name,
                            )}
                            onEdit={onEdit}
                          />
                        ) : (
                          <Section node={section} payloads={payloads} onEdit={onEdit} />
                        )}
                      </Box>
                    </Panel>
                  );
                })}
              </Box>
              <Toc
                entries={sections.map((s) => ({
                  id: sectionId("blaster", s.label),
                  label: s.label,
                  dirty: unsavedIn(s.label, "device") > 0,
                }))}
              />
            </Box>
          </Page>
        );
      }

      case "wiring":
        return (
          <Page>
            <PageHead
              title="Wiring"
              lede="Which GPIO each control is on. Pins take effect when the blaster restarts."
              actions={
                <>
                  <Chip>{wiringName}</Chip>
                  {live && (
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={busy}
                      onClick={() => setPresetsOpen(true)}
                    >
                      Change board…
                    </Button>
                  )}
                </>
              }
            />
            {presetsOpen && (
              <Panel title="Change board">
                <Box sx={{ p: 2 }}>
                  <SetupWizard
                    busy={busy}
                    schema={schema}
                    storedBoardId={schema.boardId || undefined}
                    suggested={suggestedPreset}
                    replacing={wiringName}
                    onApply={(preset) => void applyPreset(preset)}
                    onCustom={() => void startCustomWiring()}
                    onCancel={() => setPresetsOpen(false)}
                  />
                </Box>
              </Panel>
            )}
            {deviceSections
              .filter((s) => s.label === "Wiring")
              .map((section) => (
                <Panel key="wiring" title={section.label}>
                  <Box sx={{ p: 1.5 }}>
                    {wiringDiagram && (
                      <WiringWarnings schema={resolved} device={device} diagram={wiringDiagram} />
                    )}
                    {/* Side by side where there is room: the table says which value, the diagram
                        says which pad, and reading one against the other is the whole point of
                        drawing the board at all. The rules go under both because they are about the
                        pins themselves, not about either view of them. */}
                    <Stack
                      direction={{ xs: "column", lg: "row" }}
                      spacing={2}
                      sx={{ alignItems: "flex-start" }}
                    >
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <WiringTable
                          schema={resolved}
                          device={device}
                          onEdit={onEdit}
                          highlightPin={hoverPin}
                          onHoverPin={setHoverPin}
                        />
                      </Box>
                      {wiringDiagram && (
                        <WiringDiagram
                          schema={resolved}
                          device={device}
                          diagram={wiringDiagram}
                          highlightPin={hoverPin}
                          onHoverPin={setHoverPin}
                        />
                      )}
                    </Stack>
                    <WiringRules />
                  </Box>
                </Panel>
              ))}
          </Page>
        );

      case "rpm":
        return (
          <Page>
            <PageHead
              title="RPM capture"
              lede="Record RPM against time for one rev, to tune PID or check spin-up."
            />
            <Panel>
              <Box sx={{ p: 1.5 }}>
                <RpmLog
                  schema={resolved}
                  device={device}
                  onEdit={onEdit}
                  logText={deviceLogText}
                  capturing={getByKey(device, "device:useRpmLogging") === true}
                  text={rpmText}
                  onText={setRpmText}
                  revHold={consoleControls ? <RevHold api={revHoldApi} live={live} /> : null}
                />
              </Box>
            </Panel>
          </Page>
        );

      case "splash":
        return (
          <Page>
            <PageHead
              title="Splash screen"
              lede="The image the OLED shows at power-on: 128 × 64, one bit per pixel."
            />
            <Panel>
              <Box sx={{ p: 1.5 }}>
                <Splash
                  live={live}
                  onUpload={async (bytes) => void (await transport.sendBinary("LOAD_SPLASH", bytes))}
                  onClear={() => transport.sendLine("CLEAR_SPLASH")}
                  read={readSplash}
                />
              </Box>
            </Panel>
          </Page>
        );

      case "firmware":
        return <Firmware busy={busy} onFlash={() => setFlashOpen(true)} />;

      case "maint":
        return (
          <Maintenance live={live} busy={busy} profileName={profileName(slot)} onReset={askReset} />
        );

      case "raw":
        return (
          <Page>
            <PageHead
              title="Raw JSON"
              lede="The settings as the device stores them. Applying stages the differences for review, like any other edit."
            />
            <Panel>
              <Box sx={{ p: 1.5 }}>
                <RawJson
                  device={device}
                  profiles={profiles}
                  slot={slot}
                  onApply={(target, value) => {
                    const nextDevice = target === "device" ? value : device;
                    const nextProfiles =
                      target === "device"
                        ? profiles
                        : profiles.map((p, i) => (i === target ? value : p));
                    const changed = diffKeys(
                      schema,
                      { device, profiles },
                      { device: nextDevice, profiles: nextProfiles },
                    );
                    setDevice(nextDevice);
                    setProfiles(nextProfiles);
                    setDirty((prev) => new Set([...prev, ...changed]));
                    note("ok", `Applied raw JSON — ${changed.size} value(s) changed.`);
                  }}
                />
              </Box>
            </Panel>
          </Page>
        );
    }
  })();

  const navOnly: ViewId[] | undefined = setupMode ? ["overview", "firmware"] : undefined;

  // The footer sits under the rail where the rail has labels, in the phone's More sheet, and at the
  // foot of the page between the two, where the rail is icons only. One place at a time.
  const theme = useTheme();
  const railLabelled = useMediaQuery(theme.breakpoints.up("md"));
  const phone = useMediaQuery(theme.breakpoints.down("sm"));
  const footer = <ConsoleFooter stacked />;

  return (
    <DirtyKeys.Provider value={dirtyKeys}>
      <StagingContext.Provider value={staging}>
        <Shell
          top={
            <TopBar
              live={live}
              busy={busy}
              fw={live ? schema.fw : null}
              supported={SerialTransport.supported}
              asksEveryTime={SerialTransport.asksEveryTime}
              blasterName={String(getByKey(device, BLASTER_NAME_KEY) ?? "")}
              nameMaxLen={blasterNameNode?.maxLen}
              nameCharset={blasterNameNode?.charset}
              onBlasterName={(v) => onEdit(BLASTER_NAME_KEY, v)}
              wiringLabel={setupMode ? "No wiring" : wiringName}
              onConnect={(choose) => void connect(choose)}
              onDisconnect={() => void transport.disconnect()}
              onSearch={setupMode ? undefined : () => setPaletteOpen(true)}
              onChangeBoard={
                live && !setupMode
                  ? () => {
                      go("wiring");
                      setPresetsOpen(true);
                    }
                  : undefined
              }
              actions={
                live
                  ? {
                      onRead: () => void readSchemaAndValues(),
                      onRestart: () => void reboot("normal"),
                      onBootloader: () => void reboot("bootloader"),
                      onPassthrough: () => void reboot("passthrough"),
                    }
                  : undefined
              }
              onFlash={() => setFlashOpen(true)}
            />
          }
          band={band}
          nav={
            <NavRail
              view={view}
              counts={counts}
              onGo={go}
              only={navOnly}
              footer={railLabelled ? footer : undefined}
            />
          }
          tabs={
            <BottomTabs
              view={view}
              counts={counts}
              onGo={go}
              only={navOnly}
              onOpenLog={() => setLogOpen(true)}
              footer={phone ? footer : undefined}
            />
          }
          logFolded={!logOpen}
          pending={
            setupMode ? undefined : (
              <PendingBar
                changes={changes}
                profileName={profileName}
                activeIndex={schema.activeProfileIndex}
                live={live}
                busy={busy}
                onReview={() => setReviewOpen(true)}
                onWrite={(store) =>
                  void writeStores([store === "device" ? ["device", 0] : ["profile", store]])
                }
                onDiscard={discardAll}
                onBackup={saveBundleFile}
              />
            )
          }
          log={
            <LogDrawer
              lines={log}
              open={logOpen}
              verbose={verbose}
              onToggleVerbose={live ? toggleVerbose : undefined}
              verboseDisabled={busy}
              onToggle={() => setLogOpen((v) => !v)}
              onClear={() => setLog([])}
              onSave={saveLogFile}
              height={logHeight}
              onResize={setLogHeight}
            />
          }
        >
          {page}
          {!railLabelled && !phone && <Box sx={{ px: 3, pb: 2 }}>{footer}</Box>}
        </Shell>

        <input
          ref={fileInput}
          type="file"
          accept={CONFIG_ACCEPT.join(",")}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ""; // so re-picking the same file fires again
            if (file) void loadFromFile(file, loadIntent);
          }}
        />

        <ReviewSheet
          open={reviewOpen}
          changes={changes}
          profileName={profileName}
          activeIndex={schema.activeProfileIndex}
          live={live}
          busy={busy}
          progress={progress}
          onClose={() => setReviewOpen(false)}
          onRevert={revert}
          onDiscard={discardAll}
          onWrite={(store) =>
            void (store === null
              ? writeEverything()
              : writeStores([store === "device" ? ["device", 0] : ["profile", store]]))
          }
          onShow={(c) => {
            setReviewOpen(false);
            go(c.view, c.slot ?? undefined);
          }}
        />

        <Palette open={paletteOpen} items={paletteItems} onClose={() => setPaletteOpen(false)} />

        {droppedFile && (
          <LoadKindDialog
            fileName={droppedFile.name}
            profileName={profileName(slot)}
            onPick={(intent) => {
              void loadFromFile(droppedFile, intent);
              setDroppedFile(null);
            }}
            onCancel={() => setDroppedFile(null)}
          />
        )}

        {copyTo && (
          <ProfileCopyDialog
            from={slot}
            names={profileNames}
            to={copyTo.to}
            activeIndex={schema.activeProfileIndex}
            sourceDirty={dirtyFor("profile", slot).length > 0}
            busy={busy}
            onPick={(to) => setCopyTo({ to })}
            onCancel={() => setCopyTo(null)}
            onConfirm={() => copyTo.to !== null && void copyProfile(slot, copyTo.to)}
          />
        )}

        {flashOpen && (
          <FlashDialog
            live={live}
            onSaveBackup={saveBundleFile}
            // The console's own Bootloader restart, not a second route to REBOOT_BOOTLOADER.
            onEnterBootloader={() => reboot("bootloader")}
            onReconnect={() => afterReboot("Flashed")}
            onLog={note}
            onClose={() => setFlashOpen(false)}
          />
        )}

        {pendingReset && (
          <ResetDialog
            plan={pendingReset}
            busy={busy}
            onCancel={() => setPendingReset(null)}
            onConfirm={() => void runReset(pendingReset)}
          />
        )}
      </StagingContext.Provider>
    </DirtyKeys.Provider>
  );
}

/** A line across the page for something every page should know. */
function Band({
  children,
  tone,
  action,
}: {
  children: React.ReactNode;
  tone?: "warning" | "error";
  action?: React.ReactNode;
}) {
  const colour =
    tone === "error" ? "error.main" : tone === "warning" ? "warning.main" : "primary.main";
  return (
    <Box
      role="status"
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.25,
        px: { xs: 1.5, sm: 1.75 },
        py: 0.75,
        fontSize: 13,
        color: colour,
        bgcolor: "action.hover",
        borderBottom: 1,
        borderColor: "divider",
        flexWrap: "wrap",
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
      {action}
    </Box>
  );
}
