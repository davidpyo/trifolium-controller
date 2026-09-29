"""One trifolium-sim process: one boot of the firmware, spoken to one JSON line at a time."""

import json
import os
import subprocess
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[3]
EXE = PROJECT / ".pio" / "build" / "sim" / ("trifolium-sim.exe" if os.name == "nt" else "trifolium-sim")


class SimError(Exception):
    """A request the host refused."""


class SimCrash(Exception):
    """The host process died - the firmware did something the PC traps, such as dividing by zero."""

    def __init__(self, returncode, context=""):
        code = returncode & 0xFFFFFFFF if returncode is not None else None
        names = {0xC0000094: "integer divide by zero", 0xC0000005: "access violation",
                 0xC00000FD: "stack overflow"}
        what = names.get(code, f"exit {code:#x}" if code is not None else "no exit code")
        super().__init__(f"trifolium-sim died: {what}" + (f"\n{context}" if context else ""))
        self.returncode = code
        self.what = what


class HostProcess:
    def __init__(self, exe=EXE):
        if not Path(exe).is_file():
            raise FileNotFoundError(f"{exe} is not built - run `pio run -e sim`")
        self._proc = subprocess.Popen([str(exe)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                      stderr=subprocess.DEVNULL, cwd=str(PROJECT))
        self._next_id = 0

    def call(self, op, **params):
        request = {"id": self._next_id, "op": op, **params}
        self._next_id += 1
        try:
            self._proc.stdin.write((json.dumps(request) + "\n").encode())
            self._proc.stdin.flush()
            line = self._proc.stdout.readline()
        except (BrokenPipeError, OSError):
            line = b""
        if not line:
            raise SimCrash(self._proc.wait(timeout=10), f"during {op}")
        reply = json.loads(line)
        if not reply.get("ok"):
            raise SimError(f"{op}: {reply.get('error')}")
        return reply

    def close(self):
        if self._proc.poll() is None:
            try:
                self.call("quit")
            except (SimError, SimCrash):
                pass
            try:
                self._proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self._proc.kill()
        for stream in (self._proc.stdin, self._proc.stdout):
            try:
                stream.close()
            except OSError:
                pass
