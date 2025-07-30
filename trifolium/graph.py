import serial
import matplotlib.pyplot as plt
import matplotlib.animation as animation
import sys

# === CONFIG ===
PORT = 'COM12'          # Update to your serial port
BAUD = 115200
MAX_POINTS = 1000       # Number of points to display
SERIAL_TIMEOUT = 0.01  # Small timeout for fast non-blocking read

# === SETUP SERIAL ===
try:
    ser = serial.Serial(PORT, BAUD, timeout=SERIAL_TIMEOUT)
    print(f"Connected to {PORT} at {BAUD} baud.")
except serial.SerialException as e:
    print(f"Could not open port {PORT}: {e}")
    sys.exit(1)

data_buffers = []
num_series = 0

fig, ax = plt.subplots()
lines = []
colors = ['b', 'g', 'r', 'c', 'm', 'y', 'k']

ax.set_xlim(0, MAX_POINTS)
ax.grid(True)
ax.set_title("Live Serial Plot")
ax.set_xlabel("Samples")
ax.set_ylabel("Values")

def init():
    return lines

def update(frame):
    global num_series

    try:
        line = ser.readline().decode('utf-8').strip()
        if not line:
            return lines

        parts = line.split(',')
        values = [float(p.strip()) for p in parts if p.strip() != '']

        # Setup buffers and lines if series count changed
        if num_series != len(values):
            num_series = len(values)
            data_buffers.clear()
            lines.clear()
            ax.clear()
            ax.set_xlim(0, MAX_POINTS)
            ax.grid(True)
            ax.set_title("Live Serial Plot")
            ax.set_xlabel("Samples")
            ax.set_ylabel("Values")

            for i in range(num_series):
                data_buffers.append([0] * MAX_POINTS)
                color = colors[i % len(colors)]
                line_obj, = ax.plot(range(MAX_POINTS), data_buffers[i], label=f'Series {i}', color=color)
                lines.append(line_obj)
            ax.legend()

        for i, val in enumerate(values):
            data_buffers[i].append(val)
            if len(data_buffers[i]) > MAX_POINTS:
                data_buffers[i].pop(0)
            lines[i].set_ydata(data_buffers[i])

        # Recalculate limits dynamically
        all_data = [item for sublist in data_buffers for item in sublist]
        if all_data:
            ymin = min(all_data)
            ymax = max(all_data)
            margin = (ymax - ymin) * 0.1 if ymax > ymin else 1
            ax.set_ylim(ymin - margin, ymax + margin)

    except Exception as e:
        # You can comment this out if it's too noisy
        # print(f"Error reading serial: {e}")
        pass

    return lines

ani = animation.FuncAnimation(fig, update, init_func=init, interval=10, blit=True)
plt.tight_layout()
plt.show()
