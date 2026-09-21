import { chromium } from '@playwright/test';
import * as fs from 'fs';

(async () => {
  const baseUrl = process.env.PROD_BASE_URL || 'https://app.quantarra.com';
  const email = process.env.PROD_ADMIN_EMAIL || 'keerthikumar.kothandapani@gmail.com';
  const password = process.env.PROD_ADMIN_PASSWORD || 'Quantarra2026!';

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  // Login
  console.log(`🔐 Logging in to ${baseUrl}...`);
  await page.goto(`${baseUrl}/login`);
  await page.waitForLoadState('networkidle');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(5000);

  // Screenshot after login
  await page.screenshot({ path: 'reports/debug-00-after-login.png', fullPage: true });
  console.log(`📸 Current URL after login: ${page.url()}`);

  // Dismiss wizard if present
  const dismissBtn = page.locator('button', { hasText: /skip|dismiss|close|later|not now/i }).first();
  if (await dismissBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await dismissBtn.click();
    await page.waitForTimeout(1000);
    console.log('  ✅ Dismissed wizard');
  }

  // Navigate to first audit — try different approaches
  console.log('📋 Looking for audit links...');
  let auditLink = page.locator('a[href*="/audit/"]').first();
  let hasAudit = await auditLink.isVisible({ timeout: 10000 }).catch(() => false);
  
  if (!hasAudit) {
    // Try navigating to audits page directly
    console.log('  No audit on home page, trying /audits...');
    await page.goto(`${baseUrl}/audits`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    auditLink = page.locator('a[href*="/audit/"]').first();
    hasAudit = await auditLink.isVisible({ timeout: 10000 }).catch(() => false);
  }

  if (!hasAudit) {
    await page.screenshot({ path: 'reports/debug-00-no-audits.png', fullPage: true });
    console.log('❌ No audit links found. Screenshot saved.');
    console.log(`  Current URL: ${page.url()}`);
    const bodyText = await page.locator('body').innerText();
    console.log(`  Page text (first 300): ${bodyText.substring(0, 300)}`);
    await browser.close();
    return;
  }

  await auditLink.click();
  await page.waitForURL(/\/audit\//, { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Click Audit Workspace tab
  console.log('🗂️ Clicking Audit Workspace tab...');
  const workspaceTab = page.getByRole('tab', { name: /audit workspace|workspace/i });
  await workspaceTab.click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Screenshot BEFORE clicking Controls
  await page.screenshot({ path: 'reports/debug-01-workspace-loaded.png', fullPage: true });
  console.log('📸 Screenshot: debug-01-workspace-loaded.png');

  // Check what's inside #tabpanel-ws
  const wsPanelExists = await page.locator('#tabpanel-ws').count();
  console.log(`\n🔍 #tabpanel-ws exists: ${wsPanelExists > 0}`);

  // Get ALL text content in the workspace area
  if (wsPanelExists > 0) {
    const wsText = await page.locator('#tabpanel-ws').innerText();
    console.log(`\n📝 #tabpanel-ws text (first 500 chars):\n${wsText.substring(0, 500)}`);
  }

  // Find all elements containing "Controls" text
  const controlsElements = await page.locator('text=/[Cc]ontrols/i').all();
  console.log(`\n🔍 Elements matching "Controls": ${controlsElements.length}`);
  for (let i = 0; i < Math.min(controlsElements.length, 10); i++) {
    const text = await controlsElements[i].textContent();
    const tag = await controlsElements[i].evaluate(el => el.tagName);
    const visible = await controlsElements[i].isVisible();
    console.log(`  [${i}] <${tag}> visible=${visible} text="${text?.trim().substring(0, 60)}"`);
  }

  // Try clicking the Controls tab
  console.log('\n🖱️ Clicking Controls tab...');
  const controlsTab = page.locator('#tabpanel-ws').locator('text=/Controls/i').first();
  const ctVisible = await controlsTab.isVisible().catch(() => false);
  console.log(`  Controls tab visible: ${ctVisible}`);
  if (ctVisible) {
    await controlsTab.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
  }

  // Screenshot AFTER clicking Controls
  await page.screenshot({ path: 'reports/debug-02-controls-clicked.png', fullPage: true });
  console.log('📸 Screenshot: debug-02-controls-clicked.png');

  // Now look for "All controls" elements
  const allControlsElements = await page.locator('text=/All controls/i').all();
  console.log(`\n🔍 Elements matching "All controls": ${allControlsElements.length}`);
  for (let i = 0; i < Math.min(allControlsElements.length, 5); i++) {
    const text = await allControlsElements[i].textContent();
    const tag = await allControlsElements[i].evaluate(el => el.tagName);
    const visible = await allControlsElements[i].isVisible();
    console.log(`  [${i}] <${tag}> visible=${visible} text="${text?.trim().substring(0, 60)}"`);
  }

  // Look for "Add control" button
  const addBtns = await page.locator('button').filter({ hasText: /add control/i }).all();
  console.log(`\n🔍 Buttons matching "add control": ${addBtns.length}`);
  for (let i = 0; i < addBtns.length; i++) {
    const text = await addBtns[i].textContent();
    const visible = await addBtns[i].isVisible();
    console.log(`  [${i}] visible=${visible} text="${text?.trim()}"`);
  }

  // Full page text dump for analysis
  const bodyText = await page.locator('body').innerText();
  fs.writeFileSync('reports/debug-page-text.txt', bodyText);
  console.log('\n📄 Full page text saved to: reports/debug-page-text.txt');

  await browser.close();
  console.log('\n✅ Debug complete.');
})();
