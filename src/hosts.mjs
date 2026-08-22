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
const codexTier = (tier) => {
  if (!tier) return undefined;
  const model = tier.model.match(/^(?:openai|openai-codex)\/(.+)$/)?.[1];
  if (!model) throw new Error(`Codex requires an OpenAI provider model, got "${tier.model}"`);
  return { model, thinking: tier.thinking };
};
const tomlString = (value) => JSON.stringify(String(value));
const codexHome = () => process.env.CODEX_HOME || join(homedir(), ".codex");
const claudeTier = (tier) => {
  if (!tier) return undefined;
  if (!tier.model.startsWith("anthropic/")) {
    throw new Error(`Claude Code requires an Anthropic provider model, got "${tier.model}"`);
  }
  const id = tier.model.slice("anthropic/".length);
  const family = id.match(/^claude-(haiku|sonnet|opus)(?:-|$)/)?.[1];
  if (!family) throw new Error(`Anthropic model "${tier.model}" has no Claude Code family alias`);
  return { model: family, thinking: null };
};

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

  codex: {
    label: "OpenAI Codex",
    // Codex CLI and the desktop app share these user/project configuration conventions.
    supported: true,
    allowedProfiles: ["none", "openai"],
    userDir: () => join(codexHome(), "agents"),
    projectDir: (cwd) => join(cwd, ".codex", "agents"),
    skillDir: (scope, cwd) => (scope === "project" ? join(cwd, ".agents", "skills") : join(homedir(), ".agents", "skills")),
    filename: (p) => `${p.name}.toml`,
    mapTier: codexTier,
    render: (p, tier) =>
      [
        `name = ${tomlString(p.name)}`,
        `description = ${tomlString('Staffed role; use only after $staffed, "use Staffed", or "staff this project". Never select for ordinary prompts. ' + p.meta.description)}`,
        ...(tier?.model ? [`model = ${tomlString(tier.model)}`] : []),
        ...(tier?.thinking ? [`model_reasoning_effort = ${tomlString(tier.thinking)}`] : []),
        `developer_instructions = ${tomlString(p.body)}`,
        "",
      ].join("\n"),
    notes: [
      "Supports Codex CLI and the Codex experience in the ChatGPT desktop app.",
      "Custom agents are TOML files under .codex/agents; Staffed's Markdown persona bodies are preserved as developer_instructions.",
      "Skills use the shared .agents/skills location required by Codex.",
    ],
  },

  claude: {
    label: "Claude Code",
    // Claude Desktop's Code tab reads the same .claude configuration as the CLI.
    // Chat and Cowork are separate surfaces and are not targets of this host.
    supported: true,
    allowedProfiles: ["none", "anthropic"],
    userDir: () => join(homedir(), ".claude", "agents"),
    projectDir: (cwd) => join(cwd, ".claude", "agents"),
    skillDir: (scope, cwd) => (scope === "project" ? join(cwd, ".claude", "skills") : join(homedir(), ".claude", "skills")),
    filename: (p) => `${p.name}.md`,
    mapTier: claudeTier,
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
      "The anthropic profile renders as Claude Code's opus/sonnet/haiku family aliases.",
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

export function selectDefaultAgent({ home = homedir(), env = process.env } = {}) {
  const detected = [];
  if (isDirectory(join(home, ".pi", "agent"))) detected.push("pi");
  if (isDirectory(env.CODEX_HOME || join(home, ".codex"))) detected.push("codex");
  if (isDirectory(join(home, ".claude"))) detected.push("claude");
  if (detected.length > 1) {
    throw new Error(`multiple agent hosts were detected (${detected.join(", ")}); pass --agent ${detected.join(" or --agent ")}`);
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

/** Early validation for commands that may never reach resolveHost. */
export function assertKnownHost(name) {
  if (name !== undefined && !Object.hasOwn(HOSTS, name)) {
    throw new Error(`unknown agent "${name}". known: ${Object.keys(HOSTS).join(", ")}`);
  }
}

export function targetDir(host, scope, cwd) {
  return scope === "project" ? host.projectDir(cwd) : host.userDir();
}
