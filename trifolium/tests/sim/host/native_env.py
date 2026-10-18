"""Points [env:sim] at the Arduino API the firmware really runs on, and at the fake board.

String, Print and Stream come from arduino-pico's own ArduinoCore-API, compiled for the host, so a
value formats the way it does on the device. Everything board-specific is a fake in tests/sim/host/hal.
The framework package is the one [env:pico] installs, pinned through the platform line.
"""

import os

Import("env")  # noqa: F821 - provided by SCons

hal = os.path.join(env.subst("$PROJECT_DIR"), "tests", "sim", "host", "hal")
framework = os.path.join(env.subst("$PROJECT_PACKAGES_DIR"), "framework-arduinopico")
api = os.path.join(framework, "ArduinoCore-API")
noniso = os.path.join(framework, "cores", "rp2040", "stdlib_noniso.cpp")

if not os.path.isfile(os.path.join(api, "api", "String.cpp")) or not os.path.isfile(noniso):
    import sys

    sys.stderr.write(
        "\n[env:sim] needs arduino-pico's ArduinoCore-API, which [env:pico] installs:\n"
        "    pio pkg install -e pico\n"
        f"(looked in {framework})\n\n"
    )
    env.Exit(1)

# The fakes first, so <Arduino.h> is always this directory's.
env.Prepend(
    CPPPATH=[
        hal,
        api,
        os.path.join(api, "api", "deprecated"),
        os.path.join(api, "api", "deprecated-avr-comp"),
    ]
)
env.Append(CPPDEFINES=[("HAL_STDLIB_NONISO_CPP", env.StringifyMacro(noniso.replace("\\", "/")))])
env.Replace(PROGNAME="trifolium-sim")

# hal_heap.cpp counts the firmware's heap at the allocator.
env.Append(CCFLAGS=["-include", os.path.join(hal, "heap_count.h")])

# The MinGW runtime linked in, so trifolium-sim runs from any shell - not only one with that
# toolchain on PATH, where another program's libstdc++ would be picked up instead.
if os.name == "nt":
    env.Append(LINKFLAGS=["-static"])
