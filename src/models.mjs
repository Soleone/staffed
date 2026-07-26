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
  let model;
  let thinking = null;
  if (typeof value === "string") {
    const i = value.lastIndexOf(":");
    model = i === -1 ? value : value.slice(0, i);
    thinking = i === -1 ? null : value.slice(i + 1);
  } else if (typeof value === "object" && !Array.isArray(value)) {
    model = value.model;
    thinking = value.thinking ?? null;
  } else {
    throw new Error(`tier config needs a "model": got ${JSON.stringify(value)}`);
  }
  if (typeof model !== "string" || !model.trim()) {
    throw new Error(`tier config needs a non-empty "model": got ${JSON.stringify(value)}`);
  }
  if (thinking !== null && (typeof thinking !== "string" || !thinking.trim())) {
    throw new Error(`tier config has invalid "thinking": got ${JSON.stringify(value)}`);
  }
  return { model, thinking };
}

export const formatTier = (t) => (t == null ? "—" : t.thinking ? `${t.model}:${t.thinking}` : t.model);

/**
 * Resolve a profile name to a tier -> { model, thinking } map.
 * `"none"` yields a null map, meaning "stamp no model at all" — the host default
 * applies, or the orchestrator passes one at the call site.
 */
export function resolveProfile(name, cfg) {
  if (name === "none" || name == null) return { key: "none", map: null };
  cfg ??= loadConfig();
  const key = name === true ? cfg.profile : name;
  const raw = cfg.profiles?.[key];
  if (!raw) {
    throw new Error(`unknown profile "${key}". models.json has: ${Object.keys(cfg.profiles ?? {}).join(", ")}`);
  }
  const legacy = ["fast", "balanced", "deep"];
  const missing = legacy.filter((t) => !raw[t]);
  if (missing.length) throw new Error(`profile "${key}" is missing tier(s): ${missing.join(", ")}`);

  const fallbacks = [];
  const map = {};
  const hasStrong = Object.hasOwn(raw, "strong");
  for (const tier of TIERS) {
    const source = tier === "strong" && !hasStrong ? raw.balanced : raw[tier];
    const normalized = normalizeTier(source);
    if (!normalized) throw new Error(`profile "${key}" has an invalid tier "${tier}"`);
    map[tier] = { ...normalized };
    if (tier === "strong" && !hasStrong) fallbacks.push({ tier: "strong", from: "balanced" });
  }
  return {
    key,
    map,
    unverified: cfg.unverified?.[key] ?? [],
    ...(fallbacks.length ? { fallbacks } : {}),
  };
}

/** Validate models.json structure without reading or writing disk. */
export function validateModelConfig(cfg) {
  const problems = [];
  const profiles = cfg?.profiles;
  if (!profiles || typeof profiles !== "object" || Array.isArray(profiles)) {
    return ["models.json: profiles must be an object"];
  }
  if (typeof cfg.profile !== "string" || !profiles[cfg.profile]) {
    problems.push(`models.json: default profile "${cfg.profile ?? ""}" does not exist`);
  }
  for (const [key, raw] of Object.entries(profiles)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      problems.push(`models.json: profile "${key}" must be an object`);
      continue;
    }
    for (const tier of ["fast", "balanced", "deep"]) {
      if (raw[tier] == null) {
        problems.push(`models.json: profile "${key}" is missing tier "${tier}"`);
        continue;
      }
      try {
        normalizeTier(raw[tier]);
      } catch (error) {
        problems.push(`models.json: profile "${key}" tier "${tier}": ${error.message}`);
      }
    }
    if (Object.hasOwn(raw, "strong")) {
      try {
        if (!normalizeTier(raw.strong)) throw new Error("tier config must not be null");
      } catch (error) {
        problems.push(`models.json: profile "${key}" tier "strong": ${error.message}`);
      }
    }
  }
  return problems;
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
