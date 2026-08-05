# Staffed

Staff any project with coordinated subagent roles. Use with Pi, OpenAI Codex, or Claude Code.

https://github.com/user-attachments/assets/72cc52a0-1cad-4dc9-9078-daeee21e505c

https://github.com/user-attachments/assets/34e46e26-977e-4ba5-8d09-f8d1888866fd

Staffed is a product-team pack for agent sessions: install the roles, ask for the expertise you need, and read the resulting artifacts. There is no runtime, only Markdown personas, a generated skill, and files in your project.

## Install

```bash
# pnpm
pnpm add -g staffed

# npm
npm install -g staffed

staffed enable
staffed status
```

For a quick start with pinned model tiers, the two most popular profiles are
`openai` and `anthropic`:

```bash
# Pi with OpenAI models
staffed enable --profile openai

# Pi with Anthropic models
staffed enable --profile anthropic

# OpenAI Codex CLI or desktop app
staffed enable --agent codex --profile openai

# Claude Code CLI or Claude Desktop Code
staffed enable --agent claude --profile anthropic
```

Plain `staffed enable` inherits the parent session model instead of pinning a profile.

Or try it without installing globally:

```bash
pnpm dlx staffed enable
pnpm dlx staffed status
# npx staffed ... works too
```

`enable` installs personas and the `staffed` discovery skill. `status` confirms what is installed. By default, installation is user-scoped; use `--scope project` for repository-local configuration. Host-specific paths are documented below.

## Roles and modifiers

Choose the role that resolves the uncertainty. Start with one.

| Role | Use it for |
|---|---|
| `researcher` | evidence, prior art, feasibility |
| `pm` | problem, scope, users, metrics |
| `ux` | flows, information architecture, states |
| `writer` | product copy and user documentation |
| `artist` | visual/audio identity and assets |
| `architect` | system design and task breakdown |
| `builder` | one well-defined engineering task |
| `reviewer` | correctness, security, maintainability review |
| `ops` | CI, deployment, rollout and rollback |
| `marketer` | positioning, launch, campaign copy |
| `analyst` | metrics, experiments, readouts |

A composition is one role plus optional modifiers: stance, drive, lens, audience, and voice.

- **Stance:** `exploratory`, `challenging`, `decisive`
- **Drive:** `craftsperson`, `pragmatist`, `steward`, `pioneer`, `minimalist`
- **Lens:** `sceptic`, `empiricist`, `first-principles`, `conventionalist`, `systemic`, `historical`
- **Audience:** `requester`, `newcomer`, `expert`, `practitioner`, `decision-maker`, `public`, `successor`, `customer`, `maintainer`, `operator`, `executive`, `ecosystem`
- **Voice:** `empathetic`, `direct`, `blunt`, `diplomatic`, `socratic`, `provocative`, `playful`

```text
Have the PM evaluate this feature idea.
Have a decisive, sceptic PM evaluate this feature idea for newcomers.
```

Use `staffed compose` to browse valid terms and recipes. Safety, permissions, output contracts, model tier, and effort are controls, not modifiers, and take precedence.

## First use

Ask naturally:

```text
Using staffed build a link shortener with custom domains.
```

Or ask for a specific role:

```text
Have the staffed PM inspect this project and recommend three worthwhile features.
```

Each role writes its primary result to `artifacts/<role>/index.md`; the artifact is the handoff. For a small feature, a useful chain is `architect → builder → reviewer` when review risk warrants it. Use more stages only when each resolves a named uncertainty.

## Commands

| Command | Purpose |
|---|---|
| `staffed enable [name...]` | enable all roles, or named roles (additive) |
| `staffed disable [name...]` | disable all Staffed roles, or named roles |
| `staffed status` | inspect enabled roles and discovery drift |
| `staffed list [--pack name]` | list a pack's roles, tiers, and effort |
| `staffed compose [terms...]` | browse or validate compositions |
| `staffed skill` | print the generated discovery skill |
| `staffed pack list` | list available packs |
| `staffed pack use <name>` | switch the active pack for this scope |
| `staffed tier [name]` | show or set tier model/thinking mappings |
| `staffed doctor` | check model IDs against this Pi installation |
| `staffed validate` | validate the roster |

Useful options: `--agent pi|codex|claude|opencode`, `--scope user|project`, `--pack`, `--profile`, `--model`, `--thinking`, `--link`, `--force`, `--dry-run`, and `--no-skill`.

`--agent` selects where files are rendered; `--profile` selects render-time model defaults. They are independent. Without `--agent`, Staffed selects the one detected host; if multiple supported hosts are present, choose explicitly. Pi, OpenAI Codex, and Claude Code are supported. Codex uses `.codex/agents/*.toml` for custom agents and `.agents/skills/staffed/` for the shared CLI/desktop skill. The Claude integration works in both the CLI and Claude Desktop's Code tab because those surfaces share `.claude` configuration. Claude Desktop Chat and Cowork are separate surfaces and are not supported by that integration. opencode remains gated, so requests for it fail rather than write unverified files.

| Host | User agents | User skill | Project agents | Project skill |
|---|---|---|---|---|
| Pi | `~/.pi/agent/agents` | `~/.pi/agent/skills/staffed` | `.pi/agents` | `.pi/skills/staffed` |
| OpenAI Codex | `$CODEX_HOME/agents` (default `~/.codex/agents`) | `~/.agents/skills/staffed` | `.codex/agents` | `.agents/skills/staffed` |
| Claude Code | `~/.claude/agents` | `~/.claude/skills/staffed` | `.claude/agents` | `.claude/skills/staffed` |

Codex custom-agent files are TOML by specification; Staffed preserves each source Markdown persona body inside `developer_instructions`. Codex discovers repository instructions from `AGENTS.md` independently, so Staffed does not modify that file. See [Codex compatibility](docs/codex-compatibility.md).

`enable` and `disable` only manage files Staffed owns. They do not overwrite foreign or locally modified files without `--force`. One pack is active per install scope. `list` and `compose` show the catalog; use `status` for the installed state.

## How it works

- Personas route work and keep adjacent responsibilities separate.
- Artifacts persist on disk, so later roles can use them without rebuilding chat context.
- Fixed output contracts make handoffs checkable.

Most roles write to `artifacts/<role>/index.md`. `builder` changes the code; `reviewer` reports findings and does not edit. A role should return the shortest dependable result, write `None` for immaterial sections, and escalate material uncertainty rather than silently expanding scope.

## Packs, tiers, and reference

The built-in Product pack is the default. The experimental Detective preview is available through `staffed pack use detective`; see [Detective preview](docs/detective-pack.md).

Roles have a default tier (`fast`, `balanced`, `strong`, or `deep`) and effort level. Plain `enable` inherits the parent session model. The only model profiles are `openai` and `anthropic`. Pi renders their provider-qualified model IDs and thinking levels; Claude Code accepts the `anthropic` profile and renders its models as `haiku`, `sonnet`, and `opus` aliases without per-agent thinking. Use `staffed tier`, `staffed doctor`, and `staffed status` to inspect mappings. Durable tier changes require a clone or persistent install, not a temporary `pnpm dlx` cache.

For modifier definitions and recipes, see [Composition](docs/composition.md). For Claude Code and Desktop surface details, see the [compatibility guide](docs/claude-code-compatibility.md).
