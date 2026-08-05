# Claude Code compatibility

Staffed supports Claude Code in both the terminal CLI and the **Code** tab of
Claude Desktop. Anthropic documents that Desktop Code and the CLI read the same
configuration files, including skills and settings, and Claude Code discovers custom
subagents from the `.claude/agents` locations used by Staffed.

This integration does **not** target Claude Desktop's Chat or Cowork surfaces. Cowork
does not read local `~/.claude/skills/`, and neither surface consumes local Claude Code
subagent definitions as the Code tab does.

The activation contract is explicit-only: `/staffed`, “use Staffed”, or “staff this
project”. Generated descriptions and discovery guidance tell Claude Code not to select
Staffed roles for ordinary prompts.

The CLI identifier is `claude`: select it explicitly with `--agent claude`. When
`--agent` is omitted and `~/.claude` is the only detected configuration directory,
Staffed selects Claude. If both `~/.claude` and `~/.pi/agent` exist, selection must be
explicit.

## Paths

| Scope | Agents | Skill |
|---|---|---|
| user | `~/.claude/agents` | `~/.claude/skills/staffed/SKILL.md` |
| project | `.claude/agents` | `.claude/skills/staffed/SKILL.md` |

Claude Desktop Code uses these same paths. The generated skill is the discovery and
orchestration path. Using `--no-skill` leaves installed roles undiscoverable unless the
caller supplies its own instructions.

Plain enable inherits the parent model. `--profile anthropic` selects the shared
Anthropic tier mapping; Claude Code renders its provider model IDs as `haiku`, `sonnet`,
and `opus` family aliases and drops Pi-only thinking levels. `--agent claude` chooses
the integration and paths, while `--profile anthropic` chooses the model provider
mapping. The OpenAI profile is not valid for Claude Code. Alias availability depends on
the account and organization. `--link` is unavailable because explicit-only activation
requires a rendered Claude-specific description.

## Compatibility evidence

Automated coverage verifies rendering, profile restrictions, discovery generation,
name collisions, filesystem ownership, drift handling, symlink safety, and complete
project/user lifecycle behavior. Anthropic's current documentation provides the
cross-surface contract:

- [Desktop application — Shared configuration](https://code.claude.com/docs/en/desktop#shared-configuration)
- [Create custom subagents](https://code.claude.com/docs/en/subagents)
- [Extend Claude with skills](https://code.claude.com/docs/en/skills)

No authenticated Claude installation is available in the current development
environment, so account-specific alias entitlement and end-to-end routing remain
release smoke-test responsibilities.

## Recommended release smoke test

Before release against a new Claude Code version:

1. Record the Claude Code/Desktop version and test date.
2. In both CLI and Desktop Code, test project and user scopes, full and partial
   rosters, inherited and `anthropic` profiles, and skill-only discovery.
3. Confirm `/staffed` and both natural-language activation phrases dispatch only
   installed roles and produce one persona's contracted artifact.
4. Submit ordinary edit, explanation, review, product-question, and docs-rewrite
   prompts. Unexpected Staffed dispatch is a release blocker.
5. Seed foreign targets, nested duplicate agent names, tracked drift, missing files,
   and a foreign skill sibling. Confirm unforced bytes survive and `--force` never
   removes untracked content.
6. Partially disable, verify discovery shrinks to healthy tracked roles, then fully
   disable and confirm clean owned removal.
