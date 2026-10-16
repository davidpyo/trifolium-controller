import { getByKey } from "./keyPath";

// Boot rules: each is a set of switches held at power-on and the action that fires when all of them
// are. The device checks them in index order and takes the first match, so the order is the
// priority. Keys are `device:bootRules[N].<leaf>`, where the leaf is `action` or a switch id.

/** The switch ids a rule can name, in the firmware's bootButton_t order (the cycle switch has none). */
export const BOOT_SWITCHES = ["menu", "trigger", "rev", "idle", "select0", "select1", "select2"];

/** Rule slots the firmware stores. The editor counts the schema's own; this sizes the layout. */
export const MAX_BOOT_RULES = 8;

const NONE = "none";

export const bootRuleKey = (rule: number, leaf: string) => `device:bootRules[${rule}].${leaf}`;

const RULE_KEY = /^device:bootRules\[(\d+)\]\.(\w+)$/;

/** The rule index and leaf of a boot-rule key, or null for any other key. */
export function parseBootRuleKey(key: string | undefined): { rule: number; leaf: string } | null {
  const m = RULE_KEY.exec(key ?? "");
  return m ? { rule: Number(m[1]), leaf: m[2] } : null;
}

/** Every boot-rule key, rule by rule: what the layout claims for the Boot Actions section. */
export function bootRuleKeys(count = MAX_BOOT_RULES): string[] {
  const keys: string[] = [];
  for (let r = 0; r < count; r++)
    for (const leaf of ["action", ...BOOT_SWITCHES]) keys.push(bootRuleKey(r, leaf));
  return keys;
}

export interface BootRule {
  action: string;
  /** The switches the rule names. */
  on: string[];
}

/** The rules as the device payload holds them. A missing slot reads as empty. */
export function readBootRules(device: unknown, count: number): BootRule[] {
  return Array.from({ length: count }, (_, r) => ({
    action: String(getByKey(device as never, bootRuleKey(r, "action")) ?? NONE),
    on: BOOT_SWITCHES.filter((s) => getByKey(device as never, bootRuleKey(r, s)) === true),
  }));
}

export const isLive = (rule: BootRule) => rule.action !== NONE && rule.on.length > 0;

/**
 * For each rule, the earlier rule that always fires instead of it, or null.
 *
 * A rule matches when every switch it names is held, so an earlier live rule naming a subset of its
 * switches is held whenever it is - and wins.
 */
export function shadowedBy(rules: BootRule[]): (number | null)[] {
  return rules.map((rule, j) => {
    if (!isLive(rule)) return null;
    for (let i = 0; i < j; i++) {
      const earlier = rules[i];
      if (isLive(earlier) && earlier.on.every((s) => rule.on.includes(s))) return i;
    }
    return null;
  });
}

/** The edits that write `rule` into slot `index`: its action and every switch, named or not. */
export function ruleEdits(index: number, rule: BootRule): [string, unknown][] {
  return [
    [bootRuleKey(index, "action"), rule.action],
    ...BOOT_SWITCHES.map((s): [string, unknown] => [bootRuleKey(index, s), rule.on.includes(s)]),
  ];
}

/**
 * The edits that move the rule in slot `from` to slot `to`, the rules between shifting one place to
 * close the gap. Only the slots whose rule changes are written.
 */
export function moveEdits(rules: BootRule[], from: number, to: number): [string, unknown][] {
  if (from === to || from < 0 || to < 0 || from >= rules.length || to >= rules.length) return [];
  const next = [...rules];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next.flatMap((rule, i) => (rule === rules[i] ? [] : ruleEdits(i, rule)));
}

export const EMPTY_RULE: BootRule = { action: NONE, on: [] };
