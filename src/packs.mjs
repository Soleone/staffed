// Staff-pack and composition catalog. catalog.json is the single source of truth;
// this module supplies loading, validation, lookup, and presentation-neutral parsing.

import { readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { ROOT, loadPersonas } from "./personas.mjs";

export const DEFAULT_PACK = "product";
export const CATALOG_FILE = join(ROOT, "catalog.json");

/** The label suffix used wherever a pack name is printed. */
export const packSuffix = (pack) => (pack.experimental ? " (experimental preview)" : "");

let cached;
export function loadCatalog(file = CATALOG_FILE) {
  if (file === CATALOG_FILE && cached) return cached;
  const value = JSON.parse(readFileSync(file, "utf8"));
  if (file === CATALOG_FILE) cached = value;
  return value;
}

const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const string = (value) => typeof value === "string" && value.trim().length > 0;

export function packNames(catalog = loadCatalog()) {
  return object(catalog?.packs) ? Object.keys(catalog.packs) : [];
}

function agentsDirectory(value) {
  if (!string(value) || isAbsolute(value)) return null;
  const path = resolve(ROOT, value);
  const fromRoot = relative(ROOT, path);
  return fromRoot && !fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && fromRoot !== ".." ? path : null;
}

export function resolvePack(name = DEFAULT_PACK, catalog = loadCatalog()) {
  const key = String(name || DEFAULT_PACK).toLowerCase();
  const definition = object(catalog?.packs) ? catalog.packs[key] : null;
  if (!object(definition)) throw new Error(`unknown pack "${name}". known: ${packNames(catalog).join(", ")}`);
  const directory = agentsDirectory(definition.agentsDir);
  if (!directory) throw new Error(`pack "${key}" has no safe relative agentsDir`);
  const personas = loadPersonas(directory);
  return { key, ...definition, personas };
}

export function dimensionsFor(packName = DEFAULT_PACK, catalog = loadCatalog()) {
  const pack = resolvePack(packName, catalog);
  if (!Array.isArray(catalog?.dimensions)) throw new Error("catalog dimensions must be an array");
  return catalog.dimensions.map((dimension) => ({
    ...dimension,
    modes: dimension.name === "audience" ? [...dimension.modes, ...(pack.audiences ?? [])] : dimension.modes,
  }));
}

export function vocabularyFor(packName = DEFAULT_PACK, catalog = loadCatalog()) {
  const pack = resolvePack(packName, catalog);
  const entries = pack.personas.map((persona) => ({
    name: persona.name,
    alias: null,
    dimension: "role",
    summary: persona.meta.description,
    persona,
  }));
  for (const dimension of dimensionsFor(packName, catalog)) {
    for (const mode of dimension.modes) entries.push({ ...mode, dimension: dimension.name });
  }
  return entries;
}

const keyOf = (value) => String(value).toLowerCase();

export function vocabularyIndex(packName = DEFAULT_PACK, catalog = loadCatalog()) {
  const entries = vocabularyFor(packName, catalog);
  const index = new Map();
  for (const entry of entries) {
    index.set(keyOf(entry.name), entry);
    if (entry.alias) index.set(keyOf(entry.alias), entry);
  }
  return index;
}

function distance(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return rows[a.length][b.length];
}

function suggestion(token, entries) {
  const names = entries.flatMap((entry) => [entry.name, entry.alias].filter(Boolean));
  const ranked = names.map((name) => [name, distance(keyOf(token), keyOf(name))]).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  const threshold = Math.max(2, Math.floor(String(token).length / 3));
  return ranked[0]?.[1] <= threshold ? ranked[0][0] : null;
}

export function parseComposition(tokens, packName = DEFAULT_PACK, catalog = loadCatalog()) {
  const pack = resolvePack(packName, catalog);
  const entries = vocabularyFor(packName, catalog);
  const index = vocabularyIndex(packName, catalog);
  const selected = {};
  for (const token of tokens) {
    const entry = index.get(keyOf(token));
    if (!entry) {
      const hint = suggestion(token, entries);
      throw new Error(`unknown composition option "${token}"${hint ? `. Did you mean "${hint}"?` : ` for pack "${pack.key}". Run \`staffed compose${pack.key === DEFAULT_PACK ? "" : ` --pack ${pack.key}`}\` to see known choices`}`);
    }
    if (selected[entry.dimension]) {
      if (selected[entry.dimension].name === entry.name) continue;
      throw new Error(
        `composition selects two ${entry.dimension} modes: "${selected[entry.dimension].name}" and "${entry.name}"; choose one`,
      );
    }
    selected[entry.dimension] = entry;
  }
  if (!selected.role) throw new Error(`composition needs one role from pack "${pack.key}": ${pack.personas.map((p) => p.name).join(", ")}`);
  return { pack, selected };
}

export function compositionSentence(composition) {
  const { selected } = composition;
  const phrases = ["stance", "drive", "lens", "audience", "voice"]
    .map((name) => selected[name]?.phrase)
    .filter(Boolean);
  if (!phrases.length) return `Use ${selected.role.name} with its plain role defaults.`;
  const joined = phrases.length === 1 ? phrases[0] : `${phrases.slice(0, -1).join(", ")}, and ${phrases.at(-1)}`;
  return `Use ${selected.role.name} to ${joined}.`;
}

export function validateCatalog(catalog = loadCatalog()) {
  const problems = [];
  if (!object(catalog)) return ["catalog must be an object"];
  if (catalog.schema !== 1) problems.push("catalog schema must be 1");

  const add = (map, token, label) => {
    if (!string(token)) { problems.push(`${label} must be a non-empty string`); return; }
    const key = keyOf(token);
    if (map.has(key)) problems.push(`${label} "${token}" collides with ${map.get(key)}`);
    else map.set(key, label);
  };
  const requireString = (owner, field, label) => {
    if (!string(owner?.[field])) problems.push(`${label}.${field} must be a non-empty string`);
  };
  const requireArray = (owner, field, label) => {
    if (!Array.isArray(owner?.[field])) { problems.push(`${label}.${field} must be an array`); return false; }
    return true;
  };
  const validateMode = (mode, label, tokens) => {
    if (!object(mode)) { problems.push(`${label} must be an object`); return; }
    for (const field of ["name", "alias", "summary", "usefulFor", "shadow", "phrase"]) requireString(mode, field, label);
    add(tokens, mode.name, `${label}.name`);
    add(tokens, mode.alias, `${label}.alias`);
  };

  const dimensionNames = new Set();
  const coreTokens = new Map();
  if (requireArray(catalog, "dimensions", "catalog")) {
    for (const [index, dimension] of catalog.dimensions.entries()) {
      const label = `dimensions[${index}]`;
      if (!object(dimension)) { problems.push(`${label} must be an object`); continue; }
      requireString(dimension, "name", label);
      requireString(dimension, "question", label);
      if (string(dimension.name)) {
        if (dimensionNames.has(dimension.name)) problems.push(`duplicate dimension "${dimension.name}"`);
        dimensionNames.add(dimension.name);
      }
      if (requireArray(dimension, "modes", label)) {
        for (const [modeIndex, mode] of dimension.modes.entries()) validateMode(mode, `${label}.modes[${modeIndex}]`, coreTokens);
      }
    }
  }
  for (const required of ["stance", "drive", "lens", "audience", "voice"]) {
    if (!dimensionNames.has(required)) problems.push(`catalog is missing required dimension "${required}"`);
  }

  if (!object(catalog.packs)) {
    problems.push("catalog.packs must be an object");
    return problems;
  }
  for (const [packName, definition] of Object.entries(catalog.packs)) {
    const label = `packs.${packName}`;
    if (!object(definition)) { problems.push(`${label} must be an object`); continue; }
    for (const field of ["label", "description", "agentsDir", "riskGate"]) requireString(definition, field, label);
    if (typeof definition.experimental !== "boolean") problems.push(`${label}.experimental must be a boolean`);
    for (const field of ["stages", "noArtifact", "noDirectory", "audiences", "recipes", "sizing", "loops", "parallelism", "activationExamples"]) requireArray(definition, field, label);
    if (Array.isArray(definition.activationExamples)) {
      if (!definition.activationExamples.length || !definition.activationExamples.every(string)) problems.push(`${label}.activationExamples must contain non-empty strings`);
    }

    let pack = null;
    if (string(definition.agentsDir)) {
      try { pack = resolvePack(packName, catalog); }
      catch (error) { problems.push(`${label}: ${error.message}`); }
    }
    const roleNames = new Set(pack?.personas?.map((persona) => persona.name) ?? []);
    const tokens = new Map(coreTokens);
    for (const persona of pack?.personas ?? []) add(tokens, persona.name, `${label}.role.${persona.name}`);

    const stageNames = new Set();
    if (Array.isArray(definition.stages)) {
      for (const [index, stage] of definition.stages.entries()) {
        const stageLabel = `${label}.stages[${index}]`;
        if (!object(stage)) { problems.push(`${stageLabel} must be an object`); continue; }
        requireString(stage, "name", stageLabel);
        requireString(stage, "role", stageLabel);
        if (stage.parallel != null && typeof stage.parallel !== "boolean") problems.push(`${stageLabel}.parallel must be a boolean`);
        if (string(stage.name)) {
          if (stageNames.has(stage.name)) problems.push(`${label}.stages has duplicate role "${stage.name}"`);
          stageNames.add(stage.name);
          if (pack && !roleNames.has(stage.name)) problems.push(`${label}.${stage.name}: stage has no role`);
        }
      }
    }
    for (const name of roleNames) if (!stageNames.has(name)) problems.push(`${label}.${name}: role is not in the pack stages`);

    for (const field of ["noArtifact", "noDirectory"]) {
      if (!Array.isArray(definition[field])) continue;
      const seen = new Set();
      for (const [index, name] of definition[field].entries()) {
        if (!string(name)) problems.push(`${label}.${field}[${index}] must be a non-empty string`);
        else if (seen.has(name)) problems.push(`${label}.${field} contains duplicate role "${name}"`);
        else {
          seen.add(name);
          if (pack && !roleNames.has(name)) problems.push(`${label}.${field} references unknown role "${name}"`);
        }
      }
    }

    if (Array.isArray(definition.audiences)) {
      for (const [index, audience] of definition.audiences.entries()) validateMode(audience, `${label}.audiences[${index}]`, tokens);
    }

    const recipeNames = new Set();
    if (Array.isArray(definition.recipes)) {
      for (const [index, recipe] of definition.recipes.entries()) {
        const recipeLabel = `${label}.recipes[${index}]`;
        if (!object(recipe)) { problems.push(`${recipeLabel} must be an object`); continue; }
        requireString(recipe, "name", recipeLabel);
        requireString(recipe, "goal", recipeLabel);
        if (string(recipe.name)) {
          if (recipeNames.has(recipe.name)) problems.push(`${label}.recipes has duplicate name "${recipe.name}"`);
          recipeNames.add(recipe.name);
        }
        if (!Array.isArray(recipe.composition) || !recipe.composition.every(string)) {
          problems.push(`${recipeLabel}.composition must be an array of non-empty strings`);
        } else if (pack && Array.isArray(catalog.dimensions)) {
          try { parseComposition(recipe.composition, packName, catalog); }
          catch (error) { problems.push(`${recipeLabel}: ${error.message}`); }
        }
      }
    }

    if (Array.isArray(definition.sizing)) {
      for (const [index, item] of definition.sizing.entries()) {
        const itemLabel = `${label}.sizing[${index}]`;
        if (!object(item)) { problems.push(`${itemLabel} must be an object`); continue; }
        requireString(item, "work", itemLabel);
        if (item.chain !== null && (!Array.isArray(item.chain) || !item.chain.length || !item.chain.every(string))) {
          problems.push(`${itemLabel}.chain must be null or a non-empty array of role names`);
        } else if (Array.isArray(item.chain)) {
          for (const role of item.chain) if (pack && !roleNames.has(role)) problems.push(`${itemLabel}.chain references unknown role "${role}"`);
        }
      }
    }

    for (const field of ["loops", "parallelism"]) {
      if (!Array.isArray(definition[field])) continue;
      for (const [index, item] of definition[field].entries()) {
        const itemLabel = `${label}.${field}[${index}]`;
        if (!object(item)) { problems.push(`${itemLabel} must be an object`); continue; }
        requireString(item, "text", itemLabel);
        if (!Array.isArray(item.requires) || !item.requires.length || !item.requires.every(string)) {
          problems.push(`${itemLabel}.requires must be a non-empty array of role names`);
        } else {
          for (const role of item.requires) if (pack && !roleNames.has(role)) problems.push(`${itemLabel}.requires references unknown role "${role}"`);
        }
      }
    }
  }
  return problems;
}
