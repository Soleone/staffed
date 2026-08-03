import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { disable, enable, status } from "../src/install.mjs";

const tempProject = () => mkdtempSync(join(tmpdir(), "staffed-pack-project-"));
const readManifest = (cwd) => JSON.parse(readFileSync(join(cwd, ".pi", "agents", ".staffed.json"), "utf8"));
const opts = (cwd, extra = {}) => ({ host: "pi", scope: "project", cwd, ...extra });

test("product remains the default and discovery includes an owned lazy reference", () => {
  const cwd = tempProject();
  try {
    enable(opts(cwd, { only: ["builder"] }));
    const manifest = readManifest(cwd);
    assert.equal(manifest.schema, 2);
    assert.equal(manifest.pack, "product");
    assert.ok(manifest.discovery.skill);
    assert.ok(manifest.references.composition);
    assert.equal(existsSync(join(cwd, ".pi", "skills", "staffed", "references", "composition.md")), true);
    const s = status(opts(cwd));
    assert.equal(s.pack.key, "product");
    assert.equal(s.composition.state, "current");
    assert.deepEqual(s.items.filter((item) => item.state === "enabled").map((item) => item.persona.name), ["builder"]);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("legacy schema-2 manifests infer product read-only and record it on the next mutation", () => {
  const cwd = tempProject();
  try {
    enable(opts(cwd, { only: ["builder"] }));
    const file = join(cwd, ".pi", "agents", ".staffed.json");
    const legacy = readManifest(cwd); delete legacy.pack; writeFileSync(file, `${JSON.stringify(legacy, null, 2)}\n`);
    const before = readFileSync(file, "utf8");
    const s = status(opts(cwd));
    assert.equal(s.pack.key, "product");
    assert.equal(readFileSync(file, "utf8"), before, "status must remain read-only");
    enable(opts(cwd, { only: ["pm"] }));
    assert.equal(readManifest(cwd).pack, "product");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("an explicit pack switch is exclusive and refreshes pack-specific discovery", () => {
  const cwd = tempProject();
  try {
    enable(opts(cwd, { only: ["pm", "builder"] }));
    enable(opts(cwd, { pack: "detective" }));
    const manifest = readManifest(cwd);
    assert.equal(manifest.pack, "detective");
    assert.equal(existsSync(join(cwd, ".pi", "agents", "pm.md")), false);
    assert.equal(existsSync(join(cwd, ".pi", "agents", "builder.md")), false);
    assert.equal(existsSync(join(cwd, ".pi", "agents", "investigator.md")), true);
    const s = status(opts(cwd));
    assert.equal(s.pack.experimental, true);
    assert.equal(s.items.every((item) => item.state === "enabled"), true);
    const skill = readFileSync(join(cwd, ".pi", "skills", "staffed", "SKILL.md"), "utf8");
    const reference = readFileSync(join(cwd, ".pi", "skills", "staffed", "references", "composition.md"), "utf8");
    assert.match(skill, /Detective agency preview/);
    assert.doesNotMatch(skill, /roles: `pm`/);
    assert.match(reference, /### witness/);
    assert.doesNotMatch(reference, /### maintainer/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("pack switching preflights modified old roles and foreign incoming targets", () => {
  const cwd = tempProject();
  try {
    enable(opts(cwd, { only: ["builder"] }));
    const builder = join(cwd, ".pi", "agents", "builder.md");
    writeFileSync(builder, "local edit");
    assert.throws(() => enable(opts(cwd, { pack: "detective" })), /refusing to overwrite/);
    assert.equal(readFileSync(builder, "utf8"), "local edit");
    assert.equal(readManifest(cwd).pack, "product");
    enable(opts(cwd, { pack: "detective", force: true }));
    assert.equal(readManifest(cwd).pack, "detective");
  } finally { rmSync(cwd, { recursive: true, force: true }); }

  const foreign = tempProject();
  try {
    enable(opts(foreign, { only: ["builder"] }));
    const target = join(foreign, ".pi", "agents", "investigator.md");
    writeFileSync(target, "foreign");
    assert.throws(() => enable(opts(foreign, { pack: "detective" })), /refusing to overwrite/);
    assert.equal(readFileSync(target, "utf8"), "foreign");
    assert.equal(existsSync(join(foreign, ".pi", "agents", "builder.md")), true);
    assert.equal(readManifest(foreign).pack, "product");
  } finally { rmSync(foreign, { recursive: true, force: true }); }
});

test("pack switching never deletes an unowned role from the previous pack", () => {
  const cwd = tempProject();
  try {
    enable(opts(cwd, { only: ["builder"] }));
    const foreignOldRole = join(cwd, ".pi", "agents", "pm.md");
    writeFileSync(foreignOldRole, "custom pm");
    assert.throws(() => enable(opts(cwd, { pack: "detective", force: true })), /--force never deletes unowned files/);
    assert.equal(readFileSync(foreignOldRole, "utf8"), "custom pm");
    assert.equal(readManifest(cwd).pack, "product");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("modified composition references are ownership-protected during a switch", () => {
  const cwd = tempProject();
  try {
    enable(opts(cwd, { only: ["builder"] }));
    const reference = join(cwd, ".pi", "skills", "staffed", "references", "composition.md");
    writeFileSync(reference, "local composition notes");
    assert.throws(() => enable(opts(cwd, { pack: "detective" })), /refusing to overwrite/);
    assert.equal(readFileSync(reference, "utf8"), "local composition notes");
    assert.equal(readManifest(cwd).pack, "product");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("project enable rejects repository-controlled managed ancestor symlinks before mutation", () => {
  const cases = [
    {
      name: ".pi",
      setup: (cwd, outside) => symlinkSync(outside, join(cwd, ".pi"), "dir"),
    },
    {
      name: ".pi/agents",
      setup: (cwd, outside) => {
        mkdirSync(join(cwd, ".pi"));
        symlinkSync(outside, join(cwd, ".pi", "agents"), "dir");
      },
    },
    {
      name: ".pi/skills",
      setup: (cwd, outside) => {
        mkdirSync(join(cwd, ".pi"));
        symlinkSync(outside, join(cwd, ".pi", "skills"), "dir");
      },
    },
    {
      name: "staffed/references",
      setup: (cwd, outside) => {
        mkdirSync(join(cwd, ".pi", "skills", "staffed"), { recursive: true });
        symlinkSync(outside, join(cwd, ".pi", "skills", "staffed", "references"), "dir");
      },
    },
  ];

  for (const scenario of cases) {
    const cwd = tempProject();
    const outside = mkdtempSync(join(tmpdir(), "staffed-pack-outside-"));
    try {
      scenario.setup(cwd, outside);
      assert.throws(() => enable(opts(cwd, { only: ["builder"], force: true })), /project files through symlink or non-directory ancestor/, scenario.name);
      assert.deepEqual(readdirSync(outside), [], `${scenario.name} external target must remain untouched`);
      assert.equal(existsSync(join(cwd, ".pi", "agents", ".staffed.json")), false, `${scenario.name} must not create a manifest`);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  }
});

test("project disable and pack switch reject a symlinked skills ancestor atomically", () => {
  const cwd = tempProject();
  const outside = mkdtempSync(join(tmpdir(), "staffed-pack-outside-"));
  try {
    enable(opts(cwd, { only: ["builder"] }));
    const skills = join(cwd, ".pi", "skills");
    const preservedSkills = join(cwd, ".pi", "skills-preserved");
    renameSync(skills, preservedSkills);
    writeFileSync(join(outside, "sentinel"), "outside");
    symlinkSync(outside, skills, "dir");

    assert.throws(() => disable(opts(cwd, { force: true })), /project files through symlink or non-directory ancestor/);
    assert.throws(() => enable(opts(cwd, { pack: "detective", force: true })), /project files through symlink or non-directory ancestor/);
    assert.equal(readManifest(cwd).pack, "product");
    assert.equal(existsSync(join(cwd, ".pi", "agents", "builder.md")), true);
    assert.equal(existsSync(join(cwd, ".pi", "agents", "investigator.md")), false);
    assert.deepEqual(readdirSync(outside), ["sentinel"]);
    assert.equal(readFileSync(join(outside, "sentinel"), "utf8"), "outside");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("composition discovery never traverses a symlinked managed ancestor", () => {
  const cwd = tempProject();
  const outside = mkdtempSync(join(tmpdir(), "staffed-pack-outside-"));
  try {
    enable(opts(cwd, { only: ["builder"] }));
    const references = join(cwd, ".pi", "skills", "staffed", "references");
    rmSync(references, { recursive: true, force: true });
    writeFileSync(join(outside, "composition.md"), "outside sentinel");
    symlinkSync(outside, references, "dir");

    const s = status(opts(cwd));
    assert.equal(s.composition.state, "replaced");
    assert.equal(s.composition.unsafeAncestor, references);
    assert.throws(() => enable(opts(cwd, { force: true })), /symlink or non-directory ancestor/);
    assert.throws(() => enable(opts(cwd, { pack: "detective", force: true })), /symlink or non-directory ancestor/);
    assert.throws(() => disable(opts(cwd, { force: true })), /symlink or non-directory ancestor/);
    assert.equal(readFileSync(join(outside, "composition.md"), "utf8"), "outside sentinel");
    assert.equal(existsSync(join(cwd, ".pi", "agents", "builder.md")), true, "disable must fail before role mutation");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("composition discovery rejects a non-directory managed ancestor", () => {
  const cwd = tempProject();
  try {
    enable(opts(cwd, { only: ["builder"] }));
    const references = join(cwd, ".pi", "skills", "staffed", "references");
    rmSync(references, { recursive: true, force: true });
    writeFileSync(references, "not a directory");
    assert.equal(status(opts(cwd)).composition.state, "replaced");
    assert.throws(() => enable(opts(cwd, { force: true })), /symlink or non-directory ancestor/);
    assert.throws(() => disable(opts(cwd, { force: true })), /symlink or non-directory ancestor/);
    assert.equal(readFileSync(references, "utf8"), "not a directory");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("full uninstall removes empty Staffed discovery directories but preserves foreign siblings", () => {
  const empty = tempProject();
  try {
    enable(opts(empty, { only: ["builder"] }));
    disable(opts(empty));
    assert.equal(existsSync(join(empty, ".pi", "skills", "staffed")), false);
  } finally { rmSync(empty, { recursive: true, force: true }); }

  const foreign = tempProject();
  try {
    enable(opts(foreign, { only: ["builder"] }));
    const note = join(foreign, ".pi", "skills", "staffed", "notes.txt");
    writeFileSync(note, "foreign sibling");
    disable(opts(foreign));
    assert.equal(readFileSync(note, "utf8"), "foreign sibling");
    assert.equal(existsSync(join(foreign, ".pi", "skills", "staffed", "references")), false);
  } finally { rmSync(foreign, { recursive: true, force: true }); }
});
