import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ROOT } from "./personas.mjs";
import { DEFAULT_PACK, resolvePack } from "./packs.mjs";
import { resolveProfile, tierFor } from "./models.mjs";
import { resolveHost, targetDir } from "./hosts.mjs";
import { planLegacyBriefCleanup } from "./legacy-brief-cleanup.mjs";
import { compositionReferencePath, generateCompositionReference, generateSkill, skillPath } from "./skill.mjs";
import { hashText, inspectFile, normalizeManifest, removeDecision, writeDecision } from "./ownership.mjs";

const MANIFEST = ".staffed.json";
const pkgVersion = () => JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const isEphemeral = (p) => p.includes("/_npx/") || p.includes("/dlx-") || p.startsWith(tmpdir());
const pathExists = (path) => { try { lstatSync(path); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; } };

function referenceAncestorProblem(path) {
  const staffedDir = dirname(dirname(path));
  for (const ancestor of [staffedDir, dirname(path)]) {
    if (!pathExists(ancestor)) continue;
    const stat = lstatSync(ancestor);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return ancestor;
  }
  return null;
}

function skillAncestorProblem(path) {
  const ancestor = dirname(path);
  if (!pathExists(ancestor)) return null;
  const stat = lstatSync(ancestor);
  return stat.isSymbolicLink() || !stat.isDirectory() ? ancestor : null;
}

function assertSafeSkillPath(path) {
  const unsafe = skillAncestorProblem(path);
  if (unsafe) throw new Error(`refusing to access Staffed skill through symlink or non-directory ancestor ${unsafe}`);
}

function assertSafeReferencePath(path) {
  const unsafe = referenceAncestorProblem(path);
  if (unsafe) throw new Error(`refusing to access composition reference through symlink or non-directory ancestor ${unsafe}`);
}

function inspectSkillFile(path, record) {
  const unsafeAncestor = skillAncestorProblem(path);
  return unsafeAncestor
    ? { path, record, state: "replaced", unsafeAncestor }
    : inspectFile(path, record);
}

function inspectReferenceFile(path, record) {
  const unsafeAncestor = referenceAncestorProblem(path);
  return unsafeAncestor
    ? { path, record, state: "replaced", unsafeAncestor }
    : inspectFile(path, record);
}

function removeEmptyDirectory(path) {
  try { rmdirSync(path); } catch (error) { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error?.code)) throw error; }
}

/**
 * Project configuration is repository-controlled. Never follow one of its managed
 * directory ancestors through a symlink (or a non-directory) before mutating role or
 * discovery files. User-scope config may intentionally live behind home-directory
 * symlinks, so this boundary is deliberately project-only.
 */
function assertSafeProjectMutationPaths(scope, cwd, paths) {
  if (scope !== "project") return;
  const root = resolve(cwd);
  for (const target of paths) {
    const parent = dirname(resolve(target));
    const rel = relative(root, parent);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
      throw new Error(`refusing to mutate project-managed path outside ${root}: ${target}`);
    }
    let current = root;
    for (const part of rel.split(sep).filter(Boolean)) {
      current = join(current, part);
      if (!pathExists(current)) continue;
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`refusing to mutate project files through symlink or non-directory ancestor ${current}`);
      }
    }
  }
}

function assertSafeDiscoveryTarget(path) {
  if (pathExists(path) && lstatSync(path).isDirectory() && readdirSync(path).length) {
    throw new Error(`refusing to replace non-empty discovery directory ${path}`);
  }
}

function removeDiscoveryTarget(path) {
  if (!pathExists(path)) return;
  if (lstatSync(path).isDirectory()) rmdirSync(path);
  else rmSync(path, { force: true });
}

function atomicReplace(path, content, mode) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
  try {
    writeFileSync(temp, content, { flag: "wx", ...(mode === undefined ? {} : { mode }) });
    if (mode !== undefined) chmodSync(temp, mode);
    if (pathExists(path) && lstatSync(path).isDirectory()) rmdirSync(path);
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

function loadManifest(dir, context, { diagnostic = false } = {}) {
  const file = join(dir, MANIFEST);
  if (!existsSync(file)) return { manifest: null, manifestError: null };
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return { manifest: normalizeManifest(raw, context), manifestError: null };
  } catch (error) {
    if (!diagnostic) throw new Error(`invalid Staffed manifest ${file}: ${error.message}`);
    return { manifest: null, manifestError: error.message };
  }
}

function select(personas, only) {
  if (!only?.length) return personas;
  const known = new Map(personas.map((p) => [p.name, p]));
  const unknown = only.filter((n) => !known.has(n));
  if (unknown.length) throw new Error(`unknown agent(s): ${unknown.join(", ")}\nroster: ${personas.map((p) => p.name).join(" ")}`);
  return only.map((n) => known.get(n));
}

function validateProfile(host, profile) {
  if (host.allowedProfiles && !host.allowedProfiles.includes(profile.key)) {
    throw new Error(`profile "${profile.key}" is not valid for ${host.label}; use ${host.allowedProfiles.join(", ")}`);
  }
  if (host.key === "claude" && profile.map) {
    for (const value of Object.values(profile.map)) {
      if (value.thinking || !["inherit", "haiku", "sonnet", "opus"].includes(value.model)) {
        throw new Error(`profile "${profile.key}" contains a model Claude Code cannot safely render`);
      }
    }
  }
}

function recursiveMarkdown(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) recursiveMarkdown(path, out);
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(path);
  }
  return out;
}

function declaredName(path) {
  try { return readFileSync(path, "utf8").match(/^name:\s*([^\n]+)$/m)?.[1]?.trim() ?? null; }
  catch { return null; }
}

function collisions(host, dir, items) {
  if (host.key !== "claude") return [];
  const targets = new Set(items.map((i) => i.path));
  const names = new Set(items.map((i) => i.persona.name));
  return recursiveMarkdown(dir).flatMap((path) => {
    const name = declaredName(path);
    return name && names.has(name) && !targets.has(path) ? [{ name, path }] : [];
  });
}

export function plan({ host: hostName, scope = "user", profile = "none", mode = "copy", only, pack: requestedPack, cwd = process.cwd() }) {
  const host = resolveHost(hostName);
  const prof = resolveProfile(profile);
  validateProfile(host, prof);
  const dir = targetDir(host, scope, cwd);
  const { manifest, manifestError } = loadManifest(dir, { hostKey: host.key, scope });
  const activePack = manifest?.pack ?? DEFAULT_PACK;
  const pack = resolvePack(requestedPack ?? activePack);
  const previousPack = resolvePack(activePack);
  const switching = Boolean(manifest && pack.key !== activePack);
  const personas = pack.personas;
  if (mode === "link" && prof.map) throw new Error("--link cannot be combined with a model profile: a rendered file is not a link to the source.");
  if (mode === "link" && host.key === "claude") throw new Error("--link is unavailable for Claude Code because its explicit-only description must be rendered.");
  if (mode === "link" && isEphemeral(ROOT)) throw new Error(`--link refused: this package lives in an ephemeral directory (${ROOT}).\nLinks would break as soon as the cache is cleared. Use the default copy mode, or clone the repo and link from there.`);
  const items = select(personas, only).map((persona) => {
    const file = host.filename(persona), path = join(dir, file), tier = tierFor(persona, prof);
    return { persona, file, path, tier, content: mode === "link" ? null : host.render(persona, tier), ...inspectFile(path, manifest?.files[file]) };
  });
  const previousItems = switching ? previousPack.personas.map((persona) => {
    const file = host.filename(persona), path = join(dir, file);
    return { persona, file, path, ...inspectFile(path, manifest?.files[file]) };
  }) : [];
  return { host, scope, profile: prof, mode, dir, items, manifest, manifestError, personas, pack, previousPack, switching, previousItems, collisions: collisions(host, dir, items) };
}

function recordFor(p, item) {
  if (p.mode === "link") return { type: "link", target: join(ROOT, p.pack.agentsDir, item.persona.file) };
  return { type: "copy", hash: hashText(item.content), profile: p.profile.key, tier: item.persona.tier,
    ...(item.tier ? { model: item.tier.model } : {}), ...(item.tier?.thinking != null ? { thinking: item.tier.thinking } : {}) };
}

function writeManifest(p, files, discovery, references = p.manifest?.references ?? {}) {
  const value = { schema: 2, package: "staffed", version: pkgVersion(), host: p.host.key, scope: p.scope, source: ROOT,
    pack: p.pack?.key ?? p.manifest?.pack ?? DEFAULT_PACK, updatedAt: new Date().toISOString(), files, ...(Object.keys(discovery).length ? { discovery } : {}), ...(Object.keys(references).length ? { references } : {}) };
  writeFileSync(join(p.dir, MANIFEST), `${JSON.stringify(value, null, 2)}\n`);
  return value;
}

function healthyNames(host, dir, files, pack) {
  return pack.personas.filter((persona) => inspectFile(join(dir, host.filename(persona)), files[host.filename(persona)]).state === "enabled").map((p) => p.name);
}

function discoveryStatus(host, scope, cwd, manifest, names, pack) {
  const skillFile = skillPath(host.skillDir(scope, cwd));
  const skillText = generateSkill({ hostKey: host.key, enabled: names, personas: pack.personas, pack: pack.key });
  const si = inspectSkillFile(skillFile, manifest?.discovery?.skill);
  const skill = { ...si, state: si.state === "enabled" ? (readFileSync(skillFile, "utf8") === skillText ? "current" : "stale") : si.state };
  const referenceFile = compositionReferencePath(host.skillDir(scope, cwd));
  const referenceText = generateCompositionReference({ pack: pack.key, personas: pack.personas.filter((p) => names.includes(p.name)) });
  const ri = inspectReferenceFile(referenceFile, manifest?.references?.composition);
  const composition = { ...ri, state: ri.state === "enabled" ? (readFileSync(referenceFile, "utf8") === referenceText ? "current" : "stale") : ri.state, content: referenceText };
  return { skill: { ...skill, content: skillText }, composition };
}

export function enable(opts) {
  const p = plan(opts); const { force = false, dryRun = false } = opts;
  if (p.collisions.length) throw new Error(`Claude agent name collision(s):\n${p.collisions.map((c) => `  ${c.name}: ${c.path}`).join("\n")}`);
  if (p.switching && opts.skill === false && (p.manifest.discovery?.skill || p.manifest.references?.composition)) {
    throw new Error("--no-skill cannot switch a pack that has tracked discovery; switch normally, then disable discovery if needed");
  }
  const blocked = p.items.filter((i) => writeDecision(i.state, { force }) === "block");
  if (p.switching) {
    const foreignPrevious = p.previousItems.filter((item) => item.state === "foreign");
    if (foreignPrevious.length) {
      throw new Error(`refusing to switch while unowned ${p.previousPack.key} role file(s) remain:\n${foreignPrevious.map((item) => `  ${item.path}`).join("\n")}\nMove or remove them explicitly; --force never deletes unowned files.`);
    }
    for (const item of p.previousItems) {
      const decision = removeDecision(item.state, { force });
      if (decision === "keep") blocked.push(item);
    }
  }
  const files = p.switching ? {} : { ...(p.manifest?.files ?? {}) };
  const selected = new Set(p.items.map((item) => item.persona.name));
  for (const item of p.items) files[item.file] = recordFor(p, item);
  const names = p.personas
    .filter((persona) => selected.has(persona.name) || (!p.switching && inspectFile(join(p.dir, p.host.filename(persona)), p.manifest?.files?.[p.host.filename(persona)]).state === "enabled"))
    .map((persona) => persona.name);
  const cwd = opts.cwd ?? process.cwd();
  const d = discoveryStatus(p.host, p.scope, cwd, p.manifest, names, p.pack);
  const desired = opts.skill !== false ? [["skill", d.skill], ["composition", d.composition]] : [];
  const legacyCleanup = p.manifest?.discovery?.brief
    ? planLegacyBriefCleanup({ hostKey: p.host.key, scope: p.scope, cwd, home: opts.home, record: p.manifest.discovery.brief, force })
    : null;
  assertSafeProjectMutationPaths(p.scope, cwd, [
    join(p.dir, MANIFEST),
    ...p.items.map((item) => item.path),
    ...p.previousItems.map((item) => item.path),
    ...desired.map(([, item]) => item.path),
    ...(legacyCleanup ? [legacyCleanup.path] : []),
  ]);
  for (const [, item] of desired) {
    if (["foreign", "modified", "replaced"].includes(item.state) && !force) blocked.push(item);
  }
  if (blocked.length) throw new Error(`refusing to overwrite ${blocked.length} unowned or modified item(s):\n${blocked.map((i) => `  ${i.file ?? i.path}`).join("\n")}\nRe-run with --force to overwrite.`);
  for (const [key, item] of desired) {
    if (key === "skill") assertSafeSkillPath(item.path);
    if (key === "composition") assertSafeReferencePath(item.path);
    assertSafeDiscoveryTarget(item.path ?? item.file);
  }
  if (dryRun) return { ...p, wrote: [], dryRun: true };
  mkdirSync(p.dir, { recursive: true });
  const discovery = { ...(p.manifest?.discovery ?? {}) };
  const references = { ...(p.manifest?.references ?? {}) };
  if (legacyCleanup) {
    if (legacyCleanup.action === "remove-block") atomicReplace(legacyCleanup.path, legacyCleanup.content, legacyCleanup.mode);
    delete discovery.brief;
  }
  // Commit discovery first with same-directory atomic replacements. Forced replacement
  // removes/replaces only the path entry itself, so symlink targets and directory contents are safe.
  for (const [key, item] of desired) {
    atomicReplace(item.path, item.content);
    const record = { type: "copy", hash: hashText(item.content) };
    if (key === "skill") discovery.skill = record;
    else references.composition = record;
  }
  const wrote = [];
  if (p.switching) {
    const incoming = new Set(p.items.map((item) => item.path));
    for (const item of p.previousItems) if (!incoming.has(item.path)) rmSync(item.path, { recursive: true, force: true });
  }
  for (const item of p.items) {
    if (pathExists(item.path)) rmSync(item.path, { recursive: true, force: true });
    if (p.mode === "link") symlinkSync(join(ROOT, p.pack.agentsDir, item.persona.file), item.path); else writeFileSync(item.path, item.content);
    wrote.push(item.file);
  }
  const manifest = writeManifest(p, files, discovery, references);
  return { ...p, wrote, enabledTotal: Object.keys(files).length, manifest, skill: d.skill, composition: d.composition };
}

export function disable(opts) {
  const p = plan({ ...opts, mode: "copy", profile: "none" });
  if (!p.manifest) throw new Error(`nothing enabled by Staffed in ${p.dir}`);
  if (p.switching) throw new Error(`pack "${p.previousPack.key}" is active; switch packs with \`staffed pack use ${p.pack.key}\` before disabling its roles`);
  const cwd = opts.cwd ?? process.cwd();
  const mutationPaths = [join(p.dir, MANIFEST), ...p.items.map((item) => item.path)];
  if (opts.skill !== false && p.manifest.discovery?.skill) mutationPaths.push(skillPath(p.host.skillDir(p.scope, cwd)));
  if (opts.skill !== false && p.manifest.references?.composition) mutationPaths.push(compositionReferencePath(p.host.skillDir(p.scope, cwd)));
  const legacyCleanup = p.manifest.discovery?.brief
    ? planLegacyBriefCleanup({ hostKey: p.host.key, scope: p.scope, cwd, home: opts.home, record: p.manifest.discovery.brief, force: opts.force })
    : null;
  if (legacyCleanup) mutationPaths.push(legacyCleanup.path);
  assertSafeProjectMutationPaths(p.scope, cwd, mutationPaths);
  // Validate discovery targets before the first mutation so expected failures are atomic.
  if (opts.skill !== false && p.manifest.discovery?.skill) {
    const installedSkillPath = skillPath(p.host.skillDir(p.scope, cwd));
    assertSafeSkillPath(installedSkillPath);
    if (opts.force) assertSafeDiscoveryTarget(installedSkillPath);
  }
  if (opts.skill !== false && p.manifest.references?.composition) {
    const referencePath = compositionReferencePath(p.host.skillDir(p.scope, cwd));
    assertSafeReferencePath(referencePath);
    if (opts.force) assertSafeDiscoveryTarget(referencePath);
  }
  if (opts.dryRun) return { ...p, removed: [], kept: [], remaining: Object.keys(p.manifest.files).length, dryRun: true };
  const discovery = { ...(p.manifest.discovery ?? {}) };
  if (legacyCleanup) {
    if (legacyCleanup.action === "remove-block") atomicReplace(legacyCleanup.path, legacyCleanup.content, legacyCleanup.mode);
    delete discovery.brief;
  }
  const files = { ...p.manifest.files }, removed = [], kept = [];
  for (const item of p.items) {
    const inspected = inspectFile(item.path, files[item.file]);
    const decision = removeDecision(inspected.state, { force: opts.force });
    if (decision === "remove") { rmSync(item.path, { recursive: true, force: true }); delete files[item.file]; removed.push(item.file); }
    else if (decision === "prune") delete files[item.file];
    else if (decision === "keep") kept.push(item.file);
  }
  const names = healthyNames(p.host, p.dir, files, p.pack);
  const references = { ...(p.manifest.references ?? {}) };
  const d = discoveryStatus(p.host, p.scope, cwd, { ...p.manifest, files, discovery }, names, p.pack);
  if (opts.skill !== false && discovery.skill) {
    const raw = inspectFile(d.skill.path, discovery.skill), decision = removeDecision(raw.state, { force: opts.force });
    if (!names.length) {
      if (decision === "remove") { removeDiscoveryTarget(d.skill.path); removeEmptyDirectory(dirname(d.skill.path)); delete discovery.skill; }
      else if (decision === "prune") delete discovery.skill;
    } else if (raw.state === "enabled" || (opts.force && ["modified", "replaced"].includes(raw.state))) {
      atomicReplace(d.skill.path, d.skill.content);
      discovery.skill = { type: "copy", hash: hashText(d.skill.content) };
    }
  }
  if (opts.skill !== false && references.composition) {
    const raw = inspectFile(d.composition.path, references.composition), decision = removeDecision(raw.state, { force: opts.force });
    if (!names.length) {
      if (decision === "remove") {
        removeDiscoveryTarget(d.composition.path);
        removeEmptyDirectory(dirname(d.composition.path));
        delete references.composition;
      } else if (decision === "prune") delete references.composition;
    } else if (raw.state === "enabled" || (opts.force && ["modified", "replaced"].includes(raw.state))) {
      atomicReplace(d.composition.path, d.composition.content);
      references.composition = { type: "copy", hash: hashText(d.composition.content) };
    }
  }

  if (!names.length) removeEmptyDirectory(dirname(skillPath(p.host.skillDir(p.scope, cwd))));
  if (Object.keys(files).length || Object.keys(discovery).length || Object.keys(references).length) writeManifest(p, files, discovery, references); else rmSync(join(p.dir, MANIFEST), { force: true });
  return { dir: p.dir, removed, kept, remaining: Object.keys(files).length, pack: p.pack, skill: d.skill, composition: d.composition };
}

export function status({ host: hostName, scope = "user", cwd = process.cwd() } = {}) {
  const host = resolveHost(hostName), dir = targetDir(host, scope, cwd);
  const loaded = loadManifest(dir, { hostKey: host.key, scope }, { diagnostic: true });
  const manifest = loaded.manifest;
  let manifestError = loaded.manifestError;
  let pack;
  try { pack = resolvePack(manifest?.pack ?? DEFAULT_PACK); }
  catch (error) { manifestError = error.message; pack = resolvePack(DEFAULT_PACK); }
  const items = pack.personas.map((persona) => { const file = host.filename(persona); return { persona, file, ...inspectFile(join(dir, file), manifest?.files?.[file]), tracked: manifest?.files?.[file] }; });
  const names = items.filter((i) => i.state === "enabled").map((i) => i.persona.name);
  const discovery = discoveryStatus(host, scope, cwd, manifest, names, pack);
  return { host, scope, dir, pack, manifest, manifestError, items, collisions: collisions(host, dir, items), ...discovery };
}
