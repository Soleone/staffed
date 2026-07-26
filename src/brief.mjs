// The orchestration brief.
//
// This is not optional garnish. The subagent extension surfaces the roster only inside
// error messages — there is no system-prompt injection and the tool description does not
// enumerate agents — so a host session cannot discover these personas on its own. The
// brief in AGENTS.md is what makes them reachable, and what carries the parts no single
// persona can state: pipeline order, the artifact convention, and the escalation loop.
//
// It is generated rather than pasted so it can never describe personas that are not
// enabled.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const START = "<!-- staffed:start -->";
const END = "<!-- staffed:end -->";

/** Canonical pipeline order. `validate` checks this covers the roster exactly. */
export const STAGES = [
  { name: "researcher", role: "evidence" },
  { name: "pm", role: "PRD, scope, metrics" },
  { name: "ux", role: "flows, IA, states", parallel: true },
  { name: "artist", role: "visual + audio assets", parallel: true },
  { name: "writer", role: "the words" },
  { name: "architect", role: "system design, task breakdown" },
  { name: "builder", role: "one task; escalates cross-boundary changes" },
  { name: "reviewer", role: "read-only, adversarial verdict" },
  { name: "ops", role: "rollout, rollback" },
  { name: "marketer", role: "positioning, launch" },
  { name: "analyst", role: "metrics, readout" },
];

/** Render the pipeline chain, joining the parallel pair with "and". */
function chain(stages) {
  const parts = [];
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    const next = stages[i + 1];
    const text = `\`${s.name}\` (${s.role})`;
    if (s.parallel && next?.parallel) {
      parts.push(`${text} and \`${next.name}\` (${next.role})`);
      i++;
    } else parts.push(text);
  }
  return parts.join(" → ");
}

/** Wrap to 88 columns so the block reads well inside someone else's AGENTS.md. */
function wrap(text) {
  const out = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && `${line} ${word}`.length > 88) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out.join("\n");
}

/** Generate the brief for a specific set of enabled personas. */
export function generate(enabled) {
  const set = new Set(enabled);
  const stages = STAGES.filter((s) => set.has(s.name));
  const partial = stages.length < STAGES.length;

  const body = [
    "## Staffed",
    "",
    wrap(
      "This project has a product org available as subagents, dispatched with the `subagent` " +
        "tool. You are the orchestrator: default to one persona, add a stage only for a named " +
        "uncertainty or material risk, validate compact outputs, and loop back only on material failures.",
    ),
    "",
    wrap(`Pipeline: ${chain(stages)}.`),
    "",
    wrap(
      "The pipeline above is an ordering reference, not a prescription. Use `reviewer` only for " +
        "material risk, `architect` only for shared boundaries or multiple tasks, and `pm` only " +
        "when scope is unresolved. Before more than two dispatches, state what each one earns. " +
        "Require the shortest artifact that enables the next action, pass its path downstream, " +
        "and re-review only prior findings and changed hunks.",
    ),
  ];

  if (partial) {
    const missing = STAGES.filter((s) => !set.has(s.name)).map((s) => s.name);
    body.push(
      "",
      wrap(
        `Only these personas are enabled: ${stages.map((s) => s.name).join(", ")}. ` +
          `Not available: ${missing.join(", ")} — cover those stages yourself or skip them.`,
      ),
    );
  }

  return `${START}\n${body.join("\n")}\n${END}`;
}

const section = (text) => {
  const a = text.indexOf(START);
  const b = text.indexOf(END);
  return a === -1 || b === -1 || b < a ? null : { start: a, end: b + END.length };
};

/** absent (no file / no block), current, or stale. */
export function inspectBrief(file, enabled) {
  if (!existsSync(file)) return { file, state: "absent", exists: false };
  const text = readFileSync(file, "utf8");
  const found = section(text);
  if (!found) return { file, state: "absent", exists: true };
  const block = text.slice(found.start, found.end);
  return { file, state: block === generate(enabled) ? "current" : "stale", exists: true };
}

/** Insert or update the block, preserving everything around it. */
export function writeBrief(file, enabled) {
  const block = generate(enabled);
  let text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const found = section(text);

  if (found) {
    const next = text.slice(0, found.start) + block + text.slice(found.end);
    if (next === text) return { file, action: "unchanged" };
    writeFileSync(file, next);
    return { file, action: "updated" };
  }

  const created = text.length === 0;
  const sep = created ? "" : text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${text}${sep}${block}\n`);
  return { file, action: created ? "created" : "appended" };
}

/** Remove only our block, leaving the rest of the file intact. */
export function removeBrief(file) {
  if (!existsSync(file)) return { file, action: "absent" };
  const text = readFileSync(file, "utf8");
  const found = section(text);
  if (!found) return { file, action: "absent" };

  const next = `${text.slice(0, found.start).replace(/\s+$/, "")}\n${text.slice(found.end).replace(/^\s+/, "")}`;
  const cleaned = next.trim();
  writeFileSync(file, cleaned ? (cleaned.endsWith("\n") ? cleaned : `${cleaned}\n`) : "");
  return { file, action: cleaned ? "removed" : "emptied" };
}
