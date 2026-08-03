import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { compositionSentence, dimensionsFor, loadCatalog, parseComposition, resolvePack, validateCatalog, vocabularyFor } from "../src/packs.mjs";
import { generateBrief } from "../src/brief.mjs";
import { generateCompositionReference, generateSkill } from "../src/skill.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "bin", "staffed.mjs");
const run = (args, env = {}) => spawnSync(process.execPath, [BIN, ...args], { cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8" });

test("catalog is valid and active vocabularies have globally unique exact tokens", () => {
  assert.deepEqual(validateCatalog(), []);
  for (const packName of ["product", "detective"]) {
    const tokens = vocabularyFor(packName).flatMap((entry) => [entry.name, entry.alias].filter(Boolean).map((token) => token.toLowerCase()));
    assert.equal(new Set(tokens).size, tokens.length, packName);
  }
});

test("aliases classify an order-independent composition and preserve canonical output", () => {
  const result = parseComposition(["DIR", "pm", "scep", "prag", "maint"]);
  assert.equal(result.selected.role.name, "pm");
  assert.equal(result.selected.drive.name, "pragmatist");
  assert.equal(result.selected.lens.name, "sceptic");
  assert.equal(result.selected.audience.name, "maintainer");
  assert.equal(result.selected.voice.name, "direct");
  assert.match(compositionSentence(result), /^Use pm to seek the smallest dependable action/);
});

test("composition rejects duplicate dimensions, arbitrary prefixes, and missing roles", () => {
  assert.throws(() => parseComposition(["pm", "prag", "stew"]), /two drive modes/);
  assert.throws(() => parseComposition(["pm", "pra"]), /unknown composition option/);
  assert.throws(() => parseComposition(["prag", "scep"]), /needs one role/);
  assert.throws(() => parseComposition(["pm", "skeptic"]), /Did you mean "sceptic"/);
});

test("core modes are shared while audiences and roles are pack-specific", () => {
  const productAudience = dimensionsFor("product").find((dimension) => dimension.name === "audience").modes.map((mode) => mode.name);
  const detectiveAudience = dimensionsFor("detective").find((dimension) => dimension.name === "audience").modes.map((mode) => mode.name);
  assert.ok(productAudience.includes("maintainer"));
  assert.ok(!detectiveAudience.includes("maintainer"));
  assert.ok(detectiveAudience.includes("witness"));
  assert.throws(() => parseComposition(["investigator"], "product"), /unknown composition option/);
  assert.equal(resolvePack("detective").experimental, true);
});

test("skill keeps a compact index and lazy-loads detailed definitions", () => {
  const pack = resolvePack("detective");
  const skill = generateSkill({ enabled: ["investigator", "case-reviewer"], personas: pack.personas, pack: pack.key });
  const reference = generateCompositionReference({ pack: pack.key, personas: pack.personas });
  assert.match(skill, /`sceptic` \(`scep`\)/);
  assert.match(skill, /read `references\/composition\.md`/);
  assert.match(skill, /Default to the plain role/);
  assert.match(skill.replace(/\s+/g, " "), /the persona task itself must include `Composition:`/);
  assert.match(skill.replace(/\s+/g, " "), /one concise `Behavior:` line for every selected mode/);
  assert.match(skill.replace(/\s+/g, " "), /role scope, truth, correctness, safety, effort, model tier, permissions, and output contracts take precedence/);
  assert.doesNotMatch(skill, /Watch for: reflexive doubt/);
  assert.match(reference, /Dispatch behavior: interrogate unsupported assumptions/);
  assert.match(reference, /Watch for: reflexive doubt or analysis paralysis/);
  assert.match(reference, /experimental preview/);
  assert.match(skill, /Not installed: interviewer, forensic-analyst/);
  assert.doesNotMatch(skill, /careful-account|evidence-pass/);
  const brief = generateBrief({ enabled: ["investigator", "case-reviewer"], pack: "detective" });
  assert.match(brief.replace(/\s+/g, " "), /Use `case-reviewer` only/);
  assert.doesNotMatch(brief, /Use `reviewer` only/);
});

test("skill frontmatter activates exact enabled roles with modifiers while retaining the ordinary-prompt gate", () => {
  const pack = resolvePack("product");
  const skill = generateSkill({ enabled: pack.personas.map((persona) => persona.name), personas: pack.personas });
  const description = skill.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const oneLine = description.replace(/\s+/g, " ");
  const nonExampleComposition = ["decisive", "builder"];
  assert.match(oneLine, /have a sceptic maintainer direct pm look at this/);
  assert.match(oneLine, /pm prag scep/);
  assert.match(oneLine, /request combining one of these exact enabled Staffed roles with behavioral modifiers or aliases/);
  assert.match(oneLine, new RegExp(`roles with behavioral modifiers or aliases: [^.]*\\b${nonExampleComposition[1]}\\b`));
  assert.doesNotMatch(oneLine, new RegExp(nonExampleComposition.join("\\s+")), "the test composition must not be a hard-coded example");
  assert.doesNotMatch(oneLine, /decisive \(`dec`\)/, "the full mode catalog belongs in the lazily loaded skill body");
  assert.match(oneLine, /Do NOT use for ordinary edits, bug fixes, refactors, reviews or questions/);

  const partial = generateSkill({ enabled: ["builder"], personas: pack.personas });
  const partialFrontmatter = partial.match(/^---\n([\s\S]*?)\n---/)?.[1]?.replace(/\s+/g, " ") ?? "";
  assert.match(partialFrontmatter, /exact enabled Staffed roles with behavioral modifiers or aliases: builder/);
  assert.match(partialFrontmatter, /Examples: "builder scep dir"/);
  assert.doesNotMatch(partialFrontmatter, /\bpm prag scep\b/, "examples must not advertise disabled roles");
});

test("catalog validation reports malformed authoritative fields without throwing", () => {
  const malformed = structuredClone(loadCatalog());
  malformed.packs.product.label = "";
  malformed.packs.product.stages.push({ name: "pm", role: "" });
  malformed.packs.product.noArtifact.push("ghost");
  malformed.packs.product.recipes.push(structuredClone(malformed.packs.product.recipes[0]));
  malformed.packs.product.sizing[0].chain = ["ghost"];
  malformed.packs.detective.loops = "not-an-array";
  let problems;
  assert.doesNotThrow(() => { problems = validateCatalog(malformed); });
  assert.ok(problems.some((problem) => /packs\.product\.label/.test(problem)));
  assert.ok(problems.some((problem) => /duplicate role "pm"/.test(problem)));
  assert.ok(problems.some((problem) => /noArtifact references unknown role "ghost"/.test(problem)));
  assert.ok(problems.some((problem) => /recipes has duplicate name/.test(problem)));
  assert.ok(problems.some((problem) => /sizing\[0\]\.chain references unknown role "ghost"/.test(problem)));
  assert.ok(problems.some((problem) => /packs\.detective\.loops must be an array/.test(problem)));
  assert.deepEqual(validateCatalog(null), ["catalog must be an object"]);
});

test("generic generators consume third-pack metadata without built-in role leakage", () => {
  const catalog = structuredClone(loadCatalog());
  catalog.packs.guide = {
    label: "Guide collective",
    description: "A neutral orientation staff.",
    agentsDir: "test/fixtures/third-pack/agents",
    experimental: true,
    stages: [{ name: "guide", role: "orientation" }],
    noArtifact: [],
    noDirectory: [],
    audiences: [],
    recipes: [{ name: "orient", goal: "Orient the requester.", composition: ["guide", "exploratory", "requester", "direct"] }],
    sizing: [{ work: "an unfamiliar situation", chain: ["guide"] }],
    riskGate: "Add `guide` only when orientation materially helps the requester.",
    briefGuidance: "The pipeline is an ordering reference. Use `guide` for orientation and keep the handoff compact.",
    loops: [{ requires: ["guide"], text: "A materially changed situation returns to `guide`." }],
    parallelism: [{ requires: ["guide"], text: "Run guides independently only for distinct situations." }],
    activationExamples: ["guide expl req"]
  };
  assert.deepEqual(validateCatalog(catalog), []);
  const pack = resolvePack("guide", catalog);
  const skill = generateSkill({ enabled: ["guide"], personas: pack.personas, pack: "guide", catalog });
  const brief = generateBrief({ enabled: ["guide"], pack: "guide", catalog });
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/)?.[1]?.replace(/\s+/g, " ") ?? "";
  assert.match(frontmatter, /exact enabled Staffed roles with behavioral modifiers or aliases: guide/);
  assert.doesNotMatch(frontmatter, /exploratory \(`expl`\)/);
  for (const text of [skill, brief]) {
    assert.match(text, /Guide collective/);
    assert.match(text, /`guide`/);
    assert.doesNotMatch(text, /\b(?:pm|reviewer|case-reviewer|investigator|interviewer|forensic-analyst)\b/);
  }
  assert.match(skill, /Run guides independently only for distinct situations/);
  assert.match(brief, /Use `guide` for orientation/);
});

test("npm pack dry-run contains runtime and preview files without dependencies or a tarball", () => {
  const before = new Set(tarballs());
  const result = spawnSync("npm", ["pack", "--dry-run", "--json"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout)[0];
  const files = new Set(report.files.map((file) => file.path));
  for (const path of ["bin/staffed.mjs", "src/packs.mjs", "catalog.json", "packs/detective/agents/investigator.md"]) {
    assert.ok(files.has(path), `missing packed file ${path}`);
  }
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    assert.equal(Object.hasOwn(pkg, field), false, `${field} must remain absent`);
  }
  assert.deepEqual(new Set(tarballs()), before, "--dry-run must not leave a tarball");
});

const tarballs = () => readdirSync(ROOT).filter((name) => name.endsWith(".tgz"));

test("compose, pack discovery, and detective list are agent-independent", () => {
  const home = mkdtempSync(join(tmpdir(), "staffed-compose-home-"));
  try {
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    mkdirSync(join(home, ".claude"));
    for (const args of [
      ["compose"],
      ["compose", "lens"],
      ["compose", "sceptic"],
      ["compose", "recipes", "--pack", "detective"],
      ["compose", "pm", "prag", "scep", "maint", "dir"],
      ["list", "--pack", "detective"],
      ["pack", "list"],
    ]) {
      const result = run(args, { HOME: home });
      assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
      assert.doesNotMatch(result.stderr, /both Pi and Claude Code/);
    }
    assert.match(run(["list", "--pack", "detective"], { HOME: home }).stdout, /experimental preview/);
    assert.match(run(["compose", "pm", "prag", "scep", "maint", "dir"], { HOME: home }).stdout, /drive\s+pragmatist/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
