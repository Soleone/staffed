# Persona composition

Staffed composes a role from an installed staff pack with a small number of optional
behavioral modifiers. Vocabulary is a precision layer, not an entrance requirement:
`staff this project` and plain role names remain complete requests.

## Terms

- A **dimension** is a configurable behavioral axis.
- A **mode** is an available value within a dimension.
- A **modifier** is a mode selected for one dispatch.
- A **composition** is one role plus its selected modifiers.
- A **staff pack** supplies a coherent roster, domain audiences, workflow, and recipes.

Effort, model tier, permissions, safety, scope, and output contracts are controls rather
than modifiers. They always take precedence.

## Grammar

```text
<role> [stance] [drive] [lens] [audience] [voice]
```

Order is irrelevant. A role is required; all other dimensions are optional, with at
most one mode from each. Canonical names and explicit aliases match case-insensitively
as exact tokens. Staffed never guesses arbitrary prefixes.

```text
pm + prag + scep + maint + dir
```

means `pm`, pragmatic drive, sceptical lens, maintainer audience, and direct voice.

## Progressive disclosure

1. Start with `staff this project` and let the orchestrator choose a plain role.
2. Name a role when organizational ownership matters.
3. Add one natural modifier when the desired approach matters.
4. Use aliases and multi-dimensional compositions only for repeatable precision.

The generated skill carries only names, aliases, selection rules, and a few recipes.
It loads its detailed `references/composition.md` only when a modifier is present,
options are requested, or it must select a composition itself.

The orchestrator states a one-line receipt before dispatch and repeats that exact
canonical receipt in its final response so non-interactive callers retain it:

```text
Dispatching pm + sceptic + maintainer + direct: challenge assumptions for maintainers and report plainly.
```

It also puts the canonical composition and each selected mode's `Dispatch behavior`
from the lazy reference into the persona task. The receipt alone does not configure the
persona. Role scope, truth, correctness, safety, effort, model tier, permissions, and
output contracts always take precedence over modifiers.

Every agent-selected modifier must address a named uncertainty or materially change the
result. Unselected dimensions remain invisible.

## Core dimensions

The structured source of truth is [`catalog.json`](../catalog.json). `staffed compose`
renders the current catalog rather than maintaining a duplicate list in documentation.

### Stance

The move to make now: widen (`exploratory`), test (`challenging`), or resolve (`decisive`).

### Drive

The outcome favored under trade-offs: `craftsperson`, `pragmatist`, `steward`, `pioneer`,
or `minimalist`.

### Lens

How claims are examined: `sceptic`, `empiricist`, `first-principles`,
`conventionalist`, `systemic`, or `historical`.

### Audience

Whose understanding, interests, constraints, or response is foregrounded. Core audiences
travel across packs; each pack may add domain audiences without colliding with the active
vocabulary.

### Voice

How the role communicates: `empathetic`, `direct`, `blunt`, `diplomatic`, `socratic`,
`provocative`, or `playful`. Voice changes presentation, never evidence or standards.

## Discovery

```bash
staffed compose
staffed compose recipes
staffed compose lens
staffed compose sceptic
staffed compose pm prag scep maint dir
staffed compose --pack detective investigator expl scep cli dir
```

`staffed compose <dimension>` lists that dimension. A single role or mode explains it.
A complete composition classifies every token and summarizes the behavior in one sentence.
Unknown terms fail with a nearby declared choice when one is available. `list` and
`compose` are stateless catalog discovery and default to product; when another pack is
installed, pass `--pack <name>`. Use `status` to inspect installed state.

## Pack boundaries

Exactly one pack is active per install scope. This keeps short natural compositions,
role routing, artifacts, aliases, and recipes unambiguous. Core vocabulary is universal;
roles and domain audiences come from the selected catalog pack. Pack switching is
explicit and exclusive rather than silently mixing organizations.
