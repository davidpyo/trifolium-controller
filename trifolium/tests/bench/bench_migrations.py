"""What the firmware does to a stored config written by an older release, for a walk's baseline.

A baseline is captured on the firmware being replaced, so a key the new build renamed or reshaped is
judged here as the new build would hold it rather than as drift.
"""

NO_FIRE_MODE = -1

# bootButton_t order, which a legacy bootAction array is indexed by. The cycle switch has no key.
BUTTONS = ["menu", "trigger", "rev", None, "idle", "select0", "select1", "select2"]
SWITCHES = [b for b in BUTTONS if b]


def rule(action, *on):
    return {"action": action, **{s: s in on for s in SWITCHES}}


def legacy_rules(boot_action, dual_stage):
    """What 2.3.0 makes of a 2.2.0 bootAction array: deviceStore.cpp's bootRulesFromLegacy()."""
    rules = []
    for b, action in enumerate(boot_action or []):
        name = BUTTONS[b] if b < len(BUTTONS) else None
        if action == "none" or name is None or (name == "rev" and dual_stage):
            continue
        rules.append(rule(action, name))
    return (rules + [rule("none")] * 8)[:8]


def as_current(device):
    """A device dump from an older release as this build should hold it."""
    if not isinstance(device, dict) or "bootAction" not in device or "bootRules" in device:
        return device
    out = {k: v for k, v in device.items() if k != "bootAction"}
    out["bootRules"] = legacy_rules(device["bootAction"], device.get("dualStageTrigger", False))
    return out
