// One-release compatibility shim for schema-2 manifests that tracked discovery.brief.
// Remove this module and legacy manifest acceptance in the release after this cleanup ships.
import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { hashText } from "./ownership.mjs";

const START = "<!-- staffed:start -->";
const END = "<!-- staffed:end -->";

function targetPath(hostKey, scope, cwd, home) {
  if (hostKey === "pi") return scope === "project" ? join(cwd, "AGENTS.md") : join(home, ".pi", "agent", "AGENTS.md");
  if (hostKey === "claude") return scope === "project" ? join(cwd, "CLAUDE.md") : join(home, ".claude", "CLAUDE.md");
  throw new Error(`legacy brief cleanup is not supported for host ${hostKey}`);
}

function stat(path) {
  try { return lstatSync(path); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

function findBlock(text) {
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

export function planLegacyBriefCleanup({ hostKey, scope, cwd = process.cwd(), home = homedir(), record, force = false }) {
  const path = targetPath(hostKey, scope, cwd, home);
  const info = stat(path);
  if (!info) return { path, action: "prune-record" };
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error(`refusing to clean legacy Staffed brief from symlink or non-file ${path}`);
  }
  const content = readFileSync(path, "utf8");
  const block = findBlock(content);
  if (!block) return { path, action: "prune-record" };
  if (hashText(block.text) !== record.hash && !force) {
    throw new Error(`refusing to remove modified legacy Staffed brief in ${path}; re-run with --force`);
  }
  return {
    path,
    action: "remove-block",
    content: content.slice(0, block.start) + content.slice(block.end),
    mode: info.mode & 0o7777,
  };
}
