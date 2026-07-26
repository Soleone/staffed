// Reading, parsing and validating the roster. The persona files are the source of
// truth for everything except which concrete model a tier maps to.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const AGENTS_DIR = join(ROOT, "agents");
export const TIERS = ["fast", "balanced", "strong", "deep"];

// reviewer writes nothing; builder's artifact is the code. Neither owns a directory.
const NO_ARTIFACT = new Set(["reviewer"]);
const NO_DIRECTORY = new Set(["reviewer", "builder"]);

/** Split a persona file into frontmatter text and body. */
function split(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return null;
  return { fm: m[1], body: m[2] };
}

/** Flat scalar/folded-scalar frontmatter reader. Enough for name/description/model. */
function readFrontmatter(fm) {
  const out = {};
  const lines = fm.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
    if (!m) continue;
    const [, key, rest] = m;
    if (rest === ">-" || rest === ">" || rest === "|" || rest === "|-") {
      const folded = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) folded.push(lines[++i].trim());
      out[key] = folded.join(" ");
    } else {
      out[key] = rest.replace(/^["']|["']$/g, "");
    }
  }
  return out;
}

/** Tier is the first backticked token under "# Recommended model tier". */
function readTier(body) {
  const line = body.match(/^# Recommended model tier\n(.*)$/m)?.[1];
  if (!line) return { tier: null, reason: 'no "# Recommended model tier" section' };
  const tier = line.match(/`([a-z]+)`/)?.[1];
  if (!TIERS.includes(tier)) {
    return { tier: null, reason: `tier must be a backticked ${TIERS.join("|")} — got: ${line.trim()}` };
  }
  return { tier };
}

/** Load every persona. Returns { name, file, meta, body, tier, text }. */
export function loadPersonas(dir = AGENTS_DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((file) => {
      const text = readFileSync(join(dir, file), "utf8");
      const parts = split(text);
      const name = file.replace(/\.md$/, "");
      if (!parts) return { name, file, text, meta: {}, body: "", tier: null, broken: "no frontmatter" };
      const { tier, reason } = readTier(parts.body);
      return {
        name,
        file,
        text,
        fm: parts.fm,
        body: parts.body,
        meta: readFrontmatter(parts.fm),
        tier,
        broken: reason ?? null,
      };
    });
}

/** Structural checks. Returns an array of human-readable problems. */
export function validate(personas, stages) {
  const problems = [];
  const names = personas.map((p) => p.name);

  // The generated brief walks a canonical stage order; it must cover the roster exactly,
  // or a persona would be installed that no brief ever tells the orchestrator to use.
  if (stages) {
    const staged = stages.map((s) => s.name);
    for (const n of names) if (!staged.includes(n)) problems.push(`${n}: in the roster but not in the pipeline order`);
    for (const s of staged) if (!names.includes(s)) problems.push(`${s}: in the pipeline order but not in the roster`);
  }

  for (const p of personas) {
    const at = (msg) => problems.push(`${p.file}: ${msg}`);
    if (p.broken) at(p.broken);
    if (p.meta.name !== p.name) at(`frontmatter name "${p.meta.name ?? ""}" does not match filename`);
    if (!p.meta.description) at("no description");
    if (p.meta.tools) at("declares a tools allowlist (containment here is prompt-level)");
    if (p.meta.model) at("has a pinned model — pinning belongs at install time, not in source");
    if (!/^# Output \(always, in this structure\)/m.test(p.body)) at("no output contract");
    if (!/^# Effort and output budget/m.test(p.body)) at("no effort and output budget");
    if (!NO_ARTIFACT.has(p.name) && !/^# Artifact/m.test(p.body)) at("no # Artifact section");

    if (!NO_DIRECTORY.has(p.name) && !p.body.includes(`artifacts/${p.name}/`)) {
      at(`never references its own artifacts/${p.name}/`);
    }
    for (const other of names) {
      if (other === p.name || NO_DIRECTORY.has(other)) continue;
      if (new RegExp(`writ\\w+[^.]{0,40}artifacts/${other}/`).test(p.body)) {
        at(`appears to write into artifacts/${other}/`);
      }
    }
  }
  return problems;
}
