# Session Summary — 2026-09-19 (Eva Keerthi, QA)

Repos:
- QA repo: quantarra/Quantarra_testing (working tree: quantarra-qa-automation, tests in Automation/, branch main)
- App code (READ-ONLY copy, freshly pulled): C:\Users\keert\Desktop\Testing\Quantarra_codebase\project-atlas (on main, pulled to 486014e2 this session). Two OTHER project-atlas copies exist (Code repo\..., quantarra-qa-automation\...) — left untouched. QA code is checked into a different repo; leave app copies alone.

## Task 1: TG-7 workspace-filter tests — fix stale assertions + add coverage (PRJAT-1499/1503)

### Root cause of TG-7 failures (TC-4, TC-5, TC-17)
- Requirement CHANGED: PRJAT-1212 (old, per-chip filter: switching chips reset the filter) was SUPERSEDED by **PRJAT-1499/1503** (new: ONE shared panel filter per audit).
- App code confirms (apps/web/src/hooks/use-workspace-state.ts): filter stored once per audit in sessionStorage key `ws-filter-${audit.id}`; `handleSubTabChange` clears only SEARCH, not the filter; badge = countActiveFilters(appliedFilters), shown only on the `controls` sub-tab.
- "All controls"/"Controls I own" are CHIPS (controlsChip = all/mine), rendered by FilterChips (data-testid `controls-chip-{key}`), NOT the WorkspaceSubTabs (families/objectives/controls/evidence, role=tab in tablist aria-label="Workspace sub-tabs"). Filter is shared across chips.
- User verified via Jira that the requirement change is intentional → tests were stale, NOT an app bug. (Earlier we suspected a prod bug, but user confirmed 1499/1503 changed the requirement.)

### Changes made to Automation/tests/daily-shakeout/07-tg7-workspace-filters.spec.ts
- Rewrote TC-4 (filter persists across chips), TC-5 (single shared filter visible on all chips, no isolation), TC-17 (Clear all clears shared filter for whole controls view).
- Added TC-19 (switch workspace sub-tab keeps filter, clears search), TC-19b (filter persists after leaving to /policies and back to SAME audit — sessionStorage persistence; cross-audit isolation stays TC-16).
- Added TC-20 (filter btn hidden on non-controls sub-tabs), TC-21 (chip counts reflect active filter not active chip — PRJAT-1503), TC-22 (deep-link ?status=in_progress seeds shared filter; params verified in audit/[id]/page.tsx, status values from status-badge.tsx), TC-23 (filter survives full reload).
- Added helper `selectWorkspaceSubTab()` (scoped to "Workspace sub-tabs" tablist), distinct from chip helper `selectSubTab()`.
- Updated the file's top docstring to document PRJAT-1212 → PRJAT-1499/1503.
- Verified: `npx tsc --noEmit` clean; `playwright test --list` registers all TCs.

### PRs
- **PR #11 (Quantarra_testing) — MERGED to main** (squash, branch deleted): TC-4/5/17 fixes + TC-19/TC-19b + helper. Commit on main: 395dc8e.
- **PR #12 (Quantarra_testing) — OPEN**: branch `keerthi/PRJAT-1503-tg7-filter-tests-more` — adds TC-20..TC-23 (spec only). https://github.com/quantarra/Quantarra_testing/pull/12. Commit 78411fd. NOT yet merged.

### Excel update (New_Testcase.xlsx, "Regression" sheet) — DONE in working tree, NOT committed
- Updated TC-4/5/17 step+expected to the new model; appended TC-19, TC-19b, TC-20, TC-21, TC-22, TC-23 (all Run for Full regression=Yes, Shakeout=Yes to match TG-7 siblings). Verified shouldRun('TG-7','Scenario 7',...) returns true for all in RUN_MODE=regression. All 7 sheets preserved.
- Excel schema: sheet "Regression"; cols = [Test case, Test scenario/Test case/Test step, Expected Results, Identifier, Test group, Run for Full regression, Run for Smoketest in prod, Console Error Validated, Run Shakeout in Prod and POC, Last Validated]. shouldRun matches on the last "Scenario X" header row seen + Test group + Test case; reads "Run for Full regression" when RUN_MODE=regression.
- **OPEN DECISION (blocker for committing Excel):** working-tree New_Testcase.xlsx differs from HEAD 53KB→330KB — it had LARGE pre-existing uncommitted changes BEFORE my edit (not mine). Committing sweeps in unrelated binary changes. Options given to user: (1) commit as-is, or (2) revert to HEAD and re-apply ONLY TG-7 rows. User has NOT chosen yet. DO NOT commit the Excel until user decides.
- Temp helper scripts (_inspect-tg7.cjs, _update-tg7-excel.cjs, _verify-shouldrun.ts) already deleted.

### TG-7 run — NOT completed
- User asked to run headed; started staging then prod runs but user CANCELLED both ("stop execution"). Never got a green run. Reminder: run NATIVELY in PowerShell via cross-env (package.json uses cross-env, which is fine): `npx cross-env ENV=prod RUN_MODE=regression npx playwright test tests/daily-shakeout/07-tg7-workspace-filters.spec.ts --project=regression --headed`. TG-7 is regression-gated.
- Session/login note: auth-setup logs in once per role (admin+contributor), reused via storageState with a 10-min TTL. Repeated logins happen when (a) TTL expires between runs, or (b) switching ENV (session file `.auth/admin-session.json` is NOT env-keyed). User flagged "prod creds in staging" — likely a generic ADMIN_EMAIL/PASSWORD env var or non-env-keyed session. POSSIBLE IMPROVEMENT (not done): make session paths env-aware (admin-session-${env}.json) to prevent cross-env session reuse.

## Task 2: PRJAT-1487 — manual validation question (analysis only, no code)
- PRJAT-1487 (Bug, High, In Review, assignee Jessica Seip, label v0.20.0): MC Admin couldn't save org feature overrides ("Failed to save features: Permission denied") because `subscription_tiers:manage_overrides` wasn't held by MC Admin role.
- Fix (Jessica, branch `jessica/PRJAT-1487-mc-feature-overrides-permission`): all six subscription-tier WRITE endpoints now accept EITHER `subscription_tiers:*` OR per-user `mc:tiers` toggle (array @Authorize OR-form). MC Admin gets access via per-user `mc:tiers`, not a blanket role grant. The privilege-escalation half (client Admin self-granting paid features) split to **PRJAT-1490** — negative/security validation belongs there, not 1487.
- **Positive manual validation for 1487:** MC Admin WITH the `mc:tiers` toggle can save org feature overrides (no 403; PUT /api/v1/subscription-tiers/orgs/:orgId/overrides/batch returns 2xx; overrides persist on reload; enabling external_audit/third_party_ia works without a Super User). Secondary: Super User still works; read (`read_features`) still works.
- **Where is the "MC: manage tiers" toggle:** it's the per-user `mc:tiers` permission, labeled **"Subscriptions"** in the UI (mc-team-page.tsx PERMISSION_LABELS). Set it as Super User via Mission Control → Team → open the MC Admin user's permission sheet → enable "Subscriptions" → save. Caveats: backend must be RESTARTED after fix (syncPermissions runs on boot); ticket still In Review so confirm it's deployed to the target env first.

## Next steps
1. Decide Excel commit approach (option 1 as-is vs option 2 clean TG-7-only), then commit New_Testcase.xlsx — likely onto PR #12 branch so spec+Excel ship together.
2. Merge PR #12 (branch → main → delete branch) once decided/green.
3. Optionally run TG-7 headed to confirm the 5 updated/added tests pass on staging/prod (run natively via cross-env).
4. Optional improvement: env-keyed auth session files to fix cross-env session reuse.
5. If asked: draft PRJAT-1487 positive manual test-case rows or an MC Playwright/API spec.

---

# Session Summary — 2026-09-07 (Eva Keerthi, QA)

Repos:
- QA repo: quantarra/Quantarra_testing (working tree: quantarra-qa-automation, tests in Automation/, branch main)
- App repo: quantarra/project-atlas (working tree: quantarra-qa-automation/project-atlas)

## Task: move QA into app-repo CI — post-deploy Prod shakeout caller + fixes

### What was done
1. **Created post-deploy caller** `project-atlas/.github/workflows/qa-shakeout-prod.yml`
   - Trigger: `workflow_run` on `CD — Production` completion (only if deploy succeeded) + `workflow_dispatch`.
   - Calls reusable `quantarra/Quantarra_testing/.github/workflows/shakeout-prod.yml@main` with `secrets: inherit`. Prod only.
   - `if: github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success'`.
2. **Deleted duplicate cron** `project-atlas/.github/workflows/shakeout-prod.yml` (pre-existing, NOT ours) — it duplicated the QA repo's own daily cron. Daily cron now lives solely in the QA repo.
3. **Fixed reusable-workflow cross-repo checkout** (QA repo `.github/workflows/shakeout-prod.yml`): both jobs now `actions/checkout@v5` with `repository: quantarra/Quantarra_testing` + `ref: main`. Root cause of the CI failure "Some specified paths were not resolved, unable to cache dependencies": a bare checkout in a reusable workflow checks out the CALLER (project-atlas, no Automation/ folder), so setup-node's `cache-dependency-path: Automation/package-lock.json` didn't resolve. Quantarra_testing is PUBLIC → default GITHUB_TOKEN suffices, no PAT.
4. **Fixed TG-6 TC-7..TC-11** (`Automation/tests/daily-shakeout/03-tg6-audit-lifecycle.spec.ts`): `expectNoPageError()` was `getByRole('alert').toHaveCount(0)`. The app renders a persistent screen-reader announcer (role=alert, aria-live=assertive, 1x1px, EMPTY text) on every page → guaranteed false positive on all 5 tabs. Fix: ignore empty (text-less) alerts, only fail on a VISIBLE alert with error text; crash-headline check unchanged. Verified 7/7 pass against PROD. Test-only — app is healthy.

### PRs open (all unmerged)
- **Quantarra_testing #9** — reusable shakeout cross-repo checkout fix. Self-mergeable once green.
- **Quantarra_testing #10** — TG-6 TC-7..TC-11 a11y-alert false-positive fix. Self-mergeable once green.
- **project-atlas #1675** — post-deploy caller + duplicate-cron removal. Touches .github/workflows → needs Krishna review.
- **Merge order: #9 BEFORE #1675** (caller references reusable @main). #10 independent.

### Secrets — org level (in progress with Andrei)
- Caller runs in project-atlas context, so `secrets: inherit` needs the 8 secrets in project-atlas OR at org level. Chose ORG level (single source, both repos).
- Keerthi lacks org-admin (403 listing org secrets). Andrei has admin:org, acked, will create all 8 scoped to Quantarra_testing + project-atlas.
- Keerthi to send via 1Password (NOT Slack): SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SHAKEOUT_REPORT_RECIPIENTS (= .env's REPORT_RECIPIENTS value), SLACK_WEBHOOK_URL, JIRA_API_TOKEN, JIRA_EMAIL=keerthi@quantarra.io.
- **Naming**: org secret MUST be `SHAKEOUT_REPORT_RECIPIENTS` (not REPORT_RECIPIENTS) and `JIRA_EMAIL` (project-atlas currently has JIRA_USER_EMAIL). All are required:false → tests run without them, only reporting is skipped.
- **SECURITY**: Jira token + Gmail app password were pasted into chat → treat as EXPOSED. ROTATE both (Atlassian API tokens page; Google app passwords), then send the NEW values to Andrei + update Automation/.env.

### Key gotchas / lessons (IMPORTANT for next session)
- **Reusable GH workflow checkout**: bare `actions/checkout` checks out the CALLER, not the workflow's own repo. Cross-repo callers must set `repository:` + `ref:`.
- **secrets: inherit** passes the CALLER repo's secrets, not the reusable-workflow repo's. GitHub secrets are write-only (list shows names only).
- **WSL vs Windows env vars**: running Playwright/npx through WSL bash does NOT propagate Linux `export ENV=prod` to the Windows node process → tests silently run against dev/localhost. RUN NATIVELY IN POWERSHELL: `$env:ENV="prod"; npx playwright test ...`. `node` is also not on PATH in the WSL login shell; `sqlite3` is NOT installed (WSL or Windows) → eva-mem.sh cannot run here; memory is saved to THIS file instead.
- **role=alert announcer**: the app has a permanent empty 1x1 aria-live=assertive region on every page. QA must not treat role=alert presence as an error — require visible + non-empty text (mirrors the existing don't-use-bare-getByText(/error/i) rule).
- **CRLF scripts**: slack-agent.sh / eva-mem.sh have CRLF; bash chokes. Run via `tr -d '\r' < s.sh > /tmp/x.sh; bash /tmp/x.sh` (but keep eva-mem's copy in scripts/ so SCRIPT_DIR/../.eva resolves).
- **PowerShell quoting**: inline JSON/complex args to bash and gh get mangled. Write payloads/PR bodies to a file and use `--body-file` / a bash runner script.
- **.env** pins `ENV=staging`; the CLI env var override is what selects the target. Jira token in Automation/.env; base https://quantarra.atlassian.net, email keerthi@quantarra.io.

### Next steps
1. Send Andrei the 8 values via 1Password (after rotating Jira token + Gmail app password).
2. Merge Quantarra_testing #9, then #10 (self-merge once CI green). project-atlas #1675 → Krishna review, merge AFTER #9.
3. After merge: verify caller via `gh workflow run qa-shakeout-prod.yml --repo quantarra/project-atlas` (cache error should be gone).
4. Reminder: run local prod tests natively in PowerShell (`$env:ENV="prod"`), not WSL.

---

# Session Summary — 2026-09-03 (Eva Keerthi, QA)

## PRJAT-599 — EA read-only access during retention (ACCESS-06/06b)

Fetched the live ticket from Jira (curl.exe -u with JIRA_API_TOKEN from Automation/.env;
on Windows use `curl.exe`, plain `curl` maps to Invoke-WebRequest and fails on `-u`).

- **Ticket:** PRJAT-599, Task, Priority=Blocker, Status=In Review, Assignee=krishna, label=ExternalAuditor.
  Last comment (andrei, 2026-08-21): "PR still open (not merged to main). No deployment. Moving back to
  In Progress." — so as of that comment it was NOT deployed; re-check deploy state before certifying.
- **What it does:** On audit completion each EA engagement flips to status='completed' with accessEndsAt
  (7 years external audit / 30 days 3P internal) and endedAt=NULL during retention. Change to
  auth.service.ts lets a COMPLETED EA within retention keep READ-ONLY access. Rule: engagement is
  valid-for-access when status='active' OR (status='completed' AND accessEndsAt > now() AND endedAt IS NULL).
  Applied in refresh() re-validation, assumeRole(), and getEngagedOrgIds().
- **Read-only permission set (completed EA):** keep external_audit:download_reports, audits:read,
  controls:view_all, evidence:list/read/view, action_plans:view, documents:view. DROP
  external_audit:request_updates and external_audit:mark_exception.
- **Acceptance criteria:** (1) completed EA in retention can log in/refresh + read (controls, evidence,
  reports) but write actions (accept, mark exception, request updates) → 403. (2) after accessEndsAt the
  daily engagement-monitor cron flips completed→expired (sets endedAt) and EA is fully denied. (3) active
  engagements unchanged; non-EA users unaffected.

### Clarified: "engagement status" vs "audit status"
- "status=completed" in the ACCESS-06 precondition is the **EA ENGAGEMENT** lifecycle status (external
  auditor's assignment on the audit program), NOT the client's audit status. Fields accessEndsAt/endedAt
  live on the engagement/audit-program record (EA scoped via compliance_audit_programs.external_auditor_id).
  NOTE: could not verify exact entity/field names here — app source (apps/core) is NOT in this repo
  (this is the QA automation repo). Confirm field names against apps/core when needed.

### Delivered (in chat, NOT yet scripted or in Excel)
- 16 manual UI test cases TC-1..TC-16 for PRJAT-599, app under test = Audit Portal
  (staging https://stg.quantarra.com:4003). Coverage:
  - TC-1..10 = AC#1 (completed+retention: read OK, 3 writes 403, token-refresh no lockout)
  - TC-11 = AC#2 (expired → fully denied); TC-12 = endedAt NOT NULL guard (denied)
  - TC-13 = active EA read+write unchanged; TC-14 = non-EA unaffected (both AC#3)
  - TC-15 = multi-tenant isolation for completed EA; TC-16 = 3P-internal(30d) vs external(7y) both read within window
- Caveats flagged to user: this is a backend auth change → strongest verification is at the API layer
  (assert exact 403 on the 3 write endpoints, 200 on reads); where UI hides a write control, ALSO verify
  the API rejects a direct call (test enforcement, not UI gating). Engagement states (completed/expired/
  endedAt) must be DB-seeded — cannot be produced via Audit Portal UI alone; needs backend/Krishna to seed
  TC-11/12/16 (or run completion workflow + engagement-monitor cron).

### Not done / next
- User has NOT asked to script these yet. Offered: Playwright specs (Audit Portal project) + an API-layer
  read-vs-write 403/200 test, and/or add TC-1..16 to tests/New_Testcase.xlsx in the Excel-driven format.
- Before certifying: confirm PRJAT-599 PR is merged + deployed to the target env (was "PR open, not
  deployed" per andrei's Aug-21 comment).
- No files changed this session (chat-only analysis). No commits.

---

# Session Summary — 2026-08-30 (part 2, Eva Keerthi, QA)

## TG-7 Scenario 7: content validation + renumber

- **New TC-3** "Filtered list contains ONLY controls of the selected status": after applying a
  status filter, reads the workspace **Status column** for every visible row and asserts each equals
  the selected status (not just the badge/count). This closes the gap where a filter could change the
  count but list the wrong controls. Data-adaptive (uses first status with rows; used "Not started",
  172 controls on staging).
- **Key UI fact**: the workspace controls list is a `<table>`; header order is
  ["", "Control ID & Statement", "Owner", "Function", **"Status"**, "Due Date", "Frequency",
  "Last Updated", "Notes", "In Audit"]. Per-row status IS assertable text in the Status column
  (helper `readRowStatuses` finds the column by header text, not a fixed index).
- **Renumbered Scenario 7 → TC-1..TC-18** (Excel + spec together): inserted content-validation as
  TC-3, shifted old TC-3..17 to TC-4..18. New mapping: TC-4 resets-on-ControlsIOwn, TC-5 sub-tab
  isolation, TC-6 no-badge, TC-7 Owner/Function-not-restricted, TC-8 Owner/Function-on-AllControls,
  TC-9 restricted-minus-Owner/Function, TC-10 persistence (+TC-10b empty-result negative),
  TC-11..14 Internal Audit filters, TC-15 layout, TC-16 cross-audit, TC-17 clear-all, TC-18 a11y.
- **Hardened** `goHomeAndWaitForAudits`: dropped `waitForLoadState('networkidle')` (hangs on
  staging/prod background traffic → caused TC-16 flakiness) in favour of domcontentloaded + tile
  visibility.
- **IA content validation NOT added**: IA sub-tabs are empty (0 rows) on both staging and prod, so
  there is no IA table to probe or validate. The IA filter is Owner-based (not status). Revisit with
  a proper DOM probe once IA sub-tabs have data — did not write blind assertions.
- **Verified**: full TG-7 suite 21/21 passed on staging (headed). Scenario 7 also confirmed 20/20 on
  PROD earlier this session — the per-sub-tab filter feature IS live on Prod; TG-7 shakeout flags
  flipped to Yes.

---

# Session Summary — 2026-08-30 (Eva Keerthi, QA)

Repo: quantarra-qa-automation
Working tree: C:\Users\keert\Desktop\Testing\quantarra-qa-automation\Automation
Branch: main (NOT committed — changes in working tree only)

## What was done today

### Scripted new Excel test cases: Scenario 3 (TG-3) additions + expanded Scenario 7 (TG-7)
Source of truth: tests/New_Testcase.xlsx → "Regression" sheet. Specs are Excel-driven via
shouldRun('TG-X','Scenario X','TC-N') (RUN_MODE=regression reads "Run for Full regression",
RUN_MODE=shakeout reads "Run Shakeout in Prod and POC"). All TG-7 rows are Shakeout=No → regression-only.

**Scenario 3 / TG-3** — added 3 tests to tests/daily-shakeout/02-tg2-tg3-tg4-navigation.spec.ts:
- TC-1: contributor role shown. NOTE: Excel identifier was xpath //*[@id="radix-«r1q»"]/p — that
  Radix id is generated per-render and is NOT stable; asserted on visible "Contributor" text instead.
- TC-6: "Create new"/Add Audit button NOT visible for contributor.
- TC-7: all audit tiles are the default framework (SOC 2 Type 2).
- (TC-2/3/4/5 already existed in that file.)

**Scenario 7 / TG-7** — REWROTE tests/daily-shakeout/07-tg7-workspace-filters.spec.ts for the new
"Audit Workspace & Internal Auditor - Filter per sub-tab" (TC-1..TC-17 + added negative TC-9b).
The old Scenario 7 (single All-controls filter) was fully replaced. Two describe blocks:
Audit Workspace (TC-1..9,14..17) and Internal Audit (TC-10..13).

### Result: 20/20 passed on STAGING, 0 skipped (ENV=staging RUN_MODE=regression, headed)
Login happens ONCE per role in auth-setup; all TG-7 tests reuse admin storageState.

## Key UI facts discovered (verified live on stg.quantarra.com, SOC 2 Type 2 audit)
- Workspace Controls filter: button [data-testid="workspace-filter-btn"], badge
  [data-testid="workspace-filter-badge"]; drawer role=dialog title "Filters"; has "Submission status"
  section with "In progress" etc.; "Owner" + "Function" sections shown ONLY on All controls.
  Control rows: #tabpanel-ws a[href*="/control/"]. Empty result renders "No controls match your filters".
- Audit tab labels (getByRole tab): Dashboard | Audit Workspace | **Internal Audit** | Documents | Action Plans.
  It is "Internal Audit", NOT "Internal Auditor" — an earlier /internal auditor/i selector caused
  TC-10..13 to skip. Internal Audit tab IS visible under the admin (Super User) login — no separate
  IA user needed to reach it.
- Internal Audit sub-tabs: "Ready for review (N)", "Needs updates (N)", "Accepted (N)",
  "Sent for final review (N)", "Findings (N)". On the test audit all are (0).
- **Internal Audit filter is a DIFFERENT UI** from the workspace: button has NO testid, uses
  aria-label="Open filters"; drawer headings are Owner / Function / Trust Services Criterion /
  Last updated — there is NO "Submission status" here (sub-tabs are the status grouping). Owner
  options are checkboxes (11 on test audit) with a "Search owners…" input above them; footer is
  "Clear all" / "Apply filter" / "Close".

## Lessons / gotchas (important for future filter tests)
- Don't hard-code a submission status that may be empty. TC-9 was skipping ("no In progress controls");
  made it DATA-ADAPTIVE via applyFirstStatusWithResults() which picks the first status with rows
  (used "Not started", 172 controls). The persistence requirement now always runs.
- Empty-filter result is a valid NEGATIVE case → added TC-9b: force an empty status ("Accepted"),
  assert badge=1 + zero rows + "No controls match your filters" empty state + NO crash. Do NOT use a
  bare /error/i matcher — it false-positives on page chrome (console-error dot / "0 errors"). Scope to
  #tabpanel-ws and match specific phrases (something went wrong|failed to load|http 5xx).
- Filter persistence after opening a control: use the in-app "Back" link, NOT page.goBack() — browser
  history unwinds past the workspace to the Home audits list (observed), losing the tab/filter state.
- IA sub-tabs are empty on the test audit, so IA badge assertions are count-tolerant (compare counts
  before/after) rather than asserting a specific "1".

## Files changed (working tree, uncommitted)
- M tests/daily-shakeout/02-tg2-tg3-tg4-navigation.spec.ts  (TG-3 TC-1/TC-6/TC-7)
- M tests/daily-shakeout/07-tg7-workspace-filters.spec.ts   (full Scenario 7 rewrite, 18 tests)

## Not done / next
- TG-7 is regression-only (Shakeout=No). When the per-sub-tab filter feature ships to Prod, flip
  "Run Shakeout in Prod and POC" = Yes for TG-7 and run against Prod.
- Nothing committed. Awaiting user's "commit"/"PR" before staging files.
- Pre-existing typecheck errors remain (NOT ours): 03-tg6-audit-lifecycle.spec.ts, 06-api-endpoints.spec.ts,
  e2e-02-assign-control.spec.ts. Left untouched.

---

# Session Summary — 2026-08-24 (Eva Keerthi, QA)

Repo: quantarra-qa-automation (origin: keerthi-netizen/Quantarra_testing)
Working tree: C:\Users\keert\Desktop\Testing\quantarra-qa-automation
Branch: main (up to date)

## What was done today

### 1. Fixed Daily Shakeout Prod failure — TG-3 Contributor Navigation (MERGED, PR #2, commit 3e05dcf)
- Symptom: "Daily Shakeout #32" Prod failed on "TG-3: Contributor Navigation — Restricted Access"
  with `expect(locator('aside, nav').first()).toBeVisible()` → element(s) not found.
- Root cause: automated contributor login in `loginAndSave` (tests/daily-shakeout/session-setup.ts)
  waited on `page.waitForLoadState('networkidle')`, which never settles on Prod (analytics/websocket/
  AI-context traffic). Login threw → wrote an EMPTY session `{cookies:[],origins:[]}` → TG-3 ran
  unauthenticated → redirected to /login (no aside/nav) → assertion failed.
  Manual login with the Prod contributor (sales1@keystoneeng.in) worked fine — confirmed it's not the credential.
- Fix (tests/daily-shakeout/session-setup.ts): dropped networkidle waits; wait for login form input,
  confirm success via POST /auth/login response, fail loudly on non-OK, and verify saved session has
  cookies/localStorage (throw on empty).
- Decision (user): did NOT add a graceful TG-3 skip — TG-3 must stay a hard RBAC validation.
- Verified in CI: dispatched daily-shakeout.yml on the fix branch (run 32664057228, ENV=prod):
  contributor session saved OK, TG-3 checks passed, whole suite 52 passed.

### 2. Built TG-7 regression spec — Audit Workspace Filters (MERGED, PR #3, commit ed45911)
- New file: Automation/tests/daily-shakeout/07-tg7-workspace-filters.spec.ts (picked from Regression
  tab of Automation/tests/New_Testcase.xlsx — Scenario 7, TC-1..TC-14).
- Covers: navigate to Workspace→Controls→All controls; open filter Sheet; select "In progress"
  submission status; Apply; slide bar closes; count badge "1"; filter persists after opening a control
  and navigating back; Clear all + Apply removes filter/badge; All controls repopulates.
- UI selectors (apps/web, verified against source):
  - Filter trigger: [data-testid="workspace-filter-btn"] (Controls sub-tab only)
  - Count badge: [data-testid="workspace-filter-badge"]
  - Filter Sheet (Radix Sheet, role=dialog): title "Filters"; legend "Submission status";
    status option label "In progress"; footer buttons "Clear all" + "Apply filter"
  - Control rows: `#tabpanel-ws a[href*="/control/"]`
- Excel-driven via shouldRun('TG-7','Scenario 7','TC-N'). RUN_MODE=shakeout reads
  "Run Shakeout in Prod and POC"; RUN_MODE=regression reads "Run for Full regression".
- User set "Run Shakeout in Prod and POC" = No for TG-7 (filter feature NOT yet deployed to Prod),
  so TG-7 is regression-only for now. Flip to Yes once the feature is live on Prod.
- Verified: 9 passed against STAGING (ENV=staging RUN_MODE=regression). Prod run was requested then
  cancelled (feature not on Prod yet — would fail), so we kept it regression-only.

## Environment notes / gotchas
- OS: Windows / PowerShell — use `;` not `&&` in shell commands.
- Jira token lives in Automation/.env (JIRA_API_TOKEN), NOT in shell env or environments.json.
  Jira REST base: https://quantarra.atlassian.net/rest/api/3, email keerthi@quantarra.io.
- Env resolution: ENV=dev|staging|poc|prod (default dev). Prod contributor=sales1@keystoneeng.in,
  Prod admin=keerthi@quantarra.io (Super User). Creds in Automation/config/environments.json.
- Pre-existing typecheck errors (NOT ours, do not touch unless asked): 03-tg6-audit-lifecycle.spec.ts
  (page:any x2), 06-api-endpoints.spec.ts (Authorization header type), e2e-02-assign-control.spec.ts (page:any x2).
- CI workflow: .github/workflows/daily-shakeout.yml (workflow_dispatch input environment=poc|prod|both).
  Runs project=daily-shakeout, RUN_MODE defaults to shakeout.

## Also produced (not committed — informational)
- Manual UI test cases for Jira PRJAT-1179 (IA/EA control owner assignment + auditor staff visibility).
  Real UI labels: client owner column = "Owner"; IA/EA owner column = "Assigned auditor" (both apps/web
  Internal Audit tab and apps/audit Audit tab). testids: auditor-assign-{id}, auditor-dropdown-{id},
  ia-assigned-auditor-{id}. External-firm reassign shows a ConfirmDialog. PRJAT-1179 status: In Review.

## Uncommitted / untracked in working tree (left alone intentionally)
- M Automation/.gitignore
- ?? Automation/scripts/add-config-sheet.ts, debug-controls-tab.ts
- ?? Q_test, project-atlas/  (project-atlas is a local copy of the product repo used for reading source)

## Next steps / TODO for tomorrow
- When workspace-filter feature deploys to Prod: set TG-7 "Run Shakeout in Prod and POC" = Yes and
  run TG-7 against Prod to confirm.
- Optional: script the must-pass PRJAT-1179 UI cases (picker gating, external-reassign confirm dialog,
  staff-only visibility) as Playwright specs if requested.
- Optional cleanup: fix the pre-existing typecheck errors in 03-tg6 / 06-api-endpoints / e2e-02 (separate small PR).
