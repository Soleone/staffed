// Host registry. A host says where personas live and how their frontmatter is spelled.
//
// Adding a host means adding one entry. The bodies need no translation — they
// deliberately contain nothing host-specific (no `subagent`, no `worktree`, no `.pi/`).

import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Serialize frontmatter, folding description the way the sources do. */
function frontmatter(fields) {
  const lines = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || value === "") continue;
    if (key === "description") {
      lines.push("description: >-");
      let line = "";
      for (const word of String(value).split(/\s+/)) {
        if (line && `  ${line} ${word}`.length > 82) {
          lines.push(`  ${line}`);
          line = word;
        } else line = line ? `${line} ${word}` : word;
      }
      if (line) lines.push(`  ${line}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  return lines.join("\n");
}

const render = (fields, body) => `---\n${frontmatter(fields)}\n---\n${body}`;

// How each host spells a resolved tier. This is the one genuine rendering difference
// between hosts, and the reason tier config keeps model and thinking apart.
const piModel = (t) => (t ? (t.thinking ? `${t.model}:${t.thinking}` : t.model) : undefined);
const modelOnly = (t) => t?.model;

export const HOSTS = {
  pi: {
    label: "pi",
    supported: true,
    userDir: () => join(homedir(), ".pi", "agent", "agents"),
    projectDir: (cwd) => join(cwd, ".pi", "agents"),
    // Skills are the discovery mechanism: pi puts their descriptions in the system prompt.
    skillDir: (scope, cwd) => (scope === "project" ? join(cwd, ".pi", "skills") : join(homedir(), ".pi", "agent", "skills")),
    filename: (p) => `${p.name}.md`,
    render: (p, tier) => render({ name: p.name, description: p.meta.description, model: piModel(tier) }, p.body),
    notes: [
      'subagent defaults to agentScope: "user", so project-scope installs are invisible until a call passes agentScope: "both".',
      "Personas cannot ship via `pi install`: a pi package carries extensions, skills, prompts and themes only, never agents.",
    ],
  },

  claude: {
    label: "Claude Code",
    // Claude Desktop's Code tab reads the same .claude configuration as the CLI.
    // Chat and Cowork are separate surfaces and are not targets of this host.
    supported: true,
    allowedProfiles: ["none", "inherit", "claude"],
    userDir: () => join(homedir(), ".claude", "agents"),
    projectDir: (cwd) => join(cwd, ".claude", "agents"),
    skillDir: (scope, cwd) => (scope === "project" ? join(cwd, ".claude", "skills") : join(homedir(), ".claude", "skills")),
    filename: (p) => `${p.name}.md`,
    render: (p, tier) =>
      render(
        {
          name: p.name,
          description:
            'Staffed role; use only after /staffed, "use Staffed", or "staff this project". Never select for ordinary prompts. ' +
            p.meta.description,
          model: modelOnly(tier),
        },
        p.body,
      ),
    notes: [
      "Supports Claude Code CLI and the Code tab in Claude Desktop; Chat and Cowork are separate surfaces.",
      "Model names differ (opus/sonnet/haiku) — use the claude profile.",
      "Has no per-agent thinking level, so the thinking half of a tier is dropped.",
    ],
  },
  opencode: {
    label: "opencode",
    supported: false,
    userDir: () => join(homedir(), ".config", "opencode", "agent"),
    projectDir: (cwd) => join(cwd, ".opencode", "agent"),
    skillDir: (scope, cwd) => (scope === "project" ? join(cwd, ".opencode", "skills") : join(homedir(), ".config", "opencode", "skills")),
    filename: (p) => `${p.name}.md`,
    render: (p, tier) =>
      render({ name: p.name, description: p.meta.description, mode: "subagent", model: modelOnly(tier) }, p.body),
    notes: ["Adds `mode: subagent`, the only frontmatter delta in the whole roster."],
  },
};

export const DEFAULT_HOST = "pi";

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error?.code)) return false;
    throw error;
  }
}

export function selectDefaultAgent({ home = homedir() } = {}) {
  const detected = [];
  if (isDirectory(join(home, ".pi", "agent"))) detected.push("pi");
  if (isDirectory(join(home, ".claude"))) detected.push("claude");
  if (detected.length === 2) {
    throw new Error("both Pi and Claude Code were detected; pass --agent pi or --agent claude");
  }
  return detected.length
    ? { key: detected[0], detected, reason: "detected" }
    : { key: DEFAULT_HOST, detected, reason: "legacy-default" };
}

export function resolveHost(name = DEFAULT_HOST) {
  const host = HOSTS[name];
  if (!host) {
    throw new Error(`unknown agent "${name}". known: ${Object.keys(HOSTS).join(", ")}`);
  }
  if (!host.supported) {
    throw new Error(
      `agent "${name}" is not supported yet (target: ${host.userDir()}).\n` +
        `The rendering seam exists — implement and verify it, then flip supported: true in src/hosts.mjs.`,
    );
  }
  return { key: name, ...host };
}

export function targetDir(host, scope, cwd) {
  return scope === "project" ? host.projectDir(cwd) : host.userDir();
}
