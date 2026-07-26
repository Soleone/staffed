import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { enable, disable, status } from "../src/install.mjs";
import { HOSTS, resolveHost } from "../src/hosts.mjs";
import { generateSkill } from "../src/skill.mjs";
import { generateBrief } from "../src/brief.mjs";
import { loadPersonas } from "../src/personas.mjs";

const forbidden = [/\/skill:staffed/, /`subagent` tool/, /worktree/, /worktreeSetup/, /allowParallelWrites/];

function prepared(operation) {
  HOSTS["claude"].supported = true;
  try { return operation(); }
  finally { HOSTS["claude"].supported = false; }
}
const enablePrepared = (opts) => prepared(() => enable(opts));
const disablePrepared = (opts) => prepared(() => disable(opts));
const statusPrepared = (opts) => prepared(() => status(opts));

test("Claude Code remains publicly gated pending authenticated attestation", () => {
  assert.equal(HOSTS["claude"].supported, false);
  assert.throws(() => resolveHost("claude"), /not supported yet/);
});

test("Claude rendering is gated, inherits by default, and uses approved aliases", () => {
  const cwd = mkdtempSync(join(tmpdir(), "staffed-claude-render-"));
  try {
    const inherited = enablePrepared({ host: "claude", scope: "project", cwd, only: ["builder"], skill: false });
    const text = readFileSync(join(cwd, ".claude", "agents", "builder.md"), "utf8");
    assert.match(text, /use only after \/staffed, "use Staffed", or "staff this project"/);
    assert.match(text, /Never select for ordinary prompts/);
    assert.doesNotMatch(text, /^model:/m);
    assert.ok(text.endsWith(loadPersonas().find((persona) => persona.name === "builder").body));
    assert.equal(inherited.manifest.files["builder.md"].profile, "none");
    enablePrepared({ host: "claude", scope: "project", cwd, only: ["builder"], profile: "claude", skill: false });
    assert.match(readFileSync(join(cwd, ".claude", "agents", "builder.md"), "utf8"), /^model: sonnet$/m);
    assert.throws(() => enablePrepared({ host: "claude", scope: "project", cwd, only: ["builder"], profile: "openai" }), /not valid/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("Claude discovery uses explicit activation and contains no Pi-only controls", () => {
  const enabled = ["architect", "builder", "reviewer"];
  for (const text of [generateSkill({ hostKey: "claude", enabled, personas: loadPersonas() }), generateBrief({ hostKey: "claude", enabled })]) {
    assert.match(text, /\/staffed/);
    assert.match(text, /use Staffed/i);
    assert.match(text, /staff this project/i);
    assert.match(text, /ordinary prompts/i);
    assert.match(text, /Agent/);
    for (const pattern of forbidden) assert.doesNotMatch(text, pattern);
  }
});

test("Claude lifecycle tracks discovery and preserves foreign and modified content", () => {
  const cwd = mkdtempSync(join(tmpdir(), "staffed-claude-life-"));
  try {
    enablePrepared({ host: "claude", scope: "project", cwd, only: ["builder", "pm"], brief: true });
    const manifestPath = join(cwd, ".claude", "agents", ".staffed.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.schema, 2);
    assert.equal(manifest.host, "claude");
    assert.ok(manifest.discovery.skill.hash);
    assert.ok(manifest.discovery.brief.hash);
    const skillFile = join(cwd, ".claude", "skills", "staffed", "SKILL.md");
    const skillSibling = join(cwd, ".claude", "skills", "staffed", "notes.txt"); writeFileSync(skillSibling, "foreign");
    writeFileSync(skillFile, `${readFileSync(skillFile, "utf8")}local drift\n`);
    const briefFile = join(cwd, "CLAUDE.md"); writeFileSync(briefFile, readFileSync(briefFile, "utf8").replace("## Staffed", "## Locally edited Staffed"));
    const builder = join(cwd, ".claude", "agents", "builder.md"); writeFileSync(builder, "local edit");
    disablePrepared({ host: "claude", scope: "project", cwd, only: ["builder"], force: false });
    assert.equal(readFileSync(builder, "utf8"), "local edit");
    assert.match(readFileSync(skillFile, "utf8"), /local drift/);
    assert.match(readFileSync(briefFile, "utf8"), /Locally edited Staffed/);
    disablePrepared({ host: "claude", scope: "project", cwd, only: ["builder"], force: true });
    assert.equal(existsSync(builder), false);
    assert.doesNotMatch(readFileSync(skillFile, "utf8"), /local drift/);
    assert.doesNotMatch(readFileSync(briefFile, "utf8"), /Locally edited Staffed/);
    disablePrepared({ host: "claude", scope: "project", cwd, only: ["pm"] });
    assert.equal(readFileSync(skillSibling, "utf8"), "foreign");
    assert.equal(existsSync(join(cwd, ".claude", "skills", "staffed", "SKILL.md")), false);
    assert.doesNotMatch(readFileSync(join(cwd, "CLAUDE.md"), "utf8"), /staffed:start/);
    assert.equal(existsSync(manifestPath), false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("malformed brief markers only block operations that would mutate the brief", () => {
  const cwd = mkdtempSync(join(tmpdir(), "staffed-claude-markers-"));
  try {
    writeFileSync(join(cwd, "CLAUDE.md"), "before\n<!-- staffed:start -->\nbroken\n");
    enablePrepared({ host: "claude", scope: "project", cwd, only: ["builder"], skill: false });
    assert.equal(existsSync(join(cwd, ".claude", "agents", "builder.md")), true);
    assert.throws(() => enablePrepared({ host: "claude", scope: "project", cwd, only: ["pm"], brief: true }), /invalid Staffed brief/);
    assert.equal(existsSync(join(cwd, ".claude", "agents", "pm.md")), false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("forced discovery writes replace symlinks and directories without following them", () => {
  const cwd = mkdtempSync(join(tmpdir(), "staffed-claude-discovery-replace-"));
  try {
    const victim = join(cwd, "victim.txt"); writeFileSync(victim, "do not touch");
    const skill = join(cwd, ".claude", "skills", "staffed", "SKILL.md"); mkdirSync(dirname(skill), { recursive: true }); symlinkSync(victim, skill);
    const brief = join(cwd, "CLAUDE.md"); symlinkSync(victim, brief);
    enablePrepared({ host: "claude", scope: "project", cwd, only: ["builder"], brief: true, force: true });
    assert.equal(readFileSync(victim, "utf8"), "do not touch");
    assert.equal(lstatSync(skill).isSymbolicLink(), false);
    assert.equal(lstatSync(brief).isSymbolicLink(), false);

    disablePrepared({ host: "claude", scope: "project", cwd, force: true });
    mkdirSync(skill, { recursive: true });
    rmSync(brief, { force: true });
    mkdirSync(brief);
    enablePrepared({ host: "claude", scope: "project", cwd, only: ["pm"], brief: true, force: true });
    assert.equal(lstatSync(skill).isFile(), true);
    assert.equal(lstatSync(brief).isFile(), true);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("forced discovery replacement refuses a non-empty skill directory before agent mutation", () => {
  const cwd = mkdtempSync(join(tmpdir(), "staffed-claude-skill-directory-"));
  try {
    const agent = join(cwd, ".claude", "agents", "builder.md"); mkdirSync(dirname(agent), { recursive: true }); writeFileSync(agent, "foreign agent");
    const skill = join(cwd, ".claude", "skills", "staffed", "SKILL.md"); mkdirSync(skill, { recursive: true });
    const victim = join(skill, "victim.txt"); writeFileSync(victim, "preserve me");
    assert.throws(() => enablePrepared({ host: "claude", scope: "project", cwd, only: ["builder"], force: true }), /non-empty discovery directory/);
    assert.equal(readFileSync(victim, "utf8"), "preserve me");
    assert.equal(readFileSync(agent, "utf8"), "foreign agent");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("forced discovery replacement refuses a non-empty brief directory before agent mutation", () => {
  const cwd = mkdtempSync(join(tmpdir(), "staffed-claude-brief-directory-"));
  try {
    const agent = join(cwd, ".claude", "agents", "builder.md"); mkdirSync(dirname(agent), { recursive: true }); writeFileSync(agent, "foreign agent");
    const brief = join(cwd, "CLAUDE.md"); mkdirSync(brief);
    const victim = join(brief, "victim.txt"); writeFileSync(victim, "preserve me");
    assert.throws(() => enablePrepared({ host: "claude", scope: "project", cwd, only: ["builder"], skill: false, brief: true, force: true }), /non-empty discovery directory/);
    assert.equal(readFileSync(victim, "utf8"), "preserve me");
    assert.equal(readFileSync(agent, "utf8"), "foreign agent");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("discovery failure occurs before forced agent replacement", () => {
  const cwd = mkdtempSync(join(tmpdir(), "staffed-claude-discovery-atomic-"));
  try {
    const agent = join(cwd, ".claude", "agents", "builder.md"); mkdirSync(dirname(agent), { recursive: true }); writeFileSync(agent, "foreign agent");
    const blockedParent = join(cwd, ".claude", "skills", "staffed"); mkdirSync(dirname(blockedParent), { recursive: true }); writeFileSync(blockedParent, "not a directory");
    assert.throws(() => enablePrepared({ host: "claude", scope: "project", cwd, only: ["builder"], force: true }), /ENOTDIR/);
    assert.equal(readFileSync(agent, "utf8"), "foreign agent");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("--no-brief skips malformed tracked brief preflight during disable", () => {
  const cwd = mkdtempSync(join(tmpdir(), "staffed-claude-no-brief-"));
  try {
    enablePrepared({ host: "claude", scope: "project", cwd, only: ["builder"], brief: true });
    const brief = join(cwd, "CLAUDE.md"); writeFileSync(brief, "<!-- staffed:start -->\nbroken\n");
    disablePrepared({ host: "claude", scope: "project", cwd, only: ["builder"], brief: false });
    assert.equal(existsSync(join(cwd, ".claude", "agents", "builder.md")), false);
    assert.equal(readFileSync(brief, "utf8"), "<!-- staffed:start -->\nbroken\n");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("malformed manifest records block forced removal", () => {
  const cwd = mkdtempSync(join(tmpdir(), "staffed-claude-bad-record-"));
  try {
    enablePrepared({ host: "claude", scope: "project", cwd, only: ["builder"] });
    const agent = join(cwd, ".claude", "agents", "builder.md");
    const manifestFile = join(cwd, ".claude", "agents", ".staffed.json");
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
    manifest.files["builder.md"] = { type: "block", hash: "a".repeat(16) };
    writeFileSync(manifestFile, JSON.stringify(manifest));
    assert.throws(() => disablePrepared({ host: "claude", scope: "project", cwd, force: true }), /manifest files.builder.md/);
    assert.equal(existsSync(agent), true);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("malformed discovery records also block forced removal", () => {
  const cwd = mkdtempSync(join(tmpdir(), "staffed-claude-bad-discovery-"));
  try {
    enablePrepared({ host: "claude", scope: "project", cwd, only: ["builder"] });
    const skill = join(cwd, ".claude", "skills", "staffed", "SKILL.md");
    const manifestFile = join(cwd, ".claude", "agents", ".staffed.json");
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
    manifest.discovery.skill = { type: "link", target: skill };
    writeFileSync(manifestFile, JSON.stringify(manifest));
    assert.throws(() => disablePrepared({ host: "claude", scope: "project", cwd, force: true }), /manifest discovery.skill/);
    assert.equal(existsSync(skill), true);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("nested duplicate names and malformed manifests block without mutation", () => {
  const cwd = mkdtempSync(join(tmpdir(), "staffed-claude-safe-"));
  try {
    const duplicate = join(cwd, ".claude", "agents", "nested", "custom.md"); mkdirSync(dirname(duplicate), { recursive: true }); writeFileSync(duplicate, "---\nname: builder\n---\ncustom");
    assert.throws(() => enablePrepared({ host: "claude", scope: "project", cwd, only: ["builder"], force: true }), /collision/);
    assert.equal(existsSync(join(cwd, ".claude", "agents", "builder.md")), false);
    rmSync(join(cwd, ".claude"), { recursive: true, force: true });
    const dir = join(cwd, ".claude", "agents"); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, ".staffed.json"), "not json");
    assert.throws(() => enablePrepared({ host: "claude", scope: "project", cwd, only: ["builder"] }), /invalid Staffed manifest/);
    assert.equal(statusPrepared({ host: "claude", scope: "project", cwd }).manifestError.includes("JSON"), true);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
