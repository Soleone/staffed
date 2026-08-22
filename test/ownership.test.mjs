import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashText, inspectFile, normalizeManifest, removeDecision, writeDecision } from "../src/ownership.mjs";

test("copy and link ownership states and decisions fail safe", () => {
  const dir = mkdtempSync(join(tmpdir(), "staffed-owner-"));
  try {
    const file = join(dir, "agent.md");
    assert.equal(inspectFile(file).state, "disabled");
    writeFileSync(file, "ours");
    assert.equal(inspectFile(file).state, "foreign");
    const copy = { type: "copy", hash: hashText("ours") };
    assert.equal(inspectFile(file, copy).state, "enabled");
    writeFileSync(file, "changed");
    assert.equal(inspectFile(file, copy).state, "modified");
    assert.equal(writeDecision("modified", { force: false }), "block");
    assert.equal(writeDecision("modified", { force: true }), "allow");
    assert.equal(removeDecision("foreign", { force: true }), "noop");
    assert.equal(removeDecision("modified", { force: false }), "keep");
    assert.equal(removeDecision("modified", { force: true }), "remove");
    rmSync(file);
    const source = join(dir, "source"); writeFileSync(source, "x"); symlinkSync(source, file);
    assert.equal(inspectFile(file, { type: "link", target: source }).state, "enabled");
    assert.equal(inspectFile(file, { type: "link", target: "elsewhere" }).state, "replaced");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("manifest normalization validates identity and treats legacy discovery as unowned", () => {
  const legacy = normalizeManifest({ package: "staffed", host: "pi", scope: "project", files: {} }, { hostKey: "pi", scope: "project" });
  assert.equal(legacy.legacy, true);
  assert.deepEqual(legacy.discovery, {});
  assert.throws(() => normalizeManifest({ package: "other", host: "pi", scope: "project", files: {} }, { hostKey: "pi", scope: "project" }), /package/);
  assert.throws(() => normalizeManifest({ schema: 3, package: "staffed", host: "pi", scope: "project", files: {} }, { hostKey: "pi", scope: "project" }), /schema/);
});

test("manifest records fail closed by slot and required value type", () => {
  const base = { schema: 2, package: "staffed", host: "pi", scope: "project", files: {}, discovery: {} };
  const invalid = [
    { ...base, files: null },
    { schema: 2, package: "staffed", host: "pi", scope: "project", discovery: {} },
    { ...base, discovery: null },
    { ...base, files: { "builder.md": { type: "block", hash: "a".repeat(16) } } },
    { ...base, files: { "builder.md": { type: "copy", hash: 42 } } },
    { ...base, files: { "builder.md": { type: "link", target: null } } },
    { ...base, discovery: { skill: { type: "block", hash: "a".repeat(16) } } },
    { ...base, discovery: { composition: { type: "copy", hash: "a".repeat(16) } } },
    { ...base, references: { composition: { type: "block", hash: "a".repeat(16) } } },
    { ...base, discovery: { other: { type: "copy", hash: "a".repeat(16) } } },
    { ...base, discovery: { brief: { type: "block", hash: "b".repeat(16) } } },
  ];
  for (const manifest of invalid) {
    assert.throws(() => normalizeManifest(manifest, { hostKey: "pi", scope: "project" }), /manifest/);
  }

  const withoutDiscovery = { schema: 2, package: "staffed", host: "pi", scope: "project", files: {} };
  assert.deepEqual(normalizeManifest(withoutDiscovery, { hostKey: "pi", scope: "project" }).discovery, {});
  const withComposition = { ...base, pack: "detective", references: { composition: { type: "copy", hash: "a".repeat(16) } } };
  const normalized = normalizeManifest(withComposition, { hostKey: "pi", scope: "project" });
  assert.equal(normalized.pack, "detective");
  assert.equal(normalized.references.composition.type, "copy");
});
