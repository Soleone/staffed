import test from "node:test";
import assert from "node:assert/strict";

import { STAGES, generate as generateBrief } from "../src/brief.mjs";
import { generate as generateSkill } from "../src/skill.mjs";
import { loadPersonas } from "../src/personas.mjs";

const personas = loadPersonas();
const enabled = STAGES.map((stage) => stage.name);
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

test("generated brief preserves efficiency guidance when installed globally", () => {
  const brief = generateBrief(enabled);
  assert.match(brief, /default to one persona/);
  assert.match(brief, /pipeline above is an ordering reference, not a prescription/);
  assert.match(brief, /Before more than two dispatches/);
  assert.match(brief, /re-review only prior findings and changed hunks/);
});

test("every persona carries an explicit compact effort budget", () => {
  for (const persona of personas) {
    assert.match(persona.body, /^# Effort and output budget$/m, persona.name);
    assert.match(persona.body, /compact mode|Scale scrutiny to impact/, persona.name);
    assert.match(persona.body, /Keep every required (?:output )?heading/, persona.name);
  }
});
