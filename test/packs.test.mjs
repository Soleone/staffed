import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { disable, enable, status } from "../src/install.mjs";
import { hashText } from "../src/ownership.mjs";

const LEGACY_BLOCK = "<!-- staffed:start -->\nlegacy guidance\n<!-- staffed:end -->";
function trackLegacyBrief(cwd, content = `prefix\n${LEGACY_BLOCK}\nsuffix\n`) {
  const file = join(cwd, "AGENTS.md");
  writeFileSync(file, content);
  const manifestPath = join(cwd, ".pi", "agents", ".staffed.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.discovery = { ...(manifest.discovery ?? {}), brief: { type: "block", hash: hashText(LEGACY_BLOCK) } };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { file, manifestPath };
}

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
    assert.equal(Object.hasOwn(manifest.discovery, "brief"), false);
    assert.equal(existsSync(join(cwd, "AGENTS.md")), false);
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

test("project enable and pack switch clean a matching tracked legacy block without touching surrounding bytes", () => {
  const cwd = tempProject();
  try {
    enable(opts(cwd, { only: ["builder"] }));
    const { file } = trackLegacyBrief(cwd);
    chmodSync(file, 0o664);
    const oldUmask = process.umask(0o027);
    try {
      enable(opts(cwd, { only: ["pm"] }));
    } finally {
      process.umask(oldUmask);
    }
    assert.equal(readFileSync(file, "utf8"), "prefix\n\nsuffix\n");
    assert.equal(statSync(file).mode & 0o777, 0o664);
    assert.equal(Object.hasOwn(readManifest(cwd).discovery, "brief"), false);
    trackLegacyBrief(cwd);
    enable(opts(cwd, { pack: "detective" }));
    assert.equal(readFileSync(file, "utf8"), "prefix\n\nsuffix\n");
    assert.equal(readManifest(cwd).pack, "detective");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("modified tracked legacy blocks stop enable and disable atomically; force remains block-scoped", () => {
  for (const operation of ["enable", "disable"]) {
    const cwd = tempProject();
    try {
      enable(opts(cwd, { only: ["builder"] }));
      const { file, manifestPath } = trackLegacyBrief(cwd, `before\n${LEGACY_BLOCK.replace("legacy", "modified")}\nafter`);
      const role = join(cwd, ".pi", "agents", "builder.md");
      const beforeRole = readFileSync(role, "utf8"), beforeManifest = readFileSync(manifestPath, "utf8");
      const invoke = (force = false) => operation === "enable"
        ? enable(opts(cwd, { only: ["pm"], force }))
        : disable(opts(cwd, { only: ["builder"], force }));
      assert.throws(() => invoke(), /modified legacy Staffed brief/);
      assert.equal(readFileSync(role, "utf8"), beforeRole);
      assert.equal(readFileSync(manifestPath, "utf8"), beforeManifest);
      invoke(true);
      assert.equal(readFileSync(file, "utf8"), "before\n\nafter");
      if (existsSync(manifestPath)) assert.equal(Object.hasOwn(readManifest(cwd).discovery ?? {}, "brief"), false);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});

test("dry runs preflight but do not migrate a tracked legacy block or manifest", () => {
  const cwd = tempProject();
  try {
    enable(opts(cwd, { only: ["builder"] }));
    const { file, manifestPath } = trackLegacyBrief(cwd);
    const beforeFile = readFileSync(file, "utf8"), beforeManifest = readFileSync(manifestPath, "utf8");
    enable(opts(cwd, { only: ["pm"], dryRun: true }));
    assert.equal(readFileSync(file, "utf8"), beforeFile);
    assert.equal(readFileSync(manifestPath, "utf8"), beforeManifest);
    disable(opts(cwd, { dryRun: true }));
    assert.equal(readFileSync(file, "utf8"), beforeFile);
    assert.equal(readFileSync(manifestPath, "utf8"), beforeManifest);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("missing legacy targets and marker-free files only prune the tracked record", () => {
  for (const state of ["missing", "marker-free"]) {
    const cwd = tempProject();
    try {
      enable(opts(cwd, { only: ["builder"] }));
      const { file } = trackLegacyBrief(cwd, state === "missing" ? LEGACY_BLOCK : "user notes\n");
      if (state === "missing") rmSync(file);
      enable(opts(cwd, { only: ["builder"] }));
      assert.equal(existsSync(file), state !== "missing");
      if (state === "marker-free") assert.equal(readFileSync(file, "utf8"), "user notes\n");
      assert.equal(Object.hasOwn(readManifest(cwd).discovery, "brief"), false);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});

test("malformed tracked markers and unsafe target types fail even with force before mutation", () => {
  const malformed = [
    "<!-- staffed:start -->broken",
    "<!-- staffed:end -->\n<!-- staffed:start -->",
    `${LEGACY_BLOCK}\n${LEGACY_BLOCK}`,
  ];
  for (const content of malformed) {
    const cwd = tempProject();
    try {
      enable(opts(cwd, { only: ["builder"] }));
      const { manifestPath } = trackLegacyBrief(cwd, content);
      const before = readFileSync(manifestPath, "utf8");
      for (const force of [false, true]) assert.throws(() => enable(opts(cwd, { only: ["pm"], force })), /malformed/);
      assert.equal(readFileSync(manifestPath, "utf8"), before);
      assert.equal(existsSync(join(cwd, ".pi", "agents", "pm.md")), false);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }

  for (const kind of ["symlink", "directory"]) {
    const cwd = tempProject(), outside = mkdtempSync(join(tmpdir(), "staffed-brief-target-"));
    try {
      enable(opts(cwd, { only: ["builder"] }));
      const { file, manifestPath } = trackLegacyBrief(cwd);
      rmSync(file);
      if (kind === "symlink") { const victim = join(outside, "victim"); writeFileSync(victim, LEGACY_BLOCK); symlinkSync(victim, file); }
      else { mkdirSync(file); writeFileSync(join(file, "victim"), "keep"); }
      const before = readFileSync(manifestPath, "utf8");
      for (const force of [false, true]) assert.throws(() => disable(opts(cwd, { force })), /symlink or non-file/);
      assert.equal(readFileSync(manifestPath, "utf8"), before);
      assert.equal(existsSync(join(cwd, ".pi", "agents", "builder.md")), true);
      if (kind === "directory") assert.equal(readFileSync(join(file, "victim"), "utf8"), "keep");
      else assert.equal(readFileSync(join(outside, "victim"), "utf8"), LEGACY_BLOCK);
    } finally { rmSync(cwd, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
  }
});

test("untracked marker blocks are untouched by lifecycle operations including force", () => {
  const cwd = tempProject();
  try {
    const file = join(cwd, "AGENTS.md"); writeFileSync(file, LEGACY_BLOCK);
    enable(opts(cwd, { only: ["builder"], force: true }));
    status(opts(cwd));
    enable(opts(cwd, { pack: "detective", force: true }));
    disable(opts(cwd, { force: true }));
    assert.equal(readFileSync(file, "utf8"), LEGACY_BLOCK);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
