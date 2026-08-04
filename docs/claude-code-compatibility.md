# Claude Code compatibility

Claude Code support is not currently enabled. The implementation is retained behind an agent gate pending authenticated real-host attestation. Its prepared activation contract is explicit-only: `/staffed`, “use Staffed”, or “staff this project”; generated descriptions and discovery guidance tell Claude Code not to select Staffed for ordinary prompts.

The CLI identifier is `claude`: select it explicitly with `--agent claude`. When
`--agent` is omitted and `~/.claude` is the only detected configuration directory,
Staffed selects Claude and then reports the pending support gate; it never silently
falls back to Pi. If both `~/.claude` and `~/.pi/agent` exist, selection must be
explicit.

## Paths

| Scope | Agents | Skill |
|---|---|---|
| user | `~/.claude/agents` | `~/.claude/skills/staffed/SKILL.md` |
| project | `.claude/agents` | `.claude/skills/staffed/SKILL.md` |

The generated skill is the sole prepared discovery and orchestration path. Using
`--no-skill` leaves installed roles undiscoverable unless the caller supplies its own
instructions.

If the gate is activated after attestation, plain enable will inherit the parent model and `--profile claude` will use Claude Code's `haiku`, `sonnet`, and `opus` family aliases. `--agent claude` and `--profile claude` are independent: the first chooses the integration and paths, while the second chooses model aliases. Alias availability depends on the account and organization. The prepared implementation rejects `--link` because explicit-only activation requires a rendered Claude-specific description.

## Release-gate matrix

Run this matrix against an authenticated current Claude Code release before publishing compatibility claims:

1. Record the Claude Code version and test date.
2. At both scopes, test full and partial rosters, inherited and `claude` profiles, and skill-only discovery.
3. Confirm `/staffed` and both natural-language phrases dispatch only installed roles and produce one persona's contracted artifact.
4. Submit ordinary edit, explanation, review, product-question, and docs-rewrite prompts. Any Staffed Agent dispatch is a release blocker.
5. Seed foreign targets, nested duplicate agent names, tracked drift, missing files, and a foreign skill sibling. Confirm unforced bytes survive and `--force` never removes untracked content.
6. Partially disable, verify discovery shrinks to healthy tracked roles, then fully disable and confirm clean owned removal.

Automated tests cover deterministic rendering and filesystem ownership behavior. They cannot prove Claude Code routing or account-specific alias entitlement.

## Attestation

No authenticated real-host attestation is recorded in this repository yet. Treat the behavioral release gate above as pending until a release operator records the version, date, and complete matrix result.
