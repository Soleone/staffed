import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EFFORTS, TIERS, loadPersonas } from "../src/personas.mjs";
import { loadConfig, resolveProfile, setProfile, setTier, validateModelConfig } from "../src/models.mjs";
import { plan } from "../src/install.mjs";
import { HOSTS } from "../src/hosts.mjs";
import { printTiers } from "../src/cli.mjs";

test("canonical tiers and persona assignments are exact", () => {
  assert.deepEqual(TIERS, ["fast", "balanced", "strong", "deep"]);
  const groups = Object.fromEntries(TIERS.map((tier) => [tier, []]));
  for (const persona of loadPersonas()) groups[persona.tier].push(persona.name);
  for (const names of Object.values(groups)) names.sort();
  assert.deepEqual(groups, {
    fast: [],
    balanced: ["analyst", "marketer", "pm", "researcher", "writer"],
    strong: ["architect", "builder", "ops", "reviewer"],
    deep: ["artist", "ux"],
  });
  assert.deepEqual(EFFORTS, ["low", "medium", "high"]);
  assert.ok(loadPersonas().every((persona) => persona.effort === "low"));
});

test("provider profiles resolve the approved four mappings", () => {
  assert.deepEqual(resolveProfile("openai").map, {
    fast: { model: "openai-codex/gpt-5.6-terra", thinking: "low" },
    balanced: { model: "openai-codex/gpt-5.6-terra", thinking: "medium" },
    strong: { model: "openai-codex/gpt-5.6-sol", thinking: "medium" },
    deep: { model: "openai-codex/gpt-5.6-sol", thinking: "high" },
  });
  assert.deepEqual(resolveProfile("anthropic").map, {
    fast: { model: "anthropic/claude-haiku-4-5", thinking: "low" },
    balanced: { model: "anthropic/claude-sonnet-5", thinking: "medium" },
    strong: { model: "anthropic/claude-opus-5", thinking: "medium" },
    deep: { model: "anthropic/claude-opus-5", thinking: "xhigh" },
  });
});

test("only canonical provider profiles and matching model namespaces are valid", () => {
  const cfg = loadConfig();
  assert.deepEqual(Object.keys(cfg.profiles).sort(), ["anthropic", "openai"]);
  for (const removed of ["pi", "claude", "claude-code", "inherit"]) {
    assert.throws(() => resolveProfile(removed), /unknown profile/);
  }

  const extra = structuredClone(cfg);
  extra.profiles.pi = structuredClone(extra.profiles.anthropic);
  assert.ok(validateModelConfig(extra).some((problem) => /unsupported profile "pi"/.test(problem)));

  const mismatched = structuredClone(cfg);
  mismatched.profiles.anthropic.fast.model = "openai/claude-opus-5";
  assert.ok(validateModelConfig(mismatched).some((problem) => /anthropic.*fast.*anthropic provider/.test(problem)));
  assert.throws(
    () => HOSTS.claude.mapTier({ model: "openai/claude-opus-5", thinking: "medium" }),
    /requires an Anthropic provider model/,
  );

  const before = loadConfig();
  assert.throws(
    () => setTier("anthropic", "fast", { model: "openai/claude-opus-5" }),
    /requires a model from the anthropic provider/,
  );
  assert.deepEqual(loadConfig(), before);
  assert.throws(() => setProfile("pi"), /unknown profile "pi"/);
  assert.deepEqual(loadConfig(), before);
});

test("legacy three-tier profile clones balanced into strong without mutation", () => {
  const cfg = {
    profile: "old",
    profiles: {
      old: {
        fast: { model: "fast", thinking: "low" },
        balanced: { model: "middle", thinking: "medium" },
        deep: { model: "deep", thinking: "high" },
      },
    },
  };
  const before = structuredClone(cfg);
  const profile = resolveProfile("old", cfg);
  assert.deepEqual(profile.map.strong, { model: "middle", thinking: "medium" });
  assert.notStrictEqual(profile.map.strong, profile.map.balanced);
  assert.deepEqual(profile.fallbacks, [{ tier: "strong", from: "balanced" }]);
  assert.deepEqual(cfg, before);
});

test("legacy tier omissions fail and malformed supplied mappings validate", () => {
  const missing = {
    profile: "bad",
    profiles: { bad: { fast: "f", balanced: "b" } },
  };
  assert.throws(() => resolveProfile("bad", missing), /missing tier.*deep/);

  const malformed = {
    profile: "bad",
    profiles: {
      bad: { fast: { model: "" }, balanced: "b", strong: null, deep: "d" },
    },
  };
  const problems = validateModelConfig(malformed);
  assert.ok(problems.some((p) => p.includes('tier "fast"')));
  assert.ok(problems.some((p) => p.includes('tier "strong"')));
});

test("approved representative personas render exact provider values", () => {
  const cwd = mkdtempSync(join(tmpdir(), "staffed-render-"));
  try {
    const openai = plan({ host: "pi", scope: "project", profile: "openai", cwd });
    const openaiByName = new Map(openai.items.map((item) => [item.persona.name, item.content]));
    for (const name of ["builder", "reviewer", "ops"]) {
      assert.match(openaiByName.get(name), /^model: openai-codex\/gpt-5\.6-sol:medium$/m);
    }
    assert.match(openaiByName.get("researcher"), /^model: openai-codex\/gpt-5\.6-terra:medium$/m);
    assert.match(openaiByName.get("architect"), /^model: openai-codex\/gpt-5\.6-sol:medium$/m);

    const anthropic = plan({ host: "pi", scope: "project", profile: "anthropic", cwd });
    const anthropicByName = new Map(anthropic.items.map((item) => [item.persona.name, item.content]));
    assert.match(anthropicByName.get("builder"), /^model: anthropic\/claude-opus-5:medium$/m);
    assert.match(anthropicByName.get("artist"), /^model: anthropic\/claude-opus-5:xhigh$/m);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

function printedTiers(profile, cfg) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  try {
    printTiers(profile, cfg);
  } finally {
    console.log = original;
  }
  return lines.join("\n");
}

test("tier printer shows four OpenAI rows without changing the default", () => {
  const before = loadConfig().profile;
  const output = printedTiers("openai");
  for (const tier of TIERS) assert.match(output, new RegExp(`^  ${tier}\\s`, "m"));
  assert.equal(loadConfig().profile, before);
});

test("tier printer exposes legacy strong fallback and how to declare it", () => {
  const cfg = {
    profile: "legacy",
    profiles: {
      legacy: { fast: "fast", balanced: "balanced:medium", deep: "deep:high" },
    },
  };
  const output = printedTiers("legacy", cfg);
  assert.match(output, /^  strong\s+balanced\s+medium\s+compatibility fallback from balanced$/m);
  assert.match(output, /profile "legacy" has no explicit strong tier/);
  assert.match(output, /staffed tier strong --model <m> --thinking <t>/);
});

test("an explicit strong declaration removes fallback annotation and hint", () => {
  const cfg = {
    profile: "legacy",
    profiles: {
      legacy: {
        fast: "fast",
        balanced: "balanced:medium",
        strong: "declared-strong:high",
        deep: "deep:high",
      },
    },
  };
  const output = printedTiers("legacy", cfg);
  assert.match(output, /^  strong\s+declared-strong\s+high$/m);
  assert.doesNotMatch(output, /compatibility fallback/);
  assert.doesNotMatch(output, /has no explicit strong tier/);
});
