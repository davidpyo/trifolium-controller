"""Send one command to the blaster and print what comes back.

    send_serial.py COM8 DUMP_PROFILE
    send_serial.py COM8 DUMP_SCHEMA -o schema.json
    send_serial.py COM8 "LOAD_PROFILE 1" edited_profile.json
    send_serial.py COM8 LOAD_DEVICE boards/trifolium_v1_2/board.json

The last of those is the documented way to wire a board with no console, so this has to be reliable
rather than merely convenient.
"""

import sys
import time
import serial

# The CDC endpoint accepts a connection a moment before it will carry one, and a command written
# into that gap is swallowed with no error at either end: the tool prints nothing and the device
# never saw it. Every other tool here settles after opening; this one did not, which only started
# to matter when loading a preset became the way a board gets wired.
SETTLE_S = 0.4

# A reply is one line of JSON carrying "cmd". LOAD_* writes to LittleFS - which parks both cores -
# before it acks, so it gets a wider window than a plain read.
WINDOW_S = {"DUMP_SCHEMA": 15.0, "LOAD_": 8.0}
DEFAULT_WINDOW_S = 3.0


def window_for(command):
    for prefix, seconds in WINDOW_S.items():
        if command.startswith(prefix):
            return seconds
    return DEFAULT_WINDOW_S


def send_once(ser, command, payload, window_s, out_path):
    """Writes the command and prints replies until the window closes. True if anything answered."""
    ser.reset_input_buffer()
    ser.write((command + "\n").encode())
    if payload is not None:
        time.sleep(0.1)  # let the device finish parsing the command line first
        ser.write((payload + "\n").encode())

    answered = False
    end = time.time() + window_s
    while time.time() < end:
        line = ser.readline()
        if not line:
            continue
        text = line.decode(errors="replace")
        # A JSON reply is written to the output file rather than the terminal - a schema dump is
        # too big to read as scrollback, and a file is what the schema checkers consume.
        if out_path and text.lstrip().startswith("{"):
            with open(out_path, "w", encoding="utf-8") as f:
                f.write(text)
            print(f"wrote {len(text)} bytes to {out_path}")
            return True
        print(text, end="")
        answered = True
        # An unconfigured device repeats an `evt` line until a host speaks, so "something arrived"
        # is not the same as "the command was answered". Stop on the reply, not on the noise.
        if f'"cmd":"{command.split()[0]}"' in text.replace(" ", ""):
            return True
    return answered


def no_reply(command, port, window_s):
    print()
    print(f"no reply to {command} within {window_s:.0f}s.")
    print(f"  - is something else holding {port}? the web console keeps it for as long as it is")
    print("    connected, and Web Serial hands a port to exactly one page")
    print("  - is the device mid-boot? a configured boot arms the ESCs before it answers")
    print("  - is it reachable at all? `picotool info` reports a device even when the COM port")
    print("    is held open by something else")


def main():
    if len(sys.argv) < 3:
        print("usage: send_serial.py <port> <command> [json-file] [-o out.json]")
        print("examples:")
        print("  send_serial.py COM8 DUMP_PROFILE")
        print("  send_serial.py COM8 DUMP_SCHEMA -o schema.json")
        print("  send_serial.py COM8 \"LOAD_PROFILE 1\" edited_profile.json")
        print("  send_serial.py COM8 LOAD_DEVICE boards/trifolium_v1_2/board.json")
        sys.exit(1)

    args = sys.argv[1:]
    out_path = None
    if "-o" in args:
        i = args.index("-o")
        out_path = args[i + 1]
        del args[i:i + 2]

    port = args[0]
    command = args[1]
    json_path = args[2] if len(args) > 2 else None

    payload = None
    if json_path:
        with open(json_path, "r", encoding="utf-8") as f:
            payload = f.read().strip()

    window_s = window_for(command)

    # write_timeout matters as much as the read one: a device that has stopped reading its
    # input blocks the host's write forever, which looks like the tool hanging rather than
    # like the device having died. Fail instead, and say which end went quiet.
    with serial.Serial(port, 115200, timeout=1, write_timeout=5) as ser:
        time.sleep(SETTLE_S)
        # Retried once, because the one failure this tool used to report as silence is the one it
        # can recover from by itself. A command the device never saw changed nothing, so sending it
        # again is safe - and for LOAD_* it is safe anyway, since loading the same config twice is
        # the same config.
        try:
            if send_once(ser, command, payload, window_s, out_path):
                return
        except serial.SerialTimeoutException:
            print(file=sys.stderr)
            print(f"{port} accepted the connection but will not take the write: the device has "
                  "stopped reading its serial input.", file=sys.stderr)
            print("That is the device, not this tool - it is hung or has faulted. Power-cycle it "
                  "and try a read first.", file=sys.stderr)
            sys.exit(1)
        print(f"(no reply in {window_s:.0f}s - retrying once)", file=sys.stderr)
        if not send_once(ser, command, payload, window_s, out_path):
            no_reply(command, port, window_s)
            sys.exit(1)


if __name__ == "__main__":
    main()
