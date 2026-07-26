import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TIERS, loadPersonas } from "../src/personas.mjs";
import { loadConfig, resolveProfile, validateModelConfig } from "../src/models.mjs";
import { plan } from "../src/install.mjs";
import { printTiers } from "../src/cli.mjs";

test("canonical tiers and persona assignments are exact", () => {
  assert.deepEqual(TIERS, ["fast", "balanced", "strong", "deep"]);
  const groups = Object.fromEntries(TIERS.map((tier) => [tier, []]));
  for (const persona of loadPersonas()) groups[persona.tier].push(persona.name);
  for (const names of Object.values(groups)) names.sort();
  assert.deepEqual(groups, {
    fast: [],
    balanced: ["analyst", "marketer", "researcher", "writer"],
    strong: ["builder", "ops", "reviewer"],
    deep: ["architect", "artist", "pm", "ux"],
  });
});

test("openai profile resolves the approved four mappings", () => {
  assert.deepEqual(resolveProfile("openai").map, {
    fast: { model: "openai-codex/gpt-5.6-terra", thinking: "low" },
    balanced: { model: "openai-codex/gpt-5.6-terra", thinking: "medium" },
    strong: { model: "openai-codex/gpt-5.6-sol", thinking: "medium" },
    deep: { model: "openai-codex/gpt-5.6-sol", thinking: "high" },
  });
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

test("approved representative personas render exact OpenAI values", () => {
  const cwd = mkdtempSync(join(tmpdir(), "staffed-render-"));
  try {
    const result = plan({ host: "pi", scope: "project", profile: "openai", cwd });
    const byName = new Map(result.items.map((item) => [item.persona.name, item.content]));
    for (const name of ["builder", "reviewer", "ops"]) {
      assert.match(byName.get(name), /^model: openai-codex\/gpt-5\.6-sol:medium$/m);
    }
    assert.match(byName.get("researcher"), /^model: openai-codex\/gpt-5\.6-terra:medium$/m);
    assert.match(byName.get("architect"), /^model: openai-codex\/gpt-5\.6-sol:high$/m);
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
