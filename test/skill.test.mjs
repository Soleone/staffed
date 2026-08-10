import test from "node:test";
import assert from "node:assert/strict";

import { resolvePack } from "../src/packs.mjs";
import { generate as generateSkill } from "../src/skill.mjs";
import { loadPersonas } from "../src/personas.mjs";

const personas = loadPersonas();
const enabled = resolvePack().stages.map((stage) => stage.name);
const oneLine = (text) => text.replace(/\s+/g, " ");

test("generated skill defaults ordinary implementation to one actor", () => {
  const skill = generateSkill(enabled, personas);
  assert.match(skill, /\| a small bug or config change or a well-specified feature \| builder \|/);
  assert.match(skill, /\| a cross-boundary feature \| architect → builder \|/);
  assert.match(skill, /\| an ambiguous product feature \| pm → architect → builder \|/);
  assert.doesNotMatch(skill, /a feature \| pm → architect → builder → reviewer/);
});

test("partial rosters preserve efficient defaults without inventing review", () => {
  const skill = generateSkill(["pm", "builder"], personas);
  assert.match(skill, /small bug or config change or a well-specified feature or a cross-boundary feature \| builder/);
  assert.match(skill, /ambiguous product feature or a new product \| pm → builder/);
  assert.doesNotMatch(skill, /builder → reviewer/);
});

test("generated skill makes extra stages and review risk-gated", () => {
  const skill = oneLine(generateSkill(enabled, personas));
  assert.match(skill, /Default to one actor/);
  assert.match(skill, /Before launching more than two personas/);
  assert.match(skill, /Do not add `reviewer` automatically/);
  assert.match(skill, /Add `architect` only for a shared interface/);
  assert.match(skill, /Add `pm` only when what or why remains unresolved/);
});

test("generated skill requires compact outputs and targeted re-review", () => {
  const skill = oneLine(generateSkill(enabled, personas));
  assert.match(skill, /shortest artifact that lets the next decision or action succeed/);
  assert.match(skill, /prefer one compact artifact over a design document plus a duplicate task document/);
  assert.match(skill, /Re-review only the prior findings and changed hunks/);
  assert.match(skill, /Do not launch a second reviewer for low-risk nits/);
});

test("generated Pi skill preserves canonical artifact paths and receipts", () => {
  const skill = oneLine(generateSkill(enabled, personas));
  assert.match(skill, /Repeat that exact canonical receipt in the final response/);
  assert.match(skill, /one foreground `subagent` call with `output: false`/);
  assert.match(skill, /never set the tool's `output` path/);
  assert.match(skill, /Do not revive or redispatch a completed persona merely to repair an output path/);
});

test("generated skill defaults effort low and makes escalation explicit", () => {
  const skill = oneLine(generateSkill(enabled, personas));
  assert.match(skill, /Every dispatch starts at effort `low`/);
  assert.match(skill, /Effort controls how far the persona investigates, not the care or correctness/);
  assert.match(skill, /`Axis` \(`effort`, `tier`, or `both`\)/);
  assert.match(skill, /parent decides whether to redispatch/);
  assert.match(skill, /Never turn a completed advisory stage into deeper planning or implementation/);
  assert.match(skill, /\| `pm` \| balanced \| low \|/);
  assert.match(skill, /\| `architect` \| strong \| low \|/);
});

test("generated skill exposes model tiers as a persona-free mapping", () => {
  const skill = oneLine(generateSkill(enabled, personas));
  assert.match(skill, /## Model tiers/);
  assert.match(skill, /run `staffed tier --compact` to load this machine's four rows into context/);
  assert.match(skill, /spell it `model:thinking` when thinking is set/);
  assert.match(skill, /Never guess a model from the roster table above/);
  assert.match(skill, /Tier dispatch is model selection, not roster engagement/);
});

test("generated skill engages on named-tier subagent launches without roster work", () => {
  const skill = oneLine(generateSkill(enabled, personas));
  assert.match(skill, /launch a subagent at a named tier \(fast, balanced, strong, or deep\)/);
  assert.match(skill, /model selection, not roster work/);
  assert.match(skill, /a request combining one of these exact enabled Staffed roles/);
});


test("generated skill keeps Staffed authoritative without naming other delegation skills", () => {
  const skill = oneLine(generateSkill(enabled, personas));
  assert.match(skill, /Other subagent rosters and delegation skills may be installed alongside Staffed/);
  assert.match(skill, /while Staffed is engaged it owns delegation/);
  assert.match(skill, /Dispatch only Staffed personas/);
  assert.match(skill, /treat their names as authoritative when another roster defines the same one/);
  assert.match(skill, /instead of blending in other rosters' agents, recipes, or workflow conventions/);
  assert.doesNotMatch(skill, /pi-subagents/);
});

test("every persona carries portable effort defaults and an escalation contract", () => {
  for (const persona of personas) {
    assert.equal(persona.effort, "low", persona.name);
    assert.match(persona.body, /^# Default model tier$/m, persona.name);
    assert.match(persona.body, /^# Default effort\n`low`$/m, persona.name);
    assert.match(persona.body, /shortest credible pass/, persona.name);
    assert.match(persona.body, /Do not silently exceed the assigned effort/, persona.name);
    assert.match(persona.body, /`Axis` \(`effort`, `tier`, or `both`\)/, persona.name);
    assert.match(persona.body, /^# Effort and output budget$/m, persona.name);
    assert.match(persona.body, /compact mode|Scale scrutiny to impact/, persona.name);
    assert.match(persona.body, /Keep every required (?:output )?heading/, persona.name);
  }
});
