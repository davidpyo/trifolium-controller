import os
import subprocess

import pytest

from trifolium_sim import PROJECT, Blaster


def find_pio():
    exe = "pio.exe" if os.name == "nt" else "pio"
    candidate = os.path.join(os.path.expanduser("~"), ".platformio", "penv",
                             "Scripts" if os.name == "nt" else "bin", exe)
    return candidate if os.path.isfile(candidate) else "pio"


def pytest_addoption(parser):
    parser.addoption("--no-build", action="store_true",
                     help="use trifolium-sim as built, without `pio run -e sim` first")


def pytest_configure(config):
    # Once, and on the controller: parallel workers must not all run the build at the same time.
    if hasattr(config, "workerinput") or config.getoption("--no-build"):
        return
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    result = subprocess.run([find_pio(), "run", "-e", "sim"], cwd=PROJECT, capture_output=True,
                            text=True, encoding="utf-8", errors="replace", env=env)
    if result.returncode != 0:
        raise pytest.UsageError("`pio run -e sim` failed - is a host gcc or clang on PATH?\n"
                                + (result.stdout + result.stderr)[-3000:])


@pytest.fixture
def make_blaster():
    """Blasters made in a test, closed after it however it ends."""
    made = []

    def make():
        b = Blaster()
        made.append(b)
        return b

    yield make
    for b in made:
        b.close()


@pytest.fixture
def blaster(make_blaster):
    return make_blaster()
