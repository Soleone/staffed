import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { disable, enable } from "../src/install.mjs";
import { HOSTS, resolveHost, selectDefaultAgent } from "../src/hosts.mjs";
import { generateSkill } from "../src/skill.mjs";
import { loadPersonas } from "../src/personas.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "bin", "staffed.mjs");

function run(args, { cwd = ROOT, home, env = {} } = {}) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    env: { ...process.env, ...(home ? { HOME: home } : {}), ...env },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

test("Codex host uses the official custom-agent and skill locations", () => {
  assert.equal(HOSTS.codex.supported, true);
  assert.equal(resolveHost("codex").key, "codex");
  const home = mkdtempSync(join(tmpdir(), "staffed-codex-detect-"));
  try {
    mkdirSync(join(home, ".codex"));
    assert.deepEqual(selectDefaultAgent({ home }), { key: "codex", detected: ["codex"], reason: "detected" });
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("Codex honors CODEX_HOME for detection and user agent installation", () => {
  const home = mkdtempSync(join(tmpdir(), "staffed-codex-profile-home-"));
  const codexHome = mkdtempSync(join(tmpdir(), "staffed-codex-profile-"));
  try {
    assert.deepEqual(
      selectDefaultAgent({ home, env: { CODEX_HOME: codexHome } }),
      { key: "codex", detected: ["codex"], reason: "detected" },
    );
    run(["enable", "builder", "--agent", "codex", "--no-skill"], {
      home,
      env: { CODEX_HOME: codexHome },
    });
    assert.equal(existsSync(join(codexHome, "agents", "builder.toml")), true);
    assert.equal(existsSync(join(home, ".codex", "agents", "builder.toml")), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(codexHome, { recursive: true, force: true });
  }
});

test("Codex project install renders TOML agents and a shared .agents skill without AGENTS.md", () => {
  const cwd = mkdtempSync(join(tmpdir(), "staffed-codex-project-"));
  try {
    const result = enable({ host: "codex", scope: "project", cwd, only: ["builder"], profile: "openai" });
    const agent = join(cwd, ".codex", "agents", "builder.toml");
    const skillPath = join(cwd, ".agents", "skills", "staffed", "SKILL.md");
    const composition = join(cwd, ".agents", "skills", "staffed", "references", "composition.md");
    const text = readFileSync(agent, "utf8");
    assert.match(text, /^name = "builder"$/m);
    assert.match(text, /^description = "Staffed role; use only after \$staffed/m);
    assert.match(text, /^model = "gpt-5\.6-sol"$/m);
    assert.match(text, /^model_reasoning_effort = "medium"$/m);
    assert.match(text, /^developer_instructions = ".*senior product engineer/m);
    assert.equal(existsSync(skillPath), true);
    assert.equal(existsSync(composition), true);
    assert.equal(existsSync(join(cwd, "AGENTS.md")), false);
    assert.equal(result.manifest.files["builder.toml"].model, "gpt-5.6-sol");
    assert.equal(result.manifest.files["builder.toml"].thinking, "medium");

    const skill = readFileSync(skillPath, "utf8");
    assert.match(skill, /\$staffed/);
    assert.match(skill, /Codex subagent roster/);
    assert.doesNotMatch(skill, /`subagent` tool|output: false|worktreeSetup|allowParallelWrites/);

    disable({ host: "codex", scope: "project", cwd });
    assert.equal(existsSync(agent), false);
    assert.equal(existsSync(skillPath), false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("Codex user lifecycle works for both CLI and desktop shared locations", () => {
  const home = mkdtempSync(join(tmpdir(), "staffed-codex-home-"));
  try {
    mkdirSync(join(home, ".codex"));
    run(["enable", "builder", "--agent", "codex"], { home });
    assert.equal(existsSync(join(home, ".codex", "agents", "builder.toml")), true);
    assert.equal(existsSync(join(home, ".agents", "skills", "staffed", "SKILL.md")), true);
    assert.match(run(["status", "--agent", "codex"], { home }), /1\/11 enabled/);
    run(["disable", "--agent", "codex"], { home });
    assert.equal(existsSync(join(home, ".codex", "agents", "builder.toml")), false);
    assert.equal(existsSync(join(home, ".agents", "skills", "staffed", "SKILL.md")), false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("Codex profile and collision rules fail closed", () => {
  const cwd = mkdtempSync(join(tmpdir(), "staffed-codex-safe-"));
  try {
    assert.throws(
      () => enable({ host: "codex", scope: "project", cwd, only: ["builder"], profile: "anthropic" }),
      /not valid for OpenAI Codex/,
    );
    assert.throws(
      () => enable({ host: "codex", scope: "project", cwd, only: ["builder"], mode: "link" }),
      /host-specific agent format/,
    );
    const duplicate = join(cwd, ".codex", "agents", "nested", "custom.toml");
    mkdirSync(dirname(duplicate), { recursive: true });
    for (const declaration of ["name = 'builder'", 'name = "build\\u0065r"']) {
      writeFileSync(duplicate, `${declaration}\ndescription = "foreign"\ndeveloper_instructions = "foreign"\n`);
      assert.throws(
        () => enable({ host: "codex", scope: "project", cwd, only: ["builder"], force: true }),
        /OpenAI Codex agent name collision/,
      );
      assert.equal(existsSync(join(cwd, ".codex", "agents", "builder.toml")), false);
    }
    for (const text of [
      '"na\\u006de" = "builder"\ndescription = "foreign"\ndeveloper_instructions = "foreign"\n',
      'developer_instructions = """\nname = "other"\n"""\nname = "builder"\ndescription = "foreign"\n',
    ]) {
      writeFileSync(duplicate, text);
      assert.throws(
        () => enable({ host: "codex", scope: "project", cwd, only: ["builder"], force: true }),
        /cannot safely inspect Codex agent name/,
      );
      assert.equal(existsSync(join(cwd, ".codex", "agents", "builder.toml")), false);
    }
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("Codex enable rolls discovery back when a later agent write fails", { skip: process.platform === "win32" }, () => {
  const cwd = mkdtempSync(join(tmpdir(), "staffed-codex-rollback-"));
  const agents = join(cwd, ".codex", "agents");
  const skill = join(cwd, ".agents", "skills", "staffed", "SKILL.md");
  try {
    mkdirSync(agents, { recursive: true });
    chmodSync(agents, 0o500);
    assert.throws(
      () => enable({ host: "codex", scope: "project", cwd, only: ["builder"] }),
      /EACCES|permission denied/i,
    );
    assert.equal(existsSync(skill), false);
    assert.equal(existsSync(join(agents, "builder.toml")), false);
    assert.equal(existsSync(join(agents, ".staffed.json")), false);
  } finally {
    chmodSync(agents, 0o700);
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("Codex skill generator retains explicit activation without Pi-only controls", () => {
  const skill = generateSkill({ hostKey: "codex", enabled: ["builder"], personas: loadPersonas() });
  assert.match(skill, /ordinary prompts/i);
  assert.match(skill, /\$staffed/);
  assert.doesNotMatch(skill, /`subagent` tool|output: false|worktreeSetup|allowParallelWrites/);
});
