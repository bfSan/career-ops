# Liepin / LinkedIn provider completion

> Execution: current session, no subagents, following the user's standing instruction. Use TDD and verification-before-completion. Preserve the existing checkout and uncommitted work.

**Goal:** Complete collection-to-archive-to-core consumption for Liepin and LinkedIn, and publish an evidence-based readiness audit.

**Architecture:** Keep the shared collector/store/study and original provider contract. Extend recognized platform identities and rendered-DOM extraction; native standalone-detail navigation remains isolated from BOSS's in-list panel implementation. Live collection and offline provider fetch remain separate operations.

**Specification:** User request on 2026-09-13: complete Liepin/LinkedIn, audit acquisition, identify usable career-ops features; existing provider design in `../specs/2026-09-12-china-provider-integration-design.md`.

**Constraints:** No extension, copied credentials, contact/apply actions, automatic challenge solving, background schedules, rewriting old studies, or automatic personal applications. Default 5 jobs / 1 page; allow explicitly requested larger bounded batches while retaining >=15s operation spacing. Keep source dates distinct from observation dates and unknown compensation unresolved.

## 1. Liepin pagination, resume, gates

Files: `china/native-liepin-driver.mjs`, `china/collector.mjs`, `china-jobs.mjs`, `tests/china/native-liepin.test.mjs`, `tests/china/collector.test.mjs`, `tests/china/cli.test.mjs`.

- [x] RED: two result pages with duplicate ID and a next link retain filters, read fresh documents, archive each posting once and never click apply.
- [x] RED: resume from page two restores that page and continues pending details; one-page per-run budget is not an absolute page-one restriction.
- [x] RED: cross-domain `safe.liepin.com/...captchaPage...` is `challenge`; changed filters/external pagination targets stop before navigating.
- [x] GREEN: verified observed next controls only; return to owned result page after detail, wait for changed listing signature, preserve query filters and checkpoints.
- [x] GREEN: explicit CLI batch/page limits are bounded; defaults unchanged.
- [x] Verify: regression plus real continuous2 JDs, saved checkpoint +1, and next page after detail return in the same native session. Actual page2 pending-JD resume remains fixture-only.

## 2. LinkedIn source and native collection

Files: `china/platforms.mjs`, new `china/native-page-driver.mjs`, `china/native-driver.mjs`, `china/driver-choice.mjs`, `china-jobs.mjs`, `posting-dates.mjs`, `tests/china/linkedin.test.mjs`.

- [x] RED: numeric and regional slug job URLs canonicalize to the same LinkedIn ID; profile/message/off-host URLs are rejected.
- [x] RED: visible guest and signed-in detail containers yield full JD, company/location and exact posted/reposted date semantics; clipped previews and login/challenge pages never yield full JD.
- [x] RED: two identity-bound LinkedIn JDs and pagination share one owned persistent profile; unexpected redirects/old documents/foreign controls stop.
- [x] GREEN: reuse standalone-detail driver with platform-specific extraction and guards. Never silently fall back to another route after an access gate.
- [ ] Verify fixture flows and live small batch only where the user's actual browser can access the international job site. Record regional redirect/network blocks separately from implementation success.

## 3. Archive provider and original consumers

Files: `china/provider-plugin.mjs`, `china/setup-providers.mjs`, `tests/china/provider-workflow.test.mjs`, `tests/china/provider-scan.test.mjs`, `tests/china/setup-providers.test.mjs`.

- [x] RED: LinkedIn archive → v2 freeze → career-linkedin provider → actual original scan → archive_ref → JD reader; original title/location/date filters and history work, and repeated scans do not duplicate rows.
- [x] GREEN: add third archive plugin without changing existing generated plugin bytes or enabling personal flows. Preserve original LinkedIn guest liveness unless an explicit archive checker is selected.
- [x] Verify isolated real-core scan with network disabled, plus unchanged old frozen archives/reports:98 existing study jobs and3 jobs observed during live acceptance.

## 4. Collection completeness and capability audit

Files: `docs/CHINA_JOBS.md`, `docs/CHINA_ADAPTER_AUDIT.md`, report under `reports/china-market/provider-completion-2026-09-13/`.

- [x] Trace input → list → pagination → detail → full-JD gate → facts → immutable archive → resume → study → provider → scan/history/source read.
- [x] Run relevant regressions and inspect every failure. Baseline on current checkout: 242 tests, 241 pass, 1 skipped, 0 fail.
- [x] Distinguish implemented, fixture-verified, live-verified, source-data-missing and personal-input-needed capabilities.
- [x] Document explicit usage and remaining access blockers; no claim of historical half-year completeness or current job availability from archival success.

Pre-edit hashes are in `.superpowers/sdd/2026-09-13-provider-completion/baseline.json`. No commits or staging during this task because the checkout already contains user work in both index and working tree.


## Execution evidence — 2026-09-13

- Final regression: 286 tests, 285 pass, 0 fail, 1 skipped. Native desktop permission test is opt-in; synthetic browser tests do not claim a real authenticated session.
- Existing four-city v2 study: BOSS82 + Liepin16 = 98 returned through actual archive providers; actual original scan produced98 isolated pipeline rows; all98 source refs resolved; repeat scan added0. Real personal tracker/pipeline unchanged.
- Historical frozen baseline: 206 files unchanged. Initial checkout baseline1578 files retained; only intended adapter, tests and documentation edited. No staging/commit/push.
- Additional TDD coverage found during audit: description expansion, foreign pagination targets in Playwright, generic insight text mistaken for salary, foreign listing links, and page-aware liveness.
- External blockers: LinkedIn remains inaccessible. Liepin user login was completed; actual continuous2, checkpoint +1 and detail-return pagination have now passed. Two browser_closed interruptions and one startup identity_mismatch remain recorded with cause undetermined; no automatic restart loop was added.
- Remaining unchecked Verify item is LinkedIn live acceptance. Liepin live tests do not imply site exhaustion, historical coverage or verification of every page/layout.


## Login and pagination acceptance follow-up

- RED/GREEN: exact observed Liepin login route, authentication classification; currentPage and narrowly observed empty/default/transport parameters; real-style next button after two details. Nonempty/unknown filters stay significant.
- Fresh final verification:284 core/China/date tests (283 pass,1 skip),9 additional archive/compensation/liveness tests (9 pass):293 total,292 pass,0 fail,1 skip.790 modules pass syntax check.
- Live inventory now121 complete jobs (97 BOSS,24 Liepin).This acceptance validates3 full JDs, including2 new unique jobs; archive/hash/source checks pass.
- Actual original scan consumes all3 current acceptance JDs in isolated roots,3 full source readbacks,repeat adds0. The existing98-job market report remains immutable; personal queue/apps and provider switches unchanged.
- Evidence: `.superpowers/sdd/2026-09-13-provider-live-acceptance/`, especially pagination-result.json,resume-pagination-result.json,core-result.json and both final regression logs.
