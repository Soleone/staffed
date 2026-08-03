# Staffed

Staff any project with coordinated subagent roles. Staffed ships a stable product staff
covering research through measurement and an experimental detective-agency preview for
investigation, interviewing, forensic analysis, and independent case review.

It aims to be the simplest, lightest way to run a real product pipeline through agents:
**there is no runtime.** No orchestration engine, no graph to define, no framework to
adopt, no server, no dependencies, no build step, and nothing written into files you own.
The active staff pack's Markdown personas land in a directory your agent already reads,
a generated skill tells it they are there and when to reach for them, and the agent
session you already have does the orchestrating. One command sets it up, one command removes it.

That leaves the personas and their compact composition catalog as the product, and that
is the point: what makes this work is what the personas *say*, not machinery wrapped
around them. Your session decomposes a goal, dispatches personas, and validates what each
returns. Three properties keep a long pipeline from collapsing back into one agent doing
everything:

- **Descriptions route.** Every persona states what it owns *and what it must refuse*,
  so adjacent roles don't get confused for each other. `pm` won't design screens, `ux`
  won't write the strings, `writer` won't write marketing copy.
- **Artifacts live on disk.** Each persona writes to `artifacts/<agent>/index.md` and
  returns the path, not the document. The orchestrator's context stays flat whether the
  pipeline has three stages or eleven, and any stage can be re-run against the same
  inputs.
- **Output is contract-shaped.** Every persona ends in a fixed structure, so results
  can be parsed, checked, and chained instead of read and paraphrased.

## Install

```bash
pnpm dlx staffed enable                   # product pack; inherit the parent model
pnpm dlx staffed enable --pack detective # switch to the experimental detective preview
pnpm dlx staffed enable --profile openai  # cost/time-oriented OpenAI defaults
pnpm dlx staffed status                   # exact stamped model, or inherited/legacy
# npx staffed ... works too
```

That does two things, both required:

1. renders the active pack's personas into `~/.pi/agent/agents/`
2. installs a **`staffed` skill** and lazy composition reference into `~/.pi/agent/skills/`

The second one is not a nicety. `subagent` surfaces the roster only inside its error
messages — nothing injects it into the system prompt, and the tool description does not
enumerate agents — so **on their own, these personas are undiscoverable.** The skill is
what points at them, and it carries what no single persona can state: how to size a
pipeline, the artifact convention, and the escalation loop.

Nothing of yours is modified. Confirm both halves with `pnpm dlx staffed status`.

There is no API to learn, so using it is a sentence:

```
Build a link shortener with custom domains — staff this project.
```

That phrase (or "use Staffed", or `/skill:staffed`) engages the org. The session
dispatches from there, and you read `artifacts/` instead of a wall of chat.

```bash
pnpm dlx staffed enable pm architect     # only these, additive
pnpm dlx staffed enable --scope project  # into ./.pi/agents/, committable
pnpm dlx staffed disable reviewer        # drop one
pnpm dlx staffed status                  # what is enabled, and whether it drifted
```

Installs are tracked in a manifest next to the personas, so `disable` removes only
files it created and leaves anything you edited in place. Enabling over a file it does
not own — pi's own bundled `reviewer`, for instance — fails loudly instead of
overwriting it. `--force` when that is what you actually want.

## Commands

| | |
|---|---|
| `enable [name...]` | enable all, or just the named ones (additive) |
| `disable [name...]` | disable all, or just the named ones |
| `status` | what is enabled, per-persona, plus drift and brief health |
| `skill` | print the generated skill |
| `brief` | print the optional AGENTS.md block; `--write` / `--remove` to apply it |
| `list [--pack name]` | a pack's roster with each persona's default model tier and effort |
| `compose [terms...]` | browse modes/recipes or validate and explain a composition |
| `pack list` | available staff packs |
| `pack use <name>` | exclusively switch the active pack for this scope |
| `tier [name]` | show tier → model + thinking, or declare one |
| `doctor` | check configured model ids against this pi install |
| `validate` | structural checks on the roster |

Options: `--agent pi|claude|opencode` `--scope user|project` `--pack` `--profile` `--model`
`--thinking` `--link` `--force` `--dry-run` `--brief` `--no-skill`.

Agent selection is automatic when `--agent` is omitted. Staffed checks only the canonical
home configuration directories: `~/.pi/agent` and `~/.claude`. If exactly one exists,
it selects that agent. If both exist, pass `--agent pi` or `--agent claude`; Staffed
will not guess. If neither exists, agent-dependent commands visibly warn and fall back
to Pi, preserving fresh-install behavior. `help`, `list`, `compose`, `pack list`,
`tier`/`models`, and `validate` do not inspect the home directory. Consequently, `list`
and `compose` are stateless catalog discovery: they show the product catalog unless
`--pack` is passed. Use `status` to inspect the pack actually installed in a scope.

`--agent` chooses rendering and filesystem destinations. `--profile` independently
chooses model frontmatter; neither option infers the other. For example,
`--agent pi --profile claude` writes Pi files stamped with Claude-family aliases,
while `--agent claude` alone uses profile `none` and does not pin a model. Claude Code
and opencode remain behind their current support gates.

`enable` and `disable` keep the skill in sync automatically. `--brief` additionally
writes an `AGENTS.md` block; `--no-skill` installs nothing but the personas.

**Presence is enablement.** pi has no disabled-list for agents — `pi config` toggles
extensions, skills, prompts and themes, not these — so `enable` and `disable` are file
operations on the two directories `subagent` reads: `~/.pi/agent/agents/` (scope
`user`) and the nearest `.pi/agents/` (scope `project`, which needs `agentScope:
"both"` at the call site). There is no second toggle to keep in sync.

This is also why the package ships a CLI rather than a `pi` manifest: **`pi install`
cannot deliver personas.** A pi package contributes extensions, skills, prompts and
themes; there is no `agents` key. Placing files in one of those two directories is the
entire mechanism.

## Persona composition

A **composition** is one role plus optional behavioral **modifiers**. A modifier is a
selected **mode** from a configurable **dimension**. Staffed provides five optional
dimensions: stance, drive, lens, audience, and voice. Effort, model tier, permissions,
safety, and output contracts are controls, not modifiers, and always take precedence.

You do not need to learn this vocabulary before using Staffed. Plain roles remain the
default:

```text
Staff this project.
Have the PM look at this.
```

Add only the terms that materially change the result:

```text
Have a sceptic maintainer direct PM look at this.
pnpm dlx staffed compose pm prag scep maint dir
```

The latter resolves to a pragmatic PM using a sceptical lens, foregrounding maintainers,
and speaking directly. Canonical names and declared short aliases are matched exactly
(case-insensitively); arbitrary prefixes are not accepted. One mode maximum is allowed
per dimension.

```bash
pnpm dlx staffed compose                 # compact vocabulary and an example
pnpm dlx staffed compose recipes         # outcome-oriented recipes
pnpm dlx staffed compose lens            # browse one dimension
pnpm dlx staffed compose sceptic         # explain one mode and its failure mode
pnpm dlx staffed compose pm prag scep    # validate and explain a composition
```

The generated `SKILL.md` contains only names, aliases, sparse-selection rules, and a few
recipes. Detailed definitions live in `references/composition.md` and are loaded only
when a modifier is used, options are requested, or the orchestrator must choose a
composition. A composed dispatch carries the canonical composition and each selected
mode's concise behavior into the persona task; the receipt alone is not the behavior.
The orchestrator repeats the canonical receipt in its final response so non-interactive
callers retain it. See [Composition](docs/composition.md) for the complete model.

## Staff packs

Many packs may be available, but exactly one is active in an install scope. Product is
the built-in default and existing commands retain their product behavior. Switching is
explicit and exclusive: Staffed preflights local drift and foreign targets before
removing the old owned roster and installing the new one.

```bash
pnpm dlx staffed pack list
pnpm dlx staffed pack use detective --scope project
pnpm dlx staffed status
```

Core stance, drive, lens, audience, and voice modes apply across organizations. A pack
adds its roles, domain audiences, workflow, and recipes. The detective pack is an
experimental preview; see [Detective preview](docs/detective-pack.md).

## The product roster

| Persona | Owns | Artifact | Returns |
|---|---|---|---|
| `researcher` | evidence, prior art, feasibility | `artifacts/researcher/` | findings + confidence + unknowns |
| `pm` | why / what, scope, metrics | `artifacts/pm/` | PRD: problem, users, scope, non-goals, metrics |
| `ux` | flows, IA, screen states, interaction | `artifacts/ux/` | flows + IA + states + acceptance criteria |
| `writer` | in-product words, user docs | `artifacts/writer/` | voice + terminology + UI strings + error copy |
| `artist` | visual + audio identity and assets | `artifacts/artist/` `assets/` | creative direction + asset manifest (real files) |
| `architect` | system design, task decomposition | `artifacts/architect/` `tasks/` | design + interfaces + task breakdown |
| `builder` | implement one task, escalate cross-boundary | the code | diff + changes + tests + escalations |
| `reviewer` | correctness, security, taste — reports, never fixes | none | verdict + findings (severity, file:line, fix) |
| `ops` | CI, deploy, rollout and rollback | `artifacts/ops/` | release plan + checks + rollback + observability |
| `marketer` | positioning, launch | `artifacts/marketer/` | positioning + {headline, body, CTA} + checklist |
| `analyst` | product metrics, experiments, readout | `artifacts/analyst/` | metric definitions + analysis + recommendation |

Each persona declares a default model tier and a host-agnostic effort level in its
own file; `staffed list` shows both and `staffed tier` prints the model mapping. See
[Model tiers](#model-tiers) and [Effort](#effort).

## Suggested pipeline

This is the full ordering reference, not the default chain. Staffed defaults to one
persona and adds a stage only when it resolves a named uncertainty or material risk.
A fresh dispatch costs time, tokens, and context even when its output is correct.

```
1.  researcher   evidence, prior art, feasibility   (skip when already certain)
2.  pm           PRD: problem, scope, metrics
3.  ux           flows, IA, states                  ┐ parallel, both read
    artist       visual + audio identity            ┘ only the PRD
4.  writer       the words                          (needs the ux states)
5.  architect    system design + task breakdown
6.  builder × N  implement tasks                    (parallel → worktree: true)
7.  reviewer     verdict; request-changes loops back to 6
8.  ops          rollout + rollback
9.  marketer     positioning + launch
10. analyst      readout → feeds the next cycle at 2
```

Stages are skippable and the loop matters more than the order: a material
`request-changes` verdict returns to `builder`, an escalation returns to `architect`,
and the analyst's readout starts the next cycle at `pm`. Re-review only prior findings
and changed hunks unless the fix changes a foundational contract.

The parent session orchestrates. There is deliberately **no `orchestrator` persona** —
delegating the delegation adds a lossy layer between the plan and the work, and the
parent already holds the plan. (`pm` owns product definition, not dispatch.)

## Artifact convention

Each persona owns exactly one directory, `artifacts/<agent>/`, and writes its contract
to `index.md` inside it. It returns a short summary plus that path: the file is the
artifact, the message is the pointer.

```
artifacts/
  researcher/index.md      architect/index.md
  pm/index.md              architect/tasks/NN-slug.md
  ux/index.md              ops/index.md
  writer/index.md          marketer/index.md
  artist/index.md          analyst/index.md
  artist/assets/…
```

Two properties earn the nesting:

- **Paths are derivable.** Any persona finds any other's output from the agent name
  alone — no filename to memorize. `index.md` is always the primary contract.
- **Directories absorb growth.** A persona that outgrows one file adds siblings in its
  own namespace (`architect/tasks/`, `artist/assets/`, a researcher's raw data) with no
  convention change and no chance of collision. Ownership is enforced by the
  filesystem: write only under your own directory, read anyone's.

Two intentional exceptions: `builder`'s artifact is the code, and `reviewer` writes
nothing at all so its verdict can be routed immediately. Neither gets a directory. For
a canonical Pi artifact, the orchestrator makes one foreground `subagent` call with
`output: false`; setting the tool's `output` path makes that alternate path authoritative
and relocates the result. Use `output` only when a caller intentionally wants a different
root.

## Model tiers

Two different clocks, so two different files. **Default tier is the capability a
persona normally needs**; an unusually consequential assignment can request a higher
one. **Model identity is a property of the host** and changes every few months. Pinning
model strings into eleven personas couples them and buys you eleven files to edit on
every release; keeping them apart makes a refresh one edit at any roster size.

Each persona declares its default tier as a Markdown-body token, preserving the common
subagent file format while giving both scripts and humans something to reason about:

```markdown
# Default model tier
`balanced` — request `strong` or `deep` when the decision hinges on synthesis.
```

`models.json` maps tiers to concrete models, per model profile:

```bash
pnpm dlx staffed tier                           # show the mapping
pnpm dlx staffed doctor                         # verify ids visible to this Pi install
pnpm dlx staffed enable                         # inherit the parent session model
pnpm dlx staffed enable --profile openai        # apply OpenAI defaults while rendering
pnpm dlx staffed status                         # exact stamped model, or inherited/legacy

# From a clone or persistent install (not pnpm dlx's throwaway cache):
staffed tier strong --model MODEL --thinking LEVEL
```

A tier resolves to a **model and a thinking level**, stored separately because hosts
spell the level differently: pi appends it (`claude-opus-5:xhigh`) as its agent
frontmatter has no reasoning field, while Claude Code has no per-agent equivalent and
drops it. Composing that per host is the renderer's job, which keeps `models.json`
declarative.

Pinning happens at **render time, never in the source.** `--profile` stamps the model
into the enabled copy and leaves `agents/` untouched, so the repo stays portable and
there is no unpin step to forget — `validate` rejects a `model:` appearing in source at
all. Without `--profile`, personas inherit the parent session's model.

Four tiers exist (`fast`, `balanced`, `strong`, `deep`). The current defaults are:

- `fast`: no personas
- `balanced`: `researcher`, `pm`, `writer`, `marketer`, `analyst`
- `strong`: `architect`, `builder`, `reviewer`, `ops`
- `deep`: `ux`, `artist`

The opt-in `openai` profile is an allocation strategy oriented toward total cost/time
per accepted outcome; it is not a benchmark or a guarantee:

| Tier | Model | Thinking |
|---|---|---|
| `fast` | `openai-codex/gpt-5.6-terra` | `low` |
| `balanced` | `openai-codex/gpt-5.6-terra` | `medium` |
| `strong` | `openai-codex/gpt-5.6-sol` | `medium` |
| `deep` | `openai-codex/gpt-5.6-sol` | `high` |

Personas state when a higher tier may be worthwhile, but they do not silently promote
themselves. They return an escalation request and the parent decides whether to
redispatch with a call-site model override. Frontmatter does not need a custom tier
field: profile pins are render-time defaults, and the body carries the portable policy.
Plain `staffed enable` uses profile `none`, stamps no model, and inherits the parent
session model. `staffed status` reports the exact model tracked at installation,
inherited selection, or an unknown legacy manifest; it never guesses an old install
from today's profile.

> `models.json` lives inside the package, so `tier` declarations made under `pnpm dlx`
> are written to a throwaway cache. For a durable adjustment, run `staffed tier ...`
> from a clone or a persistent installed package, then re-enable to stamp the new
> mapping.

## Effort

Effort is a second, independent axis: tier chooses **who is capable enough**, while
effort chooses **how far that persona should pursue this assignment**. Every persona
declares `low` in a `# Default effort` Markdown section. This is behavioral guidance,
not host-specific frontmatter and not the profile's native model-thinking setting.

- `low`: the shortest credible pass that produces a dependable handoff
- `medium`: investigate a named material uncertainty or validate a consequential assumption
- `high`: resolve expensive, irreversible, unusually ambiguous, or high-risk work

The parent includes `Effort: low|medium|high` in each task. Before expanding, the
persona asks whether downstream can act, whether remaining uncertainty could
materially change that action, and whether the next investigation is likely to resolve
it. If more work is unlikely to change the result, it stops.

A persona never silently spends at a higher effort. When blocked by material
uncertainty it returns a compact `## Escalation` with the requested axis (`effort`,
`tier`, or both), reason, expected gain, and safe fallback. More investigation calls
for effort; stronger synthesis calls for tier; work outside the role routes to another
persona. The parent approves or declines the redispatch. Finishing an advisory stage
also does not authorize deeper planning or implementation without user approval.

## How the host finds them

Agents and skills are exact opposites in pi, which is what decides the design:

| | Agents | Skills |
|---|---|---|
| In the system prompt | never | name + description, always |
| Body | the persona, loaded on dispatch | loaded on demand |

So the personas are the workers and the skill is the operating manual — each mechanism
doing the thing it is actually good at. `enable` generates
`~/.pi/agent/skills/staffed/SKILL.md` and its description is always resident:

```yaml
description: >-
  Staff a project with a coordinated product org of subagent personas — research, PRD,
  UX, copy, design, architecture, implementation, review, release, launch, and metrics.
  Use ONLY when explicitly engaged: "staff this project", "use Staffed", or
  /skill:staffed. Do NOT use for ordinary edits, bug fixes, refactors, reviews or
  questions — those are faster done directly.
```

**That is written as a gate, not an invitation**, and the distinction is the whole point.
Whether a task deserves an eleven-stage product process is a question about *intent* —
"build me a link shortener" can mean a weekend hack or a staffed product effort depending
on something that exists only in your head. A model cannot infer it, and one guessing will
be wrong in both directions, differently on every model release. So the always-resident
line advertises the capability and then tells the model to wait to be asked.

Keeping it visible is deliberate. `disable-model-invocation: true` would hide the skill
entirely and look like the pure-explicit answer, but then *"staff this project"* in plain
English would silently do nothing and you would have to remember the slash command.
Visible-but-gated is what makes natural language work.

### Sizing, so it is not greedy once engaged

Activation is only half of it — dispatching eleven personas at a two-file feature is the
other failure. The skill body carries a sizing table, so the org scales down:

| Work | Default chain |
|---|---|
| a copy or docs change | writer |
| a small bug or config change | builder |
| a well-specified feature | builder |
| a cross-boundary feature | architect → builder |
| an ambiguous product feature | pm → architect → builder |
| a new product | the full pipeline |

`reviewer` is a risk gate, not a mandatory final stage. Add it for security,
authentication, user data, destructive or irreversible state, migrations, public
compatibility, deployment safety, broad cross-module behavior, or changes that tests
cannot validate well. Before more than two dispatches, the orchestrator states the
planned count and what uncertainty or risk each persona resolves.

Personas also run in compact mode by default: they preserve their output headings but
write `None` for immaterial sections, avoid restating upstream artifacts, and stop when
the downstream decision or action is unblocked. A bounded architecture task stays in
one artifact instead of duplicating a design and task document.

### Generated, not templated

Enable four personas and the skill describes four — roster, sizing table and pipeline all
shrink, and it names what is missing so stages get skipped deliberately rather than
silently:

```
| a small bug or config change or a well-specified feature | builder      |
| a cross-boundary feature                                 | builder      |
| an ambiguous product feature or a new product             | pm → builder |

Not installed: researcher, ux, artist, writer, architect, ops, marketer, analyst
— cover those stages yourself or skip them.
```

A hand-copied block naming all eleven would tell your orchestrator to dispatch agents
that are not installed, which fails at the tool call. `status` reports the skill as
`current`, `STALE` or `MISSING`.

### If you want unconditional presence

`--brief` additionally writes the same guidance into `AGENTS.md`, wrapped in
`<!-- staffed:start -->` markers so it updates and removes cleanly without touching the
rest of the file. It is off by default: it costs context on every single turn, where
the skill costs one line until it is used.

## Design decisions

**No tool allowlists anywhere.** Every persona leaves `tools` unset and inherits full
capability; containment is prompt-level, uniformly, including for `reviewer`. Two
reasons that are really one reason:

- *An allowlist permitting `bash` enforces nothing.* Deny `edit`/`write` and an agent
  that wants to mutate reaches for `cat >` or `sed -i`. The list changes which path it
  takes while making a reader believe there is a sandbox.
- *An allowlist denying `bash` breaks the role.* You cannot predict which CLI a project
  needs to be understood — `gh pr diff`, `cargo tree`, `bundle exec`, a repo's own
  tooling. Not hypothetical: `reviewer` shipped as `read, grep, find, ls` and silently
  could not run `git diff`. It reviewed stale disk state and sounded confident.

A prompt fence is also *broader* than any allowlist. The realistic accidental mutations
are `--fix` flags, formatters, and snapshot-writing test runs — all bash, all invisible
to a tools list. `reviewer` enumerates and forbids them explicitly.

**Parallelism costs a flag.** `subagent` rejects mutating parallel workers in a shared
checkout and infers "mutating" from the tools list, which nothing here declares. So
fanning out `builder`s needs `worktree: true` (plus `worktreeSetup: "node-modules"`
when the tree needs deps), and parallel `reviewer`s in one checkout need
`allowParallelWrites: true`. That flag is honest here: the reviewer is fenced by
contract, not by capability. The architect marks which tasks are parallel-safe.

## Running alongside an existing agent set

Discovery precedence is **package < user < project** — override by exact name.

- `reviewer` **collides by name** with the subagent extension's bundled `reviewer`.
  Enabling this one at user tier intentionally overrides it; this version has a fixed
  verdict contract and an explicit read-only fence.
- `researcher` overlaps a `scout`-style agent conceptually, not by name: `scout`
  typically greps a codebase, `researcher` gathers external evidence and runs
  feasibility spikes.
- `architect` / `builder` don't collide by name with a typical pack (`planner`,
  `worker`, `fixer`) but overlap conceptually. Routing stays clean because the
  descriptions are mutually exclusive; if you want one canonical set,
  `staffed disable <name>` on the overlap.

Personas are individually useful, and the artifact convention degrades gracefully — a
missing `artifacts/pm/index.md` just means the persona asks for that input instead of
reading it.

## Releasing

Releases are managed by Release Please and npm trusted publishing. Conventional commits
on `main` update a release PR containing the next version and changelog:

- `fix:` and `perf:` produce a patch release
- `feat:` produces a minor release
- `feat!:` or a `BREAKING CHANGE:` footer produces a major release
- `docs:`, `test:`, and `chore:` do not release by themselves

Merge the release PR to run tests and package validation, create the GitHub release and
`v*` tag, and publish to npm. The workflow uses short-lived OIDC credentials and needs no
`NPM_TOKEN` secret. It publishes only when the matching GitHub release exists and that
version is absent from npm, so a failed publish can be retried safely.

One-time repository setup:

1. In GitHub, allow Actions to create pull requests under **Settings → Actions → General**.
2. On npm, open the `staffed` package's **Settings → Trusted Publisher** and choose
   GitHub Actions.
3. Set organization/user to `Soleone`, repository to `staffed`, workflow filename to
   `release.yml`, and allow `npm publish`. Leave the environment blank.
4. After the first successful OIDC release, optionally require 2FA and disallow legacy
   tokens under npm publishing access.

The current release baseline lives in `.release-please-manifest.json`; do not run
`npm version` manually or edit versions outside the release PR.

## Portability

The markdown body is the asset. Since no persona declares `tools` and none is pinned to
a model, `name` + `description` is the common subset across pi, Claude Code and
opencode, and the bodies contain nothing host-specific. There is usually nothing to
translate. The only deltas that exist:

- **Claude Code** (`~/.claude/agents/`): implementation is prepared with gated agent
  descriptions and host-specific discovery text, but remains disabled pending authenticated
  real-host activation and non-activation attestation.
- **opencode** (`~/.config/opencode/agent/`): adds `mode: subagent`. One line, for the
  whole roster.

Claude Code and OpenCode remain gated in `src/hosts.mjs` with `supported: false`, so
requesting either fails rather than writing unverified files. See
[the Claude Code compatibility runbook](docs/claude-code-compatibility.md) for the
real-host release gate.
