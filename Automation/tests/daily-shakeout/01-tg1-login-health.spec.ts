import { test, expect } from '@playwright/test';
import { getEnvConfig } from '../../src/config/environment';
import { getShakeoutAdmin } from './test-data';
import { shouldRun, printFilterSummary } from './excel-filter';

/**
 * Daily Shakeout — TG-1: Login Health & URL Availability
 *
 * Validates:
 * 1. Login page loads (HTTP 200)
 * 2. Auth API responds (valid credentials → token)
 * 3. Auth API rejects invalid credentials (401)
 * 4. Health endpoint responds
 *
 * Excel-driven: reads "Run for Smoketest in prod" (Prod) / "Run for Smoketest in POC" (POC/staging) column to decide execution.
 */

const envConfig = getEnvConfig();
const API = envConfig.apiUrl;

test.describe.serial('TG-1: Login Health & URL Availability', () => {

  test.beforeAll(() => {
    printFilterSummary();
  });

  test('Login page loads — HTTP 200, no server errors', async ({ page }) => {
    test.skip(!shouldRun('TG-1', 'Scenario 1', 'TC-1'), 'Excluded by Excel — Run Shakeout = No');

    const response = await page.goto('/login');
    expect(response).not.toBeNull();
    expect(response!.status()).toBeLessThan(400);
    await expect(page.locator('input[type="email"], input[name="email"]').first()).toBeVisible({ timeout: 10000 });
  });

  test('Health endpoint — API backend is alive', async ({ request }) => {
    // Health check is always included — not in Excel but critical
    const res = await request.get(`${API}/health`);
    expect(res.status()).toBe(200);
  });

  test('Auth login — valid credentials return access token', async ({ request }) => {
    test.skip(!shouldRun('TG-1', 'Scenario 1', 'TC-1'), 'Excluded by Excel — Run Shakeout = No');

    const admin = getShakeoutAdmin();
    const res = await request.post(`${API}/auth/login`, {
      data: { email: admin.email, password: admin.password },
    });
    expect([200, 201]).toContain(res.status());
    const body = await res.json();
    expect(body.accessToken).toBeTruthy();
    expect(body.user).toBeTruthy();
    expect(body.user.email).toBe(admin.email);
  });

  test('Auth login — invalid credentials return 401', async ({ request }) => {
    test.skip(!shouldRun('TG-1', 'Scenario 1', 'TC-1'), 'Excluded by Excel — Run Shakeout = No');

    const res = await request.post(`${API}/auth/login`, {
      data: { email: 'invalid-user@doesnotexist.com', password: 'WrongPass123!' },
    });
    expect([401, 429]).toContain(res.status());
  });
});
