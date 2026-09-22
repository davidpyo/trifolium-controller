import React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
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
import { SerialTransport, TIMEOUT_SCHEMA_MS, type LogLine } from "./serial/transport";
import { bundleFilename, buildBundle, checkBundle, diffKeys, downloadJson } from "./config/bundle";
import { LOG_LINE_CAP } from "./rpm/parse";
import { applyLayout } from "./ui/applyLayout";
import { PresetApplyDialog } from "./ui/PresetApplyDialog";
import { DirtyKeys } from "./ui/dirty";
import { PresetPicker } from "./ui/PresetPicker";
import { BootFaults } from "./ui/BootFaults";
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
import { RpmStages } from "./ui/RpmStages";
import { SelectorSwitch } from "./ui/SelectorSwitch";
import { WiringWarnings } from "./ui/WiringWarnings";
import { WiringDiagram } from "./ui/WiringDiagram";
import { WiringRules } from "./ui/wiringRules";
import { WiringTable } from "./ui/WiringTable";
import { Fieldset, Section, type Payloads } from "./ui/Section";
import { countFields, deriveSections, pruneToStore, type Store } from "./ui/sections";
import { Splash } from "./ui/Splash";
import { CONFIG_ACCEPT, TopBar, type LoadIntent } from "./ui/TopBar";

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

type TabId = "profile" | "device" | "rpm" | "splash" | "wiring" | "raw";

export function App() {
  const [schema, setSchema] = React.useState<Schema>(OFFLINE_SCHEMA);
  const [live, setLive] = React.useState(false);
  const [slot, setSlot] = React.useState(0);
  const [device, setDevice] = React.useState<unknown>(OFFLINE_DEVICE);
  const [profiles, setProfiles] = React.useState<unknown[]>(FIXTURE_PROFILES);
  const [dirty, setDirty] = React.useState<Set<string>>(new Set());
  const [log, setLog] = React.useState<LogLine[]>([]);
  const [tab, setTab] = React.useState<TabId>("profile");
  const [busy, setBusy] = React.useState(false);
  /** A preset the user picked on an already-wired device, held until they confirm. */
  const [pendingPreset, setPendingPreset] = React.useState<Preset | null>(null);
  /** The picker, opened deliberately on a device that already has a wiring. */
  const [presetsOpen, setPresetsOpen] = React.useState(false);
  /** The connected device's DUMP_BOOT, for the faults it recorded. Null while offline. */
  const [boot, setBoot] = React.useState<BootStatus | null>(null);
  /** A reset the user picked, held until they type its word. Null when no dialog is open. */
  const [pendingReset, setPendingReset] = React.useState<ResetPlan | null>(null);
  /** The PICOBOOT flasher. Openable offline, for a board already sitting in its bootloader. */
  const [flashOpen, setFlashOpen] = React.useState(false);
  // null closed; {to: null} open with nothing picked yet.
  const [copyTo, setCopyTo] = React.useState<{ to: number | null } | null>(null);

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

  const store: Store = tab === "device" || tab === "wiring" ? "device" : "profile";

  /**
   * The schema as it applies to the values in the form right now.
   *
   * `schema.visible` is the device's answer as of the last dump, which goes stale the moment
   * anything is edited - and the rows that move are exactly the ones a user is watching for when
   * they flip Control Type or Select-Fire. Only rows carrying a `visibleWhen` are re-evaluated;
   * everything else keeps the device's word, because the rules it does not publish read
   * post-conflict pins and board properties that no amount of form state can settle.
   */
  const view = React.useMemo(
    () => resolveVisibility(schema, { device, profile: profiles[slot] ?? {} }),
    [schema, device, profiles, slot],
  );

  const sectionsFor = React.useCallback(
    (which: Store): SchemaNode[] => {
      const pruned = deriveSections(view.tree)
        .map((s) => pruneToStore(s, which))
        .filter((s): s is SchemaNode => s !== null && countFields(s) > 0);
      return applyLayout(pruned, which === "device" ? DEVICE_LAYOUT : PROFILE_LAYOUT);
    },
    [view],
  );

  const profileSections = React.useMemo(() => sectionsFor("profile"), [sectionsFor]);
  const deviceSections = React.useMemo(() => sectionsFor("device"), [sectionsFor]);
  const sections = store === "profile" ? profileSections : deviceSections;

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
  const readAll = async () => {
    const dev = await transport.request<unknown>("DUMP_DEVICE");
    const loaded: unknown[] = [];
    for (let i = 0; i < schema.profileCount; i++) {
      loaded.push((await transport.request<unknown>(`DUMP_PROFILE ${i}`)) ?? {});
    }
    if (dev) setDevice(dev);
    setProfiles(loaded);
    setDirty(new Set());
  };

  /**
   * Re-reads the schema and every stored value from a connected device.
   *
   * The schema comes first and is re-read, not cached: which rows exist and what bounds they carry
   * both depend on the board, so anything that can change the board has to refetch it rather than
   * only refreshing values.
   */
  const readSchemaAndValues = async (): Promise<boolean> => {
    const next = await transport.request<Schema>("DUMP_SCHEMA", TIMEOUT_SCHEMA_MS);
    if (!next || next.cmd !== "DUMP_SCHEMA") {
      note(
        "err",
        "No schema from this firmware - it predates DUMP_SCHEMA. Use the Raw JSON tab; the form would show limits that may not match this device.",
      );
      return false;
    }

    const dev = await transport.request<unknown>("DUMP_DEVICE");
    const loaded: unknown[] = [];
    for (let i = 0; i < next.profileCount; i++) {
      loaded.push((await transport.request<unknown>(`DUMP_PROFILE ${i}`)) ?? {});
    }

    // Cheap, and the only way to learn what this boot discarded: the faults print before a host
    // can attach. A device too old to answer leaves it null, which reads as "nothing recorded".
    setBoot(await transport.request<BootStatus>("DUMP_BOOT"));

    setSchema(next);
    setDevice(dev ?? {});
    setProfiles(loaded);
    setSlot(next.activeProfileIndex);
    setDirty(new Set());
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
  const connect = async () => {
    if (!(await transport.connect())) return;
    if (!(await transport.waitReady())) return;
    await readSchemaAndValues();
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
      setPendingPreset(null);
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
      setPendingPreset(null);
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
        setTab("wiring");
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
   * reopenAfterReboot()/waitReady() before reading again - the same sequence writeStore() uses and
   * for the same reason. Bootloader is the exception and deliberately does not: the device comes
   * back as a USB mass-storage drive with no serial port at all, so there is nothing to reconnect
   * to and pretending otherwise would just time out.
   */
  const afterReboot = async (label: string) => {
    if ((await transport.reopenAfterReboot()) && (await transport.waitReady())) {
      setLive(true);
      if (await readSchemaAndValues()) note("ok", `${label} - device is back.`);
      return;
    }
    note("err", `${label}, but the device did not come back. Reconnect when it has restarted.`);
  };

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
   * fields with no OLED row by the firmware's own mechanical rule, and RESET_PINS takes the board
   * table's wiring. Composing either payload here would be a second copy of that rule, free to
   * drift from it.
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
      wiring: "Wiring reset",
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
    setPendingReset(
      kind === "profile" ? { kind, slot, profileName: profileName(slot) } : { kind },
    );

  /**
   * Writes device fields straight to the device, outside the dirty set.
   *
   * For a setting the console arms and then clears on the user's behalf, which must not sit in a
   * batch the user might never send or might send half of. The device reboots on any LOAD_DEVICE,
   * so this carries the same reconnect as writeStore().
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

  const onEdit = (key: string, value: unknown) => {
    if (key.startsWith("device:")) {
      setDevice((prev: unknown) => setByKey((prev ?? {}) as object, key, value));
      setDirty((prev) => new Set(prev).add(key));
    } else {
      setProfiles((prev) =>
        prev.map((p, i) => (i === slot ? setByKey((p ?? {}) as object, key, value) : p)),
      );
      setDirty((prev) => new Set(prev).add(`${slot}:${key}`));
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
        i === slot ? { ...((p ?? {}) as object), fireModes: modes, activeModeCount: modes.length } : p,
      ),
    );
    setDirty((prev) =>
      new Set(prev).add(`${slot}:profile:fireModes`).add(`${slot}:profile:activeModeCount`),
    );
  };

  const writeStore = async (which: Store, target: number) => {
    const keys = dirtyFor(which, target);
    if (!keys.length) return;

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

    setBusy(true);
    try {
      const ack = await transport.load(command, buildPatch(version, entries));
      if (!ack || !ack.ok) return; // the log already says why; the device is untouched on a refusal

      setDirty((prev) => {
        const next = new Set(prev);
        for (const key of keys) next.delete(which === "device" ? key : `${target}:${key}`);
        return next;
      });

      if (ack.rebooting) {
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

  const fileInput = React.useRef<HTMLInputElement>(null);

  /** What the user said they were loading, so a mismatched file is refused rather than guessed at. */
  const [loadIntent, setLoadIntent] = React.useState<LoadIntent>("bundle");
  /** A file dropped on the header, held until the dialog says which store it is for. */
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
        `${file.name} is a full backup, not a ${intent === "device" ? "device config" : "profile"}. Use Load > Full Backup.`,
      );
      return;
    }

    if (intent === "bundle" && !check.bundle) {
      note("err", `${file.name} is not a full backup: ${check.error ?? "unrecognised file"}`);
      return;
    }

    if (check.bundle) {
      for (const w of check.warnings) note("err", `${file.name}: ${w}`);
      const changed = diffKeys(
        schema,
        { device, profiles },
        { device: check.bundle.device, profiles: check.bundle.profiles },
      );
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
      note("err", `${file.name} does not look like a device config - no motorConfig or blasterName.`);
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

  const deviceDirty = dirtyFor("device").length;
  const profileDirty = dirtyFor("profile").length;
  // `wiringByHand` is the console's own answer to "does this device still need a board chosen".
  // The device says no wiring either way; this says the user has already declined the picker.
  const showPicker = needsPresetPicker(schema, live) && !wiringByHand;

  /**
   * The preset a device with no wiring was probably running, from the id its config still carries.
   *
   * The firmware cannot do this: `boardId` is provenance it never interprets, and the board table
   * that could have resolved it is gone. Following the alias table here is the concrete payoff of
   * the console holding the presets - an upgraded device is offered the right wiring rather than
   * an empty dropdown. The boot fault carries the same id, for a device whose config was replaced.
   */
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

  const suggestedPreset = React.useMemo(() => {
    const fromSchema = presetForBoardId(schema.boardId);
    if (fromSchema) return fromSchema;
    const fault = boot?.configFaults?.find((f) => f.fault === "wiringUnavailable");
    return presetForBoardId(fault?.detail);
  }, [schema.boardId, boot]);

  // A board with no authored SVG (most of them, today) is not an error - the tab just stays
  // table-only, the same way a board with no preset falls back to custom wiring.
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

  /**
   * Dirty keys as a field sees them: device keys plus this slot's profile keys, with the "slot:"
   * prefix stripped. Switching slots changes what is marked, which is the point - an edit to slot 2
   * is not an edit to the slot you are looking at.
   */
  /**
   * Edits to rows the form is no longer showing.
   *
   * Re-evaluating visibility live means a row can disappear *after* it was edited - untick Display
   * Attached having already changed Brightness, and the brightness edit is still queued, still
   * counted, and no longer anywhere on screen to see or undo. The edit is not lost and writing it
   * is correct, since the value stays stored either way; what would be wrong is not saying so.
   */
  const hiddenKeys = React.useMemo(() => {
    const out = new Set<string>();
    walk(view.tree, (node) => {
      if (node.key && node.visible === false) out.add(node.key);
    });
    return out;
  }, [view]);

  const dirtyKeys = React.useMemo(() => {
    const out = new Set<string>();
    for (const entry of dirty) {
      if (entry.startsWith("device:")) out.add(entry);
      else if (entry.startsWith(`${slot}:`)) out.add(entry.slice(String(slot).length + 1));
    }
    return out;
  }, [dirty, slot]);

  const hiddenDirty = React.useMemo(
    () => [...dirtyKeys].filter((key) => hiddenKeys.has(key)),
    [dirtyKeys, hiddenKeys],
  );

  return (
    <DirtyContainer dirtyKeys={dirtyKeys}>
      <Stack spacing={1.25}>
        <TopBar
          lines={log}
          onClearLog={() => setLog([])}
          onSaveLog={() => {
            const name = `trifolium-log-${stamp()}.txt`;
            const blob = new Blob([logToText(log)], { type: "text/plain" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = name;
            a.click();
            URL.revokeObjectURL(url);
          }}
          live={live}
          busy={busy}
          identity={live ? { wiring: wiringName, fw: schema.fw } : null}
          supported={SerialTransport.supported}
          blasterName={String(getByKey(device, BLASTER_NAME_KEY) ?? "")}
          nameMaxLen={blasterNameNode?.maxLen}
          nameCharset={blasterNameNode?.charset}
          onBlasterName={(v) => onEdit(BLASTER_NAME_KEY, v)}
          wiringLabel={wiringName}
          onOpenPresets={() => setPresetsOpen(true)}
          deviceDirty={deviceDirty}
          profileDirty={profileDirty}
          profileName={profileName(slot)}
          profileReboots={slot === schema.activeProfileIndex}
          verbose={getByKey(device, "device:printTelemetry") === true}
          onToggleVerbose={() =>
            void applyDeviceValues([
              {
                key: "device:printTelemetry",
                value: getByKey(device, "device:printTelemetry") !== true,
              },
            ])
          }
          onConnect={() => void connect()}
          onDisconnect={() => void transport.disconnect()}
          onReadAll={() => void readSchemaAndValues()}
          onReboot={(mode) => void reboot(mode)}
          onReset={askReset}
          onWriteDevice={() => void writeStore("device", 0)}
          onWriteProfile={() => void writeStore("profile", slot)}
          onFlashFirmware={() => setFlashOpen(true)}
          onSaveDeviceFile={saveDeviceFile}
          onSaveProfileFile={saveProfileFile}
          onSaveBundleFile={saveBundleFile}
          onLoadFile={(intent) => {
            setLoadIntent(intent);
            fileInput.current?.click();
          }}
          onDropFile={setDroppedFile}
          onDropReject={(text) => note("err", text)}
        />
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
            names={profiles.map((_, i) => profileName(i))}
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
            // The console's own Reboot > Bootloader, not a second route to REBOOT_BOOTLOADER.
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

        {pendingPreset && (
          <PresetApplyDialog
            preset={pendingPreset}
            from={wiringName}
            busy={busy}
            onCancel={() => setPendingPreset(null)}
            onConfirm={() => void applyPreset(pendingPreset)}
          />
        )}

        {!live && (
          <Alert severity="info" sx={{ py: 0 }}>
            Offline, showing a sample config so the form is browsable. Connect a device to load its
            real schema and values — then Save full backup writes that device rather than this
            sample.{" "}
            <Box
              component="button"
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
              Save a full backup
            </Box>
          </Alert>
        )}

        {live && !showPicker && (deviceDirty > 0 || profileDirty > 0) && (
          <Alert severity="warning" sx={{ py: 0 }}>
            {deviceDirty > 0 && `${deviceDirty} unsaved device change(s). `}
            {profileDirty > 0 &&
              `${profileDirty} unsaved change(s) to ${profileName(slot)}. `}
            Device and profile are written separately.
            {hiddenDirty.length > 0 && (
              <Box component="span" sx={{ display: "block", mt: 0.25 }}>
                {hiddenDirty.length} of them{" "}
                {hiddenDirty.length === 1 ? "is to a row" : "are to rows"} the current settings no
                longer show, and will still be written:{" "}
                {hiddenDirty.map((k) => k.split(":").pop()).join(", ")}.
              </Box>
            )}
          </Alert>
        )}

        {/* Both render above the picker as well as above the form. A device whose stored config
            predates stored wiring is exactly the case where the picker alone misleads: it looks
            like a device nobody has configured, when in fact its wiring is the one thing this
            build could not carry across. */}
        <BootFaults boot={boot} />
        <PinConflicts schema={schema} />

        {/* A device with no wiring has no pinout, so there is nothing for the config form to edit
            and no bound it could show that would mean anything. The picker replaces it. Opened by
            hand on a wired device, it sits above the form rather than replacing it, because there
            the form is still the thing being used. */}
        {(showPicker || presetsOpen) && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <PresetPicker
              busy={busy}
              storedBoardId={schema.boardId || undefined}
              suggested={suggestedPreset}
              onApply={(preset) =>
                showPicker ? void applyPreset(preset) : setPendingPreset(preset)
              }
              onCustom={() => void startCustomWiring()}
            />
            {!showPicker && (
              <Box sx={{ mt: 1 }}>
                <Button size="small" disabled={busy} onClick={() => setPresetsOpen(false)}>
                  Cancel
                </Button>
              </Box>
            )}
          </Paper>
        )}

        {!showPicker && (
          <Paper variant="outlined">
            <Tabs value={tab} onChange={(_, v: TabId) => setTab(v)} variant="scrollable">
              <Tab value="profile" label="Profile" />
              <Tab value="device" label="Device" />
              <Tab value="rpm" label="RPM Log" />
              <Tab value="splash" label="Splash" />
              <Tab value="wiring" label="Wiring" />
              <Tab value="raw" label="Raw JSON" />
            </Tabs>
            <Divider />

            {tab === "profile" && (
              <ProfileBar
                slot={slot}
                names={profiles.map((_, i) => profileName(i))}
                activeIndex={schema.activeProfileIndex}
          onCopy={live ? () => setCopyTo({ to: null }) : undefined}
          copyDisabled={busy}
                name={String(getByKey(payloads.profile, PROFILE_NAME_KEY) ?? "")}
                nameMaxLen={profileNameNode?.maxLen}
                nameCharset={profileNameNode?.charset}
                onName={(v) => onEdit(PROFILE_NAME_KEY, v)}
                onSlotChange={setSlot}
              />
            )}

            <Box sx={{ p: 1.25 }}>
              {tab === "wiring" && (
                <Stack spacing={1.25}>
                  {sections
                    .filter((s) => s.label === "Wiring")
                    .map((section) => (
                      <Fieldset key="wiring-tab" label={section.label}>
                        {wiringDiagram && (
                          <WiringWarnings schema={view} device={device} diagram={wiringDiagram} />
                        )}
                        {/* Side by side where there is room: the table says which value, the
                            diagram says which pad, and reading one against the other is the whole
                            point of drawing the board at all. The rules go under both because they
                            are about the pins themselves, not about either view of them. */}
                        <Stack
                          direction={{ xs: "column", lg: "row" }}
                          spacing={2}
                          sx={{ alignItems: "flex-start" }}
                        >
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <WiringTable schema={view} device={device} onEdit={onEdit} />
                          </Box>
                          {wiringDiagram && (
                            <WiringDiagram schema={view} device={device} diagram={wiringDiagram} />
                          )}
                        </Stack>
                        <WiringRules />
                      </Fieldset>
                    ))}
                </Stack>
              )}

              {(tab === "profile" || tab === "device") && (
                <Stack spacing={1.25}>
                  {sections
                    // Selector Switch has a purpose-built editor below; the generic form cannot show
                    // that those three pins pick both a fire mode and a profile.
                    .filter((s) => !(tab === "profile" && s.label === "Selector Switch"))
                    // Wiring has its own tab: it is the longest section and the one you touch
                    // least once a board is set up. It stays claimed by DEVICE_LAYOUT even so,
                    // because unclaiming it would scatter the pins into "Other settings" rather
                    // than move them.
                    .filter((s) => s.label !== "Wiring")
                    .map((section) => (
                      <Fieldset key={`${section.label}-${store}-${slot}`} label={section.label}>
                        {section.label === "Motors & PID" ? (
                          // The ESC's own settings are half of what these fields describe, and
                          // there is nowhere else on the page they would be read next to.
                          <Stack spacing={1.25}>
                            <Section node={section} payloads={payloads} onEdit={onEdit} />
                            <EscSetup device={device} />
                          </Stack>
                        ) : section.label === "RPM & Timing" ? (
                          // The settings that hold across both RPM modes come first; the per-motor
                          // or per-stage targets follow, since which of those you are looking at is
                          // decided by RPM Mode in the block above.
                          <Stack spacing={1.25}>
                            <Section node={section} payloads={payloads} onEdit={onEdit} />
                            <RpmStages
                              schema={view}
                              device={device}
                              profile={payloads.profile}
                              onEdit={onEdit}
                            />
                          </Stack>
                        ) : (
                          <Section node={section} payloads={payloads} onEdit={onEdit} />
                        )}
                      </Fieldset>
                    ))}

                  {tab === "profile" && usesSelectorSwitch && (
                    <Fieldset label="Selector Switch">
                      <SelectorSwitch
                        key={`selector-${slot}`}
                        schema={view}
                        device={device}
                        profile={payloads.profile}
                        profileNames={profiles.map((_, i) => profileName(i))}
                        onEdit={onEdit}
                      />
                    </Fieldset>
                  )}

                  {tab === "profile" && (
                    <Fieldset label="Fire Modes">
                      <FireModes
                        key={`firemodes-${slot}`}
                        schema={view}
                        profile={payloads.profile}
                        onEdit={onEdit}
                        onReplaceModes={replaceModes}
                      />
                    </Fieldset>
                )}
              </Stack>
            )}

            {tab === "splash" && (
              <Splash
                live={live}
                onUpload={(bytes) => void transport.sendBinary("LOAD_SPLASH", bytes)}
                onClear={() => void transport.sendLine("CLEAR_SPLASH")}
              />
            )}

            {tab === "rpm" && (
              <RpmLog
                schema={view}
                device={device}
                onEdit={onEdit}
                logText={deviceLogText}
                capturing={getByKey(device, "device:useRpmLogging") === true}
              />
            )}

            {tab === "raw" && (
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
            )}
          </Box>
        </Paper>
        )}
      </Stack>
    </DirtyContainer>
  );
}

/** The page frame, plus the dirty set every field reads to decide whether to mark itself. */
function DirtyContainer({
  dirtyKeys,
  children,
}: {
  dirtyKeys: ReadonlySet<string>;
  children: React.ReactNode;
}) {
  return (
    <DirtyKeys.Provider value={dirtyKeys}>
      {/* xl rather than lg so the header's action column and the log beside it both have room. */}
      <Container maxWidth="xl" sx={{ py: 2 }}>
        {children}
      </Container>
    </DirtyKeys.Provider>
  );
}
