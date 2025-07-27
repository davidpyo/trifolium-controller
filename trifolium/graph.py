# === Required Libraries ===
# Install with:
#   pip install pyserial matplotlib

import serial             # For reading from the serial port
import matplotlib.pyplot as plt  # For plotting
import matplotlib.animation as animation  # For live updates
import sys                # For exiting on error

# === CONFIG ===
PORT = 'COM8'          # <-- Change to your actual COM port (e.g., 'COM4', 'COM7', etc.)
BAUD = 115200          # Match this with your Arduino's Serial.begin()
MAX_POINTS = 2000       # Number of points to show on the graph (rolling window)

# === SETUP SERIAL ===
try:
    ser = serial.Serial(PORT, BAUD, timeout=1)
    print(f"Connected to {PORT} at {BAUD} baud.")
except serial.SerialException as e:
    print(f"Could not open port {PORT}: {e}")
    sys.exit(1)

# === DATA BUFFERS ===
data_buffers = []  # 2D list of data per series
num_series = 0     # Tracks how many data series we’re plotting

# === SETUP PLOT ===
fig, ax = plt.subplots()
lines = []  # List of matplotlib line objects
colors = ['b', 'g', 'r', 'c', 'm', 'y', 'k']  # Color rotation for different series

def init():
    ax.set_title("Live Serial Plot")
    ax.set_xlabel("Samples")
    ax.set_ylabel("Values")
    ax.grid(True)
    return lines

def update(frame):
    global num_series

    try:
        line = ser.readline().decode('utf-8').strip()
        if not line:
            return lines

        parts = line.split(',')
        values = [float(p.strip()) for p in parts if p.strip() != '']

        # Reconfigure plot if number of series has changed
        if num_series != len(values):
            num_series = len(values)
            data_buffers.clear()
            for _ in range(num_series):
                data_buffers.append([0] * MAX_POINTS)

            ax.clear()
            ax.set_title("Live Serial Plot")
            ax.set_xlabel("Samples")
            ax.set_ylabel("Values")
            ax.grid(True)

            lines.clear()
            for i in range(num_series):
                color = colors[i % len(colors)]
                line_obj, = ax.plot(data_buffers[i], label=f'Series {i}', color=color)
                lines.append(line_obj)
            ax.legend()

        for i, val in enumerate(values):
            data_buffers[i].append(val)
            if len(data_buffers[i]) > MAX_POINTS:
                data_buffers[i].pop(0)
            lines[i].set_ydata(data_buffers[i])
            lines[i].set_xdata(range(len(data_buffers[i])))

        ax.relim()
        ax.autoscale_view()

    except Exception as e:
        print(f"Error reading serial: {e}")

    return lines

ani = animation.FuncAnimation(fig, update, init_func=init, interval=1, blit=False)
plt.tight_layout()
plt.show()
