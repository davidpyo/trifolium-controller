import sys
import time
import serial

# Boot-time lines (the display probe's {"evt":"display"...}, validatePusherAndMotors()'s faults)
# are printed within tens of ms of reset, while the host is still re-enumerating the USB CDC port.
# Opening the port by hand loses that window every time. This reopens it the instant it reappears
# and stays attached across resets, so those lines land in scrollback.

RETRY_S = 0.01  # how hard to hammer the port while it's gone


def watch(port, baud, start):
    with serial.Serial(port, baud, timeout=0.1) as ser:
        ser.dtr = True  # tells the device's CDC a host is listening; stops it overwriting its own
        print(f"[{time.time() - start:7.3f}] --- {port} open ---", flush=True)
        pending = b""
        while True:
            chunk = ser.read(4096)
            if not chunk:
                continue
            pending += chunk
            *lines, pending = pending.split(b"\n")
            for line in lines:
                stamp = time.time() - start
                print(f"[{stamp:7.3f}] {line.decode(errors='replace').rstrip()}", flush=True)


def main():
    if len(sys.argv) < 2:
        print("usage: watch_serial.py <port> [baud]")
        print("  Reopens the port as soon as it appears and prints every line with a timestamp.")
        print("  Leave it running, then reset or reflash the board. Ctrl-C to stop.")
        print("example:")
        print("  watch_serial.py COM8")
        sys.exit(1)

    port = sys.argv[1]
    baud = int(sys.argv[2]) if len(sys.argv) > 2 else 115200
    start = time.time()
    print(f"watching {port} at {baud} - reset the board now, Ctrl-C to stop", flush=True)

    while True:
        try:
            watch(port, baud, start)
        except KeyboardInterrupt:
            print("\nstopped")
            return
        except serial.SerialException:
            # Port vanished (reset/reflash) or isn't there yet - wait for it to come back.
            time.sleep(RETRY_S)
        except OSError:
            time.sleep(RETRY_S)


if __name__ == "__main__":
    main()
