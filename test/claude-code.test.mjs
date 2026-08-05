import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { enable, disable, status } from "../src/install.mjs";
import { HOSTS, resolveHost } from "../src/hosts.mjs";
import { hashText } from "../src/ownership.mjs";
import { generateSkill } from "../src/skill.mjs";
import { loadPersonas } from "../src/personas.mjs";

function prepared(operation) {
  return operation();
}
const enablePrepared = (opts) => prepared(() => enable(opts));
const disablePrepared = (opts) => prepared(() => disable(opts));
const statusPrepared = (opts) => prepared(() => status(opts));

function seedLegacy(cwd, text) {
  enablePrepared({ host: "claude", scope: "project", cwd, only: ["builder"] });
  const block = "<!-- staffed:start -->\nlegacy\n<!-- staffed:end -->";
  writeFileSync(join(cwd, "CLAUDE.md"), text.replace("BLOCK", block));
  const manifestPath = join(cwd, ".claude", "agents", ".staffed.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.discovery.brief = { type: "block", hash: hashText(block) };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { block, manifestPath };
}

test("Claude Code is enabled for CLI and Desktop Code configuration", () => {
  assert.equal(HOSTS.claude.supported, true);
  assert.equal(resolveHost("claude").key, "claude");
});

test("Claude rendering and skill retain explicit activation without Pi-only controls", () => {
  const cwd = mkdtempSync(join(tmpdir(), "staffed-claude-render-"));
  try {
    const result = enablePrepared({ host: "claude", scope: "project", cwd, only: ["builder"], skill: false });
    const text = readFileSync(join(cwd, ".claude", "agents", "builder.md"), "utf8");
    assert.match(text, /use only after \/staffed, "use Staffed", or "staff this project"/);
    assert.doesNotMatch(text, /^model:/m);
    assert.ok(text.endsWith(loadPersonas().find((persona) => persona.name === "builder").body));
    assert.equal(result.manifest.files["builder.md"].profile, "none");
    const skill = generateSkill({ hostKey: "claude", enabled: ["builder"], personas: loadPersonas() });
    assert.match(skill, /ordinary prompts/i);
    assert.doesNotMatch(skill, /`subagent` tool|worktreeSetup|allowParallelWrites/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("Claude project lifecycle removes only a tracked legacy CLAUDE.md block", () => {
  const cwd = mkdtempSync(join(tmpdir(), "staffed-claude-cleanup-"));
  try {
    const { manifestPath } = seedLegacy(cwd, "prefix\nBLOCK\nsuffix\n");
    enablePrepared({ host: "claude", scope: "project", cwd, only: ["builder"] });
    assert.equal(readFileSync(join(cwd, "CLAUDE.md"), "utf8"), "prefix\n\nsuffix\n");
    assert.equal(Object.hasOwn(JSON.parse(readFileSync(manifestPath, "utf8")).discovery, "brief"), false);
    disablePrepared({ host: "claude", scope: "project", cwd });
    assert.equal(existsSync(manifestPath), false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("Claude legacy cleanup fails closed on malformed tracked markers before role mutation", () => {
  const cwd = mkdtempSync(join(tmpdir(), "staffed-claude-malformed-"));
  try {
    const { manifestPath } = seedLegacy(cwd, "BLOCK");
    writeFileSync(join(cwd, "CLAUDE.md"), "<!-- staffed:start -->\nbroken\n");
    const agent = join(cwd, ".claude", "agents", "builder.md");
    const beforeAgent = readFileSync(agent, "utf8");
    const beforeManifest = readFileSync(manifestPath, "utf8");
    for (const force of [false, true]) {
      assert.throws(() => disablePrepared({ host: "claude", scope: "project", cwd, force }), /malformed/);
      assert.equal(readFileSync(agent, "utf8"), beforeAgent);
      assert.equal(readFileSync(manifestPath, "utf8"), beforeManifest);
    }
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("Claude adapts the Anthropic provider profile to family aliases", () => {
  const cwd = mkdtempSync(join(tmpdir(), "staffed-claude-profile-"));
  try {
    const result = enablePrepared({ host: "claude", scope: "project", cwd, only: ["builder", "pm"], profile: "anthropic", skill: false });
    assert.match(readFileSync(join(cwd, ".claude", "agents", "builder.md"), "utf8"), /^model: opus$/m);
    assert.match(readFileSync(join(cwd, ".claude", "agents", "pm.md"), "utf8"), /^model: sonnet$/m);
    assert.equal(result.manifest.files["builder.md"].profile, "anthropic");
    assert.equal(result.manifest.files["builder.md"].model, "opus");
    assert.equal(Object.hasOwn(result.manifest.files["builder.md"], "thinking"), false);
    assert.throws(() => enablePrepared({ host: "claude", scope: "project", cwd, only: ["builder"], profile: "openai" }), /not valid/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("Claude lifecycle preserves modified roles and foreign skill siblings", () => {
  const cwd = mkdtempSync(join(tmpdir(), "staffed-claude-life-"));
  try {
    enablePrepared({ host: "claude", scope: "project", cwd, only: ["builder", "pm"] });
    const skillFile = join(cwd, ".claude", "skills", "staffed", "SKILL.md");
    const sibling = join(cwd, ".claude", "skills", "staffed", "notes.txt");
    const builder = join(cwd, ".claude", "agents", "builder.md");
    writeFileSync(sibling, "foreign");
    writeFileSync(skillFile, `${readFileSync(skillFile, "utf8")}local drift\n`);
    writeFileSync(builder, "local edit");
    disablePrepared({ host: "claude", scope: "project", cwd, only: ["builder"] });
    assert.equal(readFileSync(builder, "utf8"), "local edit");
    assert.match(readFileSync(skillFile, "utf8"), /local drift/);
    disablePrepared({ host: "claude", scope: "project", cwd, only: ["builder"], force: true });
    assert.equal(existsSync(builder), false);
    assert.doesNotMatch(readFileSync(skillFile, "utf8"), /local drift/);
    disablePrepared({ host: "claude", scope: "project", cwd, only: ["pm"] });
    assert.equal(readFileSync(sibling, "utf8"), "foreign");
    assert.equal(existsSync(skillFile), false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("forced Claude skill writes replace symlinks without following them", () => {
  const cwd = mkdtempSync(join(tmpdir(), "staffed-claude-symlink-"));
  try {
    const victim = join(cwd, "victim.txt");
    const skill = join(cwd, ".claude", "skills", "staffed", "SKILL.md");
    writeFileSync(victim, "do not touch");
    mkdirSync(dirname(skill), { recursive: true });
    symlinkSync(victim, skill);
    enablePrepared({ host: "claude", scope: "project", cwd, only: ["builder"], force: true });
    assert.equal(readFileSync(victim, "utf8"), "do not touch");
    assert.equal(lstatSync(skill).isSymbolicLink(), false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("forced Claude discovery refuses non-empty skill directories before role mutation", () => {
  const cwd = mkdtempSync(join(tmpdir(), "staffed-claude-skill-dir-"));
  try {
    const agent = join(cwd, ".claude", "agents", "builder.md");
    const skill = join(cwd, ".claude", "skills", "staffed", "SKILL.md");
    mkdirSync(dirname(agent), { recursive: true });
    writeFileSync(agent, "foreign agent");
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(skill, "victim.txt"), "preserve me");
    assert.throws(() => enablePrepared({ host: "claude", scope: "project", cwd, only: ["builder"], force: true }), /non-empty discovery directory/);
    assert.equal(readFileSync(join(skill, "victim.txt"), "utf8"), "preserve me");
    assert.equal(readFileSync(agent, "utf8"), "foreign agent");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("Claude discovery failure occurs before forced role replacement", () => {
  const cwd = mkdtempSync(join(tmpdir(), "staffed-claude-atomic-"));
  try {
    const agent = join(cwd, ".claude", "agents", "builder.md");
    const blocked = join(cwd, ".claude", "skills", "staffed");
    mkdirSync(dirname(agent), { recursive: true });
    writeFileSync(agent, "foreign agent");
    mkdirSync(dirname(blocked), { recursive: true });
    writeFileSync(blocked, "not a directory");
    assert.throws(() => enablePrepared({ host: "claude", scope: "project", cwd, only: ["builder"], force: true }), /symlink or non-directory ancestor/);
    assert.equal(readFileSync(agent, "utf8"), "foreign agent");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("malformed Claude manifest records block forced removal", () => {
  const cwd = mkdtempSync(join(tmpdir(), "staffed-claude-record-"));
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

test("Claude collisions and malformed manifests fail without mutation", () => {
  const cwd = mkdtempSync(join(tmpdir(), "staffed-claude-safe-"));
  try {
    const duplicate = join(cwd, ".claude", "agents", "nested", "custom.md");
    mkdirSync(dirname(duplicate), { recursive: true });
    writeFileSync(duplicate, "---\nname: builder\n---\ncustom");
    assert.throws(() => enablePrepared({ host: "claude", scope: "project", cwd, only: ["builder"], force: true }), /collision/);
    assert.equal(existsSync(join(cwd, ".claude", "agents", "builder.md")), false);
    rmSync(join(cwd, ".claude"), { recursive: true, force: true });
    const dir = join(cwd, ".claude", "agents");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".staffed.json"), "not json");
    assert.throws(() => enablePrepared({ host: "claude", scope: "project", cwd, only: ["builder"] }), /invalid Staffed manifest/);
    assert.match(statusPrepared({ host: "claude", scope: "project", cwd }).manifestError, /JSON/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
