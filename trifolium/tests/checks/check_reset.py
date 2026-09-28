"""factoryResetSettings() must preserve exactly the fields the OLED menu cannot set.

    python tests/checks/check_reset.py
    python tests/checks/check_reset.py --self-test   # check the checker

The rule, and why it is worth a checker rather than a comment: a reset reachable from the menu must
never produce a state only a host can undo. If it clears a field with no OLED row, the user cannot
put it back from the device - and for `menuButtonPin` or `menuButtonNormallyClosed` that costs them
the menu itself, so they cannot even reach the reset again.

Stated as a set equation, which is what this file checks:

    preserved == (persisted fields with no menu item at all)
               U (fields whose menu item is off-device)

Both sides are grepped out of the source, because nothing ties them together at compile time - the
same premise as check_keys.py. A field that gains an OLED row must drop off the preserved list, and
a new off-device field must join it; either drift fails here.

Deliberately mechanical. It does not ask whether a field "is hardware" - that question produced a
different answer every time it was asked. It asks only whether the menu can undo the reset.
"""

import argparse
import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "src")

# Item classes that are off-device by construction - each calls setOffDevice() in its constructor.
# AdcPinItem is a PinItem subclass and BoardIdItem calls it directly; neither inherits its way onto
# this list, because the declaration is matched on the spelled class name.
OFF_DEVICE_CLASSES = ("PinItem", "AdcPinItem", "PolarityItem", "BoardIdItem")

# Not a setting. toJson() writes the version stamp alongside the fields, and a reset must emit the
# current one rather than carrying the old one forward.
NEVER_PRESERVE = {"schemaVersion"}

# Fields whose struct name and stored key differ. Empty since MOH-16 removed boardIndex, which was
# the only one: DeviceSettings held an ordinal while device.cfg carried the board's id string. Kept
# because the next such field would otherwise report a permanent false failure with no hint why.
FIELD_ALIASES = {}


def read(*names):
    out = {}
    for name in names:
        path = os.path.join(SRC, name)
        if os.path.exists(path):
            out[name] = open(path, encoding="utf-8").read()
    return out


def strip_comments(text):
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"//[^\n]*", "", text)


def persisted_fields(store_src):
    """Device fields that reach flash: whatever toJson() writes.

    Two spellings, because an array is not written with `=`. `doc["escPins"].to<JsonArray>()` is
    every bit as persisted as `doc["hasDisplay"] = ...`, and missing it meant the wiring array this
    check exists to protect was not being checked at all.
    """
    src = strip_comments(store_src)
    scalars = set(re.findall(r'doc\["(\w+)"\]\s*=', src))
    arrays = set(re.findall(r'doc\["(\w+)"\]\s*\.\s*to\s*<', src))
    return scalars | arrays


def declarations(menu_src):
    """(class, variable, key) for every menu item declared with a device key.

    The template argument list is optional and dropped: NumericItem<uint32_t> declares an item like
    any other, and without this the variable is never bound to its key - so a later
    `<name>.setOffDevice()` on it attaches to nothing and the field reads as OLED-settable. That is
    a false FAIL on a correct reset, and it stays invisible until the first templated off-device
    item exists.
    """
    pattern = re.compile(
        r"\b(\w+)(?:\s*<[^<>]*>)?\s+(\w+)\s*\(\s*\"[^\"]*\"\s*,\s*\"device:([\w\[\]\.]+)\"", re.S)
    return pattern.findall(strip_comments(menu_src))


def menu_keys(menu_src):
    """Every device field any menu item edits, whether or not it has an OLED row."""
    keys = set()
    for key in re.findall(r'"device:([\w\[\]\.]+)"', strip_comments(menu_src)):
        # motorConfig[0].kp and friends: the stored field is the array, not the leaf.
        keys.add(re.split(r"[\[\.]", key)[0])
    return keys


def off_device_keys(menu_src):
    """Fields whose menu item exists but has no OLED row.

    Two ways an item gets there, and both are read rather than assumed: a class whose constructor
    calls setOffDevice(), or an explicit `<name>.setOffDevice()` somewhere in the file.
    """
    src = strip_comments(menu_src)
    keys = set()
    by_variable = {}
    for cls, variable, key in declarations(src):
        field = re.split(r"[\[\.]", key)[0]
        by_variable[variable] = field
        if cls in OFF_DEVICE_CLASSES:
            keys.add(field)
    for variable in re.findall(r"\b(\w+)\s*\.\s*setOffDevice\s*\(", src):
        if variable in by_variable:
            keys.add(by_variable[variable])
    return keys


def preserved_fields(store_src):
    """Fields factoryResetSettings() copies back off the live settings."""
    src = strip_comments(store_src)
    m = re.search(r"DeviceSettings factoryResetSettings\(\)\s*\{", src)
    if not m:
        return None
    depth, i = 0, m.end() - 1
    while True:
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                break
        i += 1
    body = src[m.end():i]
    found = re.findall(r"\bs\.(\w+)\s*=\s*deviceSettings\.\1\b", body)
    # An array is preserved element by element in a loop, which the scalar pattern cannot see:
    # `s.escPins[i] = deviceSettings.escPins[i]`. Without this the wiring array reads as wiped.
    found += re.findall(r"\bs\.(\w+)\s*\[[^\]]*\]\s*=\s*deviceSettings\.\1\s*\[", body)
    return {FIELD_ALIASES.get(f, f) for f in found}


def expected(persisted, menu, off_device):
    """The set the reset must carry: no menu item at all, or an item with no OLED row."""
    return ((persisted - menu) | (off_device & persisted)) - NEVER_PRESERVE


def compare(preserved, want):
    """(missing, extra) - fields that should be preserved and are not, and the reverse."""
    if preserved is None:
        return None, None
    return sorted(want - preserved), sorted(preserved - want)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--self-test", action="store_true", help="check this script's own logic")
    opts = parser.parse_args()
    if opts.self_test:
        self_test()

    store = read("deviceStore.cpp").get("deviceStore.cpp")
    if not store:
        sys.exit("cannot read src/deviceStore.cpp")
    menu = "\n".join(open(p, encoding="utf-8").read()
                     for p in sorted(glob.glob(os.path.join(SRC, "menu*.cpp"))
                                     + glob.glob(os.path.join(SRC, "menu*.h"))))

    persisted = persisted_fields(store)
    menu = menu  # noqa: PLW0127 - named for the print below
    exposed = menu_keys(menu)
    off_device = off_device_keys(menu)
    preserved = preserved_fields(store)

    want = expected(persisted, exposed, off_device)
    missing, extra = compare(preserved, want)
    if missing is None:
        sys.exit("could not find factoryResetSettings() in deviceStore.cpp")

    # Intersected with `persisted` on purpose: `exposed` also holds keys for rows that edit runtime
    # state rather than a stored field, and counting those made the line disagree with the set
    # equation below it.
    print(f"{len(persisted)} persisted device field(s); {len(persisted & exposed)} reachable from "
          f"a menu item, {len(off_device & persisted)} of those with no OLED row")
    print(f"factory reset must preserve {len(want)}, and preserves {len(preserved)}")

    for field in missing:
        why = "no menu item" if field not in exposed else "menu item has no OLED row"
        print(f"  [FAIL] {field} is wiped but cannot be set from the menu ({why})"
              " - a reset would need a host to undo")
    for field in extra:
        print(f"  [FAIL] {field} is preserved but the menu can set it"
              " - a reset should clear it")
    if not missing and not extra:
        print("  [OK] the reset clears exactly what the menu can set")

    print("\n" + ("FAILED" if (missing or extra) else "OK")
          + f" - {len(missing) + len(extra)} problem(s)")
    sys.exit(1 if (missing or extra) else 0)


# -------------------------------------------------------------------------------------------


def self_test():
    ok = True

    def expect(label, condition, detail=""):
        nonlocal ok
        if not condition:
            ok = False
        print(f"  [{'PASS' if condition else 'FAIL'}] {label}" + (f" - {detail}" if detail else ""))

    store = """
    void toJson(const DeviceSettings& settings, JsonDocument& doc)
    {
        doc["boardId"] = settings.boardId;
        doc["hasDisplay"] = settings.hasDisplay;
        doc["menuButtonPin"] = settings.menuButtonPin;
        doc["menuButtonNormallyClosed"] = settings.menuButtonNormallyClosed;
        doc["dshotMode"] = settings.dshotMode;
        doc["displayBrightness"] = settings.displayBrightness;
        doc["rpmLogLength"] = settings.rpmLogLength;
        doc["batteryAdcPin"] = settings.batteryAdcPin;
        JsonArray escPins = doc["escPins"].to<JsonArray>();
    }
    DeviceSettings factoryResetSettings()
    {
        DeviceSettings s = defaultDeviceSettings();
        s.boardId = deviceSettings.boardId;
        s.hasDisplay = deviceSettings.hasDisplay;
        s.menuButtonPin = deviceSettings.menuButtonPin;
        s.menuButtonNormallyClosed = deviceSettings.menuButtonNormallyClosed;
        s.dshotMode = deviceSettings.dshotMode;
        s.rpmLogLength = deviceSettings.rpmLogLength;
        s.batteryAdcPin = deviceSettings.batteryAdcPin;
        for (uint8_t i = 0; i < 4; i++)
            s.escPins[i] = deviceSettings.escPins[i];
        return s;
    }
    """
    menu = """
    static BoardIdItem boardIdItem("Preset", "device:boardId", &deviceSettings.boardId);
    static AdcPinItem batteryAdcPinItem("Battery ADC Pin", "device:batteryAdcPin",
                                        &deviceSettings.batteryAdcPin);
    static PinItem esc1PinItem("ESC 1 Pin", "device:escPins[0]", &deviceSettings.escPins[0]);
    static PinItem menuButtonPinItem("Menu Button Pin", "device:menuButtonPin",
                                     &deviceSettings.menuButtonPin);
    static PolarityItem menuButtonPolarityItem("Menu Button Normally Closed",
                                               "device:menuButtonNormallyClosed",
                                               &deviceSettings.menuButtonNormallyClosed);
    static ToggleItem hasDisplayItem("Display Attached", "device:hasDisplay",
                                     &deviceSettings.hasDisplay, true);
    static NumericItem<uint8_t> brightnessItem("Brightness", "device:displayBrightness",
                                               &deviceSettings.displayBrightness, 0, 255, 5);
    static NumericItem<uint32_t> rpmLogLengthItem("Capture Samples", "device:rpmLogLength",
                                                  &deviceSettings.rpmLogLength, 100, 2000, 100);
    struct Init { Init() { hasDisplayItem.setOffDevice(); rpmLogLengthItem.setOffDevice(); } } init;
    """

    persisted = persisted_fields(store)
    expect("toJson gives the persisted set", "menuButtonPin" in persisted and
           "displayBrightness" in persisted, str(sorted(persisted)))
    # An array is persisted without an `=`. Missing it meant the wiring array went unchecked, which
    # is the one field group a reset losing would leave a device only a host could arm.
    expect("an array written with .to<JsonArray>() counts as persisted",
           "escPins" in persisted, str(sorted(persisted)))

    exposed = menu_keys(menu)
    expect("every menu-bound field is seen", {"boardId", "menuButtonPin", "hasDisplay",
                                              "displayBrightness"} <= exposed, str(sorted(exposed)))

    off = off_device_keys(menu)
    expect("a PinItem is off-device by its class", "menuButtonPin" in off)
    expect("a PolarityItem is off-device by its class", "menuButtonNormallyClosed" in off)
    expect("a BoardIdItem is off-device by its class", "boardId" in off)
    # A subclass is not resolved, only the spelled class name - so AdcPinItem has to be listed
    # even though every PinItem already is, and a new subclass that is not will fail here.
    expect("an AdcPinItem is off-device by its class", "batteryAdcPin" in off)
    expect("a pin declared with an array subscript is seen by its array name",
           "escPins" in off, str(sorted(off)))
    expect("an explicit setOffDevice() call is honoured", "hasDisplay" in off, str(sorted(off)))
    expect("so is one on a templated item class", "rpmLogLength" in off, str(sorted(off)))
    expect("an ordinary menu item is not off-device", "displayBrightness" not in off)

    preserved = preserved_fields(store)
    expect("the preserved set is read out of the body",
           preserved == {"boardId", "hasDisplay", "menuButtonPin", "menuButtonNormallyClosed",
                         "dshotMode", "rpmLogLength", "batteryAdcPin", "escPins"},
           str(sorted(preserved or [])))
    expect("an element-by-element loop counts as preserving the array",
           "escPins" in (preserved or set()))
    expect("an assignment from something other than deviceSettings is not counted",
           "board" not in (preserved or set()))

    # Both sides are in stored-key spelling, which is what makes them comparable at all.
    want = expected(persisted, exposed, off)
    expect("the expected set is the two groups unioned",
           want == {"boardId", "hasDisplay", "menuButtonPin", "menuButtonNormallyClosed",
                    "dshotMode", "rpmLogLength", "batteryAdcPin", "escPins"}, str(sorted(want)))
    expect("a field with an ordinary OLED row is not expected",
           "displayBrightness" not in want)
    expect("a field with no menu item at all is expected", "dshotMode" in want)

    # --- the comparator itself ---
    full = {"a", "b", "c"}
    expect("an exact match reports nothing", compare({"a", "b", "c"}, full) == ([], []))
    expect("a field that should be preserved and is not is caught - the lockout case",
           compare({"a", "b"}, full) == (["c"], []))
    expect("a field preserved that the menu can set is caught",
           compare({"a", "b", "c", "d"}, full) == ([], ["d"]))
    expect("both directions are reported at once",
           compare({"a", "b", "d"}, full) == (["c"], ["d"]))
    expect("an unreadable function is not silently a pass", compare(None, full) == (None, None))

    # Dropping the polarity preservation must fail, since that is the bug this exists to prevent.
    broken = store.replace("        s.menuButtonNormallyClosed = deviceSettings."
                           "menuButtonNormallyClosed;\n", "")
    missing, _ = compare(preserved_fields(broken), want)
    expect("removing the polarity line is caught", missing == ["menuButtonNormallyClosed"],
           str(missing))

    # The MOH-16 equivalent: a reset that dropped the ESC pins would leave a blaster that cannot
    # spin a motor, with no OLED row anywhere to put them back.
    no_esc = store.replace("        for (uint8_t i = 0; i < 4; i++)\n"
                           "            s.escPins[i] = deviceSettings.escPins[i];\n", "")
    missing, _ = compare(preserved_fields(no_esc), want)
    expect("removing the ESC pin loop is caught", missing == ["escPins"], str(missing))

    print("\nself-test " + ("passed" if ok else "FAILED"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
