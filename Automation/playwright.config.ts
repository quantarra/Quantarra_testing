import { defineConfig, devices } from '@playwright/test';
import { getEnvConfig } from './src/config/environment';

const envConfig = getEnvConfig();

console.log(`\n🎯 Running tests against: ${envConfig.env.toUpperCase()} (${envConfig.baseUrl})\n`);

export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  expect: { timeout: 10000 },
  retries: 1,
  workers: 2,

  use: {
    baseURL: envConfig.baseUrl,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'on-first-retry',
    viewport: { width: 1400, height: 900 },
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },

  projects: [
    // --- Auth Setup (runs before daily-shakeout and regression) ---
    {
      name: 'auth-setup',
      testDir: './tests/daily-shakeout',
      testMatch: '00-auth-setup.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: envConfig.baseUrl,
      },
    },

    // --- Daily Shakeout (POC + Prod environment health) ---
    {
      name: 'daily-shakeout',
      testDir: './tests/daily-shakeout',
      testIgnore: '00-auth-setup.spec.ts',
      dependencies: ['auth-setup'],
      fullyParallel: false,
      // Heavy TG-6/TG-7 tests navigate home → audit → workspace → scroll every
      // control chip on Prod (slow, lazy-rendered lists). The default 60s cap is
      // too tight once the home-tile wait + full-list scrolling are included.
      timeout: 120000,
      retries: 2,
      workers: 1,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: envConfig.baseUrl,
        navigationTimeout: 30000,
      },
    },

    // --- Regression (Full regression — Excel-driven) ---
    {
      name: 'regression',
      testDir: './tests/daily-shakeout',
      testIgnore: '00-auth-setup.spec.ts',
      dependencies: ['auth-setup'],
      fullyParallel: false,
      workers: 1,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: envConfig.baseUrl,
      },
    },

    // --- E2E Flows (full lifecycle tests — Excel "E2E Flow" sheet) ---
    {
      name: 'e2e',
      testDir: './tests/smoke-suite',
      testMatch: 'e2e-*.spec.ts',
      dependencies: ['auth-setup'],
      fullyParallel: false,
      workers: 1,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: envConfig.baseUrl,
        navigationTimeout: 30000,
        actionTimeout: 20000,
      },
    },

    // --- API Test Suite (positive + negative) ---
    {
      name: 'api-suite',
      testDir: './tests/api-suite',
      use: {
        baseURL: envConfig.apiUrl,
      },
    },

    // --- Smoke Suite (from Excel test cases) ---
    {
      name: 'smoke-suite',
      testDir: './tests/smoke-suite',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: envConfig.baseUrl,
      },
    },

    // --- Smoke tests (original) ---
    {
      name: 'smoke-web',
      testDir: './tests/smoke',
      testMatch: /^(?!.*mc-)(?!.*audit-portal).*\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: envConfig.baseUrl,
      },
    },
    {
      name: 'smoke-mc',
      testDir: './tests/smoke',
      testMatch: /mc-.*\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: envConfig.mcUrl,
      },
    },
    {
      name: 'smoke-audit',
      testDir: './tests/smoke',
      testMatch: /audit-portal.*\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: envConfig.auditUrl,
      },
    },
    {
      name: 'smoke-api',
      testDir: './tests/smoke',
      testMatch: /api-.*\.spec\.ts$/,
      use: {
        baseURL: envConfig.apiUrl,
      },
    },

    // --- Original per-app projects ---
    {
      name: 'web-chromium',
      testDir: './tests/web',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: envConfig.baseUrl,
      },
    },
    {
      name: 'mc-chromium',
      testDir: './tests/mission-control',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: envConfig.mcUrl,
      },
    },
    {
      name: 'audit-chromium',
      testDir: './tests/audit-portal',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: envConfig.auditUrl,
      },
    },
    {
      name: 'api',
      testDir: './tests/api',
      use: {
        baseURL: envConfig.apiUrl,
      },
    },
  ],

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: './reports/html' }],
    ['json', { outputFile: './reports/results.json' }],
  ],

  outputDir: './reports/artifacts',
});
