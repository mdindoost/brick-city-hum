# Decisions log

What was decided, why, and when (SPEC §0). Newest last. Music decisions live in
`docs/music/decisions.md`.

## 2026-10-14 · Repo, agents, and Phase 0 planning

- **Repo `brick-city-hum`, public, under `mdindoost`.** Mohammad's call. Non-commercial
  and attribution-driven, so openness fits; `.env` gitignored from the first commit
  and `.env.example` carries key names only. Every commit assumes a stranger reads it.
- **SPEC.md is treated as living, not frozen.** Mohammad's instruction: it records what
  he knew when he wrote it, and improving it is part of the work. Procedure: propose →
  he confirms or denies → SPEC.md is updated and the decision logged here. Neither
  silent redesign nor silent compliance with a line we believe is wrong.
- **Four subagents created** (`.claude/agents/`): `music-director` (opus, SPEC §7.4
  verbatim plus a tools limit), `implementer` (sonnet), `api-scout` (haiku, read-only —
  no Write or Edit tool, so it cannot write code even by accident), `reviewer` (opus,
  no Write or Edit — it reports, the author fixes). The tool limits are the point: each
  agent is structurally unable to do the job it should not be doing.
- **Agent files do not register until the session restarts**, so the first [VERIFY]
  sweep ran as three `general-purpose` agents pinned to haiku with the `api-scout`
  brief inlined. Same behaviour and cost; the files are correct for next session.
- **Recorder ships before everything else in Phase 0.** §13 needs ≥ 2 days of real
  data, which is 48 h of wall clock that no amount of work compresses. Everything else
  is built while it records. See `docs/plan-phase0.md`.
- **Record raw API responses alongside normalized events** *(proposed, awaiting
  confirmation)*. §3.2's thresholds are explicitly starting values to be tuned; if we
  keep only normalized output, re-tuning means another 48 h wait.
- **ffmpeg was missing** from the machine; needed for the lab's LUFS and spectrograms
  (§7.3). Mohammad authorized installing it.
