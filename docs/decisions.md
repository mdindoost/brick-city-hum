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

## 2026-10-14 · Phase 0 renders through a probe voice (SPEC §13 amended)

**Problem.** §13 required the listening lab in Phase 0 and its gate was "the lab
renders a 10-minute WAV", but §7.3 defines rendering as replaying *through the client
audio engine* — which §13 schedules for Phase 1. Phase 0 could not complete as
written: circular dependency, a spec bug rather than a misreading.

**Decision (Mohammad, option 2 of three).** Phase 0 builds a deliberately crude
**probe voice** so the measurement chain is proven before Phase 1's real voices land
in it. Rejected: moving the lab to Phase 1 (Phase 1 would then debug engine and
renderer against each other) and rendering a synthetic test signal (proves ffmpeg
works and nothing else). SPEC §13 Phase 0 updated accordingly.

**Three refinements, all from Mohammad, all binding:**

1. **The probe plugs into the real interface, not a side door.** Define the
   event→voice interface Phase 1 voices will implement, and make the probe its first
   implementation. Route its output through the planned master chain (compressor +
   −1 dBTP limiter). *Rationale: a harness that bypasses the real path lets Phase 1
   discover interface bugs late, which is the exact cost we were buying our way out of.*

2. **Determinism traps are real and must be handled explicitly.** `Tone.Reverb`
   builds its impulse response from noise generated with `Math.random`, so renders
   will **not** be bit-identical even from a fixed seed. Either keep `Tone.Reverb`
   out of the probe, or substitute the seeded PRNG for `Math.random` during offline
   renders. The same applies to any other `Math.random` or `Date.now` inside the
   engine — including `Tone.Noise`-based textures, which §6.2's rain and wind
   textures will use. The substitution must be installed **before** the engine
   constructs any audio node, or the IR is already generated from unseeded noise.
   **Acceptance: render the same slice twice → identical SHA-256.** Documented
   fallback: max sample difference below −90 dBFS, with the reason logged here.
   *Rationale: without this, every later A/B comparison is confounded by renderer
   noise and we cannot tell a musical change from a rendering artifact.*

3. **Demote the probe, do not delete it.** It moves to
   `lab/fixtures/probe-voice.ts`, is excluded from the production client bundle, and
   is retained as the renderer's regression fixture — a CI-style check that the
   harness still produces the known hash. *Rationale: when something sounds wrong
   months from now, one run distinguishes "the renderer changed" from "the music
   changed". This supersedes the earlier plan to delete the probe after Phase 1.*

## 2026-10-14 · Contact address: personal email, kept out of the repo

**Decision (Mohammad).** The §9.1 `User-Agent` contact is his personal address, held
in `.env` (gitignored) and read at runtime via `process.env.CONTACT_EMAIL`. It is
**not** shown on the public `/attributions` page — §12 requires crediting the data
*sources*, and none of them obliges us to publish our own address.

**What this does and does not hide**, stated plainly so nobody later assumes more:
- Hidden from the public repo and from GitHub scrapers — **yes, completely.**
- Hidden from the API providers — **no, by design.** adsb.lol and adsb.fi see it in
  their logs, which is the entire point: a maintainer who notices odd traffic emails
  us instead of silently blocking the IP. These are volunteer projects, not a spam risk.
- Hidden from site visitors — yes, since it never reaches the page.

**Guard: `.githooks/pre-commit`.** Git history is permanent; one accidental commit
would need a history rewrite to undo. The hook blocks any email-shaped string in
staged *added* lines, and separately blocks the literal `CONTACT_EMAIL` value read
from `.env`. **The hook itself contains no address** — it reads the one to protect
from `.env` and otherwise matches generically, so the guard cannot leak what it
guards. Deliberate exceptions go in `.githooks/allowed-emails` (currently only
`noreply@anthropic.com`, which appears in commit trailers).

Tested all three paths before committing: the real address blocked, an unrelated
address blocked, an allowlisted address passed.

**Fresh clones must run `git config core.hooksPath .githooks`** — git does not carry
hook configuration in a clone. This will be wired into the P0-1 scaffold's setup
script so it is not a thing anyone has to remember.
