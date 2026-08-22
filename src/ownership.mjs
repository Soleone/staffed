import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";

export const hashText = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);

const lstat = (path) => {
  try { return lstatSync(path); } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
};

export function inspectFile(path, record) {
  const stat = lstat(path);
  if (!stat) return { path, record, state: record ? "missing" : "disabled" };
  if (!record) return { path, record, state: "foreign" };
  if (stat.isSymbolicLink()) {
    if (record.type !== "link") return { path, record, state: "replaced" };
    return { path, record, state: readlinkSync(path) === record.target ? "enabled" : "replaced" };
  }
  if (!stat.isFile() || record.type !== "copy") return { path, record, state: "replaced" };
  return { path, record, state: hashText(readFileSync(path, "utf8")) === record.hash ? "enabled" : "modified" };
}

export function writeDecision(state, { force = false } = {}) {
  return ["foreign", "modified", "replaced"].includes(state) && !force ? "block" : "allow";
}

export function removeDecision(state, { force = false } = {}) {
  if (state === "enabled") return "remove";
  if (state === "missing") return "prune";
  if (["modified", "replaced"].includes(state)) return force ? "remove" : "keep";
  return "noop";
}

const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const HASH = /^[a-f0-9]{16}$/;

function validateRecord(record, allowedTypes, label) {
  if (!object(record) || !allowedTypes.includes(record.type)) throw new Error(`${label} is invalid`);
  if (record.type === "link" && (typeof record.target !== "string" || !record.target)) {
    throw new Error(`${label}.target must be a non-empty string`);
  }
  if (["copy", "block"].includes(record.type) && (typeof record.hash !== "string" || !HASH.test(record.hash))) {
    throw new Error(`${label}.hash must be a 16-character lowercase sha256 prefix`);
  }
}

function fileRecords(value) {
  if (!object(value)) throw new Error("manifest files must be an object");
  for (const [name, record] of Object.entries(value)) validateRecord(record, ["copy", "link"], `manifest files.${name}`);
  return value;
}

function discoveryRecords(value) {
  if (!object(value)) throw new Error("manifest discovery must be an object");
  for (const [name, record] of Object.entries(value)) {
    if (name === "skill") validateRecord(record, ["copy"], "manifest discovery.skill");
    else throw new Error(`manifest discovery.${name} is not supported`);
  }
  return value;
}

function referenceRecords(value) {
  if (!object(value)) throw new Error("manifest references must be an object");
  for (const [name, record] of Object.entries(value)) {
    if (name === "composition") validateRecord(record, ["copy"], "manifest references.composition");
    else throw new Error(`manifest references.${name} is not supported`);
  }
  return value;
}

export function normalizeManifest(raw, { hostKey, scope }) {
  if (!object(raw)) throw new Error("manifest must be an object");
  if (raw.package !== "staffed") throw new Error('manifest package must be "staffed"');
  if (raw.schema != null && raw.schema !== 2) throw new Error(`unsupported manifest schema ${raw.schema}`);
  if (raw.host !== hostKey) throw new Error(`manifest host is ${raw.host ?? "missing"}, expected ${hostKey}`);
  if (raw.scope !== scope) throw new Error(`manifest scope is ${raw.scope ?? "missing"}, expected ${scope}`);
  if (raw.pack != null && (typeof raw.pack !== "string" || !raw.pack)) throw new Error("manifest pack must be a non-empty string");
  const legacy = raw.schema == null;
  const discovery = Object.hasOwn(raw, "discovery") ? discoveryRecords(raw.discovery) : {};
  const references = Object.hasOwn(raw, "references") ? referenceRecords(raw.references) : {};
  return {
    ...raw,
    schema: 2,
    files: fileRecords(raw.files),
    discovery: legacy ? {} : discovery,
    references: legacy ? {} : references,
    pack: raw.pack ?? "product",
    legacy,
    legacyPack: raw.pack == null,
  };
}
