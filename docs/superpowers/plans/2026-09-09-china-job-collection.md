# China Job Collection Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline execution. User authorized implementation in this session.

**Goal:** Collect and archive BOSS / Liepin jobs locally with resumable browser scans and a career-ops pipeline bridge.

**Architecture:** Separate DOM adapters, persistence, browser driver and collection orchestration. Reuse the canonical pipeline writer and Data Root resolver; no changes to public ATS providers or evaluation defaults.

**Tech Stack:** Node >=18, ESM, existing Playwright, node:test.

**Spec:** `docs/superpowers/specs/2026-09-09-china-job-collection.md`

## Global Constraints

- No new runtime dependencies. No recruiter messaging or submission.
- User data under Data Root; browser profile under ignored `data/china/`.
- Every saved JD retains provenance and observed quality; no salary guessing or disappearance-based closure.
- Work in the user's newly cloned checkout on `feat/china-job-collection`.

## Tasks

### 1. Platform identity and DOM extraction

Files: `china/platforms.mjs`, `tests/china/platforms.test.mjs`.
Interface: `jobIdentity(platform,url)`, `searchUrl(platform,query)`, `extractPage({platform,kind})` (browser-evaluated function returning DOM-only data).

- [x] Write tests with literal canonical identities, spoofed hosts and synthetic BOSS/Liepin DOM fixtures.
- [x] Run `node --test tests/china/platforms.test.mjs`; observe failures before implementation.
- [x] Implement URL allowlists, per-platform selectors, page-state classification and lossless visible-text extraction.
- [x] Run same suite with actual Chrome in isolated pages; verify card/detail association and login/challenge precedence.

### 2. Durable records and explicit queue bridge

Files: `china/store.mjs`, `tests/china/store.test.mjs`.
Interface: `openStore(root)`, `saveStore(root,state)`, `recordObservation(root,state,job)`, `queueJobs(root,options)`.

- [x] Write temp-directory tests: repeated observation keeps identity, changed JD adds a version, failed detail preserves old complete text, distinct requisitions survive.
- [x] Run tests and observe failure.
- [x] Implement atomic store writes, immutable JD Markdown, and lock-protected explicit queue using `appendToPipeline`.
- [x] Verify repeated queue adds zero entries and external data directory receives all writes.

### 3. Browser scan and resume

Files: `china/collector.mjs`, `china/browser.mjs`, `tests/china/collector.test.mjs`.
Interface: `collect({root,platform,searchUrl,limit,maxPages,resume,driver})`; driver provides `listing(url)`, `detail(job)`, `next()` and `close()`.

- [x] Write tests using external-I/O driver doubles for interruption halfway through detail collection, repeat-page detection, limits and explicit empty results.
- [x] Observe failures, then implement checkpoint-before-detail and save-after-observation behavior.
- [x] Implement persistent browser login and bounded serial navigation; stop on login/challenge, never click contact buttons.
- [x] Verify resume processes the saved pending card before advancing pages and never loses the remaining page at a limit.

### 4. CLI, documentation and verification

Files: `china-jobs.mjs`, `docs/CHINA_JOBS.md`, `tests/china/cli.test.mjs`, `package.json`, `AGENTS.md`, `config/local-paths.txt`.

- [x] Test CLI help, bad arguments and read-only list in an empty external data root before adding command implementation.
- [x] Add `china:login`, `china:scan`, `china:list`, `china:queue`, `test:china`; document Chinese workflows and live-verification status.
- [x] Register a short agent routing entry for domestic collection before personal onboarding; declare new fork-owned module paths and document Git-only updates for modified upstream files.
- [x] Run `npm run test:china`, `npm run lint` and relevant upstream pipeline tests.
- [x] Run limited live checks on both sites, document any user-login or network dependency, review diff and report exact remaining limitations.

## Remaining live acceptance

- [ ] Reuse the user's confirmed BOSS login in a compatible collection session, collect a small authenticated batch and inspect archived detail fields.
- [ ] After the user completes Liepin login, collect a small authenticated batch and inspect archived detail fields.

BOSS login was confirmed in ordinary Chrome; its remaining blocker is collection-session compatibility/verification, not an assumption that the user has not logged in. Offline checks and public page probes do not satisfy authenticated acceptance. No full platform collection claim is made.

## Follow-up: BOSS redirect loop and assisted capture (2026-09-10)

- [x] Reproduce rapid security redirects using intercepted local pages; stop before loading security scripts.
- [x] Share the stop state between listing/detail pages and check it again after operation delays.
- [x] Bound login-page navigation loops; reject login-gated JD previews.
- [x] Add explicit provenance-preserving assisted JSON import without browser/Cookie access.
- [x] Validate 31 offline tests, syntax checks and independent review.
- [ ] User logs in to their stable ordinary Chrome page and opens a complete JD; verify actual assisted capture and archive.

No new live browsing was performed while waiting for manual login. Automated BOSS collection remains unaccepted.

## Follow-up: distinguish automatic verification from failure (2026-09-10)

- [x] Compare cookie-only, cookie-plus-origin-storage, browser-protocol-only and native Chrome sessions without touching the stable original window.
- [x] Confirm the ordinary login history includes one successful code-37 return; trace repeated transitions to the site's passport SDK and security-page script.
- [x] Add failing regressions for a successful first automatic check, a repeated check and a stalled check; implement a bounded first-check allowance.
- [x] Fix the review finding for repeated commit-only verification transitions; 35 offline tests, syntax checks and independent re-review pass.
- [ ] Complete authenticated full-JD acceptance. Do not repeat logins or equate a code-37 grace-period fix with a working live collector.
