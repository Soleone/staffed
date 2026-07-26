import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "bin", "staffed.mjs");

function run(args, { cwd = ROOT, env = {} } = {}) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `command failed: ${result.stderr}\n${result.stdout}`);
  return result.stdout;
}

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
    assert.match(status, /persona\s+recommended\s+state\s+installed/);
    assert.match(status, /builder\s+strong\s+enabled\s+strong → openai-codex\/gpt-5\.6-sol:medium \(openai\)/);
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

test("CLI validation reports the complete clean roster and model config", () => {
  const output = run(["validate"]);
  assert.equal(output, "11 personas\n0 problems\n");
});
