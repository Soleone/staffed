// Argument parsing and output. All behaviour lives in the sibling modules.

import { loadPersonas, validate } from "./personas.mjs";
import { formatTier, loadConfig, normalizeTier, resolveProfile, setProfile, setTier } from "./models.mjs";
import { DEFAULT_HOST, HOSTS, resolveHost } from "./hosts.mjs";
import * as placement from "./install.mjs";
import { STAGES, generate, inspectBrief, removeBrief, writeBrief } from "./brief.mjs";
import { inspectSkill, removeSkill, writeSkill, generate as skillText } from "./skill.mjs";

const HELP = `staffed — coordinated subagent roles for any project

roster
  staffed enable                 enable every persona
  staffed enable pm architect    enable only these (additive)
  staffed disable                disable every persona we enabled
  staffed disable pm             disable only these
  staffed status                 what is enabled, and whether it drifted
  staffed list                   the roster and each persona's tier

discovery (agents are invisible to a host session; something must point at them)
  staffed skill                  print the Staffed skill — installed by default
  staffed brief                  print the optional AGENTS.md block
  staffed brief --write          also put it in AGENTS.md
  staffed brief --remove         take it back out

tiers
  staffed tier                               show tier -> model/thinking
  staffed tier deep --model X --thinking Y   declare what a tier means
  staffed tier --profile claude-code         switch the default profile
  staffed doctor                             check models against this install

options
  --host <name>     ${Object.keys(HOSTS).join(" | ")}  (default: ${DEFAULT_HOST})
  --scope <s>       user | project               (default: user)
  --profile <p>     model profile to stamp, or "none" (default: none)
  --model <m>       with \`tier\`: the model for that tier
  --thinking <t>    with \`tier\`: reasoning level, or "none" to clear
  --brief           additionally write the AGENTS.md block (off by default)
  --no-skill        do not install the Staffed skill
  --write, --remove with \`brief\`: apply or undo instead of printing
  --link            symlink instead of copy (dev workflow; excludes --profile)
  --force           overwrite foreign or locally modified files
  --dry-run, -n     print what would happen
  -h, --help        this

In pi a persona is enabled purely by being present in an agents directory, so
enable/disable place and remove files. Sources are never mutated: a model profile is
applied while rendering, leaving the repo portable with no unpin step to forget.`;

const LABEL = {
  enabled: "enabled",
  disabled: "-",
  modified: "modified locally",
  replaced: "replaced",
  foreign: "not ours",
  missing: "missing (was enabled)",
};

/** The personas actually present right now, in roster order. */
const enabledNames = (opts) =>
  placement
    .status(opts)
    .items.filter((i) => i.state === "enabled")
    .map((i) => i.persona.name);

function parse(argv) {
  const opts = { scope: "user", profile: "none", mode: "copy" };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--host") opts.host = argv[++i];
    else if (a === "--scope") opts.scope = argv[++i];
    else if (a === "--profile") opts.profile = argv[++i];
    else if (a === "--model") opts.model = argv[++i];
    else if (a === "--thinking") opts.thinking = argv[++i];
    else if (a === "--brief") opts.brief = true;
    else if (a === "--no-brief") opts.brief = false;
    else if (a === "--no-skill") opts.skill = false;
    else if (a === "--write") opts.write = true;
    else if (a === "--remove") opts.remove = true;
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

const pad = (rows, i) => Math.max(...rows.map((r) => String(r[i]).length));

/** Wrap to ~86 columns with a hanging indent. */
function wrap(text, indent) {
  const out = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && `${indent}${line} ${word}`.length > 86) {
      out.push(indent + line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(indent + line);
  return out.join("\n");
}

function warnUnverified(profile) {
  if (!profile?.unverified?.length) return;
  console.log();
  console.log(
    wrap(
      `warning: tier(s) ${profile.unverified.join(", ")} in profile "${profile.key}" were seeded by ` +
        "guesswork and are not confirmed against a real install. Run `staffed doctor`, then " +
        "declare them with `staffed tier <tier> --model <m> --thinking <t>`.",
      "",
    ),
  );
}

function printTiers(profileArg) {
  const cfg = loadConfig();
  const { key, map, unverified } = resolveProfile(profileArg ?? true);
  console.log(`profile ${key}${profileArg ? "" : "  (default from models.json)"}`);
  const rows = Object.entries(map).map(([tier, t]) => [
    tier,
    t.model,
    t.thinking ?? "—",
    unverified.includes(tier) ? "unverified" : "",
  ]);
  const w = [pad(rows, 0), pad(rows, 1), pad(rows, 2)];
  console.log(`  ${"tier".padEnd(w[0])}  ${"model".padEnd(w[1])}  ${"thinking".padEnd(w[2])}`);
  for (const [t, m, th, note] of rows) {
    console.log(`  ${t.padEnd(w[0])}  ${m.padEnd(w[1])}  ${th.padEnd(w[2])}  ${note}`.trimEnd());
  }
  console.log(`\nprofiles: ${Object.keys(cfg.profiles).join(", ")}`);

  const prows = loadPersonas().map((p) => [p.name, p.tier, formatTier(map[p.tier])]);
  const pw = pad(prows, 0);
  console.log();
  for (const [n, t, m] of prows) console.log(`  ${n.padEnd(pw)}  ${t.padEnd(9)} ${m}`);
  warnUnverified({ key, unverified });
}

/** Compare configured models against what this pi install actually offers. */
async function doctor() {
  const { homedir } = await import("node:os");
  const { join } = await import("node:path");
  const { readFileSync } = await import("node:fs");
  const cfg = loadConfig();
  console.log(`env     PI_MODEL=${process.env.PI_MODEL ?? "—"} PI_REASONING_LEVEL=${process.env.PI_REASONING_LEVEL ?? "—"}`);
  console.log(`        PI_PROVIDER=${process.env.PI_PROVIDER ?? "—"}`);

  let known = new Set();
  try {
    const m = JSON.parse(readFileSync(join(homedir(), ".pi", "agent", "models.json"), "utf8"));
    for (const p of Object.values(m.providers ?? {})) for (const x of p.models ?? []) known.add(x.id);
  } catch {
    console.log("\ncould not read ~/.pi/agent/models.json — cannot verify model ids");
  }
  if (process.env.PI_MODEL) known.add(process.env.PI_MODEL);

  console.log(`\nmodels known to this install: ${known.size || "none"}`);
  for (const [key, tiers] of Object.entries(cfg.profiles)) {
    if (key === "inherit") continue;
    console.log(`\nprofile ${key}`);
    for (const [tier, raw] of Object.entries(tiers)) {
      const t = normalizeTier(raw);
      const ok = known.size === 0 ? "?" : known.has(t.model) ? "ok" : "NOT FOUND";
      console.log(`  ${tier.padEnd(9)} ${formatTier(t).padEnd(30)} ${ok}`);
    }
  }
  console.log("\n`NOT FOUND` on a non-pi profile is expected — those models belong to another host.");
  return 0;
}

function printStatus(s) {
  console.log(`host    ${s.host.label} (${s.host.key})`);
  console.log(`scope   ${s.scope}`);
  console.log(`dir     ${s.dir}`);
  console.log(
    s.manifest
      ? `updated v${s.manifest.version}, ${s.manifest.updatedAt}`
      : "manifest none — nothing enabled here",
  );
  console.log();
  const rows = s.items.map((i) => [i.persona.name, i.persona.tier, LABEL[i.state] ?? i.state, modelOf(i)]);
  const w = [pad(rows, 0), pad(rows, 1), pad(rows, 2)];
  for (const [n, t, st, m] of rows) {
    console.log(`  ${n.padEnd(w[0])}  ${t.padEnd(w[1])}  ${st.padEnd(w[2])}  ${m}`.trimEnd());
  }
  const enabled = s.items.filter((i) => i.state === "enabled").map((i) => i.persona.name);
  const drift = s.items.filter((i) => !["enabled", "disabled"].includes(i.state));
  console.log(`\n${enabled.length}/${s.items.length} enabled`);
  if (drift.length) console.log(`${drift.length} file(s) differ from the manifest`);

  // Discovery health matters as much as placement: enabled personas that nothing points at
  // are personas the host session will never find.
  const k = inspectSkill(s.host.skillDir(s.scope, process.cwd()), enabled, loadPersonas());
  const b = inspectBrief(s.host.briefFile(s.scope, process.cwd()), enabled);

  const line = (label, state, file, missing) => {
    const text = {
      current: "current",
      stale: `STALE — does not match what is enabled; re-run \`staffed enable\``,
      absent: missing,
    }[state];
    console.log(`${label.padEnd(8)} ${text}\n         ${file}`);
  };

  line("skill", k.state, k.file, enabled.length ? "MISSING — nothing tells the host these personas exist" : "absent");
  if (b.state !== "absent") line("brief", b.state, b.file, "absent");
}

const modelOf = (i) => (i.tracked?.profile && i.tracked.profile !== "none" ? `profile ${i.tracked.profile}` : "");

export async function main(argv = process.argv.slice(2)) {
  const { opts, rest } = parse(argv);
  const cmd = rest[0] ?? "help";
  const names = rest.slice(1);

  if (opts.help || cmd === "help") {
    console.log(HELP);
    return 0;
  }

  if (cmd === "list") {
    const rows = loadPersonas().map((p) => [p.name, p.tier ?? "?", p.meta.description ?? ""]);
    const w = pad(rows, 0);
    for (const [n, t, d] of rows) console.log(`  ${n.padEnd(w)}  ${t.padEnd(9)} ${d.split(". ")[0]}.`);
    console.log(`\n${rows.length} personas`);
    return 0;
  }

  if (cmd === "tier" || cmd === "models") {
    // `tier --profile X` with no tier name switches the default profile.
    if (!names.length && opts.model === undefined && opts.thinking === undefined) {
      if (opts.profile !== "none" && argv.includes("--profile")) {
        printTiers(setProfile(opts.profile));
        return 0;
      }
      printTiers();
      return 0;
    }
    if (!names.length) throw new Error("which tier? e.g. `staffed tier deep --model X --thinking xhigh`");
    const r = setTier(argv.includes("--profile") ? opts.profile : null, names[0], opts);
    console.log(`profile ${r.profile}: ${r.tier} -> ${formatTier(r.config)}\n`);
    printTiers(r.profile);
    return 0;
  }

  if (cmd === "doctor") return doctor();

  if (cmd === "skill") {
    const host = resolveHost(opts.host);
    const enabled = enabledNames(opts);
    if (!enabled.length) {
      console.error(`nothing is enabled for host ${host.label} (${opts.scope} scope).`);
      return 1;
    }
    console.log(`# would go in ${host.skillDir(opts.scope, process.cwd())}/staffed/SKILL.md\n`);
    console.log(skillText(enabled, loadPersonas()));
    return 0;
  }

  if (cmd === "brief") {
    const host = resolveHost(opts.host);
    const file = host.briefFile(opts.scope, process.cwd());
    const enabled = enabledNames(opts);
    if (!enabled.length && !opts.remove) {
      console.error(`nothing is enabled for host ${host.label} (${opts.scope} scope), so there is no brief to write.`);
      return 1;
    }
    if (opts.remove) {
      const r = removeBrief(file);
      console.log(`${r.action}: ${r.file}`);
      return 0;
    }
    if (opts.write) {
      const r = writeBrief(file, enabled);
      console.log(`${r.action}: ${r.file}`);
      return 0;
    }
    console.log(`# would go in ${file}\n`);
    console.log(generate(enabled));
    return 0;
  }

  if (cmd === "validate") {
    const personas = loadPersonas();
    const problems = validate(personas, STAGES);
    console.log(`${personas.length} personas`);
    if (!problems.length) {
      console.log("0 problems");
      return 0;
    }
    console.error(`\n${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    return 1;
  }

  if (cmd === "status") {
    printStatus(placement.status(opts));
    return 0;
  }

  if (cmd === "enable" || cmd === "install") {
    const problems = validate(loadPersonas(), STAGES);
    if (problems.length) {
      console.error(`refusing to enable — roster has ${problems.length} problem(s):`);
      for (const p of problems) console.error(`  - ${p}`);
      return 1;
    }
    const r = placement.enable({ ...opts, only: names });
    const verb = r.dryRun ? "would enable" : r.mode === "link" ? "linked" : "enabled";
    console.log(`${verb} ${r.items.length}${names.length ? "" : " (all)"} -> ${r.dir}`);
    console.log(
      `host ${r.host.label}, scope ${r.scope}, profile ${r.profile.key}, mode ${r.mode}` +
        (r.enabledTotal ? `, ${r.enabledTotal} enabled in total` : ""),
    );
    if (r.dryRun) for (const i of r.items) console.log(`  ${i.file}  (${LABEL[i.state] ?? i.state})`);

    // Personas are invisible on their own, so discovery ships with them. Both artefacts are
    // regenerated from the set that is actually enabled rather than assuming a full roster.
    if (!r.dryRun) {
      const enabled = enabledNames(opts);
      if (opts.skill !== false) {
        const s = writeSkill(r.host.skillDir(r.scope, process.cwd()), enabled, loadPersonas());
        console.log(`skill ${s.action}: ${s.file}`);
      }
      if (opts.brief === true) {
        const b = writeBrief(r.host.briefFile(r.scope, process.cwd()), enabled);
        console.log(`brief ${b.action}: ${b.file}`);
      }
    }

    const notes = [...(r.host.notes ?? [])];
    if (r.scope === "project") notes.push("This directory is committable — the roster travels with the repo.");
    if (notes.length) {
      console.log("\nnotes");
      for (const n of notes) console.log(wrap(n, "  "));
    }
    warnUnverified(r.profile);
    return 0;
  }

  if (cmd === "disable" || cmd === "uninstall") {
    const r = placement.disable({ ...opts, only: names });
    console.log(`disabled ${r.removed.length}${r.removed.length ? `: ${r.removed.join(", ")}` : ""}`);
    console.log(`${r.remaining} still enabled in ${r.dir}`);

    // Follow whatever is actually present rather than the flags: shrink discovery to the
    // remaining roster, or take it away entirely once nothing is left.
    const host = resolveHost(opts.host);
    const enabled = enabledNames(opts);
    const dir = host.skillDir(opts.scope, process.cwd());

    if (opts.skill !== false) {
      const s = enabled.length ? writeSkill(dir, enabled, loadPersonas()) : removeSkill(dir);
      if (s.action !== "absent") console.log(`skill ${s.action}: ${s.file}`);
    }
    if (opts.brief !== false) {
      const file = host.briefFile(opts.scope, process.cwd());
      const b = enabled.length ? writeBrief(file, enabled) : removeBrief(file);
      if (b.action !== "absent") console.log(`brief ${b.action}: ${b.file}`);
    }
    if (r.kept.length) {
      console.log(`kept ${r.kept.length} locally modified: ${r.kept.join(", ")} (use --force)`);
    }
    return 0;
  }

  console.error(`unknown command "${cmd}"\n${HELP}`);
  return 2;
}
