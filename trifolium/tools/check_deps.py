"""Checks that every build dependency is pinned, and that what is installed matches the pin.

    python tools/check_deps.py              # parse platformio.ini, then ask PlatformIO what resolved
    python tools/check_deps.py --offline    # the static half only; no pio call, no network
    python tools/check_deps.py --self-test  # check the checker; needs neither

Why this exists rather than "the build succeeded": a floating dependency that happens to resolve to
the right commit today is indistinguishable from a pinned one by any build. The failure it hides is
a build that changes with nothing in this repo having changed, which is the failure a release
artifact can least afford.

Two separate properties, and the first is the load-bearing one:

1. **Every spec in platformio.ini names an exact commit or version.** A bare git URL tracks a
   branch, and a caret range (`@^7`) is a range however narrow it looks.
2. **What PlatformIO actually resolved matches what was asked for.** `pio pkg list` prints both, so
   this compares them rather than guessing at directory names under ~/.platformio.

`platform` counts, and is the most consequential line in the file: that repo's platform.json names
framework-arduinopico by SHA, so pinning the platform pins the Arduino-Pico core the whole build
sits on. The toolchain and uploader packages are pinned by the platform rather than by us - they are
reported as informational, since changing them means vendoring the platform, not editing this file.
"""

import argparse
import os
import re
import subprocess
import sys

TOOLS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS)
INI = os.path.join(ROOT, "platformio.ini")

SHA_RE = re.compile(r"^[0-9a-f]{40}$")
# A version this accepts as exact. Anything with ^ ~ > < * or a space is a range.
EXACT_VERSION_RE = re.compile(r"^[0-9][0-9A-Za-z.+-]*$")


# -------------------------------------------------------------------------------------------
# parsing platformio.ini


def ini_sections(text):
    """A minimal section/key reader. configparser would do, but PlatformIO allows `;` comment
    lines inside a multi-line value and treats `${env.x}` as literal, so the rules here are
    PlatformIO's rather than configparser's."""
    sections = {}
    section = None
    key = None
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line.strip() or line.lstrip().startswith(";"):
            continue
        if line.lstrip().startswith("[") and line.strip().endswith("]"):
            section = line.strip()[1:-1]
            sections[section] = {}
            key = None
            continue
        if section is None:
            continue
        if line[0].isspace() and key is not None:
            sections[section][key] += "\n" + line.strip()
            continue
        if "=" in line:
            key, _, value = line.partition("=")
            key = key.strip()
            sections[section][key] = value.strip()
    return sections


def value_entries(value):
    """Splits a multi-line option into entries, dropping the comment lines PlatformIO allows."""
    out = []
    for line in (value or "").splitlines():
        line = line.strip()
        if line and not line.startswith(";"):
            out.append(line)
    return out


def parse_spec(entry):
    """One dependency spec, classified. `pin` is None when the spec floats, which is the whole
    question this file exists to answer."""
    entry = entry.strip()
    if entry.startswith(("http://", "https://", "git+", "git@")):
        url, _, frag = entry.partition("#")
        url = url[len("git+"):] if url.startswith("git+") else url
        pin = frag if SHA_RE.match(frag) else None
        return {"kind": "git", "name": url, "pin": pin, "raw": entry,
                "why": None if pin else ("tracks a branch - no commit" if not frag
                                         else f"'{frag}' is not a 40-character commit sha")}
    name, sep, version = entry.rpartition("@")
    if not sep:
        return {"kind": "registry", "name": entry, "pin": None, "raw": entry,
                "why": "no version - takes whatever the registry serves"}
    name, version = name.strip(), version.strip()
    if EXACT_VERSION_RE.match(version):
        return {"kind": "registry", "name": name, "pin": version, "raw": entry, "why": None}
    return {"kind": "registry", "name": name, "pin": None, "raw": entry,
            "why": f"'{version}' is a range, not a version"}


def wanted_specs(text):
    """Every dependency platformio.ini controls, across all sections, deduplicated by raw spec.

    Reads every section rather than one env on purpose: a `[env:release]` that quietly added a
    dependency of its own is exactly the drift a released artifact must not carry.
    """
    specs = []
    seen = set()
    for section, opts in ini_sections(text).items():
        for key in ("platform", "lib_deps", "platform_packages"):
            for entry in value_entries(opts.get(key)):
                spec = parse_spec(entry)
                if spec["raw"] in seen:
                    continue
                seen.add(spec["raw"])
                spec["section"] = section
                spec["option"] = key
                specs.append(spec)
    return specs


def unpinned(specs):
    return [s for s in specs if s["pin"] is None]


def env_names(text):
    """Every `[env:NAME]` section, in file order."""
    return [s[len("env:"):] for s in ini_sections(text) if s.startswith("env:")]


def env_specs(text, env):
    """The specs one environment builds with: its own section plus the `[env]` it inherits from.
    An env's own option replaces the inherited one, as PlatformIO does."""
    sections = ini_sections(text)
    specs = []
    for key in ("platform", "lib_deps", "platform_packages"):
        value = sections.get(f"env:{env}", {}).get(key)
        if value is None:
            value = sections.get("env", {}).get(key)
        for entry in value_entries(value):
            spec = parse_spec(entry)
            spec["section"] = f"env:{env}"
            spec["option"] = key
            specs.append(spec)
    return specs


def pin_conflicts(text):
    """(name, {env: pin}) for every dependency two environments pin differently. They build the
    same library, so a bump that reached one and not the other is drift the host tests would hide."""
    pins = {}
    for env in env_names(text):
        for spec in env_specs(text, env):
            if spec["pin"]:
                pins.setdefault(spec["name"], {})[env] = spec["pin"]
    return [(name, by_env) for name, by_env in sorted(pins.items())
            if len(set(by_env.values())) > 1]


# -------------------------------------------------------------------------------------------
# what PlatformIO actually resolved


PKG_LINE_RE = re.compile(
    "^[\\s|`+\\\\\\-─│├└]*(?:Platform\\s+)?"
    r"(?P<name>.+?)\s+@\s+(?P<resolved>\S+)\s+\(required:\s+(?P<req>.+)\)\s*$")


def parse_pkg_list(text):
    """Records from `pio pkg list`. Each line carries both what was asked for and what landed,
    which is the pair this file compares - the resolved version is the only evidence a pin took."""
    out = []
    for line in text.splitlines():
        m = PKG_LINE_RE.match(line)
        if m:
            out.append({"name": m.group("name").strip(),
                        "resolved": m.group("resolved").strip(),
                        "required": m.group("req").strip()})
    return out


def normalise_required(required):
    """`pio pkg list` prints a git spec as `git+<url>#<sha>` and a registry one as
    `owner/name @ version`. Reduce both to the form parse_spec() produced."""
    req = required.strip()
    if req.startswith("git+"):
        return req[len("git+"):]
    return re.sub(r"\s*@\s*", "@", req)


# A git install's resolved version carries the commit as `sha.<short>`, but the separator before
# it varies: a library with a version reports `1.0.2+sha.b46f543`, while one without gets a
# synthesised `0.0.0+<timestamp>.sha.7ad92e1`. rp2040-passthrough is the second kind.
RESOLVED_SHA_RE = re.compile(r"[.+]sha\.([0-9a-f]+)")


def resolved_matches(spec, record):
    """True when the installed package is the commit or version the spec asked for.

    The short sha is abbreviated to a length PlatformIO chooses, so the comparison is a prefix test
    against the requested sha - not equality, and not a substring search, which `in` would make
    pass for a sha appearing anywhere in the string.
    """
    resolved = record["resolved"]
    if spec["kind"] == "git":
        m = RESOLVED_SHA_RE.search(resolved)
        if not m:
            return False
        return spec["pin"].startswith(m.group(1))
    return resolved == spec["pin"]


def match_record(spec, records):
    """The `pio pkg list` line for this spec, found by the spec it says it required."""
    target = normalise_required(spec["raw"])
    for record in records:
        if normalise_required(record["required"]) == target:
            return record
    return None


def drift(specs, records):
    """(spec, record-or-None, reason) for every spec that did not land as written."""
    out = []
    for spec in specs:
        if spec["pin"] is None:
            continue  # unpinned() already owns this one; nothing to compare against
        record = match_record(spec, records)
        if record is None:
            out.append((spec, None, "nothing installed reports this as its requirement"))
        elif not resolved_matches(spec, record):
            out.append((spec, record, f"installed {record['resolved']}, asked for {spec['pin']}"))
    return out


def platform_owned(records, specs):
    """Packages the platform pins on our behalf. Informational: changing one means moving the
    platform pin, so listing them as failures would be reporting a decision as a defect."""
    ours = {normalise_required(s["raw"]) for s in specs}
    return [r for r in records if normalise_required(r["required"]) not in ours]


# -------------------------------------------------------------------------------------------


def find_pio():
    exe = "pio.exe" if os.name == "nt" else "pio"
    candidate = os.path.join(os.path.expanduser("~"), ".platformio", "penv",
                             "Scripts" if os.name == "nt" else "bin", exe)
    return candidate if os.path.isfile(candidate) else "pio"


def pkg_list(env):
    # PYTHONIOENCODING, because pio draws its dependency tree with box characters and dies on a
    # UnicodeEncodeError the moment its stdout is a pipe on a cp1252 console.
    env_vars = dict(os.environ, PYTHONIOENCODING="utf-8")
    proc = subprocess.run([find_pio(), "pkg", "list", "-e", env], cwd=ROOT, capture_output=True,
                          text=True, encoding="utf-8", errors="replace", env=env_vars)
    if proc.returncode != 0:
        return None, (proc.stderr or proc.stdout).strip()
    return proc.stdout, None


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--env", default=None,
                        help="resolve one environment only (default: every [env:*] in the file)")
    parser.add_argument("--offline", action="store_true",
                        help="only check platformio.ini is pinned; do not call pio")
    parser.add_argument("--self-test", action="store_true",
                        help="check this script's own logic; needs no PlatformIO")
    opts = parser.parse_args()

    if opts.self_test:
        self_test()

    with open(INI, encoding="utf-8") as f:
        text = f.read()
    specs = wanted_specs(text)

    failures = 0
    print(f"platformio.ini: {len(specs)} dependency spec(s)")
    floating = unpinned(specs)
    for spec in specs:
        mark = "PIN " if spec["pin"] else "FLOAT"
        detail = spec["pin"] or spec["why"]
        print(f"  [{mark}] {spec['option']}: {spec['name']}  -> {detail}")
    if floating:
        failures += len(floating)
        print(f"\n{len(floating)} dependency/dependencies float. A build is not reproducible while "
              "any of them does.")

    for name, by_env in pin_conflicts(text):
        failures += 1
        print(f"\n  [SPLIT] {name} is pinned differently per env: "
              + ", ".join(f"{env} {pin}" for env, pin in sorted(by_env.items())))

    if opts.offline:
        return done(failures)

    for env in [opts.env] if opts.env else env_names(text):
        out, err = pkg_list(env)
        if out is None:
            print(f"\ncould not resolve packages for env '{env}': {err}")
            print("re-run with --offline for the static check alone")
            return done(failures or 1)

        wanted = env_specs(text, env)
        records = parse_pkg_list(out)
        print(f"\nresolved for env '{env}': {len(records)} package(s)")
        problems = drift(wanted, records)
        for spec, record, reason in problems:
            print(f"  [DRIFT] {spec['name']}: {reason}")
        failures += len(problems)
        if not problems:
            pinned = [s for s in wanted if s["pin"]]
            print(f"  [OK] all {len(pinned)} pinned spec(s) resolved to the commit/version asked for")

        owned = platform_owned(records, wanted)
        if owned:
            print(f"  pinned by the platform, not by us ({len(owned)}) - moving one means moving "
                  "the platform pin:")
            for record in owned:
                print(f"    - {record['name']} @ {record['resolved']}")

    return done(failures)


def done(failures):
    print("\n" + ("FAILED" if failures else "OK") + f" - {failures} problem(s)")
    sys.exit(1 if failures else 0)


# -------------------------------------------------------------------------------------------
# self-test: every comparator gets a case where the wrong answer must be caught


def self_test():
    ok = True

    def expect(label, condition, detail=""):
        nonlocal ok
        if not condition:
            ok = False
        print(f"  [{'PASS' if condition else 'FAIL'}] {label}" + (f" - {detail}" if detail else ""))

    sha = "9c167c6b8aac4f4cfa6d55a0c4e5b848795150c0"

    # --- a spec is pinned, or it is not ---
    expect("a git url with a 40-char sha is pinned",
           parse_spec(f"https://github.com/x/y.git#{sha}")["pin"] == sha)
    expect("a bare git url is caught",
           parse_spec("https://github.com/x/y.git")["pin"] is None)
    expect("a branch name is not a pin - the case a `#` alone would let through",
           parse_spec("https://github.com/x/y.git#develop")["pin"] is None)
    expect("a short sha is not a pin",
           parse_spec("https://github.com/x/y.git#9c167c6")["pin"] is None)
    expect("an exact registry version is pinned",
           parse_spec("adafruit/Adafruit BusIO@1.17.4")["pin"] == "1.17.4")
    expect("a caret range is caught - the one that already looked constrained",
           parse_spec("https://github.com/bblanchon/ArduinoJson@^7")["pin"] is None)
    expect("a tilde range is caught", parse_spec("owner/lib@~1.2.0")["pin"] is None)
    expect("a comparison range is caught", parse_spec("owner/lib@>=1.2.0")["pin"] is None)
    expect("a wildcard is caught", parse_spec("owner/lib@1.*")["pin"] is None)
    expect("a bare registry name is caught", parse_spec("owner/lib")["pin"] is None)
    expect("a library name containing @ keeps its version",
           parse_spec("owner/lib@2.0.0")["name"] == "owner/lib")

    # --- reading the ini, including the things that trip a naive parser ---
    ini = (
        "[env]\n"
        f"platform = https://github.com/m/p.git#{sha}\n"
        "build_flags = -Wswitch\n"
        "lib_deps =\n"
        f"    https://github.com/a/b.git#{'b' * 40}\n"
        "    ; a comment line inside the value, which PlatformIO allows\n"
        "\n"
        "    adafruit/Adafruit BusIO@1.17.4\n"
        "\n"
        "[env:release]\n"
        "build_flags = ${env.build_flags} -D TRIFOLIUM_RELEASE_BUILD\n"
    )
    specs = wanted_specs(ini)
    names = sorted(s["name"] for s in specs)
    expect("every spec is read, comments and blank lines are not", len(specs) == 3, str(names))
    expect("the platform is one of them",
           "https://github.com/m/p.git" in names, str(names))
    expect("a `;` line inside lib_deps is not read as a dependency",
           not any("comment" in n for n in names))
    expect("an interpolated build flag does not become a dependency",
           not any("$" in n for n in names))
    expect("this fixture is fully pinned", unpinned(specs) == [])

    floaty = ini.replace(f"#{'b' * 40}", "")
    expect("dropping one sha is caught", len(unpinned(wanted_specs(floaty))) == 1)

    # A dependency added to one env only. Reading a single section would miss it entirely.
    extra = ini + f"lib_deps = https://github.com/sneaky/extra.git#{'c' * 40}\n"
    expect("a dependency added to [env:release] alone is still seen",
           len(wanted_specs(extra)) == 4)

    # --- resolved vs required ---
    sample = (
        "Resolving pico dependencies...\n"
        f"Platform raspberrypi @ 1.20.0+sha.9c167c6 (required: git+https://github.com/m/p.git#{sha})\n"
        "├── framework-arduinopico @ 1.60000.0+sha.9a0bc356 (required: "
        "git+https://github.com/e/a.git#9a0bc35654e9af3eccfb88c54f9cc73f9e153ac6)\n"
        "\n"
        "Libraries\n"
        "├── Adafruit BusIO @ 1.17.4 (required: adafruit/Adafruit BusIO @ 1.17.4)\n"
        f"└── b @ 1.0.2+sha.bbbbbbb (required: git+https://github.com/a/b.git#{'b' * 40})\n"
    )
    records = parse_pkg_list(sample)
    expect("every package line is read, the header lines are not", len(records) == 4,
           str([r["name"] for r in records]))
    expect("the platform line loses its 'Platform ' prefix",
           records[0]["name"] == "raspberrypi", records[0]["name"])
    expect("a tree-drawing prefix is stripped",
           records[2]["name"] == "Adafruit BusIO", records[2]["name"])

    plat = parse_spec(f"https://github.com/m/p.git#{sha}")
    expect("the platform spec finds its own line", match_record(plat, records) is records[0])
    expect("a matched git pin passes", resolved_matches(plat, records[0]))
    expect("a git install that landed on another commit is caught",
           not resolved_matches(plat, {"resolved": "1.20.0+sha.deadbee"}))
    expect("a git dep with no sha in its resolved version is caught, not assumed",
           not resolved_matches(plat, {"resolved": "1.20.0"}))
    expect("a truncated sha is compared as a prefix, not a substring",
           not resolved_matches(plat, {"resolved": "1.20.0+sha.c167c6b"}))
    # A versionless library gets a synthesised version, which puts a timestamp between the `+` and
    # the sha. Splitting on "+sha." alone read that as "no sha" and failed a correctly pinned dep.
    pt = parse_spec("https://github.com/d/rp.git#7ad92e12c2f7edac4a187017ee46119b3940974e")
    expect("a versionless library's timestamped version still yields its sha",
           resolved_matches(pt, {"resolved": "0.0.0+20260913194352.sha.7ad92e1"}))
    expect("a versionless library on the wrong commit is still caught",
           not resolved_matches(pt, {"resolved": "0.0.0+20260913194352.sha.9999999"}))

    busio = parse_spec("adafruit/Adafruit BusIO@1.17.4")
    expect("a registry pin that landed passes", resolved_matches(busio, records[2]))
    expect("a registry dep at another version is caught",
           not resolved_matches(busio, {"resolved": "1.17.5"}))
    expect("a registry match is exact, not a prefix",
           not resolved_matches(busio, {"resolved": "1.17.40"}))
    expect("spacing around @ does not stop a registry spec matching its line",
           match_record(busio, records) is records[2])

    ini_specs = wanted_specs(ini)
    expect("a fully-resolved set reports no drift", drift(ini_specs, records) == [],
           str(drift(ini_specs, records)))

    moved = [dict(r) for r in records]
    moved[3]["resolved"] = "1.0.2+sha.9999999"
    expect("a library that moved off its pin is caught", len(drift(ini_specs, moved)) == 1)
    expect("a pinned dep that is not installed at all is caught",
           len(drift(ini_specs, records[:3])) == 1)

    expect("packages the platform pins are reported apart from ours",
           [r["name"] for r in platform_owned(records, ini_specs)] == ["framework-arduinopico"])

    # --- two environments, each resolved against its own specs ---
    two = (
        "[env:pico]\n"
        f"platform = https://github.com/m/p.git#{sha}\n"
        "lib_deps =\n"
        f"    https://github.com/a/b.git#{'b' * 40}\n"
        "    adafruit/Adafruit BusIO@1.17.4\n"
        "[env:native]\n"
        "platform = platformio/native@1.2.1\n"
        "lib_deps =\n"
        f"    https://github.com/a/b.git#{'b' * 40}\n"
        "    doctest/doctest@2.4.12\n"
    )
    expect("both environments are found", env_names(two) == ["pico", "native"], str(env_names(two)))
    native = [s["name"] for s in env_specs(two, "native")]
    expect("an env's specs are its own and not the other env's",
           "doctest/doctest" in native and "adafruit/Adafruit BusIO" not in native, str(native))
    expect("a dependency only the other env builds is not drift for this one",
           drift(env_specs(two, "pico"), records) == [], str(drift(env_specs(two, "pico"), records)))
    expect("a library pinned alike in both envs is not a split", pin_conflicts(two) == [])
    split = two.replace(f"#{'b' * 40}\n    doctest", f"#{'c' * 40}\n    doctest")
    expect("a pin bumped in one env and not the other is caught", len(pin_conflicts(split)) == 1,
           str(pin_conflicts(split)))
    inherited = ("[env]\nlib_deps = owner/lib@1.0.0\n"
                 "[env:a]\nboard = x\n"
                 "[env:b]\nlib_deps = owner/lib@2.0.0\n")
    expect("an env with no lib_deps of its own inherits [env]'s",
           [s["pin"] for s in env_specs(inherited, "a")] == ["1.0.0"])
    expect("an env that sets lib_deps replaces [env]'s",
           [s["pin"] for s in env_specs(inherited, "b")] == ["2.0.0"])
    expect("an inherited pin and an overriding one count as a split",
           len(pin_conflicts(inherited)) == 1)

    # --- against the repo's own platformio.ini ---
    if os.path.exists(INI):
        with open(INI, encoding="utf-8") as f:
            real_text = f.read()
        real = wanted_specs(real_text)
        expect("the real platformio.ini parses", len(real) >= 6, f"{len(real)} specs")
        expect("the real platformio.ini is fully pinned",
               unpinned(real) == [], str([s["raw"] for s in unpinned(real)]))
        expect("the platform is among the pinned specs",
               any(s["option"] == "platform" and s["pin"] for s in real))
        expect("every library the envs share carries one pin",
               pin_conflicts(real_text) == [], str(pin_conflicts(real_text)))

    print("\nself-test " + ("passed" if ok else "FAILED"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
