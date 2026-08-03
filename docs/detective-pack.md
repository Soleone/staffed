# Detective agency preview

The `detective` staff pack is an **experimental preview** that proves Staffed's roster,
composition, discovery, ownership, and workflow abstractions outside product development.
It is not a substitute for law enforcement, legal counsel, licensed forensic practice,
or real-world safeguarding obligations.

## Activate it

```bash
staffed list --pack detective
staffed compose recipes --pack detective
staffed pack use detective --scope project
staffed status --scope project
```

A scope has exactly one active pack. Switching from product to detective preflights
modified owned roles, foreign incoming targets, and discovery files before mutation,
then removes the old owned roster and installs the detective roster atomically as far as
filesystem preflight permits. Use `--force` only when replacing local modifications is
intentional.

Switch back with:

```bash
staffed pack use product --scope project
```

## Roster

| Role | Owns | Refuses |
|---|---|---|
| `investigator` | case framing, hypotheses, bounded inquiry, synthesis | specialist analysis, interviewing, guilt or legal judgment |
| `interviewer` | ethical interview plans and account analysis | coercion, credibility verdicts, therapy, guilt |
| `forensic-analyst` | supplied evidence, provenance, integrity, alternatives | fabricated access/results, interviews, case adjudication |
| `case-reviewer` | independent read-only challenge and verdict | investigation, rewriting artifacts, guilt or liability |

The first three roles own `artifacts/<role>/index.md`. `case-reviewer` is deliberately
read-only and returns its verdict immediately without an artifact directory.

## Workflow

```text
investigator → interviewer → forensic-analyst → case-reviewer
```

This is an ordering reference, not a mandatory pipeline. Default to one role. Add a
specialist only for a question the case lead cannot responsibly own, and add
`case-reviewer` only for consequential conclusions, disputed provenance, open material
alternatives, fairness risk, or weak independent validation.

## Domain audiences

The pack adds `client`, `witness`, `subject`, `victim`, `court`, and `press` to the core
audiences. `subject` is deliberately neutral and never presumes culpability.

## Recipes

```text
investigator + exploratory + sceptic + client + direct
interviewer + empiricist + witness + empathetic
forensic-analyst + challenging + empiricist + court + direct
case-reviewer + challenging + sceptic + decision-maker + blunt
```

Use `staffed compose recipes --pack detective` for current canonical output and aliases.

## Experimental status

The pack is marked experimental in `pack list`, `list`, `status`, the generated skill,
and its lazy composition reference. Its inclusion validates generalized behavior and
pack switching; its roster and workflow should be treated as a preview until real usage
establishes that the organizational boundaries are dependable.
