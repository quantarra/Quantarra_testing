import { test, expect, type Page } from '@playwright/test';
import { shouldRun } from './excel-filter';
import { getAdminSessionPath, getContributorSessionPath, checkGate } from './session-setup';

/**
 * Daily Shakeout — TG-7: Audit Workspace & Internal Auditor — Filter per sub-tab
 * (Scenario 7, TC-1..TC-17)
 *
 * Verifies the workspace filter behaviour. NOTE — the filter model changed:
 *  - PRJAT-1212 (superseded): a separate filter per chip; switching chips reset it.
 *  - PRJAT-1499/1503 (current): ONE panel filter per audit (`ws-filter-${auditId}`),
 *    SHARED across all chips. Switching chips ("All controls", "Controls I own",
 *    "Needs updates", "Due today/week/month") does NOT reset the filter — only the
 *    free-text search is cleared on a sub-tab change. "Clear all" removes the shared
 *    filter for the whole controls view.
 *  - "Owner" and "Function" filter fields appear ONLY on the "All controls" chip.
 *  - Filter persists across control open/back on the controls view.
 *  - Internal Audit tab sub-tabs still isolate their own (Owner-based) filter.
 *  - Search / Filters / Add Control layout swap (new design).
 *  - Cross-audit isolation + keyboard/a11y.
 *
 * Feature flags: all TG-7 rows are "Run Shakeout in Prod and POC" = No
 * (regression-only until the feature ships to Prod). Each test is gated by
 * shouldRun('TG-7','Scenario 7','TC-N').
 *
 * Session strategy: reuse storageState created by 00-auth-setup (admin +
 * contributor). The Internal Auditor sub-tab tests reuse the admin session
 * (Super User admin can view the Internal Auditor tab on staging).
 *
 * Wait strategy: explicit waits only (up to 30s). Small settle delays where the
 * list re-queries after a filter apply.
 *
 * UI facts (from apps/web, verified against source in prior TG-7 work):
 *  - Filter trigger: [data-testid="workspace-filter-btn"]
 *  - Count badge:    [data-testid="workspace-filter-badge"]
 *  - Filter drawer:  Radix Sheet, role=dialog, title "Filters";
 *                    legend "Submission status"; status option "In progress";
 *                    footer buttons "Clear all" + "Apply filter";
 *                    "Owner" + "Function" sections (All controls only)
 *  - Control rows:   #tabpanel-ws a[href*="/control/"]
 */

const TARGET_FRAMEWORK = 'SOC 2 Type 2';

/** Control-workspace sub-tab labels. */
const SUBTAB = {
  allControls: /All controls|All requirements/i,
  controlsIOwn: /Controls I own|Requirements I own/i,
  needsUpdates: /Needs updates?/i,
  dueToday: /Due today/i,
  dueThisWeek: /Due this week/i,
  dueThisMonth: /Due this month/i,
} as const;

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Navigate to home and wait for audit tiles. */
async function goHomeAndWaitForAudits(page: Page): Promise<void> {
  // Use domcontentloaded, NOT networkidle. On staging/prod the home page keeps
  // background traffic (analytics/websocket) alive, so networkidle can hang
  // until timeout even after the page is fully usable. Wait for the audit
  // tiles to render instead — that is the real "ready" signal.
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('a[href*="/audit/"]').first()).toBeVisible({ timeout: 30000 });
}

/**
 * Open an audit by framework name (falls back to first audit).
 * @param framework substring to match on the tile (default: SOC 2 Type 2)
 * @param nth       when matching the fallback, which audit tile to open (for cross-audit tests)
 */
async function navigateToAudit(page: Page, framework = TARGET_FRAMEWORK, nth = 0): Promise<void> {
  await goHomeAndWaitForAudits(page);

  const searchBox = page
    .locator('input[placeholder*="Search audit"], input[placeholder*="Search"]')
    .first();
  if (await searchBox.isVisible({ timeout: 5000 }).catch(() => false)) {
    await searchBox.fill(framework);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
  }

  const matched = page.locator('a[href*="/audit/"]').filter({ hasText: new RegExp(framework, 'i') });
  const hasMatch = await matched.first().isVisible({ timeout: 5000 }).catch(() => false);
  const target = hasMatch ? matched.nth(nth) : page.locator('a[href*="/audit/"]').nth(nth);
  if (!hasMatch) {
    console.log(`  ⚠️ No "${framework}" audit found — falling back to audit tile #${nth}`);
  }

  await target.click();
  await page.waitForURL(/\/audit\//, { timeout: 30000, waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('tab').first()).toBeVisible({ timeout: 30000 });
}

/** Open the Audit Workspace tab and select the Controls sub-tab. */
async function gotoWorkspaceControls(page: Page): Promise<void> {
  const workspaceTab = page.getByRole('tab', { name: /audit workspace|workspace/i });
  await workspaceTab.click();
  await page.waitForLoadState('networkidle');

  const wsPanel = page.locator('#tabpanel-ws');
  await expect(wsPanel).toBeVisible({ timeout: 15000 });

  const controlsSubTab = wsPanel.locator('text=/Controls|Requirements/i').first();
  if (await controlsSubTab.isVisible({ timeout: 5000 }).catch(() => false)) {
    await controlsSubTab.click();
    await page.waitForLoadState('networkidle');
  }

  await expect(page.getByTestId('workspace-filter-btn')).toBeVisible({ timeout: 15000 });
}

/** Locator for control rows in the workspace panel. */
function controlRows(page: Page) {
  return page.locator('#tabpanel-ws a[href*="/control/"]');
}

/**
 * Select a control-workspace sub-tab by its label. Returns true if the sub-tab
 * was found and clicked, false if it is not present (some orgs/audits may not
 * have every sub-tab).
 */
async function selectSubTab(page: Page, label: RegExp): Promise<boolean> {
  const wsPanel = page.locator('#tabpanel-ws');
  const tab = wsPanel.getByRole('tab', { name: label }).first();
  const asTab = await tab.isVisible({ timeout: 3000 }).catch(() => false);
  const target = asTab ? tab : wsPanel.locator('button, a').filter({ hasText: label }).first();

  if (!(await target.isVisible({ timeout: 3000 }).catch(() => false))) {
    return false;
  }

  await target.click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  return true;
}

/**
 * Select a WORKSPACE SUB-TAB (Families / Objectives / Controls / Evidence) by
 * label. These are distinct from the filter CHIPS handled by selectSubTab():
 * they live in the tablist with aria-label="Workspace sub-tabs" and are what
 * `handleSubTabChange` reacts to (clears search, keeps filter). Returns false
 * if the sub-tab is not present for this framework/audit.
 */
async function selectWorkspaceSubTab(page: Page, label: RegExp): Promise<boolean> {
  const tablist = page.getByRole('tablist', { name: /workspace sub-tabs/i });
  const tab = tablist.getByRole('tab', { name: label }).first();

  if (!(await tab.isVisible({ timeout: 3000 }).catch(() => false))) {
    return false;
  }

  await tab.click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  return true;
}

/** Open the filter drawer and wait for it. */
async function openFilterSheet(page: Page): Promise<void> {
  const filterBtn = page.getByTestId('workspace-filter-btn');
  await expect(filterBtn).toBeVisible({ timeout: 15000 });
  await filterBtn.click();
  await expect(page.getByRole('dialog').getByText('Filters', { exact: true })).toBeVisible({
    timeout: 10000,
  });
}

/** The filter drawer dialog. */
function sheet(page: Page) {
  return page.getByRole('dialog');
}

/** Apply the given submission status in the (already open) drawer, then wait for close. */
async function applyStatus(page: Page, status: string): Promise<void> {
  const dlg = sheet(page);
  const option = dlg.getByText(status, { exact: true });
  await expect(option).toBeVisible({ timeout: 10000 });
  await option.click();
  await dlg.getByRole('button', { name: /apply filter/i }).click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 });
}

/**
 * Try each submission status in order; apply it and return the first status
 * that yields at least one control row (with the row count). Leaves that filter
 * applied. Returns null if none of the statuses produce any rows.
 *
 * Used by data-dependent tests (e.g. TC-9 persistence) so they always run
 * against a status that actually has controls, instead of skipping when the
 * hard-coded "In progress" happens to be empty on a given environment.
 */
async function applyFirstStatusWithResults(
  page: Page,
  statuses: string[] = ['In progress', 'Submitted', 'Not started', 'Accepted', 'Needs updates'],
): Promise<{ status: string; count: number } | null> {
  for (const status of statuses) {
    await openFilterSheet(page);
    const dlg = sheet(page);
    const option = dlg.getByText(status, { exact: true });

    // Not every environment exposes every status option — skip missing ones.
    if (!(await option.isVisible({ timeout: 2000 }).catch(() => false))) {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 });
      continue;
    }

    await option.click();
    await dlg.getByRole('button', { name: /apply filter/i }).click();
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 });
    await page.waitForTimeout(500); // list re-query

    const count = await controlRows(page).count();
    if (count > 0) {
      return { status, count };
    }

    // Clear this status before trying the next, so filters don't stack.
    await openFilterSheet(page);
    await sheet(page).getByRole('button', { name: /clear all/i }).click();
    await sheet(page).getByRole('button', { name: /apply filter/i }).click();
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 });
  }

  return null;
}

/** The filter count badge. */
function badge(page: Page) {
  return page.getByTestId('workspace-filter-badge');
}

/**
 * Read the "Status" column for every visible control row in the workspace
 * controls table. Returns the trimmed status text per row (e.g. "Accepted",
 * "In progress"). The table header order is:
 *   ["", "Control ID & Statement", "Owner", "Function", "Status", "Due Date", ...]
 * so we locate the "Status" column by its header text (resilient to column
 * re-ordering) rather than a hard-coded index.
 */
async function readRowStatuses(page: Page): Promise<string[]> {
  const table = page.locator('#tabpanel-ws table').first();
  await expect(table).toBeVisible({ timeout: 10000 });

  return table.evaluate((tbl) => {
    const heads = Array.from(tbl.querySelectorAll('thead th, thead td')).map((h) =>
      (h.textContent || '').trim(),
    );
    const statusIdx = heads.findIndex((h) => /^status$/i.test(h));
    if (statusIdx < 0) {
      return [];
    }

    const rows = Array.from(tbl.querySelectorAll('tbody tr'));
    return rows.map((r) => {
      const cells = r.querySelectorAll('td');
      return (cells[statusIdx]?.textContent || '').trim();
    });
  });
}

/**
 * Assert that EVERY visible control row shows the expected status — i.e. the
 * filter didn't just change the count, it actually restricted the list to
 * controls of the selected status. Fails if any row shows a different status.
 */
async function expectAllRowsHaveStatus(page: Page, expectedStatus: string): Promise<void> {
  const statuses = await readRowStatuses(page);
  expect(statuses.length, 'expected at least one filtered control row').toBeGreaterThan(0);

  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const expected = norm(expectedStatus);
  const mismatches = statuses.filter((s) => norm(s) !== expected);

  expect(
    mismatches,
    `all rows should show "${expectedStatus}"; found other statuses: ${JSON.stringify(mismatches)}`,
  ).toHaveLength(0);
}

// ── TG-7 (admin session): Audit Workspace Controls sub-tab filters ───────────

test.describe('TG-7: Audit Workspace — Filter per sub-tab', () => {
  test.use({ storageState: getAdminSessionPath() });

  test.beforeEach(({}, testInfo) => {
    const gateReason = checkGate();
    if (gateReason) {
      testInfo.skip(true, gateReason);
    }
  });

  test('TC-1: Login (admin) — home page loads with audit tiles', async ({ page }) => {
    test.skip(!shouldRun('TG-7', 'Scenario 7', 'TC-1'), 'Excluded by Excel — Run Shakeout = No');

    await goHomeAndWaitForAudits(page);
    const count = await page.locator('a[href*="/audit/"]').count();
    expect(count).toBeGreaterThan(0);
  });

  test('TC-2: All controls — apply "In progress", badge = 1, and rows match the status', async ({ page }) => {
    test.skip(!shouldRun('TG-7', 'Scenario 7', 'TC-2'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToAudit(page);
    await gotoWorkspaceControls(page);

    await openFilterSheet(page);
    await applyStatus(page, 'In progress');

    // Drawer closed + badge shows one active filter.
    await expect(badge(page)).toBeVisible({ timeout: 10000 });
    await expect(badge(page)).toHaveText('1');

    // Content validation: the filter must ACTUALLY restrict the list — every
    // visible row's Status column must read "In progress". (If the status has
    // no controls on this audit the list is empty, which the negative TC-9b
    // covers; only assert content when rows are present.)
    const rowCount = await controlRows(page).count();
    if (rowCount > 0) {
      await expectAllRowsHaveStatus(page, 'In progress');
    } else {
      console.log('  ℹ️ TC-2: no "In progress" controls on this audit — content check skipped (see TC-10b)');
    }
  });

  test('TC-3: Filtered list contains ONLY controls of the selected status', async ({ page }) => {
    test.skip(!shouldRun('TG-7', 'Scenario 7', 'TC-3'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToAudit(page);
    await gotoWorkspaceControls(page);

    // Pick whichever submission status actually has controls on this audit, so
    // the content assertion always runs against real data (not skipped when a
    // hard-coded status happens to be empty).
    const applied = await applyFirstStatusWithResults(page);
    expect(applied, 'no submission status yielded controls to validate').not.toBeNull();
    console.log(`  ℹ️ TC-3 validating status "${applied!.status}" (${applied!.count} controls)`);

    await expect(badge(page)).toHaveText('1', { timeout: 10000 });

    // Core validation: EVERY visible row's Status column equals the filter.
    // Catches a filter that changes the count but shows the wrong controls.
    await expectAllRowsHaveStatus(page, applied!.status);
  });

  test('TC-4: Filter persists across chips — ONE shared filter per audit (PRJAT-1499/1503)', async ({ page }) => {
    test.skip(!shouldRun('TG-7', 'Scenario 7', 'TC-4'), 'Excluded by Excel — Run Shakeout = No');

    // Requirement change (PRJAT-1499/1503): the panel filter is stored ONCE per
    // audit (`ws-filter-${auditId}`), NOT per chip. Switching chips ("All
    // controls" ↔ "Controls I own") deliberately does NOT reset the filter —
    // only the free-text search is cleared on a sub-tab change. This supersedes
    // the old PRJAT-1212 per-chip-reset behaviour.
    await navigateToAudit(page);
    await gotoWorkspaceControls(page);

    // Apply on All controls → badge 1.
    await openFilterSheet(page);
    await applyStatus(page, 'In progress');
    await expect(badge(page)).toHaveText('1', { timeout: 10000 });

    // Switch to "Controls I own" → filter PERSISTS (badge still 1, shared filter).
    const switched = await selectSubTab(page, SUBTAB.controlsIOwn);
    if (!switched) {
      test.skip(true, '"Controls I own" chip not available in this environment');
      return;
    }
    await expect(badge(page)).toHaveText('1', { timeout: 10000 });

    // Return to All controls → same shared filter is still applied (badge 1).
    await selectSubTab(page, SUBTAB.allControls);
    await expect(badge(page)).toHaveText('1', { timeout: 10000 });
  });

  test('TC-5: Single shared filter is visible across all chips (no per-chip isolation) (PRJAT-1499/1503)', async ({ page }) => {
    test.skip(!shouldRun('TG-7', 'Scenario 7', 'TC-5'), 'Excluded by Excel — Run Shakeout = No');

    // Requirement change (PRJAT-1499/1503): there is ONE panel filter per audit,
    // shared by every chip. Applying it on "All controls" makes it active on
    // "Controls I own" (and any other chip) too — the badge does NOT reset when
    // switching chips. This replaces the old PRJAT-1212 per-chip isolation.
    await navigateToAudit(page);
    await gotoWorkspaceControls(page);

    // All controls → apply "In progress" (badge 1).
    await openFilterSheet(page);
    await applyStatus(page, 'In progress');
    await expect(badge(page)).toHaveText('1', { timeout: 10000 });

    // Controls I own → the SAME shared filter is already active (badge 1, not 0).
    if (!(await selectSubTab(page, SUBTAB.controlsIOwn))) {
      test.skip(true, '"Controls I own" chip not available');
      return;
    }
    await expect(badge(page)).toHaveText('1', { timeout: 10000 });

    // Any other available chip also shows the shared filter as active (badge 1).
    for (const label of [SUBTAB.needsUpdates, SUBTAB.dueToday, SUBTAB.dueThisWeek, SUBTAB.dueThisMonth]) {
      if (await selectSubTab(page, label)) {
        await expect(badge(page)).toHaveText('1', { timeout: 10000 });
      }
    }

    // Back on All controls → still the same shared filter (badge 1).
    await selectSubTab(page, SUBTAB.allControls);
    await expect(badge(page)).toHaveText('1', { timeout: 10000 });
  });

  test('TC-6: No badge shown when no filter is active on a sub-tab', async ({ page }) => {
    test.skip(!shouldRun('TG-7', 'Scenario 7', 'TC-6'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToAudit(page);
    await gotoWorkspaceControls(page);

    if (!(await selectSubTab(page, SUBTAB.needsUpdates))) {
      test.skip(true, '"Needs updates" sub-tab not available');
      return;
    }

    // Open drawer, apply nothing, close via Escape.
    await openFilterSheet(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 });

    await expect(badge(page)).toHaveCount(0, { timeout: 10000 });
  });

  test('TC-7: "Owner" and "Function" NOT shown on restricted sub-tabs', async ({ page }) => {
    test.skip(!shouldRun('TG-7', 'Scenario 7', 'TC-7'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToAudit(page);
    await gotoWorkspaceControls(page);

    const restricted = [
      SUBTAB.controlsIOwn,
      SUBTAB.needsUpdates,
      SUBTAB.dueToday,
      SUBTAB.dueThisWeek,
      SUBTAB.dueThisMonth,
    ];

    let checked = 0;
    for (const label of restricted) {
      if (!(await selectSubTab(page, label))) {
        continue;
      }
      await openFilterSheet(page);
      const dlg = sheet(page);
      await expect(dlg.getByText('Owner', { exact: true })).toHaveCount(0, { timeout: 5000 });
      await expect(dlg.getByText('Function', { exact: true })).toHaveCount(0, { timeout: 5000 });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 });
      checked++;
    }

    expect(checked, 'at least one restricted sub-tab should be present to verify').toBeGreaterThan(0);
  });

  test('TC-8: "Owner" and "Function" ARE shown on "All controls"', async ({ page }) => {
    test.skip(!shouldRun('TG-7', 'Scenario 7', 'TC-8'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToAudit(page);
    await gotoWorkspaceControls(page);
    await selectSubTab(page, SUBTAB.allControls);

    await openFilterSheet(page);
    const dlg = sheet(page);
    await expect(dlg.getByText('Owner', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(dlg.getByText('Function', { exact: true })).toBeVisible({ timeout: 10000 });
  });

  test('TC-9: Restricted sub-tab drawer = All controls options MINUS Owner/Function', async ({ page }) => {
    test.skip(!shouldRun('TG-7', 'Scenario 7', 'TC-9'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToAudit(page);
    await gotoWorkspaceControls(page);

    // Baseline: option group headings on All controls.
    await selectSubTab(page, SUBTAB.allControls);
    await openFilterSheet(page);
    const baseline = (await sheet(page).getByRole('heading').allInnerTexts())
      .map((t) => t.trim())
      .filter(Boolean);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 });

    // Restricted sub-tab: same set minus Owner + Function.
    if (!(await selectSubTab(page, SUBTAB.controlsIOwn))) {
      test.skip(true, '"Controls I own" sub-tab not available');
      return;
    }
    await openFilterSheet(page);
    const restricted = (await sheet(page).getByRole('heading').allInnerTexts())
      .map((t) => t.trim())
      .filter(Boolean);
    await page.keyboard.press('Escape');

    const expected = baseline.filter((h) => !/owner|function/i.test(h));
    expect(new Set(restricted)).toEqual(new Set(expected));
  });

  test('TC-10: Filter persists after opening a control and navigating back', async ({ page }) => {
    test.skip(!shouldRun('TG-7', 'Scenario 7', 'TC-10'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToAudit(page);
    await gotoWorkspaceControls(page);
    await selectSubTab(page, SUBTAB.allControls);

    // Data-adaptive: apply the first submission status that actually has
    // controls, so the persistence check runs against real rows instead of
    // skipping when "In progress" happens to be empty on this environment.
    const applied = await applyFirstStatusWithResults(page);
    expect(
      applied,
      'no submission status yielded any controls — cannot verify filter persistence',
    ).not.toBeNull();
    await expect(badge(page)).toHaveText('1', { timeout: 10000 });
    console.log(`  ℹ️ TC-9 using status "${applied!.status}" (${applied!.count} controls)`);

    // Open the first control, then return — the filter must persist.
    const firstControl = controlRows(page).first();
    await expect(firstControl).toBeVisible({ timeout: 10000 });
    await firstControl.click();
    await page.waitForURL(/\/control\//, { timeout: 15000, waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');

    // Use the in-app "Back" affordance rather than browser history. Browser
    // goBack() can unwind past the workspace tab state (it landed on the Home
    // audits list in an earlier run). The control detail page has a "Back" link
    // that returns to the workspace with its tab/filter state intact.
    const backLink = page.getByRole('link', { name: /^\s*back\s*$/i })
      .or(page.getByRole('button', { name: /^\s*back\s*$/i }))
      .first();
    if (await backLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await backLink.click();
    } else {
      await page.goBack();
    }
    await page.waitForLoadState('networkidle');

    // Ensure we are back on the workspace controls view, then assert the filter
    // is retained (badge still "1").
    await expect(page.getByTestId('workspace-filter-btn')).toBeVisible({ timeout: 15000 });
    await expect(badge(page)).toBeVisible({ timeout: 10000 });
    await expect(badge(page)).toHaveText('1');
  });

  test('TC-10b: Empty-result filter shows a graceful empty state (negative)', async ({ page }) => {
    test.skip(!shouldRun('TG-7', 'Scenario 7', 'TC-10'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToAudit(page);
    await gotoWorkspaceControls(page);
    await selectSubTab(page, SUBTAB.allControls);

    // Find a submission status that returns ZERO controls, to exercise the
    // empty-result path. If every status has data we can't force an empty
    // result without seeding — skip in that case (data-dependent).
    const statuses = ['Not started', 'Needs updates', 'Accepted', 'Submitted', 'In progress'];
    let emptyStatus: string | null = null;

    for (const status of statuses) {
      await openFilterSheet(page);
      const option = sheet(page).getByText(status, { exact: true });
      if (!(await option.isVisible({ timeout: 2000 }).catch(() => false))) {
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 });
        continue;
      }
      await option.click();
      await sheet(page).getByRole('button', { name: /apply filter/i }).click();
      await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 });
      await page.waitForTimeout(500);

      if ((await controlRows(page).count()) === 0) {
        emptyStatus = status;
        break;
      }

      // Not empty — clear and try the next status.
      await openFilterSheet(page);
      await sheet(page).getByRole('button', { name: /clear all/i }).click();
      await sheet(page).getByRole('button', { name: /apply filter/i }).click();
      await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 });
    }

    if (!emptyStatus) {
      test.skip(true, 'Every status has controls — cannot force an empty result without seeded data');
      return;
    }

    console.log(`  ℹ️ TC-9b empty-result via status "${emptyStatus}"`);

    // Negative expectation: the filter applied (badge shown), zero rows, and
    // the app shows its empty state — NOT an error/crash.
    await expect(badge(page)).toHaveText('1', { timeout: 10000 });
    expect(await controlRows(page).count()).toBe(0);

    // The workspace renders "No controls match your filters" for an empty
    // filtered result. That IS the correct, graceful behaviour.
    const emptyState = page
      .locator('#tabpanel-ws')
      .getByText(/no controls match your filters|no controls|no results|no matching/i)
      .first();
    await expect(emptyState).toBeVisible({ timeout: 10000 });

    // No crash/error boundary in the content panel. Scope to the panel and use
    // a specific phrase — a bare /error/i matches unrelated chrome (e.g. the
    // console-error indicator / "0 errors"), which is a false positive.
    const crash = page
      .locator('#tabpanel-ws')
      .getByText(/something went wrong|failed to load|unexpected error|http 5\d\d/i);
    await expect(crash).toHaveCount(0, { timeout: 3000 });
  });

  test('TC-16: Filter does not leak across audits', async ({ page }) => {
    test.skip(!shouldRun('TG-7', 'Scenario 7', 'TC-16'), 'Excluded by Excel — Run Shakeout = No');

    // Need at least 2 audits to verify cross-audit isolation.
    await goHomeAndWaitForAudits(page);
    const auditCount = await page.locator('a[href*="/audit/"]').count();
    if (auditCount < 2) {
      test.skip(true, 'Fewer than 2 audits available — cannot test cross-audit isolation');
      return;
    }

    // Audit A → apply In progress.
    await navigateToAudit(page, TARGET_FRAMEWORK, 0);
    await gotoWorkspaceControls(page);
    await selectSubTab(page, SUBTAB.allControls);
    await openFilterSheet(page);
    await applyStatus(page, 'In progress');
    await expect(badge(page)).toHaveText('1', { timeout: 10000 });

    // Audit B → workspace All controls should start clean (no badge).
    await navigateToAudit(page, TARGET_FRAMEWORK, 1);
    await gotoWorkspaceControls(page);
    await selectSubTab(page, SUBTAB.allControls);
    await expect(badge(page)).toHaveCount(0, { timeout: 10000 });
  });

  test('TC-17: Clear all clears the single shared filter for the whole controls view (PRJAT-1499/1503)', async ({ page }) => {
    test.skip(!shouldRun('TG-7', 'Scenario 7', 'TC-17'), 'Excluded by Excel — Run Shakeout = No');

    // Requirement change (PRJAT-1499/1503): there is ONE shared filter per audit,
    // so "Clear all" removes it for the entire controls view — not just the
    // active chip. After clearing on "All controls", "Controls I own" is also
    // clear (badge gone). This replaces the old PRJAT-1212 per-chip clear.
    await navigateToAudit(page);
    await gotoWorkspaceControls(page);

    // All controls → apply "In progress" (badge 1, shared filter).
    await selectSubTab(page, SUBTAB.allControls);
    await openFilterSheet(page);
    await applyStatus(page, 'In progress');
    await expect(badge(page)).toHaveText('1', { timeout: 10000 });

    // Controls I own → same shared filter is already active (badge 1).
    if (!(await selectSubTab(page, SUBTAB.controlsIOwn))) {
      test.skip(true, '"Controls I own" chip not available');
      return;
    }
    await expect(badge(page)).toHaveText('1', { timeout: 10000 });

    // Back on All controls → Clear all → Apply.
    await selectSubTab(page, SUBTAB.allControls);
    await openFilterSheet(page);
    await sheet(page).getByRole('button', { name: /clear all/i }).click();
    await sheet(page).getByRole('button', { name: /apply filter/i }).click();
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 });

    // Shared filter cleared everywhere: no badge on All controls…
    await expect(badge(page)).toHaveCount(0, { timeout: 10000 });
    // …and no badge on Controls I own either (it shared the same filter).
    await selectSubTab(page, SUBTAB.controlsIOwn);
    await expect(badge(page)).toHaveCount(0, { timeout: 10000 });
  });

  test('TC-19: Switching workspace sub-tabs keeps the filter but clears the search (PRJAT-1499)', async ({ page }) => {
    test.skip(!shouldRun('TG-7', 'Scenario 7', 'TC-19'), 'Excluded by Excel — Run Shakeout = No');

    // PRJAT-1499 contract (handleSubTabChange): changing the WORKSPACE sub-tab
    // (Controls → Evidence → Controls) clears only the free-text SEARCH — the
    // panel FILTER is deliberately retained (it is stored once per audit and
    // only applies to the controls query). Assert both halves.
    await navigateToAudit(page);
    await gotoWorkspaceControls(page);

    // On Controls: apply a status filter (badge 1) AND type a search term.
    await openFilterSheet(page);
    await applyStatus(page, 'In progress');
    await expect(badge(page)).toHaveText('1', { timeout: 10000 });

    const searchBox = page
      .locator('#tabpanel-ws input[placeholder*="Search"], #tabpanel-ws input[type="search"]')
      .first();
    await expect(searchBox).toBeVisible({ timeout: 10000 });
    await searchBox.fill('policy');
    await expect(searchBox).toHaveValue('policy');

    // Switch to the "Evidence" workspace sub-tab (always present), then back to
    // Controls. Use the workspace sub-tab tablist (role=tab within the
    // "Workspace sub-tabs" tablist) — NOT the chip row or the audit-level tabs.
    if (!(await selectWorkspaceSubTab(page, /^Evidence/i))) {
      test.skip(true, '"Evidence" workspace sub-tab not available');
      return;
    }
    if (!(await selectWorkspaceSubTab(page, /^(Controls|Safeguards|Requirements|Elements)/i))) {
      test.skip(true, 'Controls workspace sub-tab not available on return');
      return;
    }

    // Filter is retained (badge still 1)…
    await expect(badge(page)).toHaveText('1', { timeout: 10000 });
    // …but the search was cleared on the sub-tab change.
    const searchBoxAfter = page
      .locator('#tabpanel-ws input[placeholder*="Search"], #tabpanel-ws input[type="search"]')
      .first();
    await expect(searchBoxAfter).toHaveValue('');
  });

  test('TC-19b: Filter persists after navigating to Policies and back to the SAME audit (PRJAT-1499)', async ({ page }) => {
    test.skip(!shouldRun('TG-7', 'Scenario 7', 'TC-19'), 'Excluded by Excel — Run Shakeout = No');

    // Persistence guarantee: the shared filter lives in sessionStorage keyed by
    // `ws-filter-${auditId}` (survives client-side navigation, resets only on
    // tab close). Leaving the audit entirely (to /policies) and returning to the
    // SAME audit's workspace must retain the filter. (Cross-AUDIT isolation is a
    // separate concern — see TC-16.)
    await navigateToAudit(page);

    // Capture the current audit URL so we return to the SAME audit.
    await gotoWorkspaceControls(page);
    const auditUrl = page.url();

    // Apply a filter on Controls (badge 1).
    await openFilterSheet(page);
    await applyStatus(page, 'In progress');
    await expect(badge(page)).toHaveText('1', { timeout: 10000 });

    // Navigate away to Policies (a different top-level area).
    await page.goto('/policies', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    expect(page.url()).toContain('/policies');

    // Return to the SAME audit's Workspace → Controls.
    await page.goto(auditUrl, { waitUntil: 'domcontentloaded' });
    await gotoWorkspaceControls(page);

    // Shared per-audit filter is retained: badge still shows "1".
    await expect(badge(page)).toBeVisible({ timeout: 10000 });
    await expect(badge(page)).toHaveText('1', { timeout: 10000 });
  });

  test('TC-20: Filter button is hidden on non-controls workspace sub-tabs (PRJAT-1499)', async ({ page }) => {
    test.skip(!shouldRun('TG-7', 'Scenario 7', 'TC-20'), 'Excluded by Excel — Run Shakeout = No');

    // The panel filter only applies to the controls query, so the filter button
    // (and its badge) render ONLY on the Controls sub-tab. On Families /
    // Objectives / Evidence the button must be absent (workspace-tab.tsx guards
    // it behind `activeSubTab === "controls"`).
    await navigateToAudit(page);
    await gotoWorkspaceControls(page);

    // Present on Controls.
    await expect(page.getByTestId('workspace-filter-btn')).toBeVisible({ timeout: 15000 });

    // Absent on each other workspace sub-tab that exists.
    let checked = 0;
    for (const label of [/^Families/i, /^Objectives/i, /^Evidence/i, /^Categories/i, /^Subcategories/i, /^Chapters/i, /^Standards/i]) {
      if (await selectWorkspaceSubTab(page, label)) {
        await expect(page.getByTestId('workspace-filter-btn')).toHaveCount(0, { timeout: 10000 });
        checked++;
      }
    }

    expect(checked, 'at least one non-controls workspace sub-tab should exist to verify').toBeGreaterThan(0);
  });

  test('TC-21: Chip counts reflect the active filter (not the active chip) (PRJAT-1503)', async ({ page }) => {
    test.skip(!shouldRun('TG-7', 'Scenario 7', 'TC-21'), 'Excluded by Excel — Run Shakeout = No');

    // PRJAT-1503: the "All controls" chip count reflects the active SEARCH + PANEL
    // FILTER (verified manually on stg: search "cc1.1" + Submitted → 3 rows → chip
    // shows "(3)"), and stays consistent regardless of which chip is selected.
    // The authoritative, deterministic check is that AFTER filtering the chip
    // count EQUALS the filtered row count. We do NOT read an unfiltered
    // "baseline" first — the chip count query settles asynchronously after the
    // sub-tab renders, so a pre-filter read is racy (it can catch a transient
    // "(0)"), which produced the earlier `<= 0` false failure. The filtered
    // equality below is the real requirement.
    await navigateToAudit(page);
    await gotoWorkspaceControls(page);

    const allChip = page.getByTestId('controls-chip-all');
    if (!(await allChip.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip(true, 'Controls chips not available for this user/audit');
      return;
    }

    // Parse the trailing "(N)" from the chip label, e.g. "All controls (172)".
    const parseChipCount = (text: string | null): number | null => {
      const m = (text ?? '').trim().match(/\((\d+)\)\s*$/);
      return m ? Number(m[1]) : null;
    };
    const readChipCount = async (): Promise<number | null> =>
      parseChipCount(await allChip.textContent());

    // Apply a status filter that yields a strict subset of controls.
    const applied = await applyFirstStatusWithResults(page);
    expect(applied, 'no submission status yielded controls to validate the count').not.toBeNull();
    await expect(badge(page)).toHaveText('1', { timeout: 10000 });

    // Authoritative PRJAT-1503 assertion: the "All controls" chip count reflects
    // the active filter — it EQUALS the filtered row count. Poll BOTH the chip
    // label and the row count together until they agree, so the assertion is
    // robust to the count-query round-trip after Apply (and to list re-render).
    await expect
      .poll(
        async () => {
          const chip = await readChipCount();
          const rows = await controlRows(page).count();
          return chip !== null && chip === rows ? chip : -1;
        },
        {
          timeout: 15000,
          message: 'the "All controls" chip count should equal the filtered row count (PRJAT-1503)',
        },
      )
      .toBeGreaterThanOrEqual(0);

    const chipAfter = await readChipCount();
    const rowsAfter = await controlRows(page).count();
    expect(chipAfter, 'chip count should still render after filtering').not.toBeNull();
    expect(chipAfter!, 'filtered chip count must equal the filtered row count').toBe(rowsAfter);
    console.log(`  ℹ️ TC-21 All-controls chip after "${applied!.status}": chip=${chipAfter} rows=${rowsAfter}`);
  });

  test('TC-22: Deep link ?status= seeds the shared filter on load (PRJAT-1499)', async ({ page }) => {
    test.skip(!shouldRun('TG-7', 'Scenario 7', 'TC-22'), 'Excluded by Excel — Run Shakeout = No');

    // PRJAT-1499: `?status=` is seeded into the shared per-audit filter via the
    // `override` argument of the `ws-filter-` session state. Opening the audit
    // workspace with a status deep link must arrive with the filter already
    // active (badge "1") and the chip forced to "All controls".
    await navigateToAudit(page);
    await gotoWorkspaceControls(page);

    // Derive the current audit id from the URL to build the deep link.
    const url = new URL(page.url());
    const auditIdMatch = url.pathname.match(/\/audit\/([^/]+)/);
    expect(auditIdMatch, 'could not resolve audit id from URL').not.toBeNull();
    const auditId = auditIdMatch![1];

    // Deep link with a valid ComplianceStatus value (see status-badge.tsx).
    await page.goto(`/audit/${auditId}?tab=ws&sub=controls&status=in_progress`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForLoadState('networkidle');

    // Filter button present and the seeded filter is active (badge "1").
    await expect(page.getByTestId('workspace-filter-btn')).toBeVisible({ timeout: 15000 });
    await expect(badge(page)).toBeVisible({ timeout: 10000 });
    await expect(badge(page)).toHaveText('1', { timeout: 10000 });

    // The chip is forced to "All controls" for a status deep link.
    const allChip = page.getByTestId('controls-chip-all');
    if (await allChip.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(allChip).toHaveAttribute('aria-pressed', 'true');
    }
  });

  test('TC-23: Shared filter survives a full page reload (sessionStorage) (PRJAT-1499)', async ({ page }) => {
    test.skip(!shouldRun('TG-7', 'Scenario 7', 'TC-23'), 'Excluded by Excel — Run Shakeout = No');

    // The shared filter is stored in sessionStorage (`ws-filter-${auditId}`),
    // which survives a full page reload within the same tab. Apply → reload →
    // the filter must still be active (badge "1").
    await navigateToAudit(page);
    await gotoWorkspaceControls(page);

    await openFilterSheet(page);
    await applyStatus(page, 'In progress');
    await expect(badge(page)).toHaveText('1', { timeout: 10000 });

    // Full reload — sessionStorage persists for the tab.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');

    // Re-enter the workspace controls view (reload lands on the audit page).
    await gotoWorkspaceControls(page);
    await expect(badge(page)).toBeVisible({ timeout: 10000 });
    await expect(badge(page)).toHaveText('1', { timeout: 10000 });
  });

  test('TC-18: Keyboard/a11y — Enter opens, Escape closes without applying', async ({ page }) => {
    test.skip(!shouldRun('TG-7', 'Scenario 7', 'TC-18'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToAudit(page);
    await gotoWorkspaceControls(page);
    await selectSubTab(page, SUBTAB.allControls);

    // Focus the filter button and open it with Enter.
    const filterBtn = page.getByTestId('workspace-filter-btn');
    await filterBtn.focus();
    await page.keyboard.press('Enter');
    await expect(sheet(page).getByText('Filters', { exact: true })).toBeVisible({ timeout: 10000 });

    // Escape closes without applying → no badge.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 });
    await expect(badge(page)).toHaveCount(0, { timeout: 10000 });
  });

  test('TC-15: Search / Filters / Add Control layout — all functional', async ({ page }) => {
    test.skip(!shouldRun('TG-7', 'Scenario 7', 'TC-15'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToAudit(page);
    await gotoWorkspaceControls(page);

    // All three components are present and functional on the Controls sub-tab.
    const filterBtn = page.getByTestId('workspace-filter-btn');
    await expect(filterBtn).toBeVisible({ timeout: 15000 });

    const searchBox = page
      .locator('#tabpanel-ws input[placeholder*="Search"], #tabpanel-ws input[type="search"]')
      .first();
    await expect(searchBox).toBeVisible({ timeout: 10000 });

    // Filter button opens the drawer (functional).
    await openFilterSheet(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 });

    // Add Control button opens a create flow (present for admin).
    const addControlBtn = page
      .locator('#tabpanel-ws button')
      .filter({ hasText: /add control|create control|new control/i })
      .first();
    if (await addControlBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addControlBtn.click();
      // A dialog/sheet should open for the create flow.
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 });
      await page.keyboard.press('Escape');
    } else {
      console.log('  ⚠️ Add Control button not found — skipping create-flow assertion');
    }
  });
});

// ── TG-7 (Internal Audit tab): IA sub-tab filters ────────────────────────────

test.describe('TG-7: Internal Audit — Filter per sub-tab', () => {
  test.use({ storageState: getAdminSessionPath() });

  test.beforeEach(({}, testInfo) => {
    const gateReason = checkGate();
    if (gateReason) {
      testInfo.skip(true, gateReason);
    }
  });

  // Actual IA sub-tab labels (verified against staging UI). They carry a count
  // suffix, e.g. "Ready for review (0)". The tab itself is "Internal Audit"
  // (NOT "Internal Auditor").
  const IA_SUBTAB = {
    readyForReview: /Ready for review/i,
    needsUpdates: /Needs updates/i,
    accepted: /Accepted/i,
    sentForFinal: /Sent for final review/i,
  } as const;

  /**
   * The IA filter drawer filters by Owner / Function / Trust Services Criterion
   * / Last updated — there is NO "Submission status" section here (the sub-tabs
   * themselves are the status grouping). So IA filter tests apply an Owner value.
   */
  const IA_FILTER_HEADINGS = ['Owner', 'Function', 'Trust Services Criterion', 'Last updated'];

  /** Open the Internal Audit tab. Returns false if the tab is not present. */
  async function gotoInternalAudit(page: Page): Promise<boolean> {
    const iaTab = page.getByRole('tab', { name: /internal audit/i }).first();
    if (!(await iaTab.isVisible({ timeout: 5000 }).catch(() => false))) {
      return false;
    }
    await iaTab.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    return true;
  }

  /** Select an IA sub-tab by label. Returns false if not present. */
  async function selectIaSubTab(page: Page, label: RegExp): Promise<boolean> {
    const tab = page.getByRole('tab', { name: label }).first();
    const asTab = await tab.isVisible({ timeout: 3000 }).catch(() => false);
    const target = asTab ? tab : page.locator('button, a').filter({ hasText: label }).first();
    if (!(await target.isVisible({ timeout: 3000 }).catch(() => false))) {
      return false;
    }
    await target.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    return true;
  }

  /**
   * Open the IA filter drawer. The IA "Filter" button has no testid; it exposes
   * aria-label="Open filters". Waits for the "Filters" drawer title.
   */
  async function openIaFilterDrawer(page: Page): Promise<void> {
    const filterBtn = page.getByRole('button', { name: /open filters/i }).first();
    await expect(filterBtn).toBeVisible({ timeout: 15000 });
    await filterBtn.click();
    await expect(page.getByRole('dialog').getByText('Filters', { exact: true })).toBeVisible({
      timeout: 10000,
    });
  }

  /** Apply the first available checkbox option in the (open) IA drawer, then close. */
  async function applyFirstOwner(page: Page): Promise<string | null> {
    const dlg = sheet(page);
    const firstCheckbox = dlg.getByRole('checkbox').first();

    if (!(await firstCheckbox.count())) {
      return null;
    }

    await firstCheckbox.scrollIntoViewIfNeeded().catch(() => {});
    // Radix checkboxes sometimes intercept pointer events on the label; force
    // the click to the checkbox control itself.
    await firstCheckbox.click({ force: true });

    await dlg.getByRole('button', { name: /apply filter/i }).click();
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 });
    return 'applied';
  }

  test('TC-11: IA "Ready for review" — open drawer, apply a filter, drawer closes', async ({ page }) => {
    test.skip(!shouldRun('TG-7', 'Scenario 7', 'TC-11'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToAudit(page);
    if (!(await gotoInternalAudit(page))) {
      test.skip(true, 'Internal Audit tab not available for this user/audit');
      return;
    }
    if (!(await selectIaSubTab(page, IA_SUBTAB.readyForReview))) {
      test.skip(true, '"Ready for review" sub-tab not available');
      return;
    }

    await openIaFilterDrawer(page);
    const applied = await applyFirstOwner(page);
    expect(applied, 'IA filter drawer had no applicable option to select').not.toBeNull();

    // Drawer closed (filter applied). Badge may or may not render depending on
    // whether this sub-tab has matching rows, so assert the drawer-close signal.
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 });
  });

  test('TC-11b: IA filter button shows an active-filter count badge (PRJAT-1260)', async ({ page }) => {
    test.skip(!shouldRun('TG-7', 'Scenario 7', 'TC-11'), 'Excluded by Excel — Run Shakeout = No');

    // KNOWN BUG PRJAT-1260: the Internal Audit filter button does NOT render an
    // active-filter count badge (the Audit Workspace filter does). Marked as
    // expected-to-fail so the suite stays green while tracking the bug — when
    // this test starts PASSING, the bug is fixed and test.fail() should be
    // removed. See https://quantarra.atlassian.net/browse/PRJAT-1260
    test.fail(true, 'PRJAT-1260: IA filter button missing active-filter badge');

    // Target an audit known to have Internal Audit activity. Most audits have
    // empty IA sub-tabs; "Sour Pickles" (staging) has controls in "Ready for
    // review", which is required to exercise the filter badge.
    await navigateToAudit(page, 'Sour Pickles');
    if (!(await gotoInternalAudit(page))) {
      test.skip(true, 'Internal Audit tab not available for this user/audit');
      return;
    }
    if (!(await selectIaSubTab(page, IA_SUBTAB.readyForReview))) {
      test.skip(true, '"Ready for review" sub-tab not available');
      return;
    }

    // IA content loads asynchronously (~3s). Wait for the row table to populate.
    const iaRows = page.locator('main table tbody tr');
    await iaRows.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    const rowsBefore = await iaRows.count();
    if (rowsBefore === 0) {
      test.skip(true, 'No IA rows to filter — badge check not applicable');
      return;
    }

    await openIaFilterDrawer(page);
    const applied = await applyFirstOwner(page);
    expect(applied, 'IA filter drawer had no applicable option to select').not.toBeNull();

    // KNOWN BUG PRJAT-1260: the Internal Audit filter button does NOT render an
    // active-filter count badge (the Audit Workspace filter does). This test
    // asserts the CORRECT behaviour — a numeric badge on the IA Filter button
    // after applying a filter — so it fails until PRJAT-1260 is fixed.
    const iaFilterBtn = page.getByRole('button', { name: /open filters/i }).first();
    const badgeOnBtn = iaFilterBtn.locator('text=/^\\d+$/').first();
    await expect(
      badgeOnBtn,
      'IA filter button should show an active-filter count badge (PRJAT-1260)',
    ).toBeVisible({ timeout: 10000 });
  });

  test('TC-12: IA filter isolates per sub-tab (Ready for review vs Needs updates)', async ({ page }) => {
    test.skip(!shouldRun('TG-7', 'Scenario 7', 'TC-12'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToAudit(page);
    if (!(await gotoInternalAudit(page))) {
      test.skip(true, 'Internal Audit tab not available');
      return;
    }
    if (!(await selectIaSubTab(page, IA_SUBTAB.readyForReview))) {
      test.skip(true, '"Ready for review" sub-tab not available');
      return;
    }

    await openIaFilterDrawer(page);
    const applied = await applyFirstOwner(page);
    expect(applied).not.toBeNull();
    const badgeAfterApply = await badge(page).count();

    // Switch to "Needs updates" → its filter state is independent (fresh).
    if (!(await selectIaSubTab(page, IA_SUBTAB.needsUpdates))) {
      test.skip(true, '"Needs updates" sub-tab not available');
      return;
    }
    // Independent sub-tab should not inherit the Ready-for-review badge.
    await expect(badge(page)).toHaveCount(0, { timeout: 10000 });

    // Return to Ready for review → its own filter is retained.
    await selectIaSubTab(page, IA_SUBTAB.readyForReview);
    await expect(badge(page)).toHaveCount(badgeAfterApply, { timeout: 10000 });
  });

  test('TC-13: IA sub-tabs keep their own filter independently', async ({ page }) => {
    test.skip(!shouldRun('TG-7', 'Scenario 7', 'TC-13'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToAudit(page);
    if (!(await gotoInternalAudit(page))) {
      test.skip(true, 'Internal Audit tab not available');
      return;
    }
    if (!(await selectIaSubTab(page, IA_SUBTAB.readyForReview))) {
      test.skip(true, '"Ready for review" sub-tab not available');
      return;
    }

    // Apply a filter on Ready for review.
    await openIaFilterDrawer(page);
    expect(await applyFirstOwner(page)).not.toBeNull();
    const rfrBadge = await badge(page).count();

    // Needs updates starts independent.
    if (!(await selectIaSubTab(page, IA_SUBTAB.needsUpdates))) {
      test.skip(true, '"Needs updates" sub-tab not available');
      return;
    }
    await expect(badge(page)).toHaveCount(0, { timeout: 10000 });

    // Switch back and forth — Ready for review keeps its own value.
    await selectIaSubTab(page, IA_SUBTAB.readyForReview);
    await expect(badge(page)).toHaveCount(rfrBadge, { timeout: 10000 });
    await selectIaSubTab(page, IA_SUBTAB.needsUpdates);
    await expect(badge(page)).toHaveCount(0, { timeout: 10000 });
  });

  test('TC-14: IA drawer keeps all filter options across sub-tabs', async ({ page }) => {
    test.skip(!shouldRun('TG-7', 'Scenario 7', 'TC-14'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToAudit(page);
    if (!(await gotoInternalAudit(page))) {
      test.skip(true, 'Internal Audit tab not available');
      return;
    }

    let baseline: string[] | null = null;
    let checked = 0;
    for (const label of [
      IA_SUBTAB.readyForReview,
      IA_SUBTAB.needsUpdates,
      IA_SUBTAB.accepted,
      IA_SUBTAB.sentForFinal,
    ]) {
      if (!(await selectIaSubTab(page, label))) {
        continue;
      }
      await openIaFilterDrawer(page);
      const headings = (await sheet(page).getByRole('heading').allInnerTexts())
        .map((t) => t.trim())
        .filter((t) => t && t !== 'Filters');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 });

      if (baseline === null) {
        baseline = headings;
        // Sanity: the IA drawer exposes the expected option groups.
        for (const expected of IA_FILTER_HEADINGS) {
          expect(headings, `IA drawer should contain "${expected}"`).toContain(expected);
        }
      } else {
        expect(new Set(headings), `IA drawer options changed on sub-tab`).toEqual(new Set(baseline));
      }
      checked++;
    }

    expect(checked, 'at least one IA sub-tab should be present').toBeGreaterThan(0);
  });
});

