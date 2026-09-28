"""A blaster in wall-clock time, for tools that talk to a real one.

    python -m trifolium_sim.serve --preset trifolium_v1_2 --display
    python tools/send_serial.py socket://localhost:5333 DUMP_BOOT      # once a tool takes URLs

Its USB serial is a TCP port that pyserial opens as socket://host:port, and the same serial as a
WebSocket for a browser - webserial_shim.js stands it in for navigator.serial, so the console runs
its real transport against it. One host at a time, as with a COM port. A reboot drops the host the
way re-enumeration drops the port, and for a moment after it nothing can connect. `if (Serial)` is
true while a host is connected.

A further port takes one JSON request per line for everything a person would do at the bench:
{"op": "press", "role": "trigger"}, {"op": "pack", "mv": 12400}, {"op": "panel"} and the rest in
CONTROL below. {"op": "power_on", "source": "usb"} powers it on with the pack unplugged, and
"battery" with it in.

The ESCs start up as a real blaster's do (Blaster.esc_startup()) unless --instant-escs is given.

The simulator panel is a page on a last port, http://127.0.0.1:5336/: the OLED, a button for each
wired switch, the wheels and the pusher, a pack slider - the same requests, over a WebSocket at
/control - with the web console beside it at /console, served with webserial_shim.js so it talks
to this blaster. The console is served as last built, tools/console/dist/index.html.
"""

import argparse
import base64
import hashlib
import json
import re
import selectors
import socket
import struct
import sys
import time
from pathlib import Path

from .blaster import ACCELERATING, FULLSPEED, IDLE, Blaster
from .host import PROJECT

SLICE_MS = 5
CATCH_UP_MS = 20
ENUMERATION_S = 0.8  # after a reboot, how long before the port can be opened again
# What the firmware prints as it goes to reboot. A blaster is off the bus within milliseconds of
# saying so, where the simulator, paced to the wall clock on a busy machine, can take longer than a
# host's first retry - which would then find the old boot still answering.
REBOOT_ANNOUNCED = re.compile(r'"rebooting":true|"evt":"rebooting"')
ANNOUNCED_REBOOT_MS = 2000  # how far to run ahead for it, in simulated time

WS_GUID = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
HEADERS_END = b"\r\n\r\n"

HERE = Path(__file__).parent
PANEL_PAGE = HERE / "simulator.html"
SHIM = HERE / "webserial_shim.js"
CONSOLE = PROJECT / "tools" / "console" / "dist" / "index.html"
FLYWHEEL_STATES = {IDLE: "idle", ACCELERATING: "accelerating", FULLSPEED: "at speed"}
PIN_NOT_USED = 255
DEFAULT_PACK_MV = 16400
PULSE_WINDOW_US = 500_000  # longer than any extend, so a pulse under way at the last look is whole


def driven_high(b, pin):
    level = b.pins()[pin]
    return bool(level["output"] and level["outputLevel"])


def solenoid(b, pin, since_us):
    """The pusher's FET pin: whether the solenoid is powered now, and the length of each pulse that
    ended after `since_us`. A pulse is shorter than the panel's refresh, so they come from edges."""
    rise, pulses = None, []
    for at, level in b.edges(pin, max(0, since_us - PULSE_WINDOW_US)):
        if level:
            rise = at
        elif rise is not None:
            if at > since_us:
                pulses.append(at - rise)
            rise = None
    return {"pin": pin, "on": driven_high(b, pin), "pulses": pulses}


def snapshot(b, since_us=0):
    """What the panel draws, in one request. `since_us` is the last one's `uptimeUs`."""
    reply = {"state": b.state, "boots": b.boot_count, "uptime_ms": b.uptime_ms,
             "uptimeUs": b.uptime_us, "packMv": b.pack_mv}
    if b.state != "running" or not b.peek("booted"):
        return reply
    panel = b.panel(pixels=True)
    values = b.peek("motors", "battery", "flywheelState", "firing", "runtimeShotCounter",
                    "safetyEngaged", "menuOpen", "activeProfileIndex", "wiringLive")
    values["flywheelState"] = FLYWHEEL_STATES.get(values["flywheelState"], values["flywheelState"])
    settings = b.wiring()
    led = settings.get("ledDataPin", PIN_NOT_USED)
    if led != PIN_NOT_USED:
        values["led"] = {"pin": led, "on": driven_high(b, led)}
    fet = settings.get("pusherFetPin", PIN_NOT_USED)
    if settings.get("pusherDrive") == "esc":
        values["pusherEsc"] = settings.get("pusherEscChannel")
    elif fet != PIN_NOT_USED:
        values["solenoid"] = solenoid(b, fet, since_us or 0)
    return {**reply, **values, "panel": {"on": panel.on, "pixels": panel.pixels},
            "wheels": b.wheels(), "extends": len(b.extends())}


def control(b, req):
    op = req.get("op")
    if op == "press":
        return {"pin": b.press(req["role"])}
    if op == "release":
        return {"pin": b.release(req["role"])}
    if op == "tap":
        b.tap(req["role"], req.get("hold_ms", 60), req.get("gap_ms", 60))
        return {}
    if op == "pack":
        b.set_pack(req["mv"], rise_ms=req.get("riseMs", 0))
        return {}
    if op == "panel":
        panel = b.panel(pixels=req.get("pixels", False))
        return {"on": panel.on, "text": panel.text, "highlighted": panel.highlighted,
                "pixels": panel.pixels}
    if op == "peek":
        return {"values": b.peek(*req["names"]) if len(req["names"]) > 1
                else {req["names"][0]: b.peek(req["names"][0])}}
    if op == "wheels":
        return {"wheels": b.wheels()}
    if op == "extends":
        return {"at_us": b.extends()}
    if op == "wiring":
        return {"settings": b.wiring()}
    if op == "power_cycle":
        b.power_cycle()
        b.power_on()
        return {}
    if op == "power_on":
        if req.get("source") == "usb":
            b.set_pack(0)
        else:
            b.set_pack(req.get("mv") or b.pack_mv or DEFAULT_PACK_MV)
        b.power_cycle()
        b.power_on()
        return {}
    if op == "state":
        return {"state": b.state, "boots": b.boot_count, "last_stop": b.last_stop,
                "uptime_ms": b.uptime_ms}
    if op == "flash":
        data = b.flash_get(req["path"])
        return {"exists": data is not None,
                "b64": base64.b64encode(data).decode() if data is not None else None}
    if op == "snapshot":
        return snapshot(b, req.get("since_us", 0))
    raise ValueError(f"unknown op {op!r}")


CONTROL = ("press release tap pack panel peek wheels extends wiring power_cycle power_on state "
           "flash snapshot speed").split()


class Host:
    """A serial host's connection - pyserial's socket://, where the bytes are the serial stream.
    What goes to it is queued and sent as fast as it reads, the way the host's USB driver buffers:
    nothing is lost to a slow reader, and nothing waits on one."""

    ready = True

    def __init__(self, sock):
        self.sock = sock
        self.out = bytearray()

    def feed(self, data):
        """Bytes from the host: the serial stream in them, or None if the host has gone."""
        return data

    def send(self, data):
        self.out += data

    def flush(self):
        """Sends what the socket takes now. False if the connection has gone."""
        while self.out:
            try:
                n = self.sock.send(self.out)
            except (BlockingIOError, InterruptedError):
                return True
            except OSError:
                return False
            del self.out[:n]
        return True


class WebSocketHost(Host):
    """RFC 6455, as much of it as a browser's serial bridge uses: the handshake, then one binary
    message per write each way."""

    ready = False

    def __init__(self, sock, refuse):
        super().__init__(sock)
        self.refuse = refuse
        self.buf = b""

    def feed(self, data):
        self.buf += data
        if not self.ready:
            if HEADERS_END not in self.buf:
                return b""
            head, self.buf = self.buf.split(HEADERS_END, 1)
            return self._handshake(head)
        stream = b""
        while True:
            frame = self._frame()
            if frame is None:
                return stream
            opcode, payload = frame
            if opcode in (0x1, 0x2):
                stream += payload
            elif opcode == 0x8:
                return None
            elif opcode == 0x9:
                self._queue_frame(0xA, payload)

    def _handshake(self, head):
        headers = {}
        for line in head.decode("latin-1").splitlines()[1:]:
            name, _, value = line.partition(":")
            headers[name.strip().lower()] = value.strip()
        key = headers.get("sec-websocket-key")
        if self.refuse or not key:
            self.out += b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0" + HEADERS_END
            return None
        accept = base64.b64encode(hashlib.sha1(key.encode() + WS_GUID).digest())
        self.out += (b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n"
                     b"Connection: Upgrade\r\nSec-WebSocket-Accept: " + accept + HEADERS_END)
        self.ready = True
        return self.feed(b"")

    def _frame(self):
        if len(self.buf) < 2:
            return None
        opcode, length = self.buf[0] & 0x0F, self.buf[1] & 0x7F
        at = 2
        if length == 126:
            if len(self.buf) < 4:
                return None
            length, at = struct.unpack(">H", self.buf[2:4])[0], 4
        elif length == 127:
            if len(self.buf) < 10:
                return None
            length, at = struct.unpack(">Q", self.buf[2:10])[0], 10
        masked = self.buf[1] & 0x80
        mask = self.buf[at:at + 4] if masked else b""
        at += 4 if masked else 0
        if len(self.buf) < at + length:
            return None
        payload = self.buf[at:at + length]
        self.buf = self.buf[at + length:]
        if masked:
            payload = bytes(c ^ mask[i % 4] for i, c in enumerate(payload))
        return opcode, payload

    def _queue_frame(self, opcode, payload):
        n = len(payload)
        if n < 126:
            head = struct.pack(">BB", 0x80 | opcode, n)
        elif n < 1 << 16:
            head = struct.pack(">BBH", 0x80 | opcode, 126, n)
        else:
            head = struct.pack(">BBQ", 0x80 | opcode, 127, n)
        self.out += head + payload

    def send(self, data):
        if self.ready:
            self._queue_frame(0x2, data)

    def hello(self, boot):
        """Which boot this connection reaches, as text beside the stream's binary messages: how
        the WebUSB shim tells that the blaster rebooted while the page had it closed."""
        self._queue_frame(0x1, json.dumps({"boot": boot}).encode())


class PanelSocket(WebSocketHost):
    """The panel page's connection: the bench's JSON requests, a text message each way. The HTTP
    side has already answered the handshake."""

    ready = True

    def __init__(self, sock):
        super().__init__(sock, refuse=False)

    def messages(self, data):
        """The requests in `data`, or None once the page has closed the socket."""
        self.buf += data
        found = []
        while True:
            frame = self._frame()
            if frame is None:
                return found
            opcode, payload = frame
            if opcode in (0x1, 0x2):
                found.append(payload)
            elif opcode == 0x8:
                return None
            elif opcode == 0x9:
                self._queue_frame(0xA, payload)

    def send(self, data):
        self._queue_frame(0x1, data)


def http_response(status, body=b"", content_type="text/plain; charset=utf-8"):
    return (f"HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {len(body)}\r\n"
            "Cache-Control: no-store\r\nConnection: close\r\n\r\n").encode() + body


class Server:
    def __init__(self, blaster, serial_port, control_port, speed=1.0, ws_port=None, http_port=None):
        self.b = blaster
        self.speed = speed
        self.rebase = False  # the speed changed: measure wall-clock time from now
        self.sel = selectors.DefaultSelector()
        self.serial_listener = self._listen(serial_port)
        self.control_listener = self._listen(control_port)
        self.ws_listener = self._listen(ws_port) if ws_port is not None else None
        self.http_listener = self._listen(http_port) if http_port is not None else None
        self.host = None
        self.pending = {}   # WebSocket connections still shaking hands
        self.draining = {}  # hosts a reboot dropped, still being sent what was queued for them
        self.controls = {}
        self.requests = {}  # HTTP connections, until their request is whole
        self.panels = {}    # panel pages' control WebSockets
        self.sent = len(self.b.transcript)
        self.scanned = self.announced_end = len(self.b.transcript)
        self.boots = self.b.boot_count
        self.enumerated_at = 0.0

    def _listen(self, port):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("127.0.0.1", port))
        s.listen()
        s.setblocking(False)
        self.sel.register(s, selectors.EVENT_READ)
        return s

    @property
    def ports(self):
        return self.serial_listener.getsockname()[1], self.control_listener.getsockname()[1]

    @property
    def ws_port(self):
        return self.ws_listener.getsockname()[1] if self.ws_listener else None

    @property
    def http_port(self):
        return self.http_listener.getsockname()[1] if self.http_listener else None

    def _enumerating(self):
        return time.monotonic() < self.enumerated_at

    def _close(self, sock):
        try:
            self.sel.unregister(sock)
        except (KeyError, ValueError):
            pass
        sock.close()

    def _accept(self, listener):
        conn, _ = listener.accept()
        conn.setblocking(False)
        return conn

    def _watch(self, host, reading):
        """Readable while it is the host, writable while it has bytes queued."""
        events = (selectors.EVENT_READ if reading else 0) | (
            selectors.EVENT_WRITE if host.out else 0)
        self.sel.modify(host.sock, events)

    def _flush_host(self):
        if self.host.flush():
            self._watch(self.host, reading=True)
        else:
            self._drop_host()

    def _drop_host(self, drain=False):
        """Lets go of the host - after sending what it is owed, when a reboot drops it rather than
        the host going away."""
        if not self.host:
            return
        host, self.host = self.host, None
        self.b.host_connected(False)
        if drain and host.flush() and host.out:
            self.draining[host.sock] = host
            self._watch(host, reading=False)
        else:
            self._close(host.sock)

    def _become_host(self, host):
        self._drop_host()
        self.host = host
        self.sent = len(self.b.transcript)
        self.b.host_connected(True)

    def _events(self, timeout):
        for key, mask in self.sel.select(timeout):
            sock = key.fileobj
            if sock is self.serial_listener:
                conn = self._accept(sock)
                if self._enumerating():
                    conn.close()
                    continue
                self.sel.register(conn, selectors.EVENT_READ)
                self._become_host(Host(conn))
            elif sock is self.ws_listener:
                conn = self._accept(sock)
                self.sel.register(conn, selectors.EVENT_READ)
                self.pending[conn] = WebSocketHost(conn, refuse=self._enumerating())
            elif sock is self.control_listener:
                conn = self._accept(sock)
                conn.settimeout(10)  # replies are small, and the bench is waiting on them
                self.sel.register(conn, selectors.EVENT_READ)
                self.controls[conn] = b""
            elif sock is self.http_listener:
                conn = self._accept(sock)
                self.sel.register(conn, selectors.EVENT_READ)
                self.requests[conn] = b""
            elif sock in self.requests:
                self._request(sock)
            elif sock in self.panels:
                data = self._recv(sock)
                found = None if data is None else self.panels[sock].messages(data)
                if found is None:
                    del self.panels[sock]
                    self._close(sock)
                else:
                    self._answer_panel(sock, found)
            elif sock in self.pending:
                self._handshake(sock)
            elif sock in self.draining:
                host = self.draining[sock]
                if not host.flush() or not host.out:
                    del self.draining[sock]
                    self._close(sock)
            elif self.host and sock is self.host.sock:
                if mask & selectors.EVENT_WRITE:
                    self._flush_host()
                if mask & selectors.EVENT_READ and self.host and sock is self.host.sock:
                    self._from_host(sock)
            elif sock in self.controls:
                data = self._recv(sock)
                if data is None:
                    self._close(sock)
                    del self.controls[sock]
                    continue
                self.controls[sock] += data
                while b"\n" in self.controls[sock]:
                    line, self.controls[sock] = self.controls[sock].split(b"\n", 1)
                    sock.sendall((json.dumps(self._control(line)) + "\n").encode())

    def _from_host(self, sock):
        data = self._recv(sock)
        stream = None if data is None else self.host.feed(data)
        if stream is None:
            self._drop_host()
            return
        if stream:
            self.b.send(stream)
        self._flush_host()  # a pong, if the browser pinged

    def _handshake(self, sock):
        ws = self.pending[sock]
        data = self._recv(sock)
        stream = None if data is None else ws.feed(data)
        if stream is None:
            ws.flush()  # the refusal, if there is one
            del self.pending[sock]
            self._close(sock)
        elif ws.ready:
            del self.pending[sock]
            self._become_host(ws)
            ws.hello(self.b.boot_count)
            if stream:
                self.b.send(stream)
            self._flush_host()

    @staticmethod
    def _recv(sock):
        try:
            data = sock.recv(65536)
        except (BlockingIOError, InterruptedError):
            return b""
        except OSError:
            return None
        return data or None

    def _control(self, line):
        try:
            req = json.loads(line)
            if req.get("op") == "speed":
                if not float(req["speed"]) > 0:
                    raise ValueError("speed must be above 0")
                self.speed, self.rebase = float(req["speed"]), True
                return {"ok": True, "speed": self.speed}
            reply = control(self.b, req)
            if req.get("op") == "snapshot":
                reply["speed"] = self.speed
            return {"ok": True, **reply}
        except Exception as e:  # noqa: BLE001 - reported to the client, not fatal to the blaster
            return {"ok": False, "error": str(e)}

    def _request(self, sock):
        """An HTTP request: the panel page, the console, or the panel's control WebSocket."""
        data = self._recv(sock)
        if data is None:
            del self.requests[sock]
            self._close(sock)
            return
        self.requests[sock] += data
        if HEADERS_END not in self.requests[sock]:
            return
        head, rest = self.requests.pop(sock).split(HEADERS_END, 1)
        lines = head.decode("latin-1").splitlines()
        parts = lines[0].split(" ") if lines else []
        path = parts[1] if len(parts) > 1 else "/"
        headers = {name.strip().lower(): value.strip()
                   for name, _, value in (line.partition(":") for line in lines[1:])}
        sock.settimeout(10)
        try:
            key = headers.get("sec-websocket-key")
            if path == "/control" and key:
                accept = base64.b64encode(hashlib.sha1(key.encode() + WS_GUID).digest())
                sock.sendall(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n"
                             b"Connection: Upgrade\r\nSec-WebSocket-Accept: " + accept + HEADERS_END)
                self.panels[sock] = PanelSocket(sock)
                self._answer_panel(sock, self.panels[sock].messages(rest) or [])
                return
            sock.sendall(self._page(path))
        except OSError:
            pass
        self._close(sock)

    def _page(self, path):
        if path in ("/", "/index.html"):
            return http_response("200 OK", PANEL_PAGE.read_bytes(), "text/html; charset=utf-8")
        if path == "/console":
            if not CONSOLE.exists() or self.ws_port is None:
                return http_response("404 Not Found", b"No console to serve: run `npm run build` "
                                     b"in tools/console, and serve with a --ws-port.")
            shim = (f"<script>window.__SIM_SERIAL_URL = 'ws://127.0.0.1:{self.ws_port}';\n"
                    + SHIM.read_text(encoding="utf-8") + "</script>")
            html = CONSOLE.read_text(encoding="utf-8").replace("<head>", "<head>" + shim, 1)
            return http_response("200 OK", html.encode("utf-8"), "text/html; charset=utf-8")
        return http_response("404 Not Found", b"Not here.")

    def _answer_panel(self, sock, requests):
        ws = self.panels.get(sock)
        if ws is None:
            return
        for payload in requests:
            ws.send(json.dumps(self._control(payload)).encode())
        try:
            sock.sendall(bytes(ws.out))
            ws.out.clear()
        except OSError:
            del self.panels[sock]
            self._close(sock)

    def _forward(self):
        text = self.b.transcript
        if self.host and len(text) > self.sent:
            self.host.send(text[self.sent:].encode())
            self._flush_host()
        self.sent = len(text)
        # From a little before the last look: one line can arrive over two.
        ends = [m.end() for m in REBOOT_ANNOUNCED.finditer(text, max(0, self.scanned - 32))]
        self.scanned = len(text)
        announced = bool(ends) and ends[-1] > self.announced_end
        if ends:
            self.announced_end = max(self.announced_end, ends[-1])
        if announced and self.b.boot_count == self.boots and self.b.state == "running":
            self.b.run_until_reboot(ANNOUNCED_REBOOT_MS)  # unpaced: there the moment it says so
        if self.b.boot_count != self.boots:
            self.boots = self.b.boot_count
            self._drop_host(drain=True)  # re-enumeration: the host has to open the port again
            self.enumerated_at = time.monotonic() + ENUMERATION_S / self.speed

    def serve_forever(self, stop=lambda: False):
        start_wall = time.monotonic()
        start_sim = self.b.now_us
        while not stop():
            if self.rebase:
                start_wall, start_sim, self.rebase = time.monotonic(), self.b.now_us, False
            due = start_sim + (time.monotonic() - start_wall) * 1e6 * self.speed
            behind = due - self.b.now_us
            if self.b.state == "running" and behind > 0:
                self.b.run_us(int(min(behind, CATCH_UP_MS * 1000)))
                # Not a moment's sleep while behind: Windows rounds a short select() up to ~15 ms.
                self._events(0)
            else:
                self._events(SLICE_MS / 1000)
            self._forward()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--preset", help="boards/<id>/board.json on flash before power-on")
    parser.add_argument("--display", action="store_true", help="an SSD1306 on the bus")
    parser.add_argument("--port", type=int, default=5333, help="the USB serial (default 5333)")
    parser.add_argument("--control-port", type=int, default=5334, help="the bench (default 5334)")
    parser.add_argument("--ws-port", type=int, default=5335,
                        help="the USB serial as a WebSocket, for a browser (default 5335)")
    parser.add_argument("--http-port", type=int, default=5336,
                        help="the simulator panel and the console beside it (default 5336)")
    parser.add_argument("--device", help="a device.cfg to lay over the preset, as JSON")
    parser.add_argument("--profile", action="append", default=[], metavar="SLOT=JSON",
                        help="a profile file on flash before power-on; repeatable")
    parser.add_argument("--speed", type=float, default=1.0, help="simulated seconds per second")
    parser.add_argument("--instant-escs", action="store_true",
                        help="ESCs that answer from their first frame, not after a real start-up")
    opts = parser.parse_args(argv)

    b = Blaster()
    if not opts.instant_escs:
        b.esc_startup()
    if opts.preset:
        b.flash_preset(opts.preset, json.loads(opts.device) if opts.device else None)
    elif opts.device:
        b.flash_device(json.loads(opts.device))
    for spec in opts.profile:
        slot, _, doc = spec.partition("=")
        b.flash_profile(int(slot), json.loads(doc))
    if opts.display:
        b.attach_display()
    b.power_on()
    server = Server(b, opts.port, opts.control_port, opts.speed, opts.ws_port, opts.http_port)
    serial_port, control_port = server.ports
    print(f"serial on socket://127.0.0.1:{serial_port} and ws://127.0.0.1:{server.ws_port}, "
          f"bench control on {control_port}, panel on http://127.0.0.1:{server.http_port}/",
          flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        b.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
