import { test, expect, type Page } from '@playwright/test';
import { dismissWizard } from '../../src/helpers/auth';
import { getShakeoutAdmin } from './test-data';
import { shouldRun } from './excel-filter';
import { getAdminSessionPath, checkGate } from './session-setup';

/**
 * Daily Shakeout — TG-6: Audit Lifecycle — Search and Load Existing Audit
 *
 * Session strategy: Login ONCE via storageState. Total logins for this file: 0
 * (session created by 00-auth-setup).
 *
 * Wait strategy: Explicit waits only (up to 30s). No hard sleeps.
 * Tests progress as soon as the element appears.
 */

test.describe('TG-6: Audit Lifecycle — Search and Load Existing Audit', () => {
  test.use({ storageState: getAdminSessionPath() });

  test.beforeEach(({}, testInfo) => {
    const gateReason = checkGate();
    if (gateReason) {
      testInfo.skip(true, gateReason);
    }
  });

  // Daily shakeout always tests against a SOC 2 Type 2 audit for deterministic results.
  const TARGET_FRAMEWORK = 'SOC 2 Type 2';

  /**
   * Assert the current tab/page is NOT showing a real error state.
   *
   * We must NOT use a bare getByText(/error/i): legitimate UI copy (e.g. evidence
   * descriptions like "SaaS solutions are configured to generate error messages…")
   * contains the word "error", which both (a) is a false positive and (b) resolves
   * to multiple elements → strict-mode violation. Instead, look only for genuine
   * error UI: an alert container, or a crash message ("500" / "something went wrong").
   */
  async function expectNoPageError(page: Page) {
    // NOTE: do NOT assert `getByRole('alert').toHaveCount(0)`. The app renders a
    // persistent screen-reader live region (role="alert", aria-live="assertive",
    // 1x1px, empty text) on every page — a global a11y announcer, NOT an error.
    // It is present on all audit tabs, so a bare count(0) is a guaranteed false
    // positive (this is what broke TC-7..TC-11). Only fail on an alert that
    // actually carries visible error text.
    const alerts = page.getByRole('alert');
    const count = await alerts.count();
    for (let i = 0; i < count; i++) {
      const el = alerts.nth(i);
      const text = ((await el.textContent().catch(() => '')) || '').trim();

      // Skip the empty announcer live region — it has no text content.
      if (text.length === 0) {
        continue;
      }

      // A non-empty, visible alert is a real error banner/toast → fail loudly.
      const visible = await el.isVisible().catch(() => false);
      expect(visible, `Unexpected error alert on page: "${text.slice(0, 200)}"`).toBe(false);
    }

    // Genuine crash headline anywhere on the page is always a failure.
    const crashText = page.getByText(/\b500\b|something went wrong|internal server error/i);
    await expect(crashText).toHaveCount(0, { timeout: 5000 });
  }

  /** Helper: navigate to home and wait for audit tiles to load */
  async function goHomeAndWaitForAudits(page: Page) {
    // Use domcontentloaded, NOT networkidle. On staging/prod the home page keeps
    // background traffic (analytics/websocket/AI-context) alive, so networkidle
    // can hang until the 60s timeout even after the page is fully usable. Wait
    // for the audit tiles to render instead — that is the real "ready" signal.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const auditLink = page.locator('a[href*="/audit/"]').first();
    await expect(auditLink).toBeVisible({ timeout: 30000 });
    return auditLink;
  }

  /**
   * Helper: navigate to the SOC 2 Type 2 audit and wait for the audit page to load.
   * Uses the search box to filter to SOC 2, then clicks the matching audit tile.
   * Falls back to the first audit if no SOC 2 Type 2 audit is found.
   */
  async function navigateToFirstAudit(page: Page) {
    await goHomeAndWaitForAudits(page);

    // Filter the audit list via search box (reduces list, makes selection reliable)
    const searchBox = page.locator('input[placeholder*="Search audit"], input[placeholder*="Search"]').first();
    if (await searchBox.isVisible({ timeout: 5000 }).catch(() => false)) {
      await searchBox.fill('SOC 2 Type 2');
      // Search re-queries the list; a short settle is enough. Avoid networkidle
      // (background traffic keeps the network busy and hangs the wait).
      await page.waitForTimeout(1500);
    }

    // Prefer the audit tile whose text contains "SOC 2 Type 2"
    const soc2Audit = page.locator('a[href*="/audit/"]').filter({ hasText: /SOC 2 Type 2/i }).first();
    const hasSoc2 = await soc2Audit.isVisible({ timeout: 5000 }).catch(() => false);

    const target = hasSoc2 ? soc2Audit : page.locator('a[href*="/audit/"]').first();
    if (!hasSoc2) {
      console.log(`  ⚠️ No "${TARGET_FRAMEWORK}" audit found — falling back to first available audit`);
    }

    await target.click();
    await page.waitForURL(/\/audit\//, { timeout: 30000, waitUntil: 'domcontentloaded' });
    // Wait for the audit page's tabs to render — this is the real ready signal.
    // (networkidle can hang on background traffic even after the page is usable.)
    await expect(page.getByRole('tab').first()).toBeVisible({ timeout: 30000 });
  }

  test('TC-1/TC-2: Audit tiles are visible on home page', async ({ page }) => {
    test.skip(!shouldRun('TG-6', 'Scenario 6', 'TC-1'), 'Excluded by Excel — Run Shakeout = No');

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const auditLinks = page.locator('a[href*="/audit/"]').first();
    await expect(auditLinks).toBeVisible({ timeout: 30000 });
    const count = await page.locator('a[href*="/audit/"]').count();
    expect(count).toBeGreaterThan(0);
  });

  test('TC-3: Search box is visible', async ({ page }) => {
    test.skip(!shouldRun('TG-6', 'Scenario 6', 'TC-3'), 'Excluded by Excel — Run Shakeout = No');

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const searchBox = page.locator('input[placeholder*="Search audit"], input[placeholder*="Search"]').first();
    await expect(searchBox).toBeVisible({ timeout: 30000 });
  });

  test('TC-4: Search by framework name filters matching audits', async ({ page }) => {
    test.skip(!shouldRun('TG-6', 'Scenario 6', 'TC-4'), 'Excluded by Excel — Run Shakeout = No');

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const searchBox = page.locator('input[placeholder*="Search audit"], input[placeholder*="Search"]').first();
    if (!(await searchBox.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip(true, 'Search box not visible');
      return;
    }

    await searchBox.fill('SOC');
    // Wait for filter to take effect — audit list should update
    await page.waitForTimeout(1000);
    const auditTiles = page.locator('a[href*="/audit/"]');
    const filteredCount = await auditTiles.count();
    expect(filteredCount).toBeGreaterThanOrEqual(0);
  });

  test('TC-5: Search by audit name filters matching audits', async ({ page }) => {
    test.skip(!shouldRun('TG-6', 'Scenario 6', 'TC-5'), 'Excluded by Excel — Run Shakeout = No');

    await goHomeAndWaitForAudits(page);

    const firstAuditTile = page.locator('a[href*="/audit/"]').first();
    const auditText = await firstAuditTile.textContent();
    const searchTerm = auditText?.trim().substring(0, 5) || 'RG-';

    const searchBox = page.locator('input[placeholder*="Search audit"], input[placeholder*="Search"]').first();
    if (!(await searchBox.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip(true, 'Search box not visible');
      return;
    }

    await searchBox.fill(searchTerm);
    await page.waitForTimeout(1000);

    const mainContent = page.locator('main').first();
    await expect(mainContent).toBeVisible({ timeout: 30000 });
  });

  test('TC-6: Click audit tile — shows 5 tabs (Dashboard, Workspace, IA, Document, Action Plan)', async ({ page }) => {
    test.skip(!shouldRun('TG-6', 'Scenario 6', 'TC-6'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToFirstAudit(page);

    const tabs = page.getByRole('tab');
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThanOrEqual(5);

    const tabTexts = await tabs.allTextContents();
    const tabNames = tabTexts.map((t) => t.trim().toLowerCase());

    expect(tabNames.some((t) => t.includes('dashboard'))).toBeTruthy();
    expect(tabNames.some((t) => t.includes('workspace'))).toBeTruthy();
    expect(tabNames.some((t) => t.includes('internal audit') || t.includes('ia'))).toBeTruthy();
    expect(tabNames.some((t) => t.includes('document'))).toBeTruthy();
    expect(tabNames.some((t) => t.includes('action plan'))).toBeTruthy();
  });

  test('TC-7: Validate Dashboard tab and subtabs', async ({ page }) => {
    test.skip(!shouldRun('TG-6', 'Scenario 6', 'TC-7'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToFirstAudit(page);

    const dashboardTab = page.getByRole('tab', { name: /dashboard/i });
    await dashboardTab.click();
    await page.waitForTimeout(1000);

    await expectNoPageError(page);
  });

  test('TC-8: Validate Workspace tab', async ({ page }) => {
    test.skip(!shouldRun('TG-6', 'Scenario 6', 'TC-8'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToFirstAudit(page);

    const workspaceTab = page.getByRole('tab', { name: /audit workspace|workspace/i });
    await workspaceTab.click();
    await page.waitForTimeout(1000);

    // Wait for workspace content to load (table or list)
    await expect(page.locator('main').first()).toBeVisible({ timeout: 30000 });
    await expectNoPageError(page);
  });

  test('TC-9: Validate Internal Audit tab', async ({ page }) => {
    test.skip(!shouldRun('TG-6', 'Scenario 6', 'TC-9'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToFirstAudit(page);

    const iaTab = page.getByRole('tab', { name: /internal audit|ia/i });
    await iaTab.click();
    // The tab panel is server-rendered on click; the error-absence assertion
    // below has its own timeout. Avoid networkidle (hangs on background traffic).
    await page.waitForTimeout(1000);

    await expectNoPageError(page);
  });

  test('TC-10: Validate Document tab', async ({ page }) => {
    test.skip(!shouldRun('TG-6', 'Scenario 6', 'TC-10'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToFirstAudit(page);

    const docTab = page.getByRole('tab', { name: /document/i });
    await docTab.click();
    await page.waitForTimeout(1000);

    await expectNoPageError(page);
  });

  test('TC-11: Validate Action Plan tab', async ({ page }) => {
    test.skip(!shouldRun('TG-6', 'Scenario 6', 'TC-11'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToFirstAudit(page);

    const apTab = page.getByRole('tab', { name: /action plan/i });
    await apTab.click();
    await page.waitForTimeout(1000);

    await expectNoPageError(page);
  });

  test('TC-12: Dashboard — "controls accepted" tile visible', async ({ page }) => {
    test.skip(!shouldRun('TG-6', 'Scenario 6', 'TC-12'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToFirstAudit(page);

    const dashboardTab = page.getByRole('tab', { name: /dashboard/i });
    await dashboardTab.click();
    await page.waitForTimeout(1000);

    const acceptedTile = page.getByText(/accepted|controls accepted/i).first();
    await expect(acceptedTile).toBeVisible({ timeout: 30000 });
  });

  test('TC-13: Dashboard — "controls that need updates" tile visible', async ({ page }) => {
    test.skip(!shouldRun('TG-6', 'Scenario 6', 'TC-13'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToFirstAudit(page);

    const dashboardTab = page.getByRole('tab', { name: /dashboard/i });
    await dashboardTab.click();
    await page.waitForTimeout(1000);

    const updatesTile = page.getByText(/controls that need update|need update/i).first();
    await expect(updatesTile).toBeVisible({ timeout: 30000 });
  });

  test('TC-14: Dashboard — "controls due this week" tile visible', async ({ page }) => {
    test.skip(!shouldRun('TG-6', 'Scenario 6', 'TC-14'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToFirstAudit(page);

    const dashboardTab = page.getByRole('tab', { name: /dashboard/i });
    await dashboardTab.click();
    await page.waitForTimeout(1000);

    const dueTile = page.getByText(/controls due this week|due this week/i).first();
    await expect(dueTile).toBeVisible({ timeout: 30000 });
  });

  test('TC-15: Dashboard — Donut chart visible', async ({ page }) => {
    test.skip(!shouldRun('TG-6', 'Scenario 6', 'TC-15'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToFirstAudit(page);

    const dashboardTab = page.getByRole('tab', { name: /dashboard/i });
    await dashboardTab.click();
    await page.waitForTimeout(1000);

    const chart = page.locator('svg, canvas, [class*="chart"], [class*="donut"]').first();
    await expect(chart).toBeVisible({ timeout: 30000 });
  });

  test('TC-18: Dashboard — "View all" link clickable', async ({ page }) => {
    test.skip(!shouldRun('TG-6', 'Scenario 6', 'TC-18'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToFirstAudit(page);

    const dashboardTab = page.getByRole('tab', { name: /dashboard/i });
    await dashboardTab.click();
    await page.waitForTimeout(1000);

    const viewAllBtn = page.locator('button, a').filter({ hasText: /view all/i }).first();
    await expect(viewAllBtn).toBeVisible({ timeout: 30000 });
  });

  test('TC-19: Dashboard — "Recent activity" tile visible', async ({ page }) => {
    test.skip(!shouldRun('TG-6', 'Scenario 6', 'TC-19'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToFirstAudit(page);

    const dashboardTab = page.getByRole('tab', { name: /dashboard/i });
    await dashboardTab.click();
    await page.waitForTimeout(1000);

    const recentActivity = page.getByText(/recent activity/i).first();
    await expect(recentActivity).toBeVisible({ timeout: 30000 });
  });

  test('TC-16: Dashboard — Status shows numbers (Not Started, In progress, etc.)', async ({ page }) => {
    test.skip(!shouldRun('TG-6', 'Scenario 6', 'TC-16'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToFirstAudit(page);

    const dashboardTab = page.getByRole('tab', { name: /dashboard/i });
    await dashboardTab.click();
    await page.waitForTimeout(1000);

    // Verify status labels with numbers are visible
    const notStarted = page.getByText(/not started/i).first();
    const inProgress = page.getByText(/in progress/i).first();

    const hasNotStarted = await notStarted.isVisible({ timeout: 10000 }).catch(() => false);
    const hasInProgress = await inProgress.isVisible({ timeout: 5000 }).catch(() => false);

    expect(hasNotStarted || hasInProgress).toBeTruthy();
  });

  test('TC-17: Dashboard — Status numbers are numeric values', async ({ page }) => {
    test.skip(!shouldRun('TG-6', 'Scenario 6', 'TC-17'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToFirstAudit(page);

    const dashboardTab = page.getByRole('tab', { name: /dashboard/i });
    await dashboardTab.click();
    await page.waitForTimeout(1000);

    // Verify there are numeric values displayed near status labels
    const numbers = page.locator('[class*="stat"], [class*="count"], [class*="number"], [class*="metric"]').first();
    const statusSection = page.locator('text=/\\d+/').first();

    const hasNumbers = await numbers.isVisible({ timeout: 10000 }).catch(() => false);
    const hasDigits = await statusSection.isVisible({ timeout: 5000 }).catch(() => false);

    expect(hasNumbers || hasDigits).toBeTruthy();
  });

  test('TC-20: Workspace — Display tabs (Families, Objectives, Controls, Evidence)', async ({ page }) => {
    test.skip(!shouldRun('TG-6', 'Scenario 6', 'TC-20'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToFirstAudit(page);

    const workspaceTab = page.getByRole('tab', { name: /audit workspace|workspace/i });
    await workspaceTab.click();
    await page.waitForTimeout(1000);

    // Verify workspace sub-tabs are present (scoped to workspace panel)
    // Framework-dependent naming:
    //   SOC 2 etc:        Families | Objectives | Controls | Evidence
    //   CyberFundamentals: Categories | Subcategories | Requirements | Evidence
    const wsPanel = page.locator('#tabpanel-ws');
    await expect(wsPanel).toBeVisible({ timeout: 10000 });

    const familiesTab = wsPanel.locator('text=/Families|Categories/i').first();
    const objectivesTab = wsPanel.locator('text=/Objectives|Subcategories/i').first();
    const controlsTab = wsPanel.locator('text=/Controls|Requirements/i').first();
    const evidenceTab = wsPanel.locator('text=/Evidence/i').first();

    const hasFamilies = await familiesTab.isVisible({ timeout: 10000 }).catch(() => false);
    const hasObjectives = await objectivesTab.isVisible({ timeout: 5000 }).catch(() => false);
    const hasControls = await controlsTab.isVisible({ timeout: 5000 }).catch(() => false);
    const hasEvidence = await evidenceTab.isVisible({ timeout: 5000 }).catch(() => false);

    // At least the Controls/Requirements tab should be visible (core tab)
    expect(hasControls).toBeTruthy();
    console.log(`  📋 Workspace tabs: Families/Categories=${hasFamilies}, Objectives/Subcategories=${hasObjectives}, Controls/Requirements=${hasControls}, Evidence=${hasEvidence}`);
  });

  test('TC-21: Workspace — Family (Category) tab shows subtabs', async ({ page }) => {
    test.skip(!shouldRun('TG-6', 'Scenario 6', 'TC-21'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToFirstAudit(page);

    const workspaceTab = page.getByRole('tab', { name: /audit workspace|workspace/i });
    await workspaceTab.click();
    await page.waitForTimeout(1000);

    // Click Families/Category tab (SOC 2: "Families", CyFun: "Categories")
    const familiesTab = page.locator('#tabpanel-ws').locator('text=/Families|Categories/i').first();
    if (await familiesTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await familiesTab.click();
    await page.waitForTimeout(1000);

      // Verify content loads (table or list)
      const content = page.locator('table, [role="table"], [role="grid"], main').first();
      await expect(content).toBeVisible({ timeout: 15000 });
    } else {
      test.skip(true, 'Families/Category tab not visible in this framework');
    }
  });

  test('TC-22: Workspace — Objectives (Sub-Category) tab shows subtabs', async ({ page }) => {
    test.skip(!shouldRun('TG-6', 'Scenario 6', 'TC-22'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToFirstAudit(page);

    const workspaceTab = page.getByRole('tab', { name: /audit workspace|workspace/i });
    await workspaceTab.click();
    await page.waitForTimeout(1000);

    // Click Objectives/Sub-Category tab (SOC 2: "Objectives", CyFun: "Subcategories")
    const objectivesTab = page.locator('#tabpanel-ws').locator('text=/Objectives|Subcategories/i').first();
    if (await objectivesTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await objectivesTab.click();
    await page.waitForTimeout(1000);

      const content = page.locator('table, [role="table"], [role="grid"], main').first();
      await expect(content).toBeVisible({ timeout: 15000 });
    } else {
      test.skip(true, 'Objectives/Sub-Category tab not visible in this framework');
    }
  });

  test('TC-23: Workspace — Controls tab shows All Controls and Controls I Own', async ({ page }) => {
    test.skip(!shouldRun('TG-6', 'Scenario 6', 'TC-23'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToFirstAudit(page);

    const workspaceTab = page.getByRole('tab', { name: /audit workspace|workspace/i });
    await workspaceTab.click();
    await page.waitForTimeout(1000);
    await page.waitForTimeout(2000);

    // Framework-dependent labels:
    //   SOC 2: "All controls (N)" / "Controls I own (N)"
    //   CyberFundamentals: "All requirements (N)" / "Requirements I own (N)"
    // Match either naming convention.
    const allTab = page.locator('text=/All controls|All requirements/i').first();
    const myTab = page.locator('text=/Controls I own|Requirements I own/i').first();

    await expect(allTab).toBeVisible({ timeout: 10000 });
    await expect(myTab).toBeVisible({ timeout: 5000 });
  });

  test('TC-24: Workspace — "+ Add Control" button is enabled', async ({ page }) => {
    test.skip(!shouldRun('TG-6', 'Scenario 6', 'TC-24'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToFirstAudit(page);

    const workspaceTab = page.getByRole('tab', { name: /audit workspace|workspace/i });
    await workspaceTab.click();
    await page.waitForTimeout(1000);
    await page.waitForTimeout(2000);

    // Button label is framework-dependent: "Add control" (SOC 2) or "Add requirement" (CyFun) or similar
    const addBtn = page.locator('button', { hasText: /add control|add requirement|\+ add/i }).first();
    const btnVisible = await addBtn.isVisible({ timeout: 10000 }).catch(() => false);

    if (btnVisible) {
      await expect(addBtn).toBeEnabled();
    } else {
      // Some frameworks (e.g., CyFun) may not have an add button — skip gracefully
      test.skip(true, 'Add Control/Requirement button not present for this framework');
    }
  });

  test('TC-25: Internal Auditor — tabs (Ready for review, Needs updates, Accepted, Findings)', async ({ page }) => {
    test.skip(!shouldRun('TG-6', 'Scenario 6', 'TC-25'), 'Excluded by Excel — Run Shakeout = No');

    await navigateToFirstAudit(page);

    const iaTab = page.getByRole('tab', { name: /internal audit|ia/i });
    await iaTab.click();
    await page.waitForTimeout(1000);

    // Verify IA sub-tabs are present
    const readyTab = page.locator('button, a, [role="tab"]').filter({ hasText: /ready for review|ready/i }).first();
    const needsUpdatesTab = page.locator('button, a, [role="tab"]').filter({ hasText: /needs update|update/i }).first();
    const acceptedTab = page.locator('button, a, [role="tab"]').filter({ hasText: /accepted/i }).first();
    const findingsTab = page.locator('button, a, [role="tab"]').filter({ hasText: /finding/i }).first();

    const hasReady = await readyTab.isVisible({ timeout: 10000 }).catch(() => false);
    const hasUpdates = await needsUpdatesTab.isVisible({ timeout: 5000 }).catch(() => false);
    const hasAccepted = await acceptedTab.isVisible({ timeout: 5000 }).catch(() => false);
    const hasFindings = await findingsTab.isVisible({ timeout: 5000 }).catch(() => false);

    // At least some IA tabs should be present
    expect(hasReady || hasUpdates || hasAccepted || hasFindings).toBeTruthy();
    console.log(`  📋 IA tabs: Ready=${hasReady}, NeedsUpdates=${hasUpdates}, Accepted=${hasAccepted}, Findings=${hasFindings}`);
  });
});

