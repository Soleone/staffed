// Argument parsing and output. All behaviour lives in the sibling modules.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { validate } from "./personas.mjs";
import { DEFAULT_PACK, compositionSentence, dimensionsFor, loadCatalog, packNames, packSuffix, parseComposition, resolvePack, validateCatalog, vocabularyIndex } from "./packs.mjs";
import {
  formatTier,
  loadConfig,
  resolveProfile,
  setProfile,
  setTier,
  validateModelConfig,
} from "./models.mjs";
import { HOSTS, assertKnownHost, resolveHost, selectDefaultAgent } from "./hosts.mjs";
import { table, wrap } from "./text.mjs";
import * as placement from "./install.mjs";
import { generateSkill } from "./skill.mjs";

const HELP = `staffed — coordinated subagent roles for any project

roster
  staffed enable                 enable every persona; inherit the parent model
  staffed enable --profile openai  enable with cost/time-oriented OpenAI defaults
  staffed enable --profile anthropic  enable with Anthropic provider defaults
  staffed enable --profile openai-deepseek  enable Pi's OpenAI + DeepSeek hybrid
  staffed enable pm architect    enable only these (additive)
  staffed disable                disable every persona we enabled
  staffed disable pm             disable only these
  staffed status                 what is enabled, and whether it drifted
  staffed list                   stateless product catalog roster with tier and effort
  staffed list --pack detective  inspect another catalog roster

composition and staff packs
  staffed compose                compact vocabulary and examples
  staffed compose lens           inspect one dimension
  staffed compose sceptic        explain one mode
  staffed compose pm prag scep   validate and explain a composition
  staffed compose recipes        recipes for the selected pack
  staffed pack list              available packs (exactly one is active per scope)
  staffed pack use detective     exclusively switch this scope to a pack

discovery (agents are invisible to an agent session; something must point at them)
  staffed skill                  print the Staffed skill — installed by default

tiers
  staffed tier                                 show four tier -> model/thinking rows
  staffed tier --compact                       print only the tier -> model:thinking rows
  staffed tier strong --model X --thinking Y   declare what the strong tier means
  staffed tier --profile openai|anthropic|openai-deepseek  switch the default profile
  staffed doctor                             check models against this install

options
  --agent <name>    ${Object.keys(HOSTS).join(" | ")}  (auto when omitted)
  --scope <s>       user | project               (default: user)
  --pack <p>        catalog pack for list/compose, or target for enable/use
  --profile <p>     model profile to stamp, or "none" (default: none)
  --model <m>       with \`tier\`: the model for that tier
  --thinking <t>    with \`tier\`: reasoning level, or "none" to clear
  --no-skill        do not install the Staffed skill
  --link            symlink instead of copy (dev workflow; excludes --profile)
  --force           overwrite foreign or locally modified files
  --dry-run, -n     print what would happen
  -h, --help        this

agent selection
  Agent-dependent commands probe ~/.pi/agent, ~/.codex, and ~/.claude when --agent is omitted.
  Exactly one installed agent is selected automatically. If multiple are installed,
  choose one with --agent. If none is installed, a warning is printed and Pi is used
  as the fallback. Agent-independent commands (help, list, compose, pack list,
  tier/models, validate) skip detection. Stateless list/compose default to the product
  catalog; pass --pack for another catalog. Use status for installed state.

In pi a persona is enabled purely by being present in an agents directory, so
enable/disable place and remove files. Sources are never mutated: a model profile is
applied while rendering, leaving the repo portable with no unpin step to forget.
Plain enable inherits the parent model; a profile pins render-time defaults which a
call-site model can override. Agent selection and model profile are independent. For
durable tier edits, use a clone or persistent install.`;

const LABEL = {
  enabled: "enabled",
  disabled: "-",
  modified: "modified locally",
  replaced: "replaced",
  foreign: "not ours",
  missing: "missing (was enabled)",
};

function parse(argv) {
  const opts = { scope: "user", profile: "none", mode: "copy" };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = (option) => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("-")) throw new Error(`${option} requires a value`);
      i++;
      return next;
    };
    if (a === "--agent") opts.agent = value("--agent");
    else if (a === "--scope") opts.scope = value("--scope");
    else if (a === "--pack") opts.pack = value("--pack");
    else if (a === "--profile") { opts.profile = value("--profile"); opts.profileGiven = true; }
    else if (a === "--model") opts.model = value("--model");
    else if (a === "--compact") opts.compact = true;
    else if (a === "--thinking") opts.thinking = value("--thinking");
    else if (a === "--no-skill") opts.skill = false;
    else if (a === "--link") opts.mode = "link";
    else if (a === "--copy") opts.mode = "copy";
    else if (a === "--force") opts.force = true;
    else if (a === "--dry-run" || a === "-n") opts.dryRun = true;
    else if (a === "-h" || a === "--help") opts.help = true;
    else if (a.startsWith("-")) throw new Error(`unknown option ${a}`);
    else rest.push(a);
  }
  if (!["user", "project"].includes(opts.scope)) throw new Error("--scope must be user or project");
  return { opts, rest };
}

/** Wrap to ~86 columns with a hanging indent. */
const hang = (text, indent = "") => wrap(text, 86, indent);

function warnUnverified(profile) {
  if (!profile?.unverified?.length) return;
  console.log();
  console.log(
    hang(
      `warning: tier(s) ${profile.unverified.join(", ")} in profile "${profile.key}" were seeded by ` +
        "guesswork and are not confirmed against a real install. Run `staffed doctor`, then " +
        "declare them with `staffed tier <tier> --model <m> --thinking <t>`.",
    ),
  );
}

export function printTiers(profileArg, cfg = loadConfig()) {
  const { key, map, unverified, fallbacks = [] } = resolveProfile(profileArg ?? true, cfg);
  console.log(`profile ${key}${profileArg ? "" : "  (default from models.json)"}`);
  const rows = Object.entries(map).map(([tier, t]) => [
    tier,
    t.model,
    t.thinking ?? "—",
    [
      unverified.includes(tier) ? "unverified" : "",
      fallbacks.some((f) => f.tier === tier) ? "compatibility fallback from balanced" : "",
    ]
      .filter(Boolean)
      .join("; "),
  ]);
  console.log(`  ${table([["tier", "model", "thinking", ""], ...rows]).split("\n").join("\n  ")}`);
  console.log(`\nprofiles: ${Object.keys(cfg.profiles).join(", ")}`);

  const prows = resolvePack(DEFAULT_PACK).personas.map((p) => [p.name, p.tier, p.effort, formatTier(map[p.tier])]);
  console.log();
  console.log(table(prows).split("\n").map((line) => `  ${line}`).join("\n"));
  warnUnverified({ key, unverified });
  if (fallbacks.length) {
    console.log(
      `\ncompatibility: profile "${key}" has no explicit strong tier; declare it with ` +
        "`staffed tier strong --model <m> --thinking <t>`.",
    );
  }
}

/** The tier -> model:thinking map alone, for dropping into an agent's context. */
export function printTiersCompact(profileArg, cfg = loadConfig()) {
  const { key, map } = resolveProfile(profileArg ?? true, cfg);
  console.log(`profile ${key}`);
  console.log(table(Object.entries(map).map(([tier, t]) => [tier, formatTier(t)]))
    .split("\n").map((line) => `  ${line}`).join("\n"));
}

/** Compare configured models against what this pi install actually offers. */
async function doctor(agentName) {
  if (agentName !== "pi") {
    console.error(`doctor can inspect the Pi registry only; ${resolveHost(agentName).label} model availability cannot be verified here.`);
    return 1;
  }
  const cfg = loadConfig();
  console.log(`env     PI_MODEL=${process.env.PI_MODEL ?? "—"} PI_REASONING_LEVEL=${process.env.PI_REASONING_LEVEL ?? "—"}`);
  console.log(`        PI_PROVIDER=${process.env.PI_PROVIDER ?? "—"}`);

  let known = new Set();
  try {
    const m = JSON.parse(readFileSync(join(homedir(), ".pi", "agent", "models.json"), "utf8"));
    for (const [provider, p] of Object.entries(m.providers ?? {})) {
      for (const x of p.models ?? []) {
        known.add(x.id);
        known.add(`${provider}/${x.id}`);
      }
    }
  } catch {
    console.log("\ncould not read ~/.pi/agent/models.json — cannot verify model ids");
  }
  if (process.env.PI_MODEL) {
    known.add(process.env.PI_MODEL);
    if (process.env.PI_PROVIDER) known.add(`${process.env.PI_PROVIDER}/${process.env.PI_MODEL}`);
  }

  console.log(`\nmodels known to this install: ${known.size || "none"}`);
  for (const key of Object.keys(cfg.profiles)) {
    const { map, fallbacks = [] } = resolveProfile(key, cfg);
    console.log(`\nprofile ${key}`);
    const rows = Object.entries(map).map(([tier, t]) => [
      tier,
      formatTier(t),
      `${known.size === 0 ? "?" : known.has(t.model) ? "ok" : "NOT FOUND"}${
        fallbacks.some((f) => f.tier === tier) ? " (compatibility fallback from balanced)" : ""
      }`,
    ]);
    console.log(table(rows).split("\n").map((line) => `  ${line}`).join("\n"));
  }
  console.log(
    "\nAvailability, including non-Pi and cross-provider profiles, depends on the providers installed in this Pi environment.",
  );
  return 0;
}

function printStatus(s) {
  console.log(`agent   ${s.host.label} (${s.host.key})`);
  console.log(`scope   ${s.scope}`);
  console.log(`pack    ${s.pack.key}${packSuffix(s.pack)}`);
  console.log(`dir     ${s.dir}`);
  console.log(
    s.manifestError
      ? `manifest INVALID — ${s.manifestError}`
      : s.manifest
        ? `updated v${s.manifest.version}, ${s.manifest.updatedAt}`
        : "manifest none — nothing enabled here",
  );
  console.log();
  const rows = [
    ["persona", "tier", "effort", "state", "installed"],
    ...s.items.map((i) => [
      i.persona.name,
      i.persona.tier,
      i.persona.effort,
      LABEL[i.state] ?? i.state,
      modelOf(i),
    ]),
  ];
  console.log(table(rows).split("\n").map((line) => `  ${line}`).join("\n"));
  const enabled = s.items.filter((i) => i.state === "enabled").map((i) => i.persona.name);
  const drift = s.items.filter((i) => !["enabled", "disabled"].includes(i.state));
  console.log(`\n${enabled.length}/${s.items.length} enabled`);
  if (drift.length) console.log(`${drift.length} file(s) differ from the manifest`);

  const line = (label, item, missing) => {
    const text = {
      current: "current", stale: "STALE — does not match what is enabled; re-run `staffed enable`",
      absent: missing, disabled: missing, foreign: "FOREIGN — not owned by Staffed", modified: "MODIFIED locally",
      missing: "MISSING — tracked item is absent", replaced: "REPLACED",
    }[item.state] ?? item.state;
    console.log(`${label.padEnd(8)} ${text}\n         ${item.file ?? item.path}`);
  };
  line("skill", s.skill, enabled.length ? "MISSING — nothing tells the agent these personas exist" : "absent");
  line("compose", s.composition, enabled.length ? "MISSING — composition details are unavailable" : "absent");
  if (s.collisions?.length) console.log(`collisions ${s.collisions.map((c) => `${c.name}: ${c.path}`).join(", ")}`);
}

const modelOf = (i) => {
  if (["disabled", "foreign"].includes(i.state)) return "—";
  if (i.tracked?.type === "link") return "source link; model inherited";
  if (i.tracked?.type !== "copy") return "—";
  if (!i.tracked.tier) return "unknown (legacy manifest; re-enable to refresh)";
  if (i.tracked.profile === "none" && !i.tracked.model) return `${i.tracked.tier} → inherited (none)`;
  if (!i.tracked.model) return "unknown (incomplete manifest; re-enable to refresh)";
  const value = i.tracked.thinking ? `${i.tracked.model}:${i.tracked.thinking}` : i.tracked.model;
  return `${i.tracked.tier} → ${value} (${i.tracked.profile ?? "unknown"})`;
};

function selectAgent(opts) {
  if (opts.agent !== undefined) return resolveHost(opts.agent);
  const selected = selectDefaultAgent();
  if (selected.reason === "legacy-default") {
    console.error(
      "warning: no Pi, OpenAI Codex, or Claude Code configuration directory detected; defaulting to agent pi " +
        "(use --agent codex or --agent claude to choose another host)",
    );
  }
  return resolveHost(selected.key);
}

function placementOptions(opts, host) {
  const { agent: _agent, ...rest } = opts;
  return { ...rest, host: host.key };
}

function validationProblems() {
  const catalog = loadCatalog();
  const problems = [...validateCatalog(catalog), ...validateModelConfig(loadConfig())];
  for (const name of packNames(catalog)) {
    let pack;
    try { pack = resolvePack(name, catalog); }
    catch (error) {
      if (!problems.some((problem) => problem.includes(error.message))) problems.push(`${name}: ${error.message}`);
      continue;
    }
    if (!Array.isArray(pack.stages) || !Array.isArray(pack.noArtifact) || !Array.isArray(pack.noDirectory)) continue;
    problems.push(...validate(pack.personas, pack.stages, { noArtifact: pack.noArtifact, noDirectory: pack.noDirectory }).map((problem) => `${name}: ${problem}`));
  }
  return problems;
}

function printPackList() {
  const rows = packNames().map((name) => {
    const pack = resolvePack(name);
    return [name, pack.experimental ? "experimental preview" : "stable", `${pack.label} (${pack.personas.length} roles)`];
  });
  console.log(table(rows).split("\n").map((line) => `  ${line}`).join("\n"));
  console.log("\nProduct is the built-in default. An installed scope has exactly one active pack.");
}

function printCompose(args, packName) {
  const pack = resolvePack(packName ?? DEFAULT_PACK);
  const dimensions = dimensionsFor(pack.key);
  const index = vocabularyIndex(pack.key);
  if (!args.length) {
    console.log(`Staffed composition catalog (stateless) — ${pack.label}${packSuffix(pack)}`);
    console.log("\n  <role> [stance] [drive] [lens] [audience] [voice]");
    console.log("\nSelect one role and only the modifiers that materially change the result.\n");
    console.log(`roles: ${pack.personas.map((p) => p.name).join(", ")}`);
    for (const dimension of dimensions) {
      if (dimension.name !== "audience") console.log(`${dimension.name}: ${dimension.modes.map((mode) => `${mode.name} (${mode.alias})`).join(", ")}`);
      else {
        const names = new Set(pack.audiences.map((mode) => mode.name));
        console.log(`audience (core): ${dimension.modes.filter((mode) => !names.has(mode.name)).map((mode) => `${mode.name} (${mode.alias})`).join(", ")}`);
        console.log(`audience (${pack.key}): ${pack.audiences.map((mode) => `${mode.name} (${mode.alias})`).join(", ")}`);
      }
    }
    console.log(`\nTry: staffed compose ${pack.recipes[0].composition.join(" ")}`);
    console.log("Explore: staffed compose recipes | staffed compose lens | staffed compose sceptic");
    console.log("This does not inspect installed state; pass --pack for another catalog or use status.");
    return;
  }
  if (args.length === 1 && args[0].toLowerCase() === "recipes") {
    console.log(`${pack.label}${packSuffix(pack)} recipes\n`);
    for (const recipe of pack.recipes) console.log(`  ${recipe.name}\n    ${recipe.goal}\n    ${recipe.composition.join(" + ")}\n`);
    return;
  }
  if (args.length === 1) {
    const dimension = dimensions.find((item) => item.name === args[0].toLowerCase());
    if (dimension) {
      console.log(`${dimension.name} — ${dimension.question}\n`);
      const packAudienceNames = new Set(pack.audiences.map((mode) => mode.name));
      for (const mode of dimension.modes) {
        const source = dimension.name === "audience" ? (packAudienceNames.has(mode.name) ? pack.key : "core") : "core";
        console.log(`  ${mode.name} (${mode.alias})${dimension.name === "audience" ? `  [${source}]` : ""}\n    ${mode.summary}`);
      }
      return;
    }
    const entry = index.get(args[0].toLowerCase());
    if (entry && entry.dimension !== "role") {
      console.log(`${entry.name}\ndimension  ${entry.dimension}\nalias      ${entry.alias}\n\n${entry.summary}\n\nUseful for: ${entry.usefulFor}.\nWatch for: ${entry.shadow}.`);
      return;
    }
    if (entry?.dimension === "role") {
      console.log(`${entry.name}\nrole in ${pack.label}${packSuffix(pack)}\n\n${entry.summary}`);
      const recipes = pack.recipes.filter((recipe) => recipe.composition.includes(entry.name));
      if (recipes.length) console.log(`\nRecipes:\n${recipes.map((recipe) => `  ${recipe.composition.join(" + ")}`).join("\n")}`);
      return;
    }
  }
  const composition = parseComposition(args, pack.key);
  console.log(`pack  ${pack.key}${packSuffix(pack)}`);
  for (const dimension of ["role", "stance", "drive", "lens", "audience", "voice"]) {
    const entry = composition.selected[dimension];
    if (entry) console.log(`${dimension.padEnd(8)} ${entry.name}${entry.alias ? ` (${entry.alias})` : ""}`);
  }
  console.log(`\n${compositionSentence(composition)}`);
}

function cmdList({ opts }) {
  const pack = resolvePack(opts.pack ?? DEFAULT_PACK);
  const rows = pack.personas.map((p) => [
    p.name,
    p.tier ?? "?",
    p.effort ?? "?",
    `${(p.meta.description ?? "").split(". ")[0]}.`,
  ]);
  console.log(table(rows).split("\n").map((line) => `  ${line}`).join("\n"));
  console.log(`\n${rows.length} personas — catalog pack ${pack.key}${packSuffix(pack)} (stateless; use status for installed state)`);
  return 0;
}

function cmdTier({ opts, names }) {
  const profile = opts.profileGiven ? opts.profile : undefined;
  if (opts.compact) {
    if (names.length) throw new Error("--compact takes no tier name");
    if (opts.model !== undefined || opts.thinking !== undefined) throw new Error("--compact only prints; it cannot set a tier");
    printTiersCompact(profile);
    return 0;
  }
  // `tier --profile X` with no tier name switches the default profile.
  if (!names.length && opts.model === undefined && opts.thinking === undefined) {
    if (opts.profile !== "none" && opts.profileGiven) {
      printTiers(setProfile(opts.profile));
      return 0;
    }
    printTiers();
    return 0;
  }
  if (!names.length) throw new Error("which tier? e.g. `staffed tier deep --model X --thinking xhigh`");
  const r = setTier(profile ?? null, names[0], opts);
  console.log(`profile ${r.profile}: ${r.tier} -> ${formatTier(r.config)}\n`);
  printTiers(r.profile);
  return 0;
}

function cmdValidate() {
  const problems = validationProblems();
  const count = packNames().reduce((total, name) => total + resolvePack(name).personas.length, 0);
  console.log(`${count} personas across ${packNames().length} packs`);
  if (!problems.length) {
    console.log("0 problems");
    return 0;
  }
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  return 1;
}

function cmdPack(ctx) {
  const { opts, names } = ctx;
  if (!names.length || names[0] === "list") {
    printPackList();
    return 0;
  }
  const host = selectAgent(opts);
  if (names[0] !== "use" || !names[1] || names.length > 2) throw new Error("usage: staffed pack use <name>");
  const next = resolvePack(names[1]);
  const problems = validationProblems();
  if (problems.length) throw new Error(`refusing to switch — configuration has ${problems.length} problem(s)`);
  const r = placement.enable({ ...placementOptions(opts, host), pack: next.key, only: [] });
  console.log(`${r.dryRun ? "would use" : "active pack"} ${r.pack.key}${packSuffix(r.pack)} — ${r.dryRun ? r.items.length : r.enabledTotal} roles ${r.dryRun ? "would be enabled" : "enabled"} in ${r.dir}`);
  return 0;
}

/** Commands that probe the filesystem for an installed host before running. */
const dependent = (run) => (ctx) => {
  const host = selectAgent(ctx.opts);
  return run({ ...ctx, host, agentOpts: placementOptions(ctx.opts, host) });
};

const cmdDoctor = dependent(({ host }) => doctor(host.key));

const cmdSkill = dependent(({ opts, host, agentOpts }) => {
  const current = placement.status(agentOpts);
  const enabled = current.items.filter((item) => item.state === "enabled").map((item) => item.persona.name);
  if (!enabled.length) {
    console.error(`nothing is enabled for agent ${host.label} (${opts.scope} scope).`);
    return 1;
  }
  console.log(`# would go in ${host.skillDir(opts.scope, process.cwd())}/staffed/SKILL.md\n`);
  console.log(generateSkill({ hostKey: host.key, enabled, personas: current.pack.personas, pack: current.pack.key }));
  return 0;
});

const cmdStatus = dependent(({ agentOpts }) => {
  printStatus(placement.status(agentOpts));
  return 0;
});

const cmdEnable = dependent(({ opts, names, agentOpts }) => {
  const problems = validationProblems();
  if (problems.length) {
    console.error(`refusing to enable — configuration has ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    return 1;
  }
  const r = placement.enable({ ...agentOpts, only: names });
  const verb = r.dryRun ? "would enable" : r.mode === "link" ? "linked" : "enabled";
  console.log(`${verb} ${r.items.length}${names.length ? "" : " (all)"} -> ${r.dir}`);
  console.log(
    `agent ${r.host.label}, scope ${r.scope}, pack ${r.pack.key}${packSuffix(r.pack)}, profile ${r.profile.key}, mode ${r.mode}` +
      (r.enabledTotal ? `, ${r.enabledTotal} enabled in total` : ""),
  );
  if (r.dryRun) for (const i of r.items) console.log(`  ${i.file}  (${LABEL[i.state] ?? i.state})`);

  const notes = [...(r.host.notes ?? [])];
  if (r.scope === "project") notes.push("This directory is committable — the roster travels with the repo.");
  if (notes.length) {
    console.log("\nnotes");
    for (const n of notes) console.log(hang(n, "  "));
  }
  warnUnverified(r.profile);
  return 0;
});

const cmdDisable = dependent(({ names, agentOpts }) => {
  const r = placement.disable({ ...agentOpts, only: names });
  console.log(`disabled ${r.removed.length}${r.removed.length ? `: ${r.removed.join(", ")}` : ""}`);
  console.log(`${r.remaining} still enabled in ${r.dir}`);

  if (r.kept.length) {
    console.log(`kept ${r.kept.length} locally modified: ${r.kept.join(", ")} (use --force)`);
  }
  return 0;
});

const COMMANDS = {
  help: { run: () => { console.log(HELP); return 0; } },
  list: { run: cmdList },
  compose: { run: ({ opts, names }) => { printCompose(names, opts.pack ?? DEFAULT_PACK); return 0; } },
  pack: { run: cmdPack },
  tier: { run: cmdTier },
  models: { run: cmdTier },
  validate: { run: cmdValidate },
  doctor: { run: cmdDoctor },
  skill: { run: cmdSkill },
  status: { run: cmdStatus },
  enable: { run: cmdEnable },
  install: { run: cmdEnable },
  disable: { run: cmdDisable },
  uninstall: { run: cmdDisable },
};

export async function main(argv = process.argv.slice(2)) {
  const { opts, rest } = parse(argv);
  assertKnownHost(opts.agent);
  if (opts.help) {
    console.log(HELP);
    return 0;
  }
  const command = COMMANDS[rest[0] ?? "help"];
  if (!command) {
    console.error(`unknown command "${rest[0]}"\n${HELP}`);
    return 2;
  }
  return command.run({ opts, argv, names: rest.slice(1) });
}
