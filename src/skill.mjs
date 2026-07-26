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

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
  { work: "a copy tweak", chain: ["writer"] },
  { work: "a bug fix", chain: ["builder", "reviewer"] },
  { work: "a feature", chain: ["pm", "architect", "builder", "reviewer"] },
  { work: "a new product", chain: null },
];

/** Generate SKILL.md for a specific set of enabled personas. */
export function generate(enabled, personas = []) {
  const set = new Set(enabled);
  const stages = STAGES.filter((s) => set.has(s.name));
  const partial = stages.length < STAGES.length;
  const has = (n) => set.has(n);
  const blurb = (n) => personas.find((p) => p.name === n)?.summary ?? "";

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
      "Staff a project with a coordinated product org of subagent personas — research, PRD, UX, " +
        "copy, design, architecture, implementation, review, release, launch, and metrics. Use " +
        'ONLY when explicitly engaged: "staff this project", "use Staffed", or /skill:staffed. ' +
        "Do NOT use for ordinary edits, bug fixes, refactors, reviews or questions — those are " +
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
      "You are the orchestrator, not a worker. Decompose the goal, dispatch personas with the " +
        "`subagent` tool, validate each one's output contract, and loop back on failures. Do not " +
        "do a persona's job yourself — that is the whole point of having them.",
    ),
    "",
    "## Size the pipeline to the work",
    "",
    wrap(
      "Every stage must earn its place. Dispatching costs a round trip, so run the shortest chain " +
        "that covers the actual risk, and do trivial subtasks inline rather than delegating them.",
    ),
    "",
    "| Work | Chain |",
    "|---|---|",
    ...rows,
    "",
    wrap(
      "Skipping stages is normal. Reach for the full pipeline when the work is genuinely new and " +
        "uncertain, not because the personas exist.",
    ),
    "",
    "## The roster",
    "",
    "| Persona | Dispatch it for |",
    "|---|---|",
    ...stages.map((s) => `| \`${s.name}\` | ${blurb(s.name) || s.role} |`),
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

  body.push(
    "",
    "## Passing work between personas",
    "",
    wrap(
      "Each persona writes its output to `artifacts/<agent>/index.md` and returns that path. Pass " +
        "paths downstream, never the full document — that is what keeps your context flat across a " +
        "long pipeline. `builder`'s artifact is the code itself and `reviewer` writes nothing, so " +
        "neither owns a directory.",
    ),
    "",
    "## Loops",
    "",
    "- A `request-changes` verdict goes back to `builder`, not to you. Do not patch it yourself.",
    "- A cross-boundary escalation from `builder` goes back to `architect` for a decision.",
    "- An `analyst` readout starts the next cycle at `pm`.",
    "",
    "## Parallelism",
    "",
    wrap(
      "Fan out `builder`s with `worktree: true` (add `worktreeSetup: \"node-modules\"` when the tree " +
        "needs deps); the architect marks which tasks are parallel-safe. Parallel `reviewer`s in one " +
        "checkout need `allowParallelWrites: true` — they are fenced by contract, not by capability.",
    ),
    "",
  );

  return body.join("\n");
}

export const skillPath = (dir) => join(dir, SKILL_NAME, "SKILL.md");

export function inspectSkill(dir, enabled, personas) {
  const file = skillPath(dir);
  if (!existsSync(file)) return { file, state: "absent" };
  const text = readFileSync(file, "utf8");
  return { file, state: text === generate(enabled, personas) ? "current" : "stale" };
}

export function writeSkill(dir, enabled, personas) {
  const file = skillPath(dir);
  const next = generate(enabled, personas);
  const existed = existsSync(file);
  if (existed && readFileSync(file, "utf8") === next) return { file, action: "unchanged" };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, next);
  return { file, action: existed ? "updated" : "created" };
}

export function removeSkill(dir) {
  const file = skillPath(dir);
  if (!existsSync(file)) return { file, action: "absent" };
  rmSync(dirname(file), { recursive: true, force: true });
  return { file, action: "removed" };
}
