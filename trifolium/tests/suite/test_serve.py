"""The wall-clock server, spoken to the way a tool speaks to a real blaster: pyserial on its serial
port, JSON lines on its bench port."""

import json
import socket
import subprocess
import sys
import time

import pytest

serial = pytest.importorskip("serial")

from helpers import SIM  # noqa: E402

from trifolium_sim import preset  # noqa: E402

# A build on 3S with 6000 Kv motors of six pole pairs, unlike the simulator's stock 3200 Kv on 4S.
THREE_CELL = {"batteryType": "3s", "motorConfig": [{"motorKv": 6000, "motorPolesDiv2": 6}] * 4}


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def serve(*args):
    ports = free_port(), free_port()
    proc = subprocess.Popen([sys.executable, "-m", "trifolium_sim.serve", "--display", "--instant-escs",
                             "--port", str(ports[0]), "--control-port", str(ports[1]),
                             "--ws-port", str(free_port()), *args],
                            cwd=str(SIM), stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    assert b"serial on socket://" in proc.stdout.readline()
    return proc, ports


@pytest.fixture
def served():
    proc, ports = serve()
    yield ports
    proc.terminate()
    proc.wait(timeout=10)


@pytest.fixture
def capturing():
    proc, ports = serve("--preset", "trifolium_v1_2", "--device", json.dumps({"useRpmLogging": True}))
    yield ports
    proc.terminate()
    proc.wait(timeout=10)


def reply(ser, name, window=6.0):
    deadline = time.time() + window
    while time.time() < deadline:
        line = ser.readline().decode(errors="replace").strip()
        if line.startswith("{") and f'"cmd":"{name}"' in line:
            return json.loads(line)
    return None


def open_serial(port, window=10.0):
    deadline = time.time() + window
    while True:
        try:
            return serial.serial_for_url(f"socket://127.0.0.1:{port}", timeout=0.5)
        except serial.SerialException:
            if time.time() > deadline:
                raise
            time.sleep(0.2)


def run_for(control_port, ms):
    """Waits out `ms` of the blaster's own time, which a busy machine stretches."""
    until = bench(control_port, op="state")["uptime_ms"] + ms
    while bench(control_port, op="state")["uptime_ms"] < until:
        time.sleep(0.05)


def wait_armed(control_port, timeout_s=30):
    """Past setup(), then the 2.5 s of ESC arming after it - a rev before that is ignored."""
    deadline = time.time() + timeout_s
    while not bench(control_port, op="peek", names=["booted"])["values"]["booted"]:
        assert time.time() < deadline, "the blaster never finished booting"
        time.sleep(0.1)
    run_for(control_port, 2500)


def bench(port, **req):
    with socket.create_connection(("127.0.0.1", port), timeout=10) as s:
        s.sendall((json.dumps(req) + "\n").encode())
        return json.loads(s.makefile().readline())


def until(probe, timeout_s=10):
    deadline = time.time() + timeout_s
    while True:
        got = probe()
        if got or time.time() > deadline:
            return got
        time.sleep(0.1)


def motors(control_port):
    """Each simulated wheel's motor, as (Kv, pole pairs)."""
    return [(w["kv"], w["polePairs"]) for w in bench(control_port, op="wheels")["wheels"]]


def test_the_served_blaster_has_the_motors_and_the_pack_its_config_describes():
    """The panel is the blaster as configured: its own motors on a charged pack of its own battery
    type, not the simulator's stock 3200 Kv motors on 4S."""
    proc, (_, control_port) = serve("--preset", "trifolium_v1_2", "--device", json.dumps(THREE_CELL))
    try:
        assert motors(control_port) == [(6000, 6)] * 4
        assert bench(control_port, op="snapshot")["packMv"] == 3 * 4100
    finally:
        proc.terminate()
        proc.wait(timeout=10)


def test_a_config_that_changes_the_motors_and_battery_changes_them_at_its_reboot(served):
    serial_port, control_port = served  # unwired: the stock motors, on 4S
    assert motors(control_port) == [(3200, 7)] * 4
    assert bench(control_port, op="snapshot")["packMv"] == 4 * 4100
    boots = bench(control_port, op="state")["boots"]

    ser = open_serial(serial_port)
    ser.write(("LOAD_DEVICE\n" + json.dumps(preset("trifolium_v1_2", THREE_CELL)) + "\n").encode())
    assert reply(ser, "LOAD_DEVICE")["rebooting"] is True
    ser.close()
    assert until(lambda: bench(control_port, op="state")["boots"] > boots)
    assert until(lambda: motors(control_port) == [(6000, 6)] * 4)
    assert bench(control_port, op="snapshot")["packMv"] == 3 * 4100


def test_a_tool_on_the_serial_port_loads_a_preset_and_finds_the_board_armed_after_the_reboot(served):
    serial_port, control_port = served
    ser = open_serial(serial_port)
    ser.write(b"DUMP_BOOT\n")
    assert reply(ser, "DUMP_BOOT")["wiring"]["configured"] is False

    ser.write(("LOAD_DEVICE\n" + json.dumps(preset("trifolium_v1_2")) + "\n").encode())
    assert reply(ser, "LOAD_DEVICE")["rebooting"] is True
    # The reboot drops the connection, as re-enumeration drops the COM port.
    with pytest.raises(serial.SerialException):
        for _ in range(40):
            ser.write(b"DUMP_BOOT\n")
            time.sleep(0.1)
            ser.read(4096)
    ser.close()

    time.sleep(3)  # the ESC arm loop comes before the device answers again
    ser = open_serial(serial_port)
    ser.write(b"DUMP_BOOT\n")
    boot = reply(ser, "DUMP_BOOT")
    assert boot["wiring"] == {"boardId": "trifolium_v1_2", "configured": True}
    ser.close()

    # And the bench port does what a person would.
    assert bench(control_port, op="press", role="rev")["ok"]
    run_for(control_port, 1000)
    wheels = bench(control_port, op="wheels")["wheels"]
    assert wheels[1]["rpm"] > 25000
    assert "BINARY" in bench(control_port, op="panel")["text"]


def read_until(sock, marker, window):
    got = b""
    deadline = time.time() + window
    while marker not in got and time.time() < deadline:
        try:
            chunk = sock.recv(4096)
        except socket.timeout:
            continue
        if not chunk:
            break
        got += chunk
    return got


def test_an_announced_reboot_has_happened_by_the_time_the_host_reads_the_announcement(served):
    """A blaster is off the bus 100 ms after acking a reboot, before any host retries. Paced to the
    wall clock on a busy machine, the simulator can still be running the old boot then.

    A plain socket: slowed down, the ack arrives in pieces, which pyserial's readline gives up on."""
    serial_port, control_port = served
    with socket.create_connection(("127.0.0.1", serial_port), timeout=1) as host:
        host.sendall(b"DUMP_BOOT\n")
        assert b'"cmd":"DUMP_BOOT"' in read_until(host, b'"cmd":"DUMP_BOOT"', 10)
        boots = bench(control_port, op="state")["boots"]
        assert bench(control_port, op="speed", speed=0.1)["ok"]  # ack to reboot, paced: ~1 s
        host.sendall(("LOAD_DEVICE\n" + json.dumps(preset("trifolium_v1_2")) + "\n").encode())
        assert b'"rebooting":true' in read_until(host, b'"rebooting":true', 30)
        assert bench(control_port, op="state")["boots"] == boots + 1


def test_a_host_slow_to_read_still_gets_a_whole_capture_dump(capturing):
    """What the host is sent is queued for it, as its USB driver would, so a slow reader loses
    nothing and holds nothing up. A plain socket, read to EOF: pyserial drops the bytes of a read the
    disconnect interrupts."""
    serial_port, control_port = capturing
    wait_armed(control_port)
    host = socket.socket()
    host.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4096)  # before connect, to set the window
    host.settimeout(20)
    host.connect(("127.0.0.1", serial_port))
    bench(control_port, op="press", role="rev")
    run_for(control_port, 1500)
    bench(control_port, op="release", role="rev")
    # Not reading while the dump goes out - and the bench still answers, since nothing waits on the
    # host.
    slowest, until = 0.0, time.time() + 3
    while time.time() < until:
        asked = time.time()
        bench(control_port, op="state")
        slowest = max(slowest, time.time() - asked)
    assert slowest < 1.0

    received = b""
    try:
        while chunk := host.recv(65536):  # until the reboot after the dump drops the host
            received += chunk
    except TimeoutError:
        pytest.fail(f"{len(received)} bytes, then 20 s of nothing: {bench(control_port, op='state')}")
    host.close()
    rows = [line for line in received.decode(errors="replace").splitlines()
            if line[:1].isdigit() and line.count(",") >= 8]
    assert len(rows) == bench(control_port, op="wiring")["settings"]["rpmLogLength"]
