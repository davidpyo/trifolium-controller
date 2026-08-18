import sys
import time
import serial

def main():
    if len(sys.argv) < 3:
        print("usage: send_serial.py <port> <command> [json-file]")
        print("examples:")
        print("  send_serial.py COM8 DUMP_PROFILE")
        print("  send_serial.py COM8 \"LOAD_PROFILE 1\" edited_profile.json")
        sys.exit(1)

    port = sys.argv[1]
    command = sys.argv[2]
    json_path = sys.argv[3] if len(sys.argv) > 3 else None

    payload = None
    if json_path:
        with open(json_path, "r", encoding="utf-8") as f:
            payload = f.read().strip()

    with serial.Serial(port, 115200, timeout=1) as ser:
        ser.write((command + "\n").encode())
        if payload is not None:
            time.sleep(0.1)  # let the device finish parsing the command line first
            ser.write((payload + "\n").encode())

        end = time.time() + 2
        while time.time() < end:
            line = ser.readline()
            if line:
                print(line.decode(errors="replace"), end="")

if __name__ == "__main__":
    main()
