"""Every declarative `visibleWhen` must say the same thing as the predicate beside it.

    python tests/checks/check_visibility.py
    python tests/checks/check_visibility.py --self-test   # check the checker

Why a checker rather than one source of truth: the device decides visibility with a C++ predicate,
and the console needs the same rule as data so it can re-evaluate while the user edits instead of
waiting for the next DUMP_SCHEMA. Evaluating the descriptor on-device instead would need a
key-to-value resolver the firmware does not have, which would become a second place that knows
field names - exactly the drift check_keys.py exists to police. So the rule is stated twice and
this file proves the two agree, the same premise as check_keys.py and check_reset.py.

What it checks:

  1. For every `setVisibleWhen(pred, &cond)`, the parsed body of `pred` equals the terms of `cond`.
  2. For every class that calls `setVisibleWhenData(&cond)` in its constructor, the body of that
     class's `isVisible()` override equals the terms of `cond`.
  3. Every term names a key the menu tree actually declares, so a typo fails here rather than
     silently disabling a rule in the console. Checked against the source rather than the
     checked-in schema capture: a capture can only ever lag the source it came from, and a field
     added since the last bench run would otherwise read as a typo.
  4. Advisory: a predicate that reads only stored settings but carries no condition. That is a rule
     the console cannot see, which is the drift this whole mechanism exists to remove.

Rules that read a resolved pin or a board property carry no condition on purpose - the console must
not re-evaluate those, because they are reboot-gated and the pin they read is the post-conflict one.
Those are reported as intentionally absent, not as failures.
"""

import argparse
import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "src")
FIXTURE = os.path.join(ROOT, "tools", "console", "src", "fixtures", "schema.json")

# Which id array spells the stored values for which C++ enum. Hand-written because nothing in the
# source ties an enum type to its id array by name - enumIds.h only guarantees the two are the same
# length, and only for the few that carry a COUNT sentinel. Kept to the enums visibility rules
# actually compare against; a member count mismatch fails loudly below rather than mapping wrongly.
ENUM_PAIRS = {
    "flywheelControlType_t": "kFlywheelControlIds",
    "selectFireType_t": "kSelectFireTypeIds",
    "pusherType_t": "kPusherTypeIds",
    "pusherDrive_t": "kPusherDriveIds",
    "rpmModeType_t": "kRpmModeIds",
}

# Reads a value that is not a stored setting, so it is deliberately undescribed. The reason is
# carried here rather than inferred, so adding one is a decision somebody wrote down.
NOT_DESCRIBABLE = {
    "pinDefined": "reads a resolved pin, which is post-conflict and reboot-gated",
    "board.": "reads a board property, which only changes across a reboot",
    "editingFireMode": "per-mode, already published as fireModeCaps in the schema header",
    "activeModeCount": "already published in the schema header",
    "requiredMode_": "per-instance, resolved by the constructor rather than stated in the body",
}

STORE_PREFIX = {"deviceSettings": "device", "activeProfile": "profile"}


def read_sources():
    out = {}
    for path in sorted(glob.glob(os.path.join(SRC, "menu*.cpp")) +
                       glob.glob(os.path.join(SRC, "menu*.h"))):
        out[os.path.basename(path)] = open(path, encoding="utf-8").read()
    return out


def strip_comments(text):
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"//[^\n]*", "", text)


def enum_constants():
    """C++ enum member name -> the id a config file stores for it.

    Zips each enum's members, in declaration order, against its id array. A COUNT sentinel is
    dropped first: it is a length marker, not a value anything stores.
    """
    types_src = strip_comments(open(os.path.join(SRC, "types.h"), encoding="utf-8").read())
    ids_src = strip_comments(open(os.path.join(SRC, "enumIds.h"), encoding="utf-8").read())

    arrays = {}
    for name, body in re.findall(r"inline const char\* const (\w+)\[\]\s*=\s*\{(.*?)\};",
                                 ids_src, re.S):
        arrays[name] = re.findall(r'"([^"]*)"', body)

    # A pin field stores a number rather than an id, so "is a pin wired" spells itself as a
    # comparison against PIN_NOT_USED. Read from types.h rather than written as 255 here, so the
    # rule and the firmware cannot drift apart silently.
    constants, problems = {}, []
    m = re.search(r"#define\s+PIN_NOT_USED\s+(\d+)", types_src)
    if m:
        constants["PIN_NOT_USED"] = m.group(1)
    else:
        problems.append("PIN_NOT_USED is not defined in types.h")

    for enum_name, id_array in ENUM_PAIRS.items():
        # The base type is optional: most of these enums declare none, and the two that do are
        # spelled `enum name_t : uint8_t`.
        m = re.search(r"enum\s+" + enum_name + r"\s*(?::\s*\w+\s*)?\{(.*?)\}", types_src, re.S)
        if not m:
            problems.append(f"{enum_name} is not declared in types.h")
            continue
        members = [x.split("=")[0].strip() for x in m.group(1).split(",") if x.strip()]
        members = [x for x in members if not x.endswith("_COUNT")]
        ids = arrays.get(id_array)
        if ids is None:
            problems.append(f"{id_array} is not declared in enumIds.h")
            continue
        if len(members) != len(ids):
            problems.append(
                f"{enum_name} has {len(members)} member(s) but {id_array} has {len(ids)}")
            continue
        for member, stored in zip(members, ids):
            constants[member] = stored
    return constants, problems


def parse_conditions(sources):
    """kName -> [(key, value, negate), ...], read from the VisibilityTerm/Condition declarations."""
    term_arrays, conditions = {}, {}
    for text in sources.values():
        src = strip_comments(text)
        for name, body in re.findall(
                r"constexpr VisibilityTerm (\w+)\[\]\s*=\s*\{(.*?)\};", src, re.S):
            term_arrays[name] = [
                (key, value, flag == "true")
                for key, value, flag in re.findall(
                    r'\{\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*(true|false)\s*\}', body)
            ]
        for name, array, count in re.findall(
                r"constexpr VisibilityCondition (\w+)\s*=\s*\{\s*(\w+)\s*,\s*(\d+)\s*\}", src):
            terms = term_arrays.get(array, [])
            conditions[name] = {"terms": terms, "array": array, "declared": int(count)}
    return conditions


def parse_expression(expr, constants):
    """A predicate body as terms, or (None, reason) when it reads something undescribable."""
    expr = expr.strip().rstrip(";").strip()
    for marker, reason in NOT_DESCRIBABLE.items():
        if marker in expr:
            return None, reason

    terms = []
    for operand in expr.split("&&"):
        operand = operand.strip().strip("()").strip()
        negate = False
        if operand.startswith("!"):
            negate, operand = True, operand[1:].strip()

        m = re.match(r"^(\w+)\.(\w+)\s*(==|!=)\s*(\w+)$", operand)
        if m:
            store, field, op, const = m.groups()
            if store not in STORE_PREFIX:
                return None, f"reads {store}, which is not a stored settings struct"
            stored = constants.get(const)
            if stored is None:
                return None, f"no stored id known for {const}"
            terms.append((f"{STORE_PREFIX[store]}:{field}", stored, (op == "!=") != negate))
            continue

        m = re.match(r"^(\w+)\.(\w+)$", operand)
        if m:
            store, field = m.groups()
            if store not in STORE_PREFIX:
                return None, f"reads {store}, which is not a stored settings struct"
            terms.append((f"{STORE_PREFIX[store]}:{field}", "true", negate))
            continue

        return None, f"cannot read the condition in `{operand}`"
    return terms, None


def parse_predicates(sources, constants):
    """Free-function predicate name -> (terms, reason, file)."""
    out = {}
    for name, text in sources.items():
        src = strip_comments(text)
        for pred, body in re.findall(r"\bstatic bool (\w+)\(\)\s*\{\s*return\s+(.*?);\s*\}",
                                     src, re.S):
            terms, reason = parse_expression(body, constants)
            out[pred] = (terms, reason, name)
    return out


def parse_class_rules(sources, constants):
    """Classes that set a condition in their constructor, paired with their isVisible() body."""
    out = []
    for name, text in sources.items():
        src = strip_comments(text)
        for m in re.finditer(r"\bclass\s+(\w+)\s*:\s*public\s+\w+\s*\{", src):
            start = m.end() - 1
            depth, i = 0, start
            while i < len(src):
                if src[i] == "{":
                    depth += 1
                elif src[i] == "}":
                    depth -= 1
                    if depth == 0:
                        break
                i += 1
            body = src[start:i]
            # All of them, not the first: a class may pick between conditions with a ternary, which
            # is how a per-instance rule states both of the answers it can give.
            call = re.search(r"setVisibleWhenData\((.*?)\);", body, re.S)
            if not call:
                continue
            names = re.findall(r"&(\w+)", call.group(1))
            if not names:
                continue
            vis = re.search(r"bool isVisible\(\) const override\s*\{\s*return\s+(.*?);\s*\}",
                            body, re.S)
            if not vis:
                out.append((m.group(1), names, None, "has no isVisible() override", name))
                continue
            terms, reason = parse_expression(vis.group(1), constants)
            out.append((m.group(1), names, terms, reason, name))
    return out


def parse_bindings(sources):
    """(item, predicate, condition, file) for each two-argument setVisibleWhen call."""
    out = []
    for name, text in sources.items():
        src = strip_comments(text)
        for item, pred, cond in re.findall(
                r"(\w+)\.setVisibleWhen\(\s*(\w+)\s*,\s*&(\w+)\s*\)", src):
            out.append((item, pred, cond, name))
        for item, pred in re.findall(r"(\w+)\.setVisibleWhen\(\s*(\w+)\s*\)", src):
            out.append((item, pred, None, name))
    return out


def declared_keys(sources):
    """Keys the menu tree declares, which is what DUMP_SCHEMA will publish.

    The rules themselves are cut out first. A term's own key is a string literal like any other, so
    harvesting the whole file would let a typo vouch for itself and the check would pass on nothing.
    Everything else is taken as-is rather than matched against a declaration pattern, because some
    items are declared through a macro (BOOT_ACTION_ITEM) and would otherwise look undeclared.
    """
    keys = set()
    for text in sources.values():
        src = re.sub(r"constexpr VisibilityTerm \w+\[\]\s*=\s*\{.*?\};", "",
                     strip_comments(text), flags=re.S)
        for store, key in re.findall(r'"(device|profile):([^"]*)"', src):
            # Per-motor items paste their keys together ("device:motorConfig[" #N "].kp"), so the
            # source holds fragments; the whole key is declared by the items that spell it out.
            if key.endswith("["):
                continue
            keys.add(f"{store}:{key}")
    return keys


def schema_keys():
    """Keys the checked-in schema capture carries - a second opinion, and one that can be stale."""
    if not os.path.exists(FIXTURE):
        return None
    import json
    raw = json.load(open(FIXTURE, encoding="utf-8"))
    keys = set()

    def walk(nodes):
        for node in nodes:
            if node.get("key"):
                keys.add(node["key"])
            walk(node.get("children") or [])

    walk(raw.get("tree") or [])
    return keys


def audit():
    sources = read_sources()
    constants, problems = enum_constants()
    conditions = parse_conditions(sources)
    predicates = parse_predicates(sources, constants)
    class_rules = parse_class_rules(sources, constants)
    bindings = parse_bindings(sources)
    declared = declared_keys(sources)
    captured = schema_keys()

    failures, notes = list(problems), []

    for name, cond in conditions.items():
        if cond["declared"] != len(cond["terms"]):
            failures.append(f"{name} declares {cond['declared']} term(s) but "
                            f"{cond['array']} holds {len(cond['terms'])}")
        for key, _, _ in cond["terms"]:
            if key not in declared:
                failures.append(f"{name} names {key}, which no menu item declares")
            elif captured is not None and key not in captured:
                # The field is real; the capture predates it. Worth saying, because the console
                # renders that capture offline and so cannot show the rule working until it is
                # regenerated - tests/suite/test_fixtures.py does that.
                notes.append(f"{name} names {key}, which the checked-in schema capture predates - "
                             f"regenerate the fixtures (tests/suite/test_fixtures.py)")

    described = set()
    for item, pred, cond_name, filename in bindings:
        if cond_name is None:
            terms, reason, _ = predicates.get(pred, (None, "predicate not found", filename))
            if terms:
                notes.append(f"{filename}: {item} uses {pred}, which reads only stored settings "
                             f"but carries no condition - the console cannot re-evaluate it")
            continue
        described.add(cond_name)
        cond = conditions.get(cond_name)
        if cond is None:
            failures.append(f"{filename}: {item} points at {cond_name}, which is not declared")
            continue
        terms, reason, _ = predicates.get(pred, (None, "predicate not found", filename))
        if terms is None:
            failures.append(f"{filename}: {item} describes {pred} with {cond_name}, but {pred} "
                            f"{reason} - it should carry no condition at all")
            continue
        if sorted(terms) != sorted(cond["terms"]):
            failures.append(f"{filename}: {cond_name} does not match {pred}\n"
                            f"      predicate says {sorted(terms)}\n"
                            f"      condition says {sorted(cond['terms'])}")

    for cls, cond_names, terms, reason, filename in class_rules:
        described.update(cond_names)
        missing = [n for n in cond_names if n not in conditions]
        if missing:
            failures.append(f"{filename}: {cls} points at {', '.join(missing)}, "
                            f"which is not declared")
            continue
        if len(cond_names) > 1:
            # A rule that picks its condition per instance. The constructor decides which, so the
            # body reads a member rather than a setting and there is nothing to compare against.
            notes.append(f"{filename}: {cls} picks between {' and '.join(cond_names)} per "
                         f"instance - confirm by hand that each matches the mode it is chosen for")
            continue
        cond_name = cond_names[0]
        cond = conditions[cond_name]
        if terms is None:
            notes.append(f"{filename}: {cls} sets {cond_name} but its rule {reason} - "
                         f"not machine-checkable, confirm it by hand")
            continue
        if sorted(terms) != sorted(cond["terms"]):
            failures.append(f"{filename}: {cond_name} does not match {cls}::isVisible()\n"
                            f"      isVisible says {sorted(terms)}\n"
                            f"      condition says {sorted(cond['terms'])}")

    for name in sorted(set(conditions) - described):
        failures.append(f"{name} is declared but nothing points at it")

    return conditions, predicates, bindings, failures, notes


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--self-test", action="store_true", help="check this script's own logic")
    opts = parser.parse_args()
    if opts.self_test:
        self_test()

    conditions, predicates, bindings, failures, notes = audit()

    undescribed = sum(1 for _, _, cond, _ in bindings if cond is None)
    print(f"{len(conditions)} declarative condition(s) over {len(bindings)} visibility binding(s); "
          f"{undescribed} deliberately undescribed")

    for note in notes:
        print(f"  [note] {note}")
    for failure in failures:
        print(f"  [FAIL] {failure}")
    if not failures:
        print("  [OK] every visibleWhen matches the predicate beside it")

    print("\n" + ("FAILED" if failures else "OK") + f" - {len(failures)} problem(s)")
    sys.exit(1 if failures else 0)


def self_test():
    """Each case asserts a wrong answer is caught, not merely that a right one passes."""
    checks, failed = [], 0

    def check(label, condition, detail=""):
        nonlocal failed
        ok = bool(condition)
        checks.append((label, ok, detail))
        if not ok:
            failed += 1

    constants, problems = enum_constants()
    check("the real enums pair with their id arrays", not problems, str(problems))
    check("PID_CONTROL maps to its stored id", constants.get("PID_CONTROL") == "pid",
          str(constants.get("PID_CONTROL")))
    check("SWITCH_SELECT_FIRE maps to its stored id",
          constants.get("SWITCH_SELECT_FIRE") == "switch", str(constants.get("SWITCH_SELECT_FIRE")))

    terms, reason = parse_expression("deviceSettings.flywheelControl == PID_CONTROL", constants)
    check("an equality predicate parses", terms == [("device:flywheelControl", "pid", False)],
          str(terms))

    terms, reason = parse_expression("deviceSettings.selectFireType != NO_SELECT_FIRE", constants)
    check("an inequality predicate parses", terms == [("device:selectFireType", "off", True)],
          str(terms))

    terms, reason = parse_expression("deviceSettings.useRpmBaseShotCounter", constants)
    check("a bare bool parses", terms == [("device:useRpmBaseShotCounter", "true", False)],
          str(terms))

    terms, reason = parse_expression(
        "deviceSettings.variableFPS && deviceSettings.selectFireType == SWITCH_SELECT_FIRE",
        constants)
    check("a two-term AND parses", terms == [("device:variableFPS", "true", False),
                                             ("device:selectFireType", "switch", False)],
          str(terms))

    check("PUSHER_DRIVE_ESC maps to its stored id", constants.get("PUSHER_DRIVE_ESC") == "esc",
          str(constants.get("PUSHER_DRIVE_ESC")))
    check("PIN_NOT_USED is read from types.h", constants.get("PIN_NOT_USED") == "255",
          str(constants.get("PIN_NOT_USED")))

    # A pin rule is a comparison against a number, which is the one non-enum constant this parses.
    terms, reason = parse_expression("deviceSettings.ledDataPin != PIN_NOT_USED", constants)
    check("a stored-pin rule parses as a negated 255",
          terms == [("device:ledDataPin", "255", True)], str(terms))

    # ... and the wrong answer is caught: "wired" and "not wired" must not compare equal, which is
    # the whole failure mode - a rule that hides the row it was written to show.
    wired, _ = parse_expression("deviceSettings.ledDataPin != PIN_NOT_USED", constants)
    unwired, _ = parse_expression("deviceSettings.ledDataPin == PIN_NOT_USED", constants)
    check("a pin rule and its inverse do not compare equal", sorted(wired) != sorted(unwired))

    fet, _ = parse_expression("deviceSettings.pusherDrive == PUSHER_DRIVE_FET", constants)
    esc, _ = parse_expression("deviceSettings.pusherDrive == PUSHER_DRIVE_ESC", constants)
    check("the two pusher-driver rules do not compare equal", sorted(fet) != sorted(esc))

    terms, reason = parse_expression("pinDefined(menuButtonPin)", constants)
    check("a resolved-pin rule is refused, with a reason", terms is None and "pin" in (reason or ""),
          str(reason))

    terms, reason = parse_expression("board.pusherDriverType == ESC_DRIVER", constants)
    check("a board-property rule is refused, with a reason",
          terms is None and "board" in (reason or ""), str(reason))

    terms, reason = parse_expression("deviceSettings.flywheelControl == NOT_A_REAL_CONSTANT",
                                     constants)
    check("an unknown constant is refused rather than guessed", terms is None, str(terms))

    # The bug this file exists to catch: a condition that quietly disagrees with its predicate.
    a, _ = parse_expression("deviceSettings.flywheelControl == PID_CONTROL", constants)
    b, _ = parse_expression("deviceSettings.flywheelControl == TBH_CONTROL", constants)
    check("two different rules do not compare equal", sorted(a) != sorted(b))

    real = read_sources()
    check("a real menu key is declared", "device:useRpmBaseShotCounter" in declared_keys(real))

    # The bug the cut-out exists to catch: a term whose key is a typo would otherwise be found in
    # the source by the term itself, vouch for its own spelling, and pass.
    forged = {"fake.cpp": 'static constexpr VisibilityTerm kTerms[] = '
                          '{{"device:notAField", "true", false}};'}
    check("a key seen only inside a rule does not count as declared",
          "device:notAField" not in declared_keys(forged), str(declared_keys(forged)))
    check("a key seen outside a rule does count",
          "device:realField" in declared_keys(
              {"f.cpp": 'static ToggleItem x("L", "device:realField", &y);'}))

    conditions, predicates, bindings, failures, notes = audit()
    check("the real source yields conditions", len(conditions) >= 8, str(len(conditions)))
    check("the real source yields bindings", len(bindings) >= 20, str(len(bindings)))
    check("the real tree passes its own audit", not failures, "\n".join(failures))

    for label, ok, detail in checks:
        print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f" - {detail}" if detail and not ok
                                                           else ""))
    print(f"\n{'self-test passed' if not failed else f'self-test FAILED - {failed}'}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
