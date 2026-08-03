import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { selectDefaultAgent } from "../src/hosts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "bin", "staffed.mjs");

function runResult(args, { cwd = ROOT, env = {} } = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function run(args, options) {
  const result = runResult(args, options);
  assert.equal(result.status, 0, `command failed: ${result.stderr}\n${result.stdout}`);
  return result.stdout;
}

function tempHome(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("default agent detector handles exact-one, ambiguity, fallback, and regular files", () => {
  const home = tempHome("staffed-detect-");
  try {
    assert.deepEqual(selectDefaultAgent({ home }), { key: "pi", detected: [], reason: "legacy-default" });
    const pi = join(home, ".pi", "agent");
    mkdirSync(pi, { recursive: true });
    assert.deepEqual(selectDefaultAgent({ home }), { key: "pi", detected: ["pi"], reason: "detected" });
    rmSync(join(home, ".pi"), { recursive: true, force: true });
    mkdirSync(join(home, ".claude"));
    assert.deepEqual(selectDefaultAgent({ home }), { key: "claude", detected: ["claude"], reason: "detected" });
    mkdirSync(pi, { recursive: true });
    assert.throws(
      () => selectDefaultAgent({ home }),
      /both Pi and Claude Code were detected; pass --agent pi or --agent claude/,
    );
    rmSync(join(home, ".pi"), { recursive: true, force: true });
    rmSync(join(home, ".claude"), { recursive: true, force: true });
    writeFileSync(join(home, ".claude"), "not a directory");
    assert.deepEqual(selectDefaultAgent({ home }), { key: "pi", detected: [], reason: "legacy-default" });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("help documents default agent selection and detection exceptions", () => {
  const output = run(["help"]);
  assert.match(output, /probe ~\/\.pi\/agent and ~\/\.claude when --agent is omitted/);
  assert.match(output, /Exactly one installed agent is selected automatically/);
  assert.match(output, /If both are installed, pass\s+--agent pi or --agent claude/);
  assert.match(output, /If neither is installed, a warning is printed and Pi\s+is used as the fallback/);
  assert.match(output, /Agent-independent commands \(help, list, compose, pack list,\s+tier\/models, validate\) skip detection/);
});

test("agent-independent commands do not detect an ambiguous home", () => {
  const home = tempHome("staffed-independent-");
  try {
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    mkdirSync(join(home, ".claude"));
    for (const args of [["help"], ["list"], ["compose"], ["pack", "list"], ["tier"], ["models"], ["validate"], ["list", "--agent", "claude"]]) {
      const result = runResult(args, { env: { HOME: home } });
      assert.equal(result.status, 0, `${args[0]} failed: ${result.stderr}`);
      assert.doesNotMatch(result.stderr, /both Pi and Claude Code/);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("an exact-one Pi home auto-selects Pi without a fallback warning", () => {
  const home = tempHome("staffed-pi-only-");
  try {
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    const result = runResult(["status"], { env: { HOME: home } });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^agent\s+pi \(pi\)$/m);
    assert.doesNotMatch(result.stderr, /warning:/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("dependent commands detect ambiguity before project mutation and explicit agent wins", () => {
  const home = tempHome("staffed-ambiguous-");
  const cwd = mkdtempSync(join(tmpdir(), "staffed-ambiguous-project-"));
  try {
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    mkdirSync(join(home, ".claude"));
    for (const args of [["status"], ["enable", "builder", "--scope", "project"]]) {
      const result = runResult(args, { cwd, env: { HOME: home } });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /pass --agent pi or --agent claude/);
    }
    assert.equal(existsSync(join(cwd, ".pi")), false);
    assert.equal(existsSync(join(cwd, ".claude")), false);
    const explicit = runResult(["status", "--agent", "pi", "--scope", "project"], { cwd, env: { HOME: home } });
    assert.equal(explicit.status, 0, explicit.stderr);
    assert.match(explicit.stdout, /^agent\s+pi \(pi\)$/m);
    assert.doesNotMatch(explicit.stderr, /warning:|both Pi/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("no-install fallback is visible, read-only for status, and writes only Pi on enable", () => {
  const home = tempHome("staffed-fallback-");
  const cwd = mkdtempSync(join(tmpdir(), "staffed-fallback-project-"));
  try {
    const status = runResult(["status"], { env: { HOME: home } });
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stderr, /warning: no Pi or Claude Code configuration directory detected; defaulting to agent pi/);
    assert.match(status.stdout, /^agent\s+pi \(pi\)$/m);
    assert.equal(existsSync(join(home, ".pi")), false);

    const enabled = runResult(["enable", "builder", "--scope", "project", "--no-skill"], {
      cwd,
      env: { HOME: home },
    });
    assert.equal(enabled.status, 0, enabled.stderr);
    assert.match(enabled.stderr, /defaulting to agent pi/);
    assert.equal(existsSync(join(cwd, ".pi", "agents", "builder.md")), true);
    assert.equal(existsSync(join(cwd, ".claude")), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("breaking selector names reject and agent/profile axes remain independent", () => {
  const home = tempHome("staffed-agent-profile-");
  const cwd = mkdtempSync(join(tmpdir(), "staffed-agent-profile-project-"));
  try {
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    const formerAgent = ["claude", "code"].join("-");
    const formerOption = `--${"host"}`;
    const cases = [
      [["status", formerOption, "pi"], new RegExp(`unknown option ${formerOption}`)],
      [["status", "--agent", formerAgent], new RegExp(`unknown agent "${formerAgent}"`)],
      [["status", "--agent"], /--agent requires a value/],
      [["enable", "builder", "--scope", "project", "--agent", "pi", "--profile", formerAgent], new RegExp(`unknown profile "${formerAgent}"`)],
    ];
    for (const [args, message] of cases) {
      const result = runResult(args, { cwd, env: { HOME: home } });
      assert.equal(result.status, 1, `${args.join(" ")} unexpectedly exited ${result.status}`);
      assert.match(result.stderr, message);
    }
    run(["enable", "builder", "--scope", "project", "--profile", "claude", "--no-skill"], {
      cwd,
      env: { HOME: home },
    });
    const manifest = JSON.parse(readFileSync(join(cwd, ".pi", "agents", ".staffed.json"), "utf8"));
    assert.equal(manifest.host, "pi");
    assert.equal(manifest.files["builder.md"].profile, "claude");
    assert.equal(manifest.files["builder.md"].model, "sonnet");
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a lone Claude directory selects Claude and reaches the unchanged support gate", () => {
  const home = tempHome("staffed-claude-only-");
  try {
    mkdirSync(join(home, ".claude"));
    const result = runResult(["status"], { env: { HOME: home } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /agent "claude" is not supported yet/);
    assert.doesNotMatch(result.stderr, /defaulting to agent pi/);
    assert.equal(existsSync(join(home, ".pi")), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("project enable records exact pinned install facts and status uses them", () => {
  const cwd = mkdtempSync(join(tmpdir(), "staffed-enable-"));
  try {
    run(["enable", "builder", "--scope", "project", "--profile", "openai", "--no-skill"], { cwd });
    const manifest = JSON.parse(readFileSync(join(cwd, ".pi", "agents", ".staffed.json"), "utf8"));
    assert.deepEqual(
      manifest.files["builder.md"],
      {
        type: "copy",
        hash: manifest.files["builder.md"].hash,
        profile: "openai",
        tier: "strong",
        model: "openai-codex/gpt-5.6-sol",
        thinking: "medium",
      },
    );
    assert.match(manifest.files["builder.md"].hash, /^[a-f0-9]{16}$/);

    const status = run(["status", "--scope", "project"], { cwd });
    assert.match(status, /persona\s+tier\s+effort\s+state\s+installed/);
    assert.match(status, /builder\s+strong\s+low\s+enabled\s+strong → openai-codex\/gpt-5\.6-sol:medium \(openai\)/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("plain enable records inherited mapping without a concrete model", () => {
  const cwd = mkdtempSync(join(tmpdir(), "staffed-inherit-"));
  try {
    run(["enable", "builder", "--scope", "project", "--no-skill"], { cwd });
    const manifest = JSON.parse(readFileSync(join(cwd, ".pi", "agents", ".staffed.json"), "utf8"));
    assert.equal(manifest.files["builder.md"].profile, "none");
    assert.equal(manifest.files["builder.md"].tier, "strong");
    assert.ok(!Object.hasOwn(manifest.files["builder.md"], "model"));
    const status = run(["status", "--scope", "project"], { cwd });
    assert.match(status, /strong → inherited \(none\)/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("status reports legacy manifest mapping as unknown instead of resolving it", () => {
  const cwd = mkdtempSync(join(tmpdir(), "staffed-legacy-"));
  try {
    run(["enable", "builder", "--scope", "project", "--profile", "openai", "--no-skill"], { cwd });
    const path = join(cwd, ".pi", "agents", ".staffed.json");
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    delete manifest.files["builder.md"].tier;
    delete manifest.files["builder.md"].model;
    delete manifest.files["builder.md"].thinking;
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);

    const status = run(["status", "--scope", "project"], { cwd });
    assert.match(status, /unknown \(legacy manifest; re-enable to refresh\)/);
    assert.doesNotMatch(status, /builder.*gpt-5\.6-sol/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("status reports a pinned record missing model metadata as incomplete, not inherited", () => {
  const cwd = mkdtempSync(join(tmpdir(), "staffed-incomplete-"));
  try {
    run(["enable", "builder", "--scope", "project", "--profile", "openai", "--no-skill"], { cwd });
    const path = join(cwd, ".pi", "agents", ".staffed.json");
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    delete manifest.files["builder.md"].model;
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);

    const status = run(["status", "--scope", "project"], { cwd });
    assert.match(status, /builder.*unknown \(incomplete manifest; re-enable to refresh\)/);
    assert.doesNotMatch(status, /builder.*inherited/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("doctor recognizes provider-qualified environment model alias", () => {
  const home = mkdtempSync(join(tmpdir(), "staffed-doctor-"));
  try {
    const output = run(["doctor"], {
      env: { HOME: home, PI_PROVIDER: "openai-codex", PI_MODEL: "gpt-5.6-sol" },
    });
    assert.match(output, /strong\s+openai-codex\/gpt-5\.6-sol:medium\s+ok/);
    assert.match(output, /deep\s+openai-codex\/gpt-5\.6-sol:high\s+ok/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor recognizes provider-qualified user registry aliases", () => {
  const home = mkdtempSync(join(tmpdir(), "staffed-registry-"));
  try {
    const registry = join(home, ".pi", "agent", "models.json");
    mkdirSync(dirname(registry), { recursive: true });
    writeFileSync(registry, JSON.stringify({ providers: { "openai-codex": { models: [{ id: "gpt-5.6-sol" }] } } }));
    const output = run(["doctor"], { env: { HOME: home, PI_PROVIDER: "", PI_MODEL: "" } });
    assert.match(output, /strong\s+openai-codex\/gpt-5\.6-sol:medium\s+ok/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("user-scope lifecycle supports partial disable and clean discovery removal", () => {
  const home = mkdtempSync(join(tmpdir(), "staffed-user-life-"));
  try {
    run(["enable", "builder", "pm"], { env: { HOME: home } });
    const dir = join(home, ".pi", "agent");
    assert.match(run(["status"], { env: { HOME: home } }), /2\/11 enabled/);
    run(["disable", "builder"], { env: { HOME: home } });
    assert.equal(existsSync(join(dir, "agents", "builder.md")), false);
    assert.equal(existsSync(join(dir, "agents", "pm.md")), true);
    const skill = readFileSync(join(dir, "skills", "staffed", "SKILL.md"), "utf8");
    assert.match(skill, /\| `pm` \| balanced \| low \|/);
    assert.doesNotMatch(skill, /\| `builder` \| strong \| low \|/);
    run(["disable"], { env: { HOME: home } });
    assert.equal(existsSync(join(dir, "agents", ".staffed.json")), false);
    assert.equal(existsSync(join(dir, "skills", "staffed", "SKILL.md")), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("pack use exposes an exclusive detective preview switch", () => {
  const cwd = mkdtempSync(join(tmpdir(), "staffed-pack-use-"));
  const home = tempHome("staffed-pack-use-home-");
  try {
    const output = run(["pack", "use", "detective", "--agent", "pi", "--scope", "project"], { cwd, env: { HOME: home } });
    assert.match(output, /active pack detective \(experimental preview\)/);
    const manifest = JSON.parse(readFileSync(join(cwd, ".pi", "agents", ".staffed.json"), "utf8"));
    assert.equal(manifest.pack, "detective");
    assert.equal(existsSync(join(cwd, ".pi", "agents", "investigator.md")), true);
    assert.equal(existsSync(join(cwd, ".pi", "agents", "builder.md")), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("CLI validation reports the complete clean roster and model config", () => {
  const output = run(["validate"]);
  assert.equal(output, "15 personas across 2 packs\n0 problems\n");
});
