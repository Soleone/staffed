import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ROOT, loadPersonas } from "./personas.mjs";
import { resolveProfile, tierFor } from "./models.mjs";
import { resolveHost, targetDir } from "./hosts.mjs";
import { deleteBriefBlock, findBriefBlock, generateBrief, upsertBriefBlock } from "./brief.mjs";
import { generateSkill, skillPath } from "./skill.mjs";
import { hashText, inspectFile, normalizeManifest, removeDecision, writeDecision } from "./ownership.mjs";

const MANIFEST = ".staffed.json";
const pkgVersion = () => JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const isEphemeral = (p) => p.includes("/_npx/") || p.includes("/dlx-") || p.startsWith(tmpdir());
const pathExists = (path) => { try { lstatSync(path); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; } };

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

function atomicReplace(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
  try {
    writeFileSync(temp, content, { flag: "wx" });
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

export function plan({ host: hostName, scope = "user", profile = "none", mode = "copy", only, cwd = process.cwd() }) {
  const host = resolveHost(hostName);
  const prof = resolveProfile(profile);
  validateProfile(host, prof);
  const dir = targetDir(host, scope, cwd);
  const personas = loadPersonas();
  const { manifest, manifestError } = loadManifest(dir, { hostKey: host.key, scope });
  if (mode === "link" && prof.map) throw new Error("--link cannot be combined with a model profile: a rendered file is not a link to the source.");
  if (mode === "link" && host.key === "claude") throw new Error("--link is unavailable for Claude Code because its explicit-only description must be rendered.");
  if (mode === "link" && isEphemeral(ROOT)) throw new Error(`--link refused: this package lives in an ephemeral directory (${ROOT}).\nLinks would break as soon as the cache is cleared. Use the default copy mode, or clone the repo and link from there.`);
  const items = select(personas, only).map((persona) => {
    const file = host.filename(persona), path = join(dir, file), tier = tierFor(persona, prof);
    return { persona, file, path, tier, content: mode === "link" ? null : host.render(persona, tier), ...inspectFile(path, manifest?.files[file]) };
  });
  return { host, scope, profile: prof, mode, dir, items, manifest, manifestError, personas, collisions: collisions(host, dir, items) };
}

function recordFor(p, item) {
  if (p.mode === "link") return { type: "link", target: join(ROOT, "agents", item.persona.file) };
  return { type: "copy", hash: hashText(item.content), profile: p.profile.key, tier: item.persona.tier,
    ...(item.tier ? { model: item.tier.model } : {}), ...(item.tier?.thinking != null ? { thinking: item.tier.thinking } : {}) };
}

function writeManifest(p, files, discovery) {
  const value = { schema: 2, package: "staffed", version: pkgVersion(), host: p.host.key, scope: p.scope, source: ROOT,
    updatedAt: new Date().toISOString(), files, ...(Object.keys(discovery).length ? { discovery } : {}) };
  writeFileSync(join(p.dir, MANIFEST), `${JSON.stringify(value, null, 2)}\n`);
  return value;
}

function healthyNames(host, dir, files) {
  return loadPersonas().filter((persona) => inspectFile(join(dir, host.filename(persona)), files[host.filename(persona)]).state === "enabled").map((p) => p.name);
}

function briefInspection(file, record, desired) {
  if (!pathExists(file)) return { file, record, state: record ? "missing" : "absent" };
  const stat = lstatSync(file);
  if (!stat.isFile()) return { file, record, state: "replaced" };
  const text = readFileSync(file, "utf8");
  let found;
  try { found = findBriefBlock(text); }
  catch (error) { return { file, record, state: "invalid", error: error.message }; }
  if (!found) return { file, record, state: record ? "missing" : "absent" };
  if (!record) return { file, record, state: "foreign" };
  if (hashText(found.text) !== record.hash) return { file, record, state: "modified" };
  return { file, record, state: found.text === desired ? "current" : "stale" };
}

function discoveryStatus(host, scope, cwd, manifest, names) {
  const skillFile = skillPath(host.skillDir(scope, cwd));
  const skillText = generateSkill({ hostKey: host.key, enabled: names, personas: loadPersonas() });
  const si = inspectFile(skillFile, manifest?.discovery?.skill);
  const skill = { ...si, state: si.state === "enabled" ? (readFileSync(skillFile, "utf8") === skillText ? "current" : "stale") : si.state };
  const briefFile = host.briefFile(scope, cwd), briefText = generateBrief({ hostKey: host.key, enabled: names });
  return { skill: { ...skill, content: skillText }, brief: { ...briefInspection(briefFile, manifest?.discovery?.brief, briefText), content: briefText } };
}

export function enable(opts) {
  const p = plan(opts); const { force = false, dryRun = false } = opts;
  if (p.collisions.length) throw new Error(`Claude agent name collision(s):\n${p.collisions.map((c) => `  ${c.name}: ${c.path}`).join("\n")}`);
  const blocked = p.items.filter((i) => writeDecision(i.state, { force }) === "block");
  const files = { ...(p.manifest?.files ?? {}) };
  const selected = new Set(p.items.map((item) => item.persona.name));
  for (const item of p.items) files[item.file] = recordFor(p, item);
  const names = loadPersonas()
    .filter((persona) => selected.has(persona.name) || inspectFile(join(p.dir, p.host.filename(persona)), p.manifest?.files?.[p.host.filename(persona)]).state === "enabled")
    .map((persona) => persona.name);
  const d = discoveryStatus(p.host, p.scope, opts.cwd ?? process.cwd(), p.manifest, names);
  const desired = [];
  if (opts.skill !== false) desired.push(["skill", d.skill]);
  if (opts.brief === true) desired.push(["brief", d.brief]);
  for (const [, item] of desired) {
    if (item.state === "invalid") throw new Error(`invalid Staffed brief in ${item.file}: ${item.error}`);
    if (["foreign", "modified", "replaced"].includes(item.state) && !force) blocked.push(item);
  }
  if (blocked.length) throw new Error(`refusing to overwrite ${blocked.length} unowned or modified item(s):\n${blocked.map((i) => `  ${i.file ?? i.path}`).join("\n")}\nRe-run with --force to overwrite.`);
  for (const [, item] of desired) assertSafeDiscoveryTarget(item.path ?? item.file);
  if (dryRun) return { ...p, wrote: [], dryRun: true };
  mkdirSync(p.dir, { recursive: true });
  const discovery = { ...(p.manifest?.discovery ?? {}) };
  // Commit discovery first with same-directory atomic replacements. Forced replacement
  // removes/replaces only the path entry itself, so symlink targets and directory contents are safe.
  for (const [key, item] of desired) {
    if (key === "skill") {
      atomicReplace(item.path, item.content);
      discovery.skill = { type: "copy", hash: hashText(item.content) };
    } else {
      const old = ["foreign", "modified", "current", "stale"].includes(item.state) ? readFileSync(item.file, "utf8") : "";
      atomicReplace(item.file, upsertBriefBlock(old, item.content));
      discovery.brief = { type: "block", hash: hashText(item.content) };
    }
  }
  const wrote = [];
  for (const item of p.items) {
    if (pathExists(item.path)) rmSync(item.path, { recursive: true, force: true });
    if (p.mode === "link") symlinkSync(join(ROOT, "agents", item.persona.file), item.path); else writeFileSync(item.path, item.content);
    wrote.push(item.file);
  }
  const manifest = writeManifest(p, files, discovery);
  return { ...p, wrote, enabledTotal: Object.keys(files).length, manifest, skill: d.skill, brief: d.brief };
}

export function disable(opts) {
  const p = plan({ ...opts, mode: "copy", profile: "none" });
  if (!p.manifest) throw new Error(`nothing enabled by Staffed in ${p.dir}`);
  // Validate discovery targets before the first mutation so expected failures are atomic.
  if (opts.force && opts.skill !== false && p.manifest.discovery?.skill) {
    assertSafeDiscoveryTarget(skillPath(p.host.skillDir(p.scope, opts.cwd ?? process.cwd())));
  }
  if (opts.brief !== false && p.manifest.discovery?.brief) {
    const file = p.host.briefFile(p.scope, opts.cwd ?? process.cwd());
    if (opts.force) assertSafeDiscoveryTarget(file);
    if (pathExists(file) && lstatSync(file).isFile()) findBriefBlock(readFileSync(file, "utf8"));
  }
  const files = { ...p.manifest.files }, removed = [], kept = [];
  for (const item of p.items) {
    const inspected = inspectFile(item.path, files[item.file]);
    const decision = removeDecision(inspected.state, { force: opts.force });
    if (decision === "remove") { rmSync(item.path, { recursive: true, force: true }); delete files[item.file]; removed.push(item.file); }
    else if (decision === "prune") delete files[item.file];
    else if (decision === "keep") kept.push(item.file);
  }
  const names = healthyNames(p.host, p.dir, files);
  const discovery = { ...(p.manifest.discovery ?? {}) };
  const d = discoveryStatus(p.host, p.scope, opts.cwd ?? process.cwd(), { ...p.manifest, files, discovery }, names);
  if (opts.skill !== false && discovery.skill) {
    const raw = inspectFile(d.skill.path, discovery.skill), decision = removeDecision(raw.state, { force: opts.force });
    if (!names.length) {
      if (decision === "remove") { removeDiscoveryTarget(d.skill.path); try { rmdirSync(dirname(d.skill.path)); } catch {} delete discovery.skill; }
      else if (decision === "prune") delete discovery.skill;
    } else if (raw.state === "enabled" || (opts.force && ["modified", "replaced"].includes(raw.state))) {
      atomicReplace(d.skill.path, d.skill.content);
      discovery.skill = { type: "copy", hash: hashText(d.skill.content) };
    }
  }
  if (opts.brief !== false && discovery.brief) {
    const b = briefInspection(d.brief.file, discovery.brief, d.brief.content);
    if (!names.length) {
      if (b.state === "current" || b.state === "stale" || (opts.force && b.state === "modified")) {
        atomicReplace(b.file, deleteBriefBlock(readFileSync(b.file, "utf8"))); delete discovery.brief;
      } else if (opts.force && b.state === "replaced") {
        removeDiscoveryTarget(b.file); delete discovery.brief;
      } else if (b.state === "missing") delete discovery.brief;
    } else if (["current", "stale"].includes(b.state) || (opts.force && ["modified", "replaced"].includes(b.state))) {
      const text = b.state === "replaced" ? "" : readFileSync(b.file, "utf8");
      atomicReplace(b.file, upsertBriefBlock(text, d.brief.content)); discovery.brief = { type: "block", hash: hashText(d.brief.content) };
    }
  }
  if (Object.keys(files).length || Object.keys(discovery).length) writeManifest(p, files, discovery); else rmSync(join(p.dir, MANIFEST), { force: true });
  return { dir: p.dir, removed, kept, remaining: Object.keys(files).length, skill: d.skill, brief: d.brief };
}

export function setBrief({ action, host: hostName, scope = "user", cwd = process.cwd(), force = false }) {
  const s = status({ host: hostName, scope, cwd });
  if (!s.manifest) throw new Error(`nothing enabled by Staffed in ${s.dir}`);
  const p = { ...s, profile: { key: "none" } }, discovery = { ...(s.manifest.discovery ?? {}) };
  const b = s.brief;
  if (force && b.state === "replaced") assertSafeDiscoveryTarget(b.file);
  if (action === "write") {
    if (b.state === "invalid") throw new Error(`invalid Staffed brief in ${b.file}: ${b.error}`);
    if (["foreign", "modified", "replaced"].includes(b.state) && !force) throw new Error(`refusing to overwrite unowned, modified, or replaced brief in ${b.file}`);
    const text = ["foreign", "modified", "current", "stale"].includes(b.state) ? readFileSync(b.file, "utf8") : "";
    atomicReplace(b.file, upsertBriefBlock(text, b.content)); discovery.brief = { type: "block", hash: hashText(b.content) };
  } else {
    if (!discovery.brief) return { action: "absent", file: b.file };
    if (b.state === "invalid") throw new Error(`invalid Staffed brief in ${b.file}: ${b.error}`);
    if (b.state === "modified" && !force) return { action: "kept", file: b.file };
    if (["current", "stale", "modified"].includes(b.state)) atomicReplace(b.file, deleteBriefBlock(readFileSync(b.file, "utf8")));
    else if (force && b.state === "replaced") removeDiscoveryTarget(b.file);
    delete discovery.brief;
  }
  writeManifest(p, s.manifest.files, discovery);
  return { action: action === "write" ? "written" : "removed", file: b.file };
}

export function status({ host: hostName, scope = "user", cwd = process.cwd() } = {}) {
  const host = resolveHost(hostName), dir = targetDir(host, scope, cwd);
  const { manifest, manifestError } = loadManifest(dir, { hostKey: host.key, scope }, { diagnostic: true });
  const items = loadPersonas().map((persona) => { const file = host.filename(persona); return { persona, file, ...inspectFile(join(dir, file), manifest?.files[file]), tracked: manifest?.files[file] }; });
  const names = items.filter((i) => i.state === "enabled").map((i) => i.persona.name);
  const discovery = discoveryStatus(host, scope, cwd, manifest, names);
  return { host, scope, dir, manifest, manifestError, items, collisions: collisions(host, dir, items), ...discovery };
}
