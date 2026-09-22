import React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import LinearProgress from "@mui/material/LinearProgress";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import {
  ActivationLost,
  PickerCancelled,
  flashImage,
  rebootDevice,
  requestBootDevice,
  webUsbSupported,
  type FlashProgress,
} from "../flash/flash";
import { formatSize, parseUf2, type FlashImage } from "../flash/uf2";
import type { LogKind } from "../serial/transport";
import { DropLabel, dropOutlineSx, useFileDrop } from "./FileDrop";
import { HelpSection, Para, Step, Steps } from "./Help";

/**
 * Flashing a .uf2 over PICOBOOT, without the RPI-RP2 drive.
 *
 * The one thing this dialog's shape is dictated by: WebUSB's device picker needs transient
 * activation, so it has to be asked for inside the click that started the flash. The blaster is
 * still on serial at that moment, so the reboot request and the picker go out together and Chrome's
 * live-updating picker grows an `RP2 Boot` entry a second later. That cannot be deferred to a
 * device-arrival listener, and a click that takes too long to reach the picker loses its activation
 * - which is why there is a second path back to the picker with the board already in BOOTSEL.
 *
 * An ordinary image does not reach the stored config - measured through this path, not assumed -
 * so the backup gate is precaution rather than recovery: either save one here, or say you have one.
 */

/**
 * Where a new .uf2 comes from. The project's own releases rather than a fork's: this console ships
 * as the project's tool, and the firmware it configures is the firmware published there.
 *
 * An absolute URL rather than a path beside the console, because the console is a single file that
 * is meant to work from `file://` as much as from a host - a relative link would 404 for everyone
 * who saved a copy, which is most people. The page it opens is the release list, not a direct
 * download, so the user picks the build that matches their board and reads the notes on the way.
 */
const FIRMWARE_URL = "https://github.com/davidpyo/trifolium-controller/releases/latest";
const ZADIG_URL = "https://zadig.akeo.ie/";

/** Shared by the picker and the drop zone. A .uf2 has no type of its own on most platforms. */
const UF2_ACCEPT = [".uf2", "application/octet-stream"] as const;

type Stage =
  /** Choosing a file and dealing with the backup. */
  | "pick"
  /** The board is in BOOTSEL and waiting to be picked out of the browser's dialog. */
  | "select"
  | "flashing"
  | "done"
  | "error";

export interface FlashDialogProps {
  /** Whether the console still holds the serial port, which decides who reboots the board. */
  live: boolean;
  onSaveBackup: () => void;
  /** The console's own Reboot > Bootloader: sends REBOOT_BOOTLOADER and drops the port. */
  onEnterBootloader: () => Promise<void>;
  /** Back on Web Serial and re-read the schema, after the board returns to its firmware. */
  onReconnect: () => Promise<void>;
  onLog: (kind: LogKind, text: string) => void;
  onClose: () => void;
}

const PHASE_LABEL: Record<FlashProgress["phase"], string> = {
  erase: "Erasing",
  write: "Writing",
  verify: "Verifying",
};

export function FlashDialog(props: FlashDialogProps) {
  const { live, onSaveBackup, onEnterBootloader, onReconnect, onLog, onClose } = props;

  const [stage, setStage] = React.useState<Stage>("pick");
  const [image, setImage] = React.useState<FlashImage | null>(null);
  const [fileName, setFileName] = React.useState("");
  const [fileError, setFileError] = React.useState("");
  const [backupDone, setBackupDone] = React.useState(false);
  const [progress, setProgress] = React.useState<FlashProgress | null>(null);
  const [message, setMessage] = React.useState("");
  /** Held so a retry, or a reboot after a failed verify, does not need the picker again. */
  const [device, setDevice] = React.useState<USBDevice | null>(null);
  /** True once the erase has gone through: the board has no firmware to fall back on. */
  const [partial, setPartial] = React.useState(false);

  const supported = webUsbSupported();
  const running = stage === "flashing";

  const onFile = async (file: File) => {
    setFileError("");
    setImage(null);
    setFileName(file.name);
    try {
      const parsed = parseUf2(new Uint8Array(await file.arrayBuffer()));
      setImage(parsed);
      onLog("ok", `${file.name}: ${formatSize(parsed.data.length)} over ${parsed.blocks} blocks.`);
    } catch (e) {
      const text = (e as Error).message;
      setFileError(`${file.name}: ${text}`);
      onLog("err", `${file.name}: ${text}`);
    }
  };

  // Dropping is off outside the pick stage: there is nothing to choose once a flash is under way.
  const { over, dropProps } = useFileDrop({
    accept: UF2_ACCEPT,
    what: "a .uf2 firmware image",
    disabled: stage !== "pick",
    onFile: (file) => void onFile(file),
    onReject: (text) => {
      setImage(null);
      setFileError(text);
      onLog("err", text);
    },
  });

  /** Erase, write, verify, reboot - everything once a board has actually been picked. */
  const run = async (target: USBDevice) => {
    if (!image) return;
    setStage("flashing");
    setProgress(null);
    onLog("out", `Flashing ${fileName} over PICOBOOT (${formatSize(image.data.length)}).`);
    try {
      let announced = "";
      await flashImage(target, image, (p) => {
        setProgress(p);
        if (p.phase !== announced) {
          announced = p.phase;
          onLog("out", `${PHASE_LABEL[p.phase]}...`);
        }
      });
      onLog("ok", "Written and verified against the file.");
    } catch (e) {
      setPartial(Boolean((e as { partial?: boolean }).partial));
      setMessage((e as Error).message);
      setStage("error");
      onLog("err", (e as Error).message);
      return;
    }

    try {
      await rebootDevice(target);
    } catch (e) {
      // The image is on the board and verified; only the way back failed. Say so rather than
      // reporting a flash that worked as one that did not.
      setPartial(false);
      setMessage(`${(e as Error).message} Unplug the blaster and plug it back in to start it.`);
      setStage("error");
      onLog("err", (e as Error).message);
      return;
    }

    setStage("done");
    setMessage("Flashed and verified. The blaster is restarting.");
    onLog("ok", "Rebooted into the new firmware.");
    await onReconnect();
  };

  /**
   * The whole flow, from one click: reboot to BOOTSEL and ask for the device inside the same
   * activation. Nothing may be awaited here that the board does not need.
   */
  const startFlash = async () => {
    if (!image) return;
    setMessage("");
    try {
      if (live) await onEnterBootloader();
    } catch (e) {
      setMessage(`Could not reboot into the bootloader: ${(e as Error).message}`);
      setStage("error");
      return;
    }
    await pickAndRun();
  };

  /** The picker on its own, for a board already in BOOTSEL - a retry, or an offline start. */
  const pickAndRun = async () => {
    try {
      const picked = await requestBootDevice();
      setDevice(picked);
      await run(picked);
    } catch (e) {
      if (e instanceof PickerCancelled || e instanceof ActivationLost) {
        // Recoverable, and the board is in BOOTSEL either way: it is out of its firmware and
        // waiting, so saying nothing here is the worst outcome available.
        setStage("select");
        setMessage(
          e instanceof ActivationLost
            ? "The picker did not open. The blaster is in bootloader mode - pick it below."
            : "No board was picked. The blaster is in bootloader mode and will not run until it " +
            "is flashed or unplugged.",
        );
        onLog("err", (e as Error).message);
        return;
      }
      setPartial(false);
      setMessage((e as Error).message);
      setStage("error");
      onLog("err", (e as Error).message);
    }
  };

  const rebootOnly = async () => {
    if (!device) return;
    try {
      await rebootDevice(device);
      onLog("ok", "Rebooted out of the bootloader.");
      setStage("done");
      setMessage("Restarted. Check which firmware it came back on.");
      await onReconnect();
    } catch (e) {
      setMessage((e as Error).message);
      onLog("err", (e as Error).message);
    }
  };

  const percent = progress && progress.total ? (progress.done / progress.total) * 100 : 0;

  return (
    <Dialog open onClose={running ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Flash firmware over USB</DialogTitle>
      <DialogContent>
        {/* The whole content is the target: the picker is one small button in a column of prose,
            and a file aimed at it lands anywhere but. */}
        <Stack spacing={1.5} {...dropProps} sx={dropOutlineSx(over)}>
          <DropLabel over={over} label="Drop a .uf2 here" />
          {!supported && (
            <Alert severity="error" sx={{ py: 0.5 }}>
              This browser has no WebUSB. Use Chrome or Edge on desktop.
            </Alert>
          )}

          {stage === "pick" && (
            <>
              {/* Not "this erases your config": the wiring and profiles live in LittleFS above
                  the firmware, so an ordinary image does not reach them. What does reach them is a
                  full-chip erase image, and a firmware whose schema refuses the stored shape. */}
              <Alert severity="warning" sx={{ py: 0.5 }}>
                This replaces the firmware. Wiring, tuning and profiles are kept. Take a full
                backup first.
              </Alert>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    onSaveBackup();
                    setBackupDone(true);
                  }}
                >
                  Save full backup
                </Button>
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={backupDone}
                      onChange={(e) => setBackupDone(e.target.checked)}
                    />
                  }
                  label={
                    <Typography variant="body2">I have a backup of this blaster</Typography>
                  }
                />
              </Stack>

              {/* Get a file, then pick it: downloading and flashing are one task, so the link
                  sits beside the picker rather than in the header. */}
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Button size="small" variant="outlined" component="label">
                  {image ? "Choose a different .uf2" : "Choose a .uf2 file"}
                  <input
                    type="file"
                    accept={UF2_ACCEPT.join(",")}
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = ""; // so re-picking the same file fires again
                      if (file) void onFile(file);
                    }}
                  />
                </Button>
                <Button
                  size="small"
                  component="a"
                  href={FIRMWARE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Download Firmware
                </Button>
                <Typography variant="caption" color="text.disabled">
                  or drop one here
                </Typography>
              </Stack>

              {fileError && (
                <Alert severity="error" sx={{ py: 0.5 }}>
                  {fileError}
                </Alert>
              )}
              {image && (
                <Typography variant="body2" color="text.secondary">
                  {fileName} — {formatSize(image.data.length)}, {image.blocks} blocks
                </Typography>
              )}

              <Typography variant="body2" color="text.secondary">
                {live
                  ? "The blaster restarts into its bootloader. Pick RP2 Boot when the browser asks."
                  : "Not connected. Expects a blaster already in bootloader mode."}
              </Typography>
            </>
          )}

          {stage === "select" && (
            <>
              <Alert severity="warning" sx={{ py: 0.5 }}>
                {message}
              </Alert>
              <Typography variant="body2" color="text.secondary">
                If RP2 Boot is not in the list, unplug the blaster, hold BOOTSEL, and plug it back
                in.
              </Typography>
            </>
          )}

          {running && (
            <>
              <Typography variant="body2">
                {progress ? PHASE_LABEL[progress.phase] : "Starting"} {fileName}
              </Typography>
              <LinearProgress variant={progress ? "determinate" : "indeterminate"} value={percent} />
              <Typography variant="caption" color="text.disabled">
                Do not unplug the blaster.
              </Typography>
            </>
          )}

          {stage === "done" && (
            <Alert severity="success" sx={{ py: 0.5 }}>
              {message}
            </Alert>
          )}

          {stage === "error" && (
            <>
              <Alert severity="error" sx={{ py: 0.5 }}>
                {message}
              </Alert>
              {partial && (
                <Typography variant="body2" color="text.secondary">
                  The blaster is in bootloader mode and will not run until it is flashed again.
                </Typography>
              )}
            </>
          )}

          {(stage === "done" || (stage === "error" && !partial)) && (
            <Box>
              <Typography variant="body2" color="text.secondary">
                Connect and check the wiring before using the blaster.
              </Typography>
            </Box>
          )}

          {!running && stage !== "done" && (
            <Box>
              <Divider sx={{ mb: 0.5 }} />
              <BootloaderHelp />
              <DriverHelp />
              <DragDropHelp />
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={running}>
          {stage === "done" ? "Close" : "Cancel"}
        </Button>
        {stage === "pick" && (
          <Button
            variant="contained"
            color="warning"
            disabled={!supported || !image || !backupDone}
            onClick={() => void startFlash()}
          >
            {live ? "Reboot and flash" : "Pick device and flash"}
          </Button>
        )}
        {stage === "select" && (
          <Button variant="contained" color="warning" onClick={() => void pickAndRun()}>
            Pick device and flash
          </Button>
        )}
        {stage === "error" && device && (
          <>
            <Button onClick={() => void rebootOnly()}>Reboot the board anyway</Button>
            <Button variant="contained" color="warning" onClick={() => void run(device)}>
              Flash again
            </Button>
          </>
        )}
        {stage === "error" && !device && (
          <Button variant="contained" onClick={() => setStage("pick")}>
            Start over
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

/**
 * The collapsed sections. Everything under one is for the flash that did not work, and a dialog
 * that explains its failure modes before they happen is a dialog nobody reads - so they are opt-in,
 * and once opened they may take the space to actually explain themselves.
 */
function DragDropHelp() {
  return (
    <HelpSection summary="Flash by drag and drop instead">
      <Para>
        The board can also be flashed as a USB drive, without this dialog or any driver setup. It
        is the fallback when the steps above do not get you connected.
      </Para>
      <Steps>
        <Step>Download the .uf2 with the link at the top of this dialog.</Step>
        <Step>
          Put the blaster in Bootloader mode using one of the methods described above.
        </Step>
        <Step>Copy the .uf2 onto the RPI-RP2 drive that appears.</Step>
        <Step>
          The drive disappears on its own once the file is written, and the blaster restarts on the
          new firmware.
        </Step>
      </Steps>
    </HelpSection>
  );
}

function BootloaderHelp() {
  return (
    <HelpSection summary="How do I put the blaster into bootloader mode?">
      <Para>
        In bootloader mode the blaster stops being a serial device and shows up as RP2 Boot, which
        is what this dialog writes to. Four ways in, easiest first:
      </Para>
      <Steps>
        <Step>From this console: Reboot &gt; Bootloader in the header.</Step>
        <Step>From the blaster's own OLED menu: Reboot &gt; Bootloader.</Step>
        <Step>
          Hold a switch whose Boot Action is Bootloader while powering the blaster on. Boot actions
          are set on the Wiring tab.
        </Step>
        <Step>
          Hold the BOOTSEL button on the board while plugging the USB cable in. This one needs no
          working firmware, so it still works when the blaster is unresponsive, half-flashed, or has
          never been flashed at all.
        </Step>
      </Steps>
    </HelpSection>
  );
}

function DriverHelp() {
  return (
    <HelpSection summary="Windows: the flash hangs, or RP2 Boot never appears">
      <Para>
        Windows sometimes fails to set up the driver the browser needs to reach the board. When that
        happens the blaster either never appears in the picker, or it is picked and the flash then
        sits there with no error. It is a known problem, not something you did wrong.
      </Para>
      <Para>Set the driver up by hand with Zadig, a small free Windows utility:</Para>
      <Steps>
        <Step>
          Download Zadig from{" "}
          <Link href={ZADIG_URL} target="_blank" rel="noopener noreferrer">
            zadig.akeo.ie
          </Link>{" "}
          and run it. It is a single .exe, with no installer.
        </Step>
        <Step>
          Options &gt; List All Devices. Without it the blaster is not in the dropdown at all, which
          is the step that gets missed.
        </Step>
        <Step>
          Select RP2 Boot (Interface 1) in the dropdown, and check that number. Interface 0 is the
          drive Windows shows for drag-and-drop flashing: changing that one takes drag-and-drop
          away instead of fixing anything.
        </Step>
        <Step>
          Confirm the driver box on the right reads WinUSB, then click Install Driver - or Replace
          Driver, if something is already bound. It can sit for a minute or two looking stuck.
        </Step>
        <Step>Unplug the blaster, plug it back in holding BOOTSEL, and flash again.</Step>
      </Steps>
      <Para>
        On Linux the driver is not the problem, but permission can be: Chrome may need a udev rule
        for the bootloader's USB id, 2E8A:0003, before it can open the board.
      </Para>
    </HelpSection>
  );
}
