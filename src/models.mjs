// Tier -> { model, thinking } resolution. models.json is the only file that changes
// when models do. Thinking is kept separate from the model name because hosts spell it
// differently: pi wants a `model:level` suffix, others have no per-agent notion of it.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, TIERS } from "./personas.mjs";

const FILE = join(ROOT, "models.json");

export const loadConfig = () => JSON.parse(readFileSync(FILE, "utf8"));
const saveConfig = (cfg) => writeFileSync(FILE, `${JSON.stringify(cfg, null, 2)}\n`);

/** Accept "model", "model:thinking" or { model, thinking }. */
export function normalizeTier(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    const i = value.lastIndexOf(":");
    return i === -1
      ? { model: value, thinking: null }
      : { model: value.slice(0, i), thinking: value.slice(i + 1) };
  }
  if (!value.model) throw new Error(`tier config needs a "model": got ${JSON.stringify(value)}`);
  return { model: value.model, thinking: value.thinking ?? null };
}

export const formatTier = (t) => (t == null ? "—" : t.thinking ? `${t.model}:${t.thinking}` : t.model);

/**
 * Resolve a profile name to a tier -> { model, thinking } map.
 * `"none"` yields a null map, meaning "stamp no model at all" — the host default
 * applies, or the orchestrator passes one at the call site.
 */
export function resolveProfile(name) {
  if (name === "none" || name == null) return { key: "none", map: null };
  const cfg = loadConfig();
  const key = name === true ? cfg.profile : name;
  const raw = cfg.profiles?.[key];
  if (!raw) {
    throw new Error(`unknown profile "${key}". models.json has: ${Object.keys(cfg.profiles ?? {}).join(", ")}`);
  }
  const missing = TIERS.filter((t) => !raw[t]);
  if (missing.length) throw new Error(`profile "${key}" is missing tier(s): ${missing.join(", ")}`);
  const map = Object.fromEntries(TIERS.map((t) => [t, normalizeTier(raw[t])]));
  return { key, map, unverified: cfg.unverified?.[key] ?? [] };
}

/** Declare what a tier means. Writes models.json. */
export function setTier(profileKey, tier, { model, thinking }) {
  if (!TIERS.includes(tier)) throw new Error(`unknown tier "${tier}". known: ${TIERS.join(", ")}`);
  const cfg = loadConfig();
  const key = profileKey ?? cfg.profile;
  if (!cfg.profiles?.[key]) throw new Error(`unknown profile "${key}"`);

  const current = normalizeTier(cfg.profiles[key][tier]) ?? { model: null, thinking: null };
  const next = {
    model: model ?? current.model,
    thinking: thinking === "none" ? null : (thinking ?? current.thinking),
  };
  if (!next.model) throw new Error(`tier "${tier}" has no model yet — pass --model`);

  cfg.profiles[key][tier] = next.thinking ? next : { model: next.model };
  // A tier the user has now declared by hand is no longer an unverified guess of ours.
  if (cfg.unverified?.[key]) {
    cfg.unverified[key] = cfg.unverified[key].filter((t) => t !== tier);
    if (!cfg.unverified[key].length) delete cfg.unverified[key];
    if (!Object.keys(cfg.unverified).length) delete cfg.unverified;
  }
  saveConfig(cfg);
  return { profile: key, tier, config: next };
}

/** Set the default profile. */
export function setProfile(key) {
  const cfg = loadConfig();
  if (!cfg.profiles?.[key]) throw new Error(`unknown profile "${key}"`);
  cfg.profile = key;
  saveConfig(cfg);
  return key;
}

/** The tier config to stamp for a persona, or undefined to omit the field. */
export const tierFor = (persona, profile) => (profile?.map ? profile.map[persona.tier] : undefined);
