// The Staffed skill: how a host session learns the roster exists and how to run it.
//
// Agents are invisible — `subagent` surfaces them only in error messages. Skills are the
// inverse: pi puts every skill's name and description in the system prompt at startup and
// loads the body on demand. So the skill is the discovery mechanism, and the personas are
// the workers it dispatches.
//
// The description is deliberately written as a gate rather than an invitation. Whether a
// piece of work deserves a staffed workflow is a question about intent, which lives with
// the user and is not inferable from a prompt, so the model is told to wait to be asked.
// Keeping the skill visible (rather than disable-model-invocation) is what lets "use the
// "staff this project" work in plain English instead of requiring a slash command.

import { join } from "node:path";
import { DEFAULT_PACK, dimensionsFor, resolvePack } from "./packs.mjs";

export const SKILL_NAME = "staffed";

const wrap = (text, width = 88) => {
  const out = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && `${line} ${word}`.length > width) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out.join("\n");
};

function chain(stages) {
  const parts = [];
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    if (s.parallel && stages[i + 1]?.parallel) {
      parts.push(`\`${s.name}\` and \`${stages[++i].name}\``);
    } else parts.push(`\`${s.name}\``);
  }
  return parts.join(" → ");
}

/** Generate SKILL.md for a specific set of enabled personas. */
export function generateSkill({ hostKey = "pi", enabled, personas = [], pack: packName = DEFAULT_PACK, catalog }) {
  const claude = hostKey === "claude";
  const codex = hostKey === "codex";
  const codexOrClaude = codex || claude;
  const invocation = claude ? "/staffed" : codex ? "$staffed" : "/skill:staffed";
  const workerLabel = claude ? "Agent" : codex ? "Codex subagent" : "subagent";
  const dispatchTool = claude ? "Agent" : codex ? "Codex subagents" : "the `subagent` tool";
  const pack = resolvePack(packName, catalog);
  const set = new Set(enabled);
  const stages = pack.stages.filter((s) => set.has(s.name));
  const partial = stages.length < pack.stages.length;
  const has = (n) => set.has(n);
  const persona = (n) => personas.find((p) => p.name === n);
  const blurb = (n) => persona(n)?.summary ?? "";
  const enabledRoleNames = stages.map((stage) => stage.name);
  const configuredActivationExamples = pack.activationExamples.filter((example) =>
    example.split(/\s+/).some((token) => enabledRoleNames.includes(token)),
  );
  const activationExamples = (configuredActivationExamples.length
    ? configuredActivationExamples
    : enabledRoleNames.slice(0, 2).map((name) => `${name} scep dir`))
    .map((example) => `"${example}"`)
    .join(" or ");
  const availableRecipes = pack.recipes.filter((recipe) => recipe.composition.some((token) => set.has(token)));
  const receiptRecipe = availableRecipes[0];
  const receiptExample = receiptRecipe
    ? `Dispatching ${receiptRecipe.composition.join(" + ")}: ${receiptRecipe.goal}`
    : `Dispatching ${stages[0]?.name ?? "role"}: plain role defaults.`;

  // A partial roster can collapse multiple work sizes onto the same remaining chain.
  // Merge their labels rather than printing duplicate rows.
  const byChain = new Map();
  for (const r of pack.sizing) {
    const c = (r.chain ?? stages.map((s) => s.name)).filter(has);
    if (!c.length) continue;
    const key = c.join(" → ");
    byChain.set(key, [...(byChain.get(key) ?? []), r.work]);
  }
  const rows = [...byChain].map(([c, works]) => `| ${works.join(" or ")} | ${c} |`);

  const body = [
    "---",
    `name: ${SKILL_NAME}`,
    "description: >-",
    ...wrap(
      `Staff a project with ${pack.label}${pack.experimental ? " (experimental preview)" : ""}, a coordinated ${workerLabel} roster for ${pack.description.toLowerCase()} Use ` +
        `ONLY when explicitly engaged: "staff this project", "use Staffed", ${invocation}, ` +
        `or a request combining one of these exact enabled Staffed roles with behavioral modifiers or aliases: ${enabledRoleNames.join(", ")}, or a request to launch a subagent at a named tier (fast, balanced, strong, or deep) or with a concrete model — model selection, not roster work. ` +
        `Examples: ${activationExamples}. ` +
        `${codexOrClaude ? "Do NOT use for ordinary prompts, including edits, bug fixes, refactors, reviews or questions" : "Do NOT use for ordinary edits, bug fixes, refactors, reviews or questions"} — those are ` +
        "faster done directly.",
      84,
    )
      .split("\n")
      .map((l) => `  ${l}`),
    "---",
    "",
    "# Staffed",
    "",
    wrap(
      "You are the orchestrator, not a worker. Decompose the goal, dispatch the smallest sufficient " +
        `set of personas with ${dispatchTool}, validate their output contracts, and loop back ` +
        "only when a material failure requires it. One persona is a valid staffed pipeline.",
    ),
    "",
    wrap(
      "Other subagent rosters and delegation skills may be installed alongside Staffed; while " +
        "Staffed is engaged it owns delegation. Dispatch only Staffed personas, treat their names " +
        "as authoritative when another roster defines the same one, and keep Staffed sizing, " +
        "effort, escalation, and artifact contracts in force instead of blending in other " +
        "rosters' agents, recipes, or workflow conventions.",
    ),
    "",
    "## Size the pipeline to the work",
    "",
    wrap(
      "Default to one actor. Every additional stage must resolve a named uncertainty or material " +
        "risk that the current actor cannot own. Dispatching adds latency, cost, and a fresh context, " +
        "so never add a persona merely because the work can be split further.",
    ),
    "",
    "| Work | Chain |",
    "|---|---|",
    ...rows,
    "",
    wrap(
      "Skipping stages is normal. Reach for the full pipeline only when the matter is genuinely " +
        "new and uncertain. Before launching more than two personas, state the planned dispatch " +
        "count and the specific risk or unknown each one resolves; shrink the plan if that case is weak.",
    ),
    "",
    "## Risk gates",
    "",
    wrap(pack.riskGate),
    "",
    "## Compact by default",
    "",
    wrap(
      "Ask every persona for the shortest artifact that lets the next decision or action succeed. " +
        "It must not restate upstream context, fill sections with speculative possibilities, or keep " +
        "investigating after its definition of done is met. Expand only when complexity, evidence, or " +
        "risk requires it. For a bounded task, prefer one compact artifact over a design document plus " +
        "a duplicate task document.",
    ),
    "",
    "## Effort and escalation",
    "",
    wrap(
      "Every dispatch starts at effort `low` unless the user requested otherwise or approved an " +
        "escalation. Put `Effort: low`, `Effort: medium`, or `Effort: high` in the task. Effort controls " +
        "how far the persona investigates, not the care or correctness of its work. Low means the " +
        "shortest credible pass, not a careless one.",
    ),
    "",
    wrap(
      "Before expanding, ask: can downstream act; could the remaining uncertainty materially change " +
        "that action; and is the next investigation likely to resolve it? Stop when the handoff is " +
        "dependable and more work is unlikely to change it. Do not silently raise effort.",
    ),
    "",
    wrap(
      "When material uncertainty remains, the persona stops and returns an `## Escalation` naming " +
        "`Axis` (`effort`, `tier`, or `both`), `Requested`, `Reason`, `Expected gain`, and `Safe fallback`. " +
        "Approve more effort when additional investigation can resolve the issue; approve a higher " +
        "model tier when stronger synthesis is needed; route to another persona when the work belongs " +
        "elsewhere. The parent decides whether to redispatch. Never turn a completed advisory stage " +
        "into deeper planning or implementation without the user's approval.",
    ),
    "",
    "## Compose a role (optional)",
    "",
    wrap(
      "A composition is one role plus at most one mode from each optional dimension: stance, drive, lens, audience, and voice. Default to the plain role and add a modifier only when the user requested it or it addresses a named uncertainty or risk. Honor user modifiers. Every selected modifier must earn a material change; never fill every dimension by default. Modifiers never override role scope, correctness, effort, model tier, safety, permissions, or output contracts.",
    ),
    "",
    ...dimensionsFor(pack.key, catalog).flatMap((dimension) => {
      const render = (label, modes) => `${label}: ${modes.map((mode) => `\`${mode.name}\` (\`${mode.alias}\`)`).join(", ")}`;
      if (dimension.name !== "audience") return [render(dimension.name, dimension.modes)];
      const packNames = new Set(pack.audiences.map((mode) => mode.name));
      return [render("audience (core)", dimension.modes.filter((mode) => !packNames.has(mode.name))), render(`audience (${pack.key})`, pack.audiences)];
    }),
    "",
    `roles: ${stages.map((stage) => `\`${stage.name}\``).join(", ")}`,
    "",
    wrap(
      `Matching is case-insensitive but exact: accept only canonical names or listed aliases, never arbitrary prefixes. If a modifier appears, the user asks about options, or you must select a composition, read \`references/composition.md\` before dispatching. Otherwise do not load it. Before dispatch, state a one-line receipt such as \`${receiptExample}\` Repeat that exact canonical receipt in the final response so non-interactive callers retain it. A receipt is not enough: the persona task itself must include \`Composition:\` with canonical role and mode names plus one concise \`Behavior:\` line for every selected mode, copied from that mode's \`Dispatch behavior\` in the reference. Explicitly tell the persona that role scope, truth, correctness, safety, effort, model tier, permissions, and output contracts take precedence over every modifier.`,
    ),
    "",
    "Recipes:",
    ...availableRecipes.slice(0, 5).map((recipe) => `- ${recipe.goal} — ${recipe.composition.map((token) => `\`${token}\``).join(" + ")}`),
    "",
    "## The roster",
    "",
    "| Persona | Default tier | Default effort | Dispatch it for |",
    "|---|---|---|---|",
    ...stages.map((s) => {
      const p = persona(s.name);
      return `| \`${s.name}\` | ${p?.tier ?? "inherit"} | ${p?.effort ?? "low"} | ${blurb(s.name) || s.role} |`;
    }),
    "",
    wrap(
      "Route by each persona's `description`, which states what it owns and what it must refuse. " +
        "One persona, one job. Full order when you do run end to end: " +
        `${chain(stages)}.`,
    ),
    "",
    "## Model tiers",
    "",
    wrap(
      "A persona's tier names a row in `models.json`, which maps `fast`, `balanced`, `strong`, and `deep` to concrete " +
        "model + thinking values: the part of Staffed that works without any persona. When the user names a tier " +
        "(\"launch a deep tier subagent\") or an escalation approves a higher tier, run `staffed tier --compact` to " +
        "load this machine's four rows into context, then pass the row's model when dispatching. On pi, spell it " +
        "`model:thinking` when thinking is set; hosts without per-agent thinking take the model alone. Never guess a " +
        "model from the roster table above, which carries only tier names, and do not read a persona file for the " +
        "mapping: `staffed tier --compact` is the lightweight source, fresh from this machine's `models.json` and " +
        "reflecting profile switches and local edits. An explicit concrete-model request is also a control, not a " +
        "modifier: preserve the user's exact model string and pass it as the dispatch `model`, with any requested " +
        "Pi thinking suffix, instead of resolving or replacing it with a tier. If both a role and model are named, " +
        "the explicit model overrides that role's default tier for that dispatch. For a casual model request such as " +
        "`Opus`, `latest Sonnet`, or `Sol`, and only when the host is Pi, first try `pi --list-models <search>` " +
        "with the user's distinctive model terms; use the provider and model columns as candidates and choose an " +
        "exact, clearly matching ID. This lists Pi's available catalog, not necessarily the current interactive " +
        "session's `/scoped-models` set. If the command is unavailable, fails, returns no candidates, or the match " +
        "is ambiguous, continue by interpreting the request from context; do not invent an ID or block the staffed " +
        "dispatch. Non-Pi hosts skip the command entirely. Tier or model dispatch is model selection, not roster " +
        "engagement: no persona runs unless the user asked for staffed work.",
    ),
  ];

  if (partial) {
    const missing = pack.stages.filter((s) => !set.has(s.name)).map((s) => s.name);
    body.push(
      "",
      wrap(`Not installed: ${missing.join(", ")} — cover those stages yourself or skip them.`),
    );
  }

  const artifactExceptions = [
    ...pack.noDirectory.filter(has).map((name) => pack.noArtifact.includes(name) ? `\`${name}\` writes nothing` : `\`${name}\`'s artifact is its assigned work itself`),
  ];
  body.push(
    "",
    "## Passing work between personas",
    "",
    wrap(
      "Each artifact-owning persona writes to `artifacts/<agent>/index.md` and returns that path. " +
        (codexOrClaude ? "" : "For a canonical artifact dispatch, make one foreground `subagent` call with `output: false`; never set the tool's `output` path, because that path becomes authoritative and relocates the artifact under the subagent runtime. Do not revive or redispatch a completed persona merely to repair an output path. ") +
        "Pass paths downstream, never the full document — that keeps context flat across a long " +
        "pipeline." +
        (artifactExceptions.length ? ` Exceptions: ${artifactExceptions.join("; ")}.` : ""),
    ),
  );

  const loops = pack.loops
    .filter((loop) => loop.requires.every(has))
    .map((loop) => `- ${loop.text}`);
  if (loops.length) body.push("", "## Loops", "", ...loops);

  if (!codexOrClaude) {
    const parallel = pack.parallelism
      .filter((item) => item.requires.every(has))
      .map((item) => item.text);
    if (parallel.length) body.push("", "## Parallelism", "", wrap(parallel.join(" ")));
  }
  body.push("");
  return body.join("\n");
}

export function generateCompositionReference({ pack: packName = DEFAULT_PACK, personas = [], catalog } = {}) {
  const pack = resolvePack(packName, catalog);
  const roster = personas.length ? personas : pack.personas;
  const lines = [
    "# Staffed composition reference", "",
    `Active staff pack: **${pack.label}**${pack.experimental ? " — experimental preview" : ""}.`, "",
    "A dimension is a configurable axis; a mode is an available value; a selected mode is a modifier; one role plus modifiers is a composition. Select at most one mode per dimension. Controls such as effort, model tier, permissions, safety, and output contracts are never modifiers and always take precedence.", "",
    "Use modifiers sparsely. Preserve explicit user modifiers, explain what agent-selected modifiers earn, and default to the plain role.", "",
  ];
  for (const dimension of dimensionsFor(pack.key, catalog)) {
    lines.push(`## ${dimension.name}`, "", dimension.question, "");
    const packNames = new Set(pack.audiences.map((mode) => mode.name));
    for (const mode of dimension.modes) {
      if (dimension.name === "audience" && mode === dimension.modes[0]) lines.push("### Core audiences", "");
      if (dimension.name === "audience" && packNames.has(mode.name) && !packNames.has(dimension.modes[dimension.modes.indexOf(mode) - 1]?.name)) lines.push(`### ${pack.label} audiences`, "");
      const heading = dimension.name === "audience" ? "####" : "###";
      lines.push(`${heading} ${mode.name} (\`${mode.alias}\`)`, "", mode.summary, "", `Dispatch behavior: ${mode.phrase}.`, "", `Useful for: ${mode.usefulFor}.`, "", `Watch for: ${mode.shadow}.`, "");
    }
  }
  lines.push("## Roles", "");
  for (const persona of roster) lines.push(`### ${persona.name}`, "", persona.meta.description, "");
  lines.push("## Recipes", "");
  const roleNames = new Set(roster.map((persona) => persona.name));
  for (const recipe of pack.recipes.filter((item) => item.composition.some((token) => roleNames.has(token)))) lines.push(`### ${recipe.name}`, "", recipe.goal, "", recipe.composition.map((token) => `\`${token}\``).join(" + "), "");
  lines.push("## Composition rules", "", "- Matching is case-insensitive exact-token matching against canonical names and declared aliases.", "- One role is required; one mode maximum per optional dimension.", "- A modifier changes approach, not authority, truth, correctness, or scope.", "- Give a one-line canonical composition receipt before dispatch and repeat it in the final response.", "- Put the canonical composition and every selected mode's Dispatch behavior in the persona task; role, safety, controls, and output contracts always take precedence.", "");
  return lines.join("\n");
}

export const generate = (enabled, personas = []) => generateSkill({ hostKey: "pi", enabled, personas });
export const skillPath = (dir) => join(dir, SKILL_NAME, "SKILL.md");
export const compositionReferencePath = (dir) => join(dir, SKILL_NAME, "references", "composition.md");
