// The Staffed skill: how a host session learns the roster exists and how to run it.
//
// Agents are invisible — `subagent` surfaces them only in error messages. Skills are the
// inverse: pi puts every skill's name and description in the system prompt at startup and
// loads the body on demand. So the skill is the discovery mechanism, and the personas are
// the workers it dispatches.
//
// The description is deliberately written as a gate rather than an invitation. Whether a
// piece of work deserves a product pipeline is a question about intent, which lives with
// the user and is not inferable from a prompt, so the model is told to wait to be asked.
// Keeping the skill visible (rather than disable-model-invocation) is what lets "use the
// "staff this project" work in plain English instead of requiring a slash command.

import { join } from "node:path";
import { STAGES } from "./brief.mjs";

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

/** Size the pipeline to the work. Only rows whose personas are enabled are shown. */
const SIZING = [
  { work: "a copy or docs change", chain: ["writer"] },
  { work: "a small bug or config change", chain: ["builder"] },
  { work: "a well-specified feature", chain: ["builder"] },
  { work: "a cross-boundary feature", chain: ["architect", "builder"] },
  { work: "an ambiguous product feature", chain: ["pm", "architect", "builder"] },
  { work: "a new product", chain: null },
];

/** Generate SKILL.md for a specific set of enabled personas. */
export function generateSkill({ hostKey = "pi", enabled, personas = [] }) {
  const claude = hostKey === "claude-code";
  const set = new Set(enabled);
  const stages = STAGES.filter((s) => set.has(s.name));
  const partial = stages.length < STAGES.length;
  const has = (n) => set.has(n);
  const persona = (n) => personas.find((p) => p.name === n);
  const blurb = (n) => persona(n)?.summary ?? "";

  // A partial roster can collapse two sizes onto the same chain (drop `architect` and a
  // feature looks like a product). Merge the labels rather than printing the row twice.
  const byChain = new Map();
  for (const r of SIZING) {
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
      `Staff a project with a coordinated product org of ${claude ? "Agent" : "subagent"} personas — research, PRD, UX, ` +
        "copy, design, architecture, implementation, review, release, launch, and metrics. Use " +
        `ONLY when explicitly engaged: "staff this project", "use Staffed", or ${claude ? "/staffed" : "/skill:staffed"}. ` +
        `${claude ? "Do NOT use for ordinary prompts, including edits, bug fixes, refactors, reviews or questions" : "Do NOT use for ordinary edits, bug fixes, refactors, reviews or questions"} — those are ` +
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
        `set of personas with ${claude ? "Agent" : "the `subagent` tool"}, validate their output contracts, and loop back ` +
        "only when a material failure requires it. One persona is a valid staffed pipeline.",
    ),
    "",
    "## Size the pipeline to the work",
    "",
    wrap(
      "Default to one actor. Every additional stage must resolve a named uncertainty or material " +
        "risk that the current actor cannot own. Dispatching adds latency, cost, and a fresh context, " +
        "so never add a persona merely because the work can be called a feature.",
    ),
    "",
    "| Work | Chain |",
    "|---|---|",
    ...rows,
    "",
    wrap(
      "Skipping stages is normal. Reach for the full pipeline only when the product is genuinely " +
        "new and uncertain. Before launching more than two personas, state the planned dispatch " +
        "count and the specific risk or unknown each one resolves; shrink the plan if that case is weak.",
    ),
    "",
    "## Risk gates",
    "",
    wrap(
      "Do not add `reviewer` automatically. Add it when the change touches security, authentication, " +
        "user data, destructive or irreversible state, migrations, public compatibility, deployment " +
        "safety, broad cross-module behavior, or cannot be validated well by tests. Add `architect` " +
        "only for a shared interface, multiple subsystem boundaries, or multiple independent build " +
        "tasks. Add `pm` only when what or why remains unresolved; add `researcher` only when an " +
        "external fact or feasibility question blocks that decision.",
    ),
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
  ];

  if (partial) {
    const missing = STAGES.filter((s) => !set.has(s.name)).map((s) => s.name);
    body.push(
      "",
      wrap(`Not installed: ${missing.join(", ")} — cover those stages yourself or skip them.`),
    );
  }

  const artifactExceptions = [
    has("builder") ? "`builder`'s artifact is the code itself" : "",
    has("reviewer") ? "`reviewer` writes nothing" : "",
  ].filter(Boolean);
  body.push(
    "",
    "## Passing work between personas",
    "",
    wrap(
      "Each artifact-owning persona writes to `artifacts/<agent>/index.md` and returns that path. " +
        "Pass paths downstream, never the full document — that keeps context flat across a long " +
        "pipeline." +
        (artifactExceptions.length ? ` Exceptions: ${artifactExceptions.join("; ")}.` : ""),
    ),
  );

  const loops = [];
  if (has("reviewer") && has("builder")) {
    loops.push(
      "- A material `request-changes` verdict goes back to `builder`; keep revision scope to the findings.",
      "- Re-review only the prior findings and changed hunks unless a fix alters a foundational contract.",
      "- Do not launch a second reviewer for low-risk nits or changes already proven by focused validation.",
    );
  }
  if (has("builder") && has("architect")) {
    loops.push("- A cross-boundary escalation from `builder` goes back to `architect` for a decision.");
  }
  if (has("analyst") && has("pm")) loops.push("- An `analyst` readout starts the next cycle at `pm`.");
  if (loops.length) body.push("", "## Loops", "", ...loops);

  if (!claude) {
    const parallel = [];
    if (has("builder")) parallel.push("Fan out `builder`s only for independent tasks and use `worktree: true` (plus `worktreeSetup: \"node-modules\"` when needed).");
    if (has("reviewer")) parallel.push("Parallel `reviewer`s in one checkout need `allowParallelWrites: true`; they are fenced by contract.");
    if (parallel.length) body.push("", "## Parallelism", "", wrap(parallel.join(" ")));
  }
  body.push("");
  return body.join("\n");
}

export const generate = (enabled, personas = []) => generateSkill({ hostKey: "pi", enabled, personas });
export const skillPath = (dir) => join(dir, SKILL_NAME, "SKILL.md");
