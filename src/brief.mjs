import { DEFAULT_PACK, resolvePack } from "./packs.mjs";

const START = "<!-- staffed:start -->";
const END = "<!-- staffed:end -->";

// Backward-compatible export for callers and tests that mean the built-in product roster.
export const STAGES = resolvePack(DEFAULT_PACK).stages;

function chain(stages) {
  const parts = [];
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i], next = stages[i + 1];
    const text = `\`${s.name}\` (${s.role})`;
    if (s.parallel && next?.parallel) { parts.push(`${text} and \`${next.name}\` (${next.role})`); i++; }
    else parts.push(text);
  }
  return parts.join(" → ");
}

function wrap(text) {
  const out = []; let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && `${line} ${word}`.length > 88) { out.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out.join("\n");
}

export function generateBrief({ hostKey = "pi", enabled, pack: packName = DEFAULT_PACK, catalog }) {
  const pack = resolvePack(packName, catalog);
  const set = new Set(enabled);
  const stages = pack.stages.filter((s) => set.has(s.name));
  const partial = stages.length < pack.stages.length;
  const claude = hostKey === "claude";
  const actor = claude ? "Agent" : "subagent";
  const activation = claude
    ? 'Use Staffed only after /staffed, "use Staffed", or "staff this project"; never use it for ordinary prompts. '
    : "";
  const body = [
    "## Staffed", "",
    wrap(
      activation + `This project has the ${pack.label}${pack.experimental ? " (experimental)" : ""} available as ${actor}s. You are the orchestrator: ` +
      "default to one persona, add a stage only for a named uncertainty or material risk, validate " +
      "compact outputs, and loop back only on material failures.",
    ), "", wrap(`Pipeline: ${chain(stages)}.`), "",
    wrap(pack.briefGuidance), "",
    wrap(
      "Start every dispatch at effort `low` unless the user requested otherwise or approved an " +
      "escalation, and state the effort in the task. Low means the shortest credible pass. Stop " +
      "when downstream can act and further work is unlikely to change the result. A persona with " +
      "material uncertainty must stop and request higher `effort`, a higher model `tier`, or both, " +
      "with its reason, expected gain, and safe fallback; the parent decides whether to redispatch. " +
      "Do not continue from an advisory stage into deeper planning or implementation without approval.",
    ),
  ];
  if (partial) {
    const missing = pack.stages.filter((s) => !set.has(s.name)).map((s) => s.name);
    body.push("", wrap(`Only these personas are enabled: ${stages.map((s) => s.name).join(", ")}. Not available: ${missing.join(", ")} — cover those stages yourself or skip them.`));
  }
  return `${START}\n${body.join("\n")}\n${END}`;
}

export const generate = (enabled) => generateBrief({ hostKey: "pi", enabled });

export function findBriefBlock(text) {
  const starts = [...text.matchAll(new RegExp(START, "g"))];
  const ends = [...text.matchAll(new RegExp(END, "g"))];
  if (!starts.length && !ends.length) return null;
  if (starts.length !== 1 || ends.length !== 1 || ends[0].index < starts[0].index) {
    throw new Error("ambiguous or malformed Staffed brief markers");
  }
  const start = starts[0].index;
  const end = ends[0].index + END.length;
  return { start, end, text: text.slice(start, end) };
}

export function upsertBriefBlock(text, block) {
  const found = findBriefBlock(text);
  if (found) return text.slice(0, found.start) + block + text.slice(found.end);
  const sep = !text ? "" : text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  return `${text}${sep}${block}\n`;
}

export function deleteBriefBlock(text) {
  const found = findBriefBlock(text);
  return found ? text.slice(0, found.start) + text.slice(found.end) : text;
}
