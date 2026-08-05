# OpenAI Codex compatibility

Staffed supports Codex CLI and the Codex experience in the ChatGPT desktop app.
Both surfaces use Codex's standard local configuration formats.

## Selection

Pass Codex explicitly when more than one supported host is installed:

```bash
staffed enable --agent codex
staffed status --agent codex
```

If Codex is the only detected host (`$CODEX_HOME` exists, defaulting to
`~/.codex`), Staffed selects it automatically.

## Installed paths

| Scope | Custom agents | Staffed skill |
|---|---|---|
| user | `$CODEX_HOME/agents/*.toml` (default `~/.codex/agents/*.toml`) | `~/.agents/skills/staffed/SKILL.md` |
| project | `.codex/agents/*.toml` | `.agents/skills/staffed/SKILL.md` |

`CODEX_HOME` changes Codex's user state/configuration root and is honored for
custom-agent installation and host detection. It does not move the user skill;
Codex discovers that under `$HOME/.agents/skills`.

The skill's composition reference is installed beside it at
`staffed/references/composition.md`.

Staffed's persona sources remain portable Markdown. Codex requires each custom agent
to be a TOML file with `name`, `description`, and `developer_instructions`, so Staffed
renders the Markdown body into `developer_instructions`. An OpenAI profile additionally
renders `model` and `model_reasoning_effort` in Codex's native spelling.

## `AGENTS.md`

Codex discovers instructions from `AGENTS.md` at the repository root and along the
path to the working directory, plus a user-level file under `~/.codex/AGENTS.md`.
Staffed's discovery mechanism is the installed `staffed` skill, so enabling or
disabling Staffed does not create or edit any `AGENTS.md` file.

## Desktop behavior

The desktop app and CLI both discover standalone skills and Codex custom agents from
the locations above. If both are pointed at the same home and repository, no separate
Staffed installation is needed.

## References

- [Build skills](https://developers.openai.com/codex/skills)
- [Subagents and custom agents](https://developers.openai.com/codex/agent-configuration/subagents)
- [Custom instructions with AGENTS.md](https://developers.openai.com/codex/guides/agents-md)
