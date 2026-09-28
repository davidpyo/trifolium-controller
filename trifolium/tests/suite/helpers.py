"""What several suites set up the same way."""

import json
import re

import pytest

from trifolium_sim import PROJECT

TESTS = PROJECT / "tests"
SIM = TESTS / "sim"
SUITE = TESTS / "suite"


def armed_v12(b, overrides=None, display=True, settle_ms=2500):
    """A v1.2 on a charged pack, booted and past ESC arming: every ESC answers, then 1.5 s of zero
    throttle."""
    b.flash_preset("trifolium_v1_2", overrides)
    if display:
        b.attach_display()
    assert b.boot(settle_ms)
    return b


def open_menu(b):
    b.hold("menu", b.wiring()["menuButtonHoldTime_ms"] + 100)
    assert b.peek("menuOpen"), b.panel().text


def close_menu(b):
    """A long press backs out one level, so as many as it takes."""
    for _ in range(6):
        b.hold("menu", b.wiring()["menuButtonHoldTime_ms"] + 100)
        if not b.peek("menuOpen"):
            break
    b.run_ms(500)
    assert not b.peek("menuOpen"), b.panel().text


def label(row):
    """A menu row without its value or arrow: "Idle Mode: OFF" is "Idle Mode"."""
    return re.sub(r"(:.*| >)$", "", row.strip())


def select(b, name):
    """Steps down the list with rev until the highlighted row is `name`."""
    for _ in range(40):
        if label(b.panel().highlighted) == name:
            return
        b.tap("rev")
    pytest.fail(f"no row {name!r} in:\n{b.panel().text}")


def enter(b, *path):
    """Opens each submenu in `path` in turn, from wherever the menu is."""
    for name in path:
        select(b, name)
        b.tap("menu")


def rows(b):
    """Every row of the open list, by label, in order - stepped through once with rev."""
    seen = []
    for _ in range(60):
        row = label(b.panel().highlighted)
        if row in seen:
            break
        seen.append(row)
        b.tap("rev")
    first = seen.index(label(b.panel().highlighted))
    return seen[first:] + seen[:first]


def schema(b):
    """DUMP_SCHEMA, and the capture left at .pio/native/schema.json for checks/check_schema.py."""
    raw = b.command("DUMP_SCHEMA", timeout_ms=5000, parse=False)
    assert raw, "no DUMP_SCHEMA reply"
    out = PROJECT / ".pio" / "native"
    out.mkdir(parents=True, exist_ok=True)
    (out / "schema.json").write_text(raw, encoding="utf-8")
    return json.loads(raw)


def keyed_nodes(tree):
    """Every schema node with a key, by that key."""
    nodes = {}

    def walk(node):
        if node.get("key"):
            nodes.setdefault(node["key"], node)
        for child in node.get("children", []):
            walk(child)

    for node in tree:
        walk(node)
    return nodes


def flatten(value, path="", out=None):
    """{"motorConfig[1].kp": 0.2, ...} for every leaf."""
    out = {} if out is None else out
    if isinstance(value, dict):
        for key, v in value.items():
            flatten(v, f"{path}.{key}" if path else key, out)
    elif isinstance(value, list):
        for i, v in enumerate(value):
            flatten(v, f"{path}[{i}]", out)
    else:
        out[path] = value
    return out


def same(a, b):
    """Equal, with numbers compared to float precision - the stores hold floats."""
    if isinstance(a, bool) or isinstance(b, bool):
        return a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(a - b) <= 1e-6 * max(1.0, abs(a))
    return a == b


def differences(got, want, where):
    """Where `got` fails to hold what `want` names. Floats to the precision a stored float keeps."""
    if isinstance(want, dict):
        got = got if isinstance(got, dict) else {}
        return [d for k, v in want.items() for d in differences(got.get(k), v, f"{where}.{k}")]
    if isinstance(want, list):
        if not isinstance(got, list) or len(got) != len(want):
            return [f"{where}: {got!r}, the file says {want!r}"]
        return [d for i, (g, w) in enumerate(zip(got, want)) for d in differences(g, w, f"{where}[{i}]")]
    if isinstance(want, float):
        close = isinstance(got, (int, float)) and abs(got - want) <= 1e-4 * max(1.0, abs(want))
        return [] if close else [f"{where}: {got!r}, the file says {want!r}"]
    return [] if got == want else [f"{where}: {got!r}, the file says {want!r}"]
