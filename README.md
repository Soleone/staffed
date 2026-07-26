# Staffed

Staff any project with coordinated subagent roles. The included product staff covers
research, product definition, UX, copy, visual and audio design, architecture,
implementation, review, release, launch, and measurement.

It aims to be the simplest, lightest way to run a real product pipeline through agents:
**there is no runtime.** No orchestration engine, no graph to define, no framework to
adopt, no server, no dependencies, no build step, and nothing written into files you own.
Eleven markdown personas land in a directory your agent already reads, a generated skill
tells it they are there and when to reach for them, and the agent session you already
have does the orchestrating. One command sets it up, one command removes it.

That leaves the personas as the entire product — about 600 lines of prose, and that is
the point: what makes this work is what the personas *say*, not machinery wrapped around
them. Your session decomposes a goal, dispatches personas, and validates what each
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
pnpm dlx staffed enable                   # inherit the parent session model
pnpm dlx staffed enable --profile openai  # cost/time-oriented OpenAI defaults
pnpm dlx staffed status                   # exact stamped model, or inherited/legacy
# npx staffed ... works too
```

That does two things, both required:

1. renders all eleven personas into `~/.pi/agent/agents/`
2. installs a **`staffed` skill** into `~/.pi/agent/skills/`

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
| `list` | the roster with each persona's tier |
| `tier [name]` | show tier → model + thinking, or declare one |
| `doctor` | check configured model ids against this pi install |
| `validate` | structural checks on the roster |

Options: `--host` `--scope user|project` `--profile` `--model` `--thinking` `--link`
`--force` `--dry-run` `--brief` `--no-skill`.

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

## The roster

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

Each persona also declares a model tier in its own file; `staffed tier` prints the
mapping. See [Model tiers](#model-tiers).

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
nothing at all so its verdict can be routed immediately. Neither gets a directory. Pass
a different root via `subagent`'s `output` parameter when a caller needs one.

## Model tiers

Two different clocks, so two different files. **Tier is a property of the persona** and
rarely changes — an architect wants deep reasoning regardless of what ships next
quarter. **Model identity is a property of the host** and changes every few months.
Pinning model strings into eleven personas couples them and buys you eleven files to
edit on every release; keeping them apart makes a refresh one edit at any roster size.

So each persona declares a tier as a token a script can read and a human can argue
with:

```markdown
# Recommended model tier
`balanced` — deep when the decision hinges on synthesis rather than gathering.
```

`models.json` maps tiers to concrete models, per host profile:

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

Four tiers exist (`fast`, `balanced`, `strong`, `deep`). The current assignments are:

- `fast`: no personas
- `balanced`: `researcher`, `writer`, `marketer`, `analyst`
- `strong`: `builder`, `reviewer`, `ops`
- `deep`: `pm`, `architect`, `ux`, `artist`

The opt-in `openai` profile is an allocation strategy oriented toward total cost/time
per accepted outcome; it is not a benchmark or a guarantee:

| Tier | Model | Thinking |
|---|---|---|
| `fast` | `openai-codex/gpt-5.6-terra` | `low` |
| `balanced` | `openai-codex/gpt-5.6-terra` | `medium` |
| `strong` | `openai-codex/gpt-5.6-sol` | `medium` |
| `deep` | `openai-codex/gpt-5.6-sol` | `high` |

Some personas describe a *conditional* tier — `reviewer` scales with change risk and
`writer` with whether it is naming a core concept. Frontmatter cannot express that and
does not need to: profile pins are render-time defaults, and `subagent`'s call-site
`model` overrides them. Plain `staffed enable` uses profile `none`, stamps no model,
and inherits the parent session model. `staffed status` reports the exact model tracked
at installation, inherited selection, or an unknown legacy manifest; it never guesses
an old install from today's profile.

> `models.json` lives inside the package, so `tier` declarations made under `pnpm dlx`
> are written to a throwaway cache. For a durable adjustment, run `staffed tier ...`
> from a clone or a persistent installed package, then re-enable to stamp the new
> mapping.

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

- **Claude Code** (`~/.claude/agents/`): model vocabulary only (`opus`/`sonnet`/`haiku`)
  — use the `claude-code` profile.
- **opencode** (`~/.config/opencode/agent/`): adds `mode: subagent`. One line, for the
  whole roster.

Both are stubbed in `src/hosts.mjs` with `supported: false`, so requesting one fails
with an explanation rather than writing files nobody has verified. Add a host there, a
profile in `models.json`, then `staffed enable --host <name>`.
