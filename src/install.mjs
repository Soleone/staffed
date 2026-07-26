// Placement. In pi a persona is enabled purely by being present in an agents
// directory — there is no disabled-list to toggle — so enable/disable here are
// file operations, tracked in a manifest so we only ever remove our own work.

import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, loadPersonas } from "./personas.mjs";
import { resolveProfile, tierFor } from "./models.mjs";
import { resolveHost, targetDir } from "./hosts.mjs";

const MANIFEST = ".agent-company.json";
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const pkgVersion = () => JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

const readManifest = (dir) => {
  try {
    return JSON.parse(readFileSync(join(dir, MANIFEST), "utf8"));
  } catch {
    return null;
  }
};

/** Ephemeral sources (npx / pnpm dlx caches) must not be symlinked — links would dangle. */
const isEphemeral = (p) => p.includes("/_npx/") || p.includes("/dlx-") || p.startsWith(tmpdir());

const isLink = (p) => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};
const exists = (p) => {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

/**
 * Classify a target path against what we recorded there.
 * Reads the filesystem rather than trusting the manifest's mode, so a directory
 * holding a mix of linked and copied personas still reports accurately.
 */
function inspect(dir, file, manifest) {
  const path = join(dir, file);
  const tracked = manifest?.files?.[file];
  if (!exists(path)) return { path, state: tracked ? "missing" : "disabled", tracked };
  if (!tracked) return { path, state: "foreign", tracked };

  if (isLink(path)) {
    let dest = null;
    try {
      dest = readlinkSync(path);
    } catch {
      /* unreadable link */
    }
    if (tracked.type !== "link") return { path, state: "replaced", tracked };
    return { path, state: dest === tracked.target ? "enabled" : "replaced", tracked };
  }
  if (tracked.type !== "copy") return { path, state: "replaced", tracked };
  return { path, state: sha(readFileSync(path, "utf8")) === tracked.hash ? "enabled" : "modified", tracked };
}

/** Resolve requested persona names against the roster. */
function select(personas, only) {
  if (!only?.length) return personas;
  const known = new Map(personas.map((p) => [p.name, p]));
  const unknown = only.filter((n) => !known.has(n));
  if (unknown.length) {
    throw new Error(
      `unknown agent(s): ${unknown.join(", ")}\nroster: ${personas.map((p) => p.name).join(" ")}`,
    );
  }
  return only.map((n) => known.get(n));
}

export function plan({ host: hostName, scope = "user", profile = "none", mode = "copy", only, cwd = process.cwd() }) {
  const host = resolveHost(hostName);
  const prof = resolveProfile(profile);
  const dir = targetDir(host, scope, cwd);
  const personas = loadPersonas();
  const manifest = readManifest(dir);

  if (mode === "link" && prof.map) {
    throw new Error("--link cannot be combined with a model profile: a rendered file is not a link to the source.");
  }
  if (mode === "link" && isEphemeral(ROOT)) {
    throw new Error(
      `--link refused: this package lives in an ephemeral directory (${ROOT}).\n` +
        "Links would break as soon as the cache is cleared. Use the default copy mode, or clone the repo and link from there.",
    );
  }

  const items = select(personas, only).map((p) => {
    const file = host.filename(p);
    return {
      persona: p,
      file,
      tier: tierFor(p, prof),
      content: mode === "link" ? null : host.render(p, tierFor(p, prof)),
      ...inspect(dir, file, manifest),
    };
  });

  return { host, scope, profile: prof, mode, dir, items, manifest, personas };
}

export function enable(opts) {
  const p = plan(opts);
  const { force = false, dryRun = false } = opts;

  const blocked = p.items.filter(
    (i) => i.state === "foreign" || ["modified", "replaced"].includes(i.state),
  );
  if (blocked.length && !force) {
    const why = (i) =>
      i.state === "foreign" ? "already exists and was not installed by us" : "was modified after we installed it";
    throw new Error(
      `refusing to overwrite ${blocked.length} file(s) in ${p.dir}:\n` +
        blocked.map((i) => `  ${i.file} — ${why(i)}`).join("\n") +
        "\nRe-run with --force to overwrite, or remove them first.",
    );
  }

  if (dryRun) return { ...p, wrote: [], dryRun: true };

  mkdirSync(p.dir, { recursive: true });
  // Merge, never replace: enabling one persona must not forget the others.
  const files = { ...(p.manifest?.files ?? {}) };
  const wrote = [];
  for (const item of p.items) {
    if (exists(item.path)) rmSync(item.path, { force: true });
    if (p.mode === "link") {
      const target = join(ROOT, "agents", item.persona.file);
      symlinkSync(target, item.path);
      files[item.file] = { type: "link", target };
    } else {
      writeFileSync(item.path, item.content);
      files[item.file] = { type: "copy", hash: sha(item.content), profile: p.profile.key };
    }
    wrote.push(item.file);
  }
  writeManifest(p, files);
  return { ...p, wrote, enabledTotal: Object.keys(files).length };
}

export function disable(opts) {
  const p = plan({ ...opts, mode: "copy", profile: "none" });
  const { force = false } = opts;
  if (!p.manifest) throw new Error(`nothing enabled by agent-company in ${p.dir}`);

  const files = { ...(p.manifest.files ?? {}) };
  const removed = [];
  const kept = [];
  for (const item of p.items) {
    const i = inspect(p.dir, item.file, p.manifest);
    if (i.state === "disabled") continue;
    if (i.state === "missing") {
      delete files[item.file];
      continue;
    }
    if (["modified", "replaced"].includes(i.state) && !force) {
      kept.push(item.file);
      continue;
    }
    rmSync(i.path, { force: true });
    delete files[item.file];
    removed.push(item.file);
  }

  if (Object.keys(files).length) writeManifest(p, files);
  else rmSync(join(p.dir, MANIFEST), { force: true });
  return { dir: p.dir, removed, kept, remaining: Object.keys(files).length };
}

function writeManifest(p, files) {
  writeFileSync(
    join(p.dir, MANIFEST),
    `${JSON.stringify(
      {
        package: "agent-company",
        version: pkgVersion(),
        host: p.host.key,
        scope: p.scope,
        source: ROOT,
        updatedAt: new Date().toISOString(),
        files,
      },
      null,
      2,
    )}\n`,
  );
}

export function status({ host: hostName, scope = "user", cwd = process.cwd() } = {}) {
  const host = resolveHost(hostName);
  const dir = targetDir(host, scope, cwd);
  const manifest = readManifest(dir);
  const items = loadPersonas().map((p) => {
    const file = host.filename(p);
    return { persona: p, file, ...inspect(dir, file, manifest) };
  });
  return { host, scope, dir, manifest, items };
}
